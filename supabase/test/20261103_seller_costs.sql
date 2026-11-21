-- ISOLATED STAGING ONLY. Apply after fee_policy_v2 and existing test migrations.
-- Service RPCs only. Authentication and provider retrieval belong to the trusted
-- server; record additionally requires its participating-operator allowlist.
-- This is accounting/consent, never a transfer or payout executor.
BEGIN;
CREATE TABLE rr_sandbox.seller_cost_disclosures (
 order_id uuid PRIMARY KEY REFERENCES rr_sandbox.orders(id),
 seller_id uuid NOT NULL, document text NOT NULL, payload jsonb NOT NULL,
 disclosure_hash text NOT NULL CHECK(disclosure_hash ~ '^[a-f0-9]{64}$'),
 created_by uuid NOT NULL, recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE rr_sandbox.seller_cost_acceptances (
 order_id uuid PRIMARY KEY REFERENCES rr_sandbox.seller_cost_disclosures(order_id),
 seller_id uuid NOT NULL, disclosure_hash text NOT NULL,
 accepted_by uuid NOT NULL, accepted_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE rr_sandbox.seller_cost_allocations (
 order_id uuid NOT NULL REFERENCES rr_sandbox.orders(id), kind text NOT NULL,
 obligation_key text NOT NULL, seller_id uuid NOT NULL,
 phase text NOT NULL CHECK(phase IN ('reserved','confirmed')),
 amount_cents bigint NOT NULL CHECK(amount_cents BETWEEN 0 AND 10000000),
 source_total_cents bigint NOT NULL CHECK(source_total_cents BETWEEN 0 AND 30000000),
 source_reference text, evidence jsonb NOT NULL,
 recorded_by uuid NOT NULL, recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 confirmed_by uuid, confirmed_at timestamptz,
 PRIMARY KEY(order_id,kind), UNIQUE(order_id,obligation_key),
 CHECK(kind IN ('processing','radar','connect_active_account','payout','insurance')),
 CHECK(amount_cents<=source_total_cents),
 CHECK((phase='reserved' AND source_reference IS NULL AND confirmed_at IS NULL AND confirmed_by IS NULL)
  OR (phase='confirmed' AND source_reference IS NOT NULL AND confirmed_at IS NOT NULL AND confirmed_by IS NOT NULL))
);
CREATE INDEX rr_test_cost_obligation ON rr_sandbox.seller_cost_allocations(obligation_key);
CREATE INDEX rr_test_cost_source ON rr_sandbox.seller_cost_allocations(source_reference);
ALTER TABLE rr_sandbox.seller_cost_disclosures ENABLE ROW LEVEL SECURITY;
ALTER TABLE rr_sandbox.seller_cost_acceptances ENABLE ROW LEVEL SECURITY;
ALTER TABLE rr_sandbox.seller_cost_allocations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON rr_sandbox.seller_cost_disclosures,rr_sandbox.seller_cost_acceptances,
 rr_sandbox.seller_cost_allocations FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION rr_sandbox.guard_seller_cost_immutable() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF TG_TABLE_NAME<>'seller_cost_allocations' OR TG_OP='DELETE'
  THEN RAISE EXCEPTION 'Seller cost evidence is immutable'; END IF;
 IF OLD.phase='confirmed' THEN RAISE EXCEPTION 'Seller cost evidence is immutable'; END IF;
 IF NEW.order_id IS DISTINCT FROM OLD.order_id OR NEW.kind IS DISTINCT FROM OLD.kind
  OR NEW.obligation_key IS DISTINCT FROM OLD.obligation_key OR NEW.seller_id IS DISTINCT FROM OLD.seller_id
  OR NEW.recorded_at IS DISTINCT FROM OLD.recorded_at OR NEW.recorded_by IS DISTINCT FROM OLD.recorded_by
  THEN RAISE EXCEPTION 'Seller cost binding and audit are immutable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER rr_test_cost_disclosure_immutable BEFORE UPDATE OR DELETE ON rr_sandbox.seller_cost_disclosures
 FOR EACH ROW EXECUTE FUNCTION rr_sandbox.guard_seller_cost_immutable();
CREATE TRIGGER rr_test_cost_acceptance_immutable BEFORE UPDATE OR DELETE ON rr_sandbox.seller_cost_acceptances
 FOR EACH ROW EXECUTE FUNCTION rr_sandbox.guard_seller_cost_immutable();
CREATE TRIGGER rr_test_cost_allocation_immutable BEFORE UPDATE OR DELETE ON rr_sandbox.seller_cost_allocations
 FOR EACH ROW EXECUTE FUNCTION rr_sandbox.guard_seller_cost_immutable();

-- Deliberately project only amounts and opaque identities, never quote addresses
-- or arbitrary checkout input. The first disclosure freezes period/batch.
CREATE FUNCTION rr_sandbox.seller_cost_order(p_order uuid) RETURNS jsonb
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE o rr_sandbox.orders; q jsonb; d jsonb; result jsonb; paid timestamptz;
BEGIN
 SELECT * INTO o FROM rr_sandbox.orders WHERE id=p_order;
 IF NOT FOUND OR o.fee_policy_version<>'rr-fees-v2' THEN RAISE EXCEPTION 'Version 2 test order required'; END IF;
 SELECT payload INTO d FROM rr_sandbox.seller_cost_disclosures WHERE order_id=o.id;
 SELECT coalesce(o.snapshot,a.snapshot) INTO q FROM (SELECT 1) z
  LEFT JOIN rr_sandbox.checkout_attempts a ON a.order_id=o.id;
 IF q IS NULL THEN RAISE EXCEPTION 'Prepared checkout snapshot required'; END IF;
 result:=jsonb_build_object('test',true,'orderId',o.id,'sellerId',o.seller_id,'currency','USD',
  'feePolicyVersion',o.fee_policy_version,'itemCents',o.item_cents,'buyerFeeCents',o.buyer_fee_cents,
  'shippingCents',q->'shippingCents','taxCents',q->'taxCents','totalCents',q->'totalCents',
  'settlementPeriod',coalesce(d->>'settlementPeriod',to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM')),
  'payoutBatchId',coalesce(d->>'payoutBatchId',o.id::text));
 SELECT min(processed_at) INTO paid FROM rr_sandbox.provider_events WHERE order_id=o.id
  AND event_type IN ('checkout.session.completed','checkout.session.async_payment_succeeded');
 IF paid IS NOT NULL AND o.payment_intent_id IS NOT NULL THEN
  result:=result||jsonb_build_object('paidAt',floor(extract(epoch FROM paid)*1000)::bigint);
 END IF;
 RETURN result;
END $$;

CREATE FUNCTION rr_sandbox.seller_cost_review(p_actor uuid,p_order uuid) RETURNS jsonb
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE o rr_sandbox.orders; d rr_sandbox.seller_cost_disclosures; a rr_sandbox.seller_cost_acceptances;
 costs jsonb; prior jsonb; acceptance jsonb; projected jsonb;
BEGIN
 SELECT * INTO o FROM rr_sandbox.orders WHERE id=p_order;
 IF NOT FOUND OR p_actor IS NULL OR p_actor NOT IN (o.seller_id,o.buyer_id) THEN RAISE EXCEPTION 'Order unavailable'; END IF;
 -- Historical orders expose their saved figures for a clear held explanation.
 -- They never enter the new disclosure, cost assessment or consent workflow.
 IF o.fee_policy_version='rr-fees-v1' THEN
  RETURN jsonb_build_object('test',true,'orderId',o.id,'feePolicyVersion',o.fee_policy_version,
   'order',jsonb_build_object('orderId',o.id,'sellerId',o.seller_id,'feePolicyVersion',o.fee_policy_version,
    'itemCents',o.item_cents,'buyerFeeCents',o.buyer_fee_cents),
   'disclosure',NULL,'acceptance',NULL,'costs','[]'::jsonb,'priorAllocations','[]'::jsonb,'releaseEnabled',false);
 END IF;
 projected:=rr_sandbox.seller_cost_order(o.id);
 SELECT * INTO d FROM rr_sandbox.seller_cost_disclosures WHERE order_id=o.id;
 SELECT * INTO a FROM rr_sandbox.seller_cost_acceptances WHERE order_id=o.id;
 IF a.order_id IS NOT NULL THEN acceptance:=jsonb_build_object('test',true,'source','server_verified_session','authenticated',true,
  'orderId',o.id,'sellerId',o.seller_id,'policyVersion','rr-seller-costs-v1','feePolicyVersion','rr-fees-v2',
  'disclosureHash',a.disclosure_hash,'authenticatedAt',floor(extract(epoch FROM a.accepted_at)*1000)::bigint); END IF;
 SELECT coalesce(jsonb_agg(evidence ORDER BY kind),'[]'::jsonb) INTO costs
  FROM rr_sandbox.seller_cost_allocations WHERE order_id=o.id;
 -- Bounded, complete current allocations for shared obligations and receipts.
 IF (SELECT count(*) FROM rr_sandbox.seller_cost_allocations p WHERE p.seller_id=o.seller_id)>10000
  THEN RAISE EXCEPTION 'Cost allocation review limit; reconciliation required'; END IF;
 SELECT coalesce(jsonb_agg(evidence ORDER BY order_id,kind),'[]'::jsonb) INTO prior
  FROM rr_sandbox.seller_cost_allocations WHERE seller_id=o.seller_id;
 RETURN jsonb_build_object('test',true,'orderId',o.id,'feePolicyVersion',o.fee_policy_version,'order',projected,
  'disclosure',CASE WHEN d.order_id IS NULL THEN NULL ELSE d.payload||jsonb_build_object('hash',d.disclosure_hash) END,
  'acceptance',acceptance,'costs',costs,'priorAllocations',prior,'releaseEnabled',false);
END $$;
CREATE FUNCTION public.rr_test_seller_cost_context(p_actor uuid,p_order uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF p_actor IS NULL OR NOT EXISTS(SELECT 1 FROM rr_sandbox.orders WHERE id=p_order AND seller_id=p_actor)
  THEN RAISE EXCEPTION 'Seller order unavailable'; END IF;
 RETURN rr_sandbox.seller_cost_review(p_actor,p_order);
END $$;
CREATE FUNCTION public.rr_test_seller_cost_review(p_actor uuid,p_order uuid) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$ SELECT rr_sandbox.seller_cost_review(p_actor,p_order) $$;

CREATE FUNCTION public.rr_test_prepare_seller_cost_disclosure(p_actor uuid,p_order uuid,p_document text,p_hash text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE o rr_sandbox.orders; a rr_sandbox.checkout_attempts; d rr_sandbox.seller_cost_disclosures;
 p jsonb; q jsonb; required text[]:=ARRAY['test','policyVersion','feePolicyVersion','orderId','sellerId','currency',
 'itemCents','buyerFeeCents','shippingCents','taxCents','totalCents','settlementPeriod','payoutBatchId',
 'maxTotalCents','costCaps','selectedInsurance','createdAt'];
BEGIN
 SELECT * INTO o FROM rr_sandbox.orders WHERE id=p_order FOR UPDATE;
 IF NOT FOUND OR p_actor IS NULL OR p_actor<>o.seller_id THEN RAISE EXCEPTION 'Seller order unavailable'; END IF;
 IF o.fee_policy_version<>'rr-fees-v2' THEN RAISE EXCEPTION 'Version 2 test order required'; END IF;
 IF p_document IS NULL OR octet_length(p_document)>8192 OR p_hash IS NULL OR p_hash !~ '^[a-f0-9]{64}$'
  OR encode(sha256(convert_to('rr-cost-disclosure-v1'||chr(10)||p_document,'UTF8')),'hex')<>p_hash
  THEN RAISE EXCEPTION 'Invalid seller cost disclosure hash'; END IF;
 p:=p_document::jsonb;
 SELECT * INTO d FROM rr_sandbox.seller_cost_disclosures WHERE order_id=o.id;
 IF FOUND THEN
  IF d.document IS DISTINCT FROM p_document OR d.disclosure_hash IS DISTINCT FROM p_hash
   THEN RAISE EXCEPTION 'Seller cost disclosure is immutable; new order required'; END IF;
  RETURN rr_sandbox.seller_cost_review(p_actor,p_order);
 END IF;
 SELECT * INTO a FROM rr_sandbox.checkout_attempts WHERE order_id=o.id FOR UPDATE;
 IF NOT FOUND OR a.phase<>'prepared' OR a.dispatched_at IS NOT NULL OR a.session_id IS NOT NULL
  OR a.quote_expires_at<=clock_timestamp() OR o.state<>'reserved' OR o.snapshot IS NOT NULL
  THEN RAISE EXCEPTION 'Fresh prepared checkout required before seller disclosure'; END IF;
 q:=rr_sandbox.seller_cost_order(p_order);
 IF jsonb_typeof(p) IS DISTINCT FROM 'object' OR NOT(p ?& required)
  OR EXISTS(SELECT 1 FROM jsonb_object_keys(p) k WHERE NOT(k=ANY(required)))
  OR p->'test' IS DISTINCT FROM 'true'::jsonb OR p->>'policyVersion' IS DISTINCT FROM 'rr-seller-costs-v1'
  OR EXISTS(SELECT 1 FROM jsonb_each(q-'paidAt') e WHERE p->e.key IS DISTINCT FROM e.value)
  OR jsonb_typeof(p->'selectedInsurance') IS DISTINCT FROM 'boolean'
  THEN RAISE EXCEPTION 'Invalid or unbound seller cost disclosure'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_each(p) WHERE key IN ('itemCents','buyerFeeCents','shippingCents','taxCents','totalCents','maxTotalCents','createdAt')
  AND (jsonb_typeof(value)<>'number' OR value::text !~ '^[0-9]+$'))
  OR (p->>'maxTotalCents')::numeric NOT BETWEEN 0 AND o.item_cents
  OR (p->>'createdAt')::numeric NOT BETWEEN extract(epoch FROM clock_timestamp())*1000-300000 AND extract(epoch FROM clock_timestamp())*1000+30000
  OR (p->>'createdAt')::numeric>extract(epoch FROM clock_timestamp())*1000
  THEN RAISE EXCEPTION 'Invalid seller cost disclosure amounts or time'; END IF;
 IF jsonb_typeof(p->'costCaps') IS DISTINCT FROM 'object'
  OR NOT(p->'costCaps' ?& ARRAY['processing','radar','connect_active_account','payout','insurance'])
  OR EXISTS(SELECT 1 FROM jsonb_each(p->'costCaps') WHERE key NOT IN ('processing','radar','connect_active_account','payout','insurance')
   OR jsonb_typeof(value)<>'number' OR value::text !~ '^[0-9]+$' OR value::numeric NOT BETWEEN 0 AND o.item_cents)
  OR (p->'selectedInsurance'='false'::jsonb AND p->'costCaps'->'insurance'<>'0'::jsonb)
  THEN RAISE EXCEPTION 'Known seller cost caps required'; END IF;
 INSERT INTO rr_sandbox.seller_cost_disclosures(order_id,seller_id,document,payload,disclosure_hash,created_by)
  VALUES(o.id,o.seller_id,p_document,p,p_hash,p_actor);
 RETURN rr_sandbox.seller_cost_review(p_actor,p_order);
END $$;
CREATE FUNCTION public.rr_test_accept_seller_costs(p_actor uuid,p_order uuid,p_hash text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE o rr_sandbox.orders; d rr_sandbox.seller_cost_disclosures; a rr_sandbox.seller_cost_acceptances;
BEGIN
 SELECT * INTO o FROM rr_sandbox.orders WHERE id=p_order FOR UPDATE;
 IF NOT FOUND OR p_actor IS NULL OR p_actor<>o.seller_id OR o.fee_policy_version<>'rr-fees-v2' THEN RAISE EXCEPTION 'Seller order unavailable'; END IF;
 SELECT * INTO d FROM rr_sandbox.seller_cost_disclosures WHERE order_id=o.id;
 IF NOT FOUND OR p_hash IS NULL OR p_hash<>d.disclosure_hash THEN RAISE EXCEPTION 'Exact seller disclosure acceptance required'; END IF;
 SELECT * INTO a FROM rr_sandbox.seller_cost_acceptances WHERE order_id=o.id;
 IF FOUND THEN RETURN rr_sandbox.seller_cost_review(p_actor,p_order); END IF;
 IF o.state<>'reserved' OR NOT EXISTS(SELECT 1 FROM rr_sandbox.checkout_attempts WHERE order_id=o.id AND phase='prepared'
  AND dispatched_at IS NULL AND session_id IS NULL AND quote_expires_at>clock_timestamp())
  THEN RAISE EXCEPTION 'Seller acceptance required before checkout dispatch'; END IF;
 INSERT INTO rr_sandbox.seller_cost_acceptances(order_id,seller_id,disclosure_hash,accepted_by)
  VALUES(o.id,o.seller_id,d.disclosure_hash,p_actor);
 RETURN rr_sandbox.seller_cost_review(p_actor,p_order);
END $$;

-- Disclosure locks the whole saved quote, including destination/rate/tax quote.
-- Refreshing an expired quote with different evidence requires a new order.
CREATE FUNCTION rr_sandbox.guard_checkout_seller_costs() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE d rr_sandbox.seller_cost_disclosures; v text;
BEGIN
 SELECT fee_policy_version INTO v FROM rr_sandbox.orders WHERE id=NEW.order_id;
 IF v<>'rr-fees-v2' THEN RETURN NEW; END IF;
 SELECT * INTO d FROM rr_sandbox.seller_cost_disclosures WHERE order_id=NEW.order_id;
 IF TG_OP='UPDATE' AND d.order_id IS NOT NULL AND (NEW.input IS DISTINCT FROM OLD.input OR NEW.snapshot IS DISTINCT FROM OLD.snapshot)
  THEN RAISE EXCEPTION 'Seller disclosure freezes checkout quote; new order required'; END IF;
 IF NEW.phase<>'prepared' THEN
  IF d.order_id IS NULL OR NOT EXISTS(SELECT 1 FROM rr_sandbox.seller_cost_acceptances WHERE order_id=NEW.order_id AND disclosure_hash=d.disclosure_hash)
   THEN RAISE EXCEPTION 'Seller cost acceptance required before checkout dispatch'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_each(NEW.snapshot) e WHERE e.key IN ('itemCents','buyerFeeCents','shippingCents','taxCents','totalCents') AND d.payload->e.key IS DISTINCT FROM e.value)
   THEN RAISE EXCEPTION 'Accepted seller cost snapshot mismatch'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER rr_test_checkout_seller_costs BEFORE INSERT OR UPDATE ON rr_sandbox.checkout_attempts
 FOR EACH ROW EXECUTE FUNCTION rr_sandbox.guard_checkout_seller_costs();
CREATE FUNCTION rr_sandbox.guard_order_seller_costs() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE d rr_sandbox.seller_cost_disclosures;
BEGIN
 IF NEW.fee_policy_version='rr-fees-v2' AND NEW.snapshot IS NOT NULL AND (TG_OP='INSERT' OR OLD.snapshot IS NULL) THEN
  SELECT * INTO d FROM rr_sandbox.seller_cost_disclosures WHERE order_id=NEW.id;
  IF d.order_id IS NULL OR NOT EXISTS(SELECT 1 FROM rr_sandbox.seller_cost_acceptances WHERE order_id=NEW.id AND disclosure_hash=d.disclosure_hash)
   OR EXISTS(SELECT 1 FROM jsonb_each(NEW.snapshot) e WHERE e.key IN ('itemCents','buyerFeeCents','shippingCents','taxCents','totalCents') AND d.payload->e.key IS DISTINCT FROM e.value)
   THEN RAISE EXCEPTION 'Accepted seller cost disclosure required for saved checkout'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER rr_test_order_seller_costs BEFORE INSERT OR UPDATE ON rr_sandbox.orders
 FOR EACH ROW EXECUTE FUNCTION rr_sandbox.guard_order_seller_costs();

CREATE FUNCTION public.rr_test_record_seller_cost(p_actor uuid,p_order uuid,p_evidence jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE o rr_sandbox.orders; d rr_sandbox.seller_cost_disclosures; previous rr_sandbox.seller_cost_allocations;
 e jsonb:=p_evidence; k text; ph text; ob text; ref text; amount bigint; total bigint; used bigint; lock_key text;
 allowed text[]:=ARRAY['test','verified','source','obligationKey','orderId','sellerId','kind','phase','amountCents',
 'sourceTotalCents','sourceReference','currency','observedAt','scope','period','payoutBatchId','payoutReference'];
BEGIN
 -- The trusted repository additionally restricts this RPC to its configured
 -- participating operator. Browser callers receive no record-cost route.
 SELECT * INTO o FROM rr_sandbox.orders WHERE id=p_order FOR UPDATE;
 IF NOT FOUND OR p_actor IS NULL OR p_actor NOT IN (o.seller_id,o.buyer_id) OR o.fee_policy_version<>'rr-fees-v2'
  THEN RAISE EXCEPTION 'Version 2 participant order required'; END IF;
 SELECT * INTO d FROM rr_sandbox.seller_cost_disclosures WHERE order_id=o.id;
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM rr_sandbox.seller_cost_acceptances WHERE order_id=o.id AND disclosure_hash=d.disclosure_hash)
  THEN RAISE EXCEPTION 'Accepted seller cost disclosure required'; END IF;
 IF e IS NULL OR jsonb_typeof(e)<>'object' OR NOT(e ?& ARRAY['test','verified','source','obligationKey','orderId','sellerId','kind','phase',
  'amountCents','sourceTotalCents','sourceReference','currency','observedAt','scope'])
  OR EXISTS(SELECT 1 FROM jsonb_object_keys(e) x WHERE NOT(x=ANY(allowed)))
  OR e->'test' IS DISTINCT FROM 'true'::jsonb OR e->'verified' IS DISTINCT FROM 'true'::jsonb
  OR e->>'orderId' IS DISTINCT FROM o.id::text OR e->>'sellerId' IS DISTINCT FROM o.seller_id::text
  OR e->>'currency' IS DISTINCT FROM 'USD' THEN RAISE EXCEPTION 'Invalid verified seller cost evidence'; END IF;
 k:=e->>'kind';ph:=e->>'phase';ref:=e->>'sourceReference';
 IF k IS NULL OR k NOT IN ('processing','radar','connect_active_account','payout','insurance') OR ph IS NULL OR ph NOT IN ('reserved','confirmed')
  OR EXISTS(SELECT 1 FROM jsonb_each(e) WHERE key IN ('amountCents','sourceTotalCents','observedAt')
   AND (jsonb_typeof(value)<>'number' OR value::text !~ '^[0-9]+$'))
  OR (e->>'amountCents')::numeric NOT BETWEEN 0 AND 10000000
  OR (e->>'sourceTotalCents')::numeric NOT BETWEEN 0 AND 30000000
  OR (e->>'observedAt')::numeric NOT BETWEEN 1000000000000 AND extract(epoch FROM clock_timestamp())*1000+30000
  THEN RAISE EXCEPTION 'Invalid seller cost kind, phase or integer amounts'; END IF;
 amount:=(e->>'amountCents')::bigint;total:=(e->>'sourceTotalCents')::bigint;
 ob:=CASE k WHEN 'connect_active_account' THEN k||':'||o.seller_id||':'||(d.payload->>'settlementPeriod')
  WHEN 'payout' THEN k||':'||(d.payload->>'payoutBatchId') ELSE k||':'||o.id END;
 IF e->>'obligationKey' IS DISTINCT FROM ob OR amount>total OR amount>(d.payload->'costCaps'->>k)::bigint
  OR k='insurance' AND d.payload->'selectedInsurance'<>'true'::jsonb
  OR k='connect_active_account' AND (e->>'scope' IS DISTINCT FROM 'seller_month' OR e->>'period' IS DISTINCT FROM d.payload->>'settlementPeriod')
  OR k='payout' AND (e->>'scope' IS DISTINCT FROM 'payout' OR e->>'payoutBatchId' IS DISTINCT FROM d.payload->>'payoutBatchId')
  OR k IN ('processing','radar','insurance') AND e->>'scope' IS DISTINCT FROM 'order'
  OR k<>'connect_active_account' AND e ? 'period'
  OR k<>'payout' AND (e ? 'payoutBatchId' OR e ? 'payoutReference')
  THEN RAISE EXCEPTION 'Seller cost scope, disclosure cap or selection mismatch'; END IF;
 IF ph='reserved' THEN
  IF e->>'source' IS DISTINCT FROM 'disclosed_reserve' OR e->'sourceReference' IS DISTINCT FROM 'null'::jsonb OR e ? 'payoutReference'
   THEN RAISE EXCEPTION 'Invalid seller cost reservation'; END IF;
 ELSE
  IF e->>'source' IS DISTINCT FROM 'provider_receipt' OR ref IS NULL OR length(ref)>200
   OR ref !~ '^[A-Za-z][A-Za-z0-9_]*(:[A-Za-z0-9_.-]+)*$'
   OR k='payout' AND (e->>'payoutReference' IS NULL OR e->>'payoutReference' !~ '^po_[A-Za-z0-9]+$')
   THEN RAISE EXCEPTION 'Bound provider receipt required'; END IF;
 END IF;
 -- Same lock order for every source/obligation pair. Hash collisions only
 -- serialize unrelated work; they cannot bypass aggregate enforcement.
 FOR lock_key IN SELECT x FROM unnest(ARRAY['obligation:'||ob,'source:'||coalesce(ref,ob)]) x ORDER BY x LOOP
  PERFORM pg_advisory_xact_lock(hashtextextended(lock_key,0));
 END LOOP;
 SELECT * INTO previous FROM rr_sandbox.seller_cost_allocations WHERE order_id=o.id AND kind=k FOR UPDATE;
 IF FOUND AND previous.phase='confirmed' THEN
  IF previous.evidence-'observedAt' IS DISTINCT FROM e-'observedAt' THEN RAISE EXCEPTION 'Confirmed seller cost is immutable; reconciliation required'; END IF;
  RETURN rr_sandbox.seller_cost_review(p_actor,p_order);
 END IF;
 IF previous.order_id IS NOT NULL AND previous.phase='reserved' AND ph='confirmed' AND amount>previous.amount_cents
  THEN RAISE EXCEPTION 'Additional seller cost reservation required'; END IF;
 IF ph='confirmed' THEN
  IF o.state<>'paid' OR o.payment_intent_id IS NULL OR o.refund_state<>'none' OR o.refunded_cents<>0 OR o.refund_pending_cents<>0
   OR EXISTS(SELECT 1 FROM rr_sandbox.refunds WHERE order_id=o.id)
   OR EXISTS(SELECT 1 FROM rr_sandbox.refund_requests WHERE order_id=o.id)
   OR NOT EXISTS(SELECT 1 FROM rr_sandbox.provider_events WHERE order_id=o.id AND event_type IN ('checkout.session.completed','checkout.session.async_payment_succeeded'))
   OR NOT EXISTS(SELECT 1 FROM rr_sandbox.ledger_entries WHERE order_id=o.id AND kind='gross_receivable' AND amount_cents=(d.payload->>'totalCents')::bigint)
   THEN RAISE EXCEPTION 'Signed paid order without refund activity required'; END IF;
  IF k='processing' AND NOT EXISTS(SELECT 1 FROM rr_sandbox.charge_fee_evidence WHERE order_id=o.id
   AND balance_transaction_id||':fee'=ref AND (evidence->>'feeCents')::bigint=amount AND (evidence->>'feeCents')::bigint=total)
   THEN RAISE EXCEPTION 'Original verified charge fee receipt required'; END IF;
 END IF;
 SELECT coalesce(sum(amount_cents),0) INTO used FROM rr_sandbox.seller_cost_allocations WHERE order_id=o.id AND kind<>k;
 IF used+amount>o.item_cents OR used+amount>(d.payload->>'maxTotalCents')::bigint
  THEN RAISE EXCEPTION 'Seller proceeds or total disclosed cost cap exceeded'; END IF;
 IF EXISTS(SELECT 1 FROM rr_sandbox.seller_cost_allocations WHERE obligation_key=ob AND NOT(order_id=o.id AND kind=k)
  AND (seller_id<>o.seller_id OR kind<>k OR phase='confirmed' AND source_total_cents<>total))
  THEN RAISE EXCEPTION 'Cost obligation source conflict'; END IF;
 SELECT coalesce(sum(amount_cents),0) INTO used FROM rr_sandbox.seller_cost_allocations WHERE obligation_key=ob AND NOT(order_id=o.id AND kind=k);
 IF used+amount>total THEN RAISE EXCEPTION 'Shared cost obligation already allocated'; END IF;
 IF ref IS NOT NULL THEN
  IF EXISTS(SELECT 1 FROM rr_sandbox.seller_cost_allocations WHERE source_reference=ref AND NOT(order_id=o.id AND kind=k)
   AND (seller_id<>o.seller_id OR kind<>k OR source_total_cents<>total)) THEN RAISE EXCEPTION 'Provider cost source conflict'; END IF;
  SELECT coalesce(sum(amount_cents),0) INTO used FROM rr_sandbox.seller_cost_allocations WHERE source_reference=ref AND NOT(order_id=o.id AND kind=k);
  IF used+amount>total THEN RAISE EXCEPTION 'Provider receipt already allocated'; END IF;
 END IF;
 IF previous.order_id IS NOT NULL AND previous.evidence-'observedAt'=e-'observedAt' THEN RETURN rr_sandbox.seller_cost_review(p_actor,p_order); END IF;
 INSERT INTO rr_sandbox.seller_cost_allocations(order_id,kind,obligation_key,seller_id,phase,amount_cents,source_total_cents,source_reference,evidence,recorded_by,confirmed_by,confirmed_at)
  VALUES(o.id,k,ob,o.seller_id,ph,amount,total,ref,e,p_actor,CASE WHEN ph='confirmed' THEN p_actor END,CASE WHEN ph='confirmed' THEN clock_timestamp() END)
 ON CONFLICT(order_id,kind) DO UPDATE SET phase=excluded.phase,amount_cents=excluded.amount_cents,source_total_cents=excluded.source_total_cents,
  source_reference=excluded.source_reference,evidence=excluded.evidence,confirmed_by=excluded.confirmed_by,confirmed_at=excluded.confirmed_at;
 IF ph='confirmed' THEN
  INSERT INTO rr_sandbox.ledger_entries(order_id,kind,amount_cents) VALUES
   (o.id,'seller_cost_recovery_'||k,amount),(o.id,'provider_cost_payable_'||k,-amount);
 END IF;
 RETURN rr_sandbox.seller_cost_review(p_actor,p_order);
END $$;

REVOKE ALL ON FUNCTION rr_sandbox.guard_seller_cost_immutable(),rr_sandbox.seller_cost_order(uuid),rr_sandbox.seller_cost_review(uuid,uuid),
 rr_sandbox.guard_checkout_seller_costs(),rr_sandbox.guard_order_seller_costs() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.rr_test_seller_cost_context(uuid,uuid),public.rr_test_seller_cost_review(uuid,uuid),
 public.rr_test_prepare_seller_cost_disclosure(uuid,uuid,text,text),public.rr_test_accept_seller_costs(uuid,uuid,text),
 public.rr_test_record_seller_cost(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.rr_test_seller_cost_context(uuid,uuid),public.rr_test_seller_cost_review(uuid,uuid),
 public.rr_test_prepare_seller_cost_disclosure(uuid,uuid,text,text),public.rr_test_accept_seller_costs(uuid,uuid,text),
 public.rr_test_record_seller_cost(uuid,uuid,jsonb) TO service_role;
COMMIT;
