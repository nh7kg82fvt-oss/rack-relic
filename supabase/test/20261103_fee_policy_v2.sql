-- ISOLATED STAGING ONLY. Apply after checkout_quote_refresh and existing
-- protection migrations. Historical orders and quotes retain their 4% amounts.
BEGIN;
ALTER TABLE rr_sandbox.orders ADD COLUMN fee_policy_version text NOT NULL DEFAULT 'rr-fees-v1';

-- PostgreSQL generated the original CHECK name. Find the single monetary
-- relationship instead of depending on its position among unrelated checks.
DO $$
DECLARE names text[];
BEGIN
 SELECT array_agg(conname::text) INTO names FROM pg_constraint
 WHERE conrelid='rr_sandbox.orders'::regclass AND contype='c'
  AND pg_get_constraintdef(oid) LIKE '%buyer_fee_cents%'
  AND pg_get_constraintdef(oid) LIKE '%item_cents%';
 IF cardinality(names) IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'Expected original buyer fee constraint'; END IF;
 EXECUTE format('ALTER TABLE rr_sandbox.orders DROP CONSTRAINT %I',names[1]);
END $$;
ALTER TABLE rr_sandbox.orders ADD CONSTRAINT rr_test_order_fee_policy_check CHECK(
 fee_policy_version IN ('rr-fees-v1','rr-fees-v2') AND
 buyer_fee_cents=(item_cents*CASE fee_policy_version WHEN 'rr-fees-v1' THEN 4 WHEN 'rr-fees-v2' THEN 5 END+50)/100
  +CASE fee_policy_version WHEN 'rr-fees-v2' THEN 50 ELSE 0 END
);

-- A missing tag is compatible only with pre-migration 4% evidence. Explicit
-- nulls and unknown tags are not legacy evidence and must fail closed.
CREATE FUNCTION rr_sandbox.check_fee_policy_document(p_document jsonb,p_version text) RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF p_document IS NULL OR jsonb_typeof(p_document)<>'object' THEN RAISE EXCEPTION 'Fee policy document required'; END IF;
 IF p_document ? 'feePolicyVersion' THEN
  IF jsonb_typeof(p_document->'feePolicyVersion') IS DISTINCT FROM 'string'
   OR (p_document->>'feePolicyVersion') IS DISTINCT FROM p_version
   THEN RAISE EXCEPTION 'Fee policy version mismatch'; END IF;
 ELSIF p_version IS DISTINCT FROM 'rr-fees-v1' THEN RAISE EXCEPTION 'Fee policy version required';
 END IF;
END $$;
REVOKE ALL ON FUNCTION rr_sandbox.check_fee_policy_document(jsonb,text) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION rr_sandbox.guard_order_fee_policy() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP='UPDATE' THEN
  IF NEW.fee_policy_version IS DISTINCT FROM OLD.fee_policy_version
   OR NEW.item_cents IS DISTINCT FROM OLD.item_cents
   OR NEW.buyer_fee_cents IS DISTINCT FROM OLD.buyer_fee_cents
   THEN RAISE EXCEPTION 'Reserved order fee policy and amounts are immutable'; END IF;
  IF OLD.snapshot IS NOT NULL AND NEW.snapshot IS DISTINCT FROM OLD.snapshot
   THEN RAISE EXCEPTION 'Saved order snapshot is immutable'; END IF;
 END IF;
 IF NEW.snapshot IS NOT NULL THEN
  PERFORM rr_sandbox.check_fee_policy_document(NEW.snapshot,NEW.fee_policy_version);
  IF (NEW.snapshot->'itemCents') IS DISTINCT FROM to_jsonb(NEW.item_cents)
   OR (NEW.snapshot->'buyerFeeCents') IS DISTINCT FROM to_jsonb(NEW.buyer_fee_cents)
   THEN RAISE EXCEPTION 'Snapshot fee amounts differ from reservation'; END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION rr_sandbox.guard_order_fee_policy() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER rr_test_order_fee_policy BEFORE INSERT OR UPDATE ON rr_sandbox.orders
 FOR EACH ROW EXECUTE FUNCTION rr_sandbox.guard_order_fee_policy();

CREATE FUNCTION rr_sandbox.guard_checkout_fee_policy() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE o rr_sandbox.orders;
BEGIN
 IF TG_OP='UPDATE' THEN
  IF NEW.order_id IS DISTINCT FROM OLD.order_id THEN RAISE EXCEPTION 'Checkout order is immutable'; END IF;
  IF (OLD.phase<>'prepared' OR OLD.dispatched_at IS NOT NULL OR OLD.session_id IS NOT NULL OR OLD.session_expires_at IS NOT NULL)
   AND (NEW.input IS DISTINCT FROM OLD.input OR NEW.snapshot IS DISTINCT FROM OLD.snapshot)
   THEN RAISE EXCEPTION 'Dispatched checkout evidence is immutable'; END IF;
 END IF;
 SELECT * INTO o FROM rr_sandbox.orders WHERE id=NEW.order_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Checkout reservation required'; END IF;
 PERFORM rr_sandbox.check_fee_policy_document(NEW.input,o.fee_policy_version);
 PERFORM rr_sandbox.check_fee_policy_document(NEW.snapshot,o.fee_policy_version);
 IF (NEW.snapshot->'itemCents') IS DISTINCT FROM to_jsonb(o.item_cents)
  OR (NEW.snapshot->'buyerFeeCents') IS DISTINCT FROM to_jsonb(o.buyer_fee_cents)
  THEN RAISE EXCEPTION 'Checkout fee amounts differ from reservation'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION rr_sandbox.guard_checkout_fee_policy() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER rr_test_checkout_fee_policy BEFORE INSERT OR UPDATE ON rr_sandbox.checkout_attempts
 FOR EACH ROW EXECUTE FUNCTION rr_sandbox.guard_checkout_fee_policy();

CREATE OR REPLACE FUNCTION public.rr_test_reserve(p_order uuid,p_listing uuid,p_buyer uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=rr_sandbox,pg_temp AS $$
DECLARE l catalog; o orders;
BEGIN
 IF p_order IS NULL OR p_listing IS NULL OR p_buyer IS NULL THEN RAISE EXCEPTION 'Order identity required'; END IF;
 -- Keep the existing catalog -> order lock order used by payment recovery.
 SELECT * INTO l FROM catalog WHERE id=p_listing FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Listing unavailable'; END IF;
 SELECT * INTO o FROM orders WHERE id=p_order;
 IF FOUND THEN
  IF o.buyer_id<>p_buyer OR o.listing_id<>p_listing THEN RAISE EXCEPTION 'Order identity mismatch'; END IF;
  RETURN to_jsonb(o);
 END IF;
 IF l.status<>'published' OR l.moderation_status<>'active' OR l.seller_id=p_buyer THEN RAISE EXCEPTION 'Listing unavailable'; END IF;
 IF EXISTS(SELECT 1 FROM orders WHERE listing_id=l.id AND state IN ('reserved','checkout_open','payment_pending','paid')) THEN RAISE EXCEPTION 'Listing already reserved'; END IF;
 INSERT INTO orders(id,listing_id,buyer_id,seller_id,listing_version,listing_updated_at,item_cents,buyer_fee_cents,fee_policy_version,state)
 -- The fixed fifty cents is charged once on this order's item subtotal.
 VALUES(p_order,l.id,p_buyer,l.seller_id,l.version,l.updated_at,l.price_cents,(l.price_cents*5+50)/100+50,'rr-fees-v2','reserved') RETURNING * INTO o;
 RETURN to_jsonb(o);
END $$;

CREATE OR REPLACE FUNCTION public.rr_test_prepare_checkout(p_order uuid,p_buyer uuid,p_input jsonb,p_snapshot jsonb,p_expires timestamptz) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=rr_sandbox,pg_temp AS $$
DECLARE o orders; a checkout_attempts; shipping bigint; tax bigint;
BEGIN
 SELECT * INTO o FROM orders WHERE id=p_order FOR UPDATE;
 IF NOT FOUND OR o.buyer_id<>p_buyer OR p_buyer IS NULL THEN RAISE EXCEPTION 'Order unavailable'; END IF;
 -- Check the requested policy even on a replay; never silently reinterpret
 -- an older reservation as a new price or relabel saved evidence.
 PERFORM rr_sandbox.check_fee_policy_document(p_input,o.fee_policy_version);
 PERFORM rr_sandbox.check_fee_policy_document(p_snapshot,o.fee_policy_version);
 SELECT * INTO a FROM checkout_attempts WHERE order_id=p_order FOR UPDATE;
 IF FOUND THEN
  IF a.phase<>'prepared' OR a.dispatched_at IS NOT NULL OR a.session_id IS NOT NULL
   OR a.session_expires_at IS NOT NULL OR a.quote_expires_at>clock_timestamp()
   THEN RETURN to_jsonb(a); END IF;
  IF (p_input->'shippingQuote'->>'destinationHash') IS DISTINCT FROM
   (a.input->'shippingQuote'->>'destinationHash') THEN RAISE EXCEPTION 'Destination differs from saved checkout'; END IF;
 END IF;
 IF o.state<>'reserved' OR p_expires IS NULL OR p_expires<=clock_timestamp() OR p_expires>clock_timestamp()+interval '30 minutes' THEN RAISE EXCEPTION 'Reservation or quote expired'; END IF;
 IF p_input IS NULL OR p_snapshot IS NULL OR jsonb_typeof(p_input)<>'object' OR jsonb_typeof(p_snapshot)<>'object'
  OR (p_input->>'orderId') IS DISTINCT FROM o.id::text OR (p_input->>'buyerId') IS DISTINCT FROM o.buyer_id::text
  OR (p_input->'listing'->>'id') IS DISTINCT FROM o.listing_id::text
  OR (p_input->'listing'->>'seller_id') IS DISTINCT FROM o.seller_id::text
  OR (p_input->'listing'->>'price_cents') IS DISTINCT FROM o.item_cents::text
  OR (p_snapshot->'test') IS DISTINCT FROM 'true'::jsonb
  OR (p_snapshot->>'orderId') IS DISTINCT FROM o.id::text OR (p_snapshot->>'listingId') IS DISTINCT FROM o.listing_id::text
  OR (p_snapshot->>'sellerId') IS DISTINCT FROM o.seller_id::text OR (p_snapshot->>'currency') IS DISTINCT FROM 'USD'
  THEN RAISE EXCEPTION 'Checkout identity mismatch'; END IF;
 IF NOT (p_snapshot ?& array['itemCents','buyerFeeCents','shippingCents','taxCents','totalCents'])
  OR EXISTS(SELECT 1 FROM jsonb_each(p_snapshot) WHERE key IN ('itemCents','buyerFeeCents','shippingCents','taxCents','totalCents') AND (jsonb_typeof(value)<>'number' OR value::text !~ '^[0-9]+$')) THEN RAISE EXCEPTION 'Invalid checkout amounts'; END IF;
 shipping:=(p_snapshot->>'shippingCents')::bigint;tax:=(p_snapshot->>'taxCents')::bigint;
 IF (p_snapshot->>'itemCents')::bigint<>o.item_cents OR (p_snapshot->>'buyerFeeCents')::bigint<>o.buyer_fee_cents
  OR shipping NOT BETWEEN 0 AND 100000 OR tax NOT BETWEEN 0 AND 10000000
  OR (p_snapshot->>'totalCents')::bigint<>o.item_cents+o.buyer_fee_cents+shipping+tax
  THEN RAISE EXCEPTION 'Checkout amount mismatch'; END IF;
 IF (p_input->'shippingQuote'->'amountCents') IS DISTINCT FROM (p_snapshot->'shippingCents')
  OR (p_input->'taxQuote'->'amountCents') IS DISTINCT FROM (p_snapshot->'taxCents')
  OR (p_input->'taxQuote'->'baseCents') IS DISTINCT FROM to_jsonb(o.item_cents+o.buyer_fee_cents+shipping)
  OR (p_snapshot->'baseCents') IS DISTINCT FROM to_jsonb(o.item_cents+o.buyer_fee_cents+shipping)
  OR (p_input->'shippingQuote'->'test') IS DISTINCT FROM 'true'::jsonb
  OR (p_input->'taxQuote'->'test') IS DISTINCT FROM 'true'::jsonb
  OR (p_input->'shippingQuote'->>'orderId') IS DISTINCT FROM o.id::text
  OR (p_input->'taxQuote'->>'orderId') IS DISTINCT FROM o.id::text
  OR (p_input->'shippingQuote'->>'destinationHash') IS NULL
  OR (p_input->'shippingQuote'->>'destinationHash') !~ '^[a-f0-9]{64}$'
  OR (p_input->'taxQuote'->>'destinationHash') IS DISTINCT FROM (p_input->'shippingQuote'->>'destinationHash')
  THEN RAISE EXCEPTION 'Checkout quote evidence mismatch'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_object_keys(p_input) k WHERE k NOT IN ('orderId','buyerId','listing','shippingQuote','taxQuote','feePolicyVersion')) THEN RAISE EXCEPTION 'Unexpected checkout input'; END IF;
 INSERT INTO checkout_attempts(order_id,input,snapshot,quote_expires_at) VALUES(p_order,p_input,p_snapshot,p_expires)
 ON CONFLICT(order_id) DO UPDATE SET input=excluded.input,snapshot=excluded.snapshot,quote_expires_at=excluded.quote_expires_at
 RETURNING * INTO a;
 RETURN to_jsonb(a);
END $$;

REVOKE ALL ON FUNCTION public.rr_test_reserve(uuid,uuid,uuid),
 public.rr_test_prepare_checkout(uuid,uuid,jsonb,jsonb,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.rr_test_reserve(uuid,uuid,uuid),
 public.rr_test_prepare_checkout(uuid,uuid,jsonb,jsonb,timestamptz) TO service_role;
COMMIT;
