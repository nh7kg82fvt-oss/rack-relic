-- ISOLATED STAGING ONLY. Apply after seller_onboarding, refund_requests,
-- charge_fee_evidence, order_issues and tracking_observations. Never production.
-- No transfer/payout executor or live agreement acceptance exists in this file.
BEGIN;
CREATE TABLE rr_sandbox.seller_protection_status (
 seller_id uuid PRIMARY KEY REFERENCES rr_sandbox.seller_accounts(seller_id),
 account_id text NOT NULL,
 provider_ready boolean NOT NULL,
 checked_at timestamptz NOT NULL,
 held boolean NOT NULL DEFAULT false,
 held_at timestamptz,
 held_by uuid,
 hold_reason text CHECK(hold_reason IN ('suspicious_activity','delivery_problem','verification_problem')),
 CHECK((held AND held_at IS NOT NULL AND held_by IS NOT NULL AND hold_reason IS NOT NULL)
  OR (NOT held AND held_at IS NULL AND held_by IS NULL AND hold_reason IS NULL))
);
ALTER TABLE rr_sandbox.seller_protection_status ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON rr_sandbox.seller_protection_status FROM PUBLIC,anon,authenticated;

-- Only the server's fresh, bound Stripe read may populate this projection.
-- It contains no identity documents, bank details, URLs or raw provider data.
CREATE FUNCTION public.rr_test_record_seller_protection(p_actor uuid,p_account text,p_ready boolean,p_checked bigint) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE a rr_sandbox.seller_accounts; checked timestamptz;
BEGIN
 IF p_actor IS NULL OR p_account IS NULL OR p_ready IS NULL OR p_checked IS NULL THEN RAISE EXCEPTION 'Seller evidence required'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_actor::text,301103));
 SELECT * INTO a FROM rr_sandbox.seller_accounts WHERE seller_id=p_actor FOR UPDATE;
 IF NOT FOUND OR a.phase<>'known' OR a.account_id IS DISTINCT FROM p_account THEN RAISE EXCEPTION 'Seller binding required'; END IF;
 checked:=to_timestamp(p_checked/1000.0);
 IF checked<clock_timestamp()-interval '5 minutes' OR checked>clock_timestamp()+interval '30 seconds' THEN RAISE EXCEPTION 'Fresh seller evidence required'; END IF;
 -- Older responses cannot erase a more recent restriction or refresh a ready lease.
 INSERT INTO rr_sandbox.seller_protection_status(seller_id,account_id,provider_ready,checked_at)
 VALUES(p_actor,p_account,p_ready,checked)
 ON CONFLICT(seller_id) DO UPDATE SET provider_ready=EXCLUDED.provider_ready,checked_at=EXCLUDED.checked_at
 WHERE seller_protection_status.account_id=EXCLUDED.account_id
  AND (EXCLUDED.checked_at>seller_protection_status.checked_at
   OR EXCLUDED.checked_at=seller_protection_status.checked_at AND NOT EXCLUDED.provider_ready);
 RETURN jsonb_build_object('test',true,'recorded',true);
END $$;

-- Test-only conservative caps: $300 per complete order, five unsettled orders,
-- $1,000 unsettled gross per seller. These are not approved live policies.
-- All claims count, including unknown provider outcomes. No clock-only expiry,
-- refund request, acknowledgment or successful sample label frees exposure.
CREATE FUNCTION rr_sandbox.check_seller_protection(p_seller uuid,p_order uuid,p_total bigint) RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE s rr_sandbox.seller_protection_status; a rr_sandbox.seller_accounts; n bigint; exposure bigint;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(p_seller::text,301103));
 SELECT * INTO a FROM rr_sandbox.seller_accounts WHERE seller_id=p_seller;
 SELECT * INTO s FROM rr_sandbox.seller_protection_status WHERE seller_id=p_seller;
 IF a.phase IS DISTINCT FROM 'known' OR a.account_id IS DISTINCT FROM s.account_id
  OR s.provider_ready IS DISTINCT FROM true OR s.checked_at<clock_timestamp()-interval '5 minutes'
  OR s.checked_at>clock_timestamp()+interval '30 seconds' OR s.held IS DISTINCT FROM false
  THEN RAISE EXCEPTION 'Seller verification or review required'; END IF;
 IF EXISTS(SELECT 1 FROM rr_sandbox.orders o WHERE o.seller_id=p_seller AND
  (o.risk_status IN ('review','blocked') OR o.refund_state<>'none'
   OR EXISTS(SELECT 1 FROM rr_sandbox.order_issues i WHERE i.order_id=o.id)))
  THEN RAISE EXCEPTION 'Seller issue review required'; END IF;
 IF p_total IS NULL OR p_total NOT BETWEEN 1 AND 30000 THEN RAISE EXCEPTION 'Test order limit requires review'; END IF;
 SELECT count(*),COALESCE(sum(GREATEST(o.item_cents+o.buyer_fee_cents,
  COALESCE((o.snapshot->>'totalCents')::bigint,0),COALESCE((c.snapshot->>'totalCents')::bigint,0))),0)
 INTO n,exposure FROM rr_sandbox.orders o LEFT JOIN rr_sandbox.checkout_attempts c ON c.order_id=o.id
 WHERE o.seller_id=p_seller AND o.id<>p_order AND o.state NOT IN ('expired','payment_failed','cancelled');
 IF n>=5 OR exposure+p_total>100000 THEN RAISE EXCEPTION 'Test seller exposure limit requires review'; END IF;
END $$;
REVOKE ALL ON FUNCTION rr_sandbox.check_seller_protection(uuid,uuid,bigint) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION rr_sandbox.guard_seller_protection() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE o rr_sandbox.orders;
BEGIN
 IF TG_TABLE_NAME='orders' THEN
  IF TG_OP='INSERT' THEN
   PERFORM rr_sandbox.check_seller_protection(NEW.seller_id,NEW.id,NEW.item_cents+NEW.buyer_fee_cents);
  ELSIF OLD.state='reserved' AND NEW.state='checkout_open' THEN
   PERFORM rr_sandbox.check_seller_protection(NEW.seller_id,NEW.id,(NEW.snapshot->>'totalCents')::bigint);
  END IF;
 ELSE
  IF OLD.phase='prepared' AND NEW.phase='dispatched' THEN
   SELECT * INTO o FROM rr_sandbox.orders WHERE id=NEW.order_id;
   PERFORM rr_sandbox.check_seller_protection(o.seller_id,o.id,(NEW.snapshot->>'totalCents')::bigint);
  END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION rr_sandbox.guard_seller_protection() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER rr_test_seller_protection_orders BEFORE INSERT OR UPDATE ON rr_sandbox.orders
 FOR EACH ROW EXECUTE FUNCTION rr_sandbox.guard_seller_protection();
CREATE TRIGGER rr_test_seller_protection_dispatch BEFORE UPDATE ON rr_sandbox.checkout_attempts
 FOR EACH ROW EXECUTE FUNCTION rr_sandbox.guard_seller_protection();

-- Recovery must not hand out an old open Checkout URL after a seller hold or
-- verification expiry. Preserve the original response and unknown references.
-- Move the old implementation out of the public RPC namespace and revoke it.
ALTER FUNCTION public.rr_test_checkout_attempt(uuid,uuid) SET SCHEMA rr_sandbox;
REVOKE ALL ON FUNCTION rr_sandbox.rr_test_checkout_attempt(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.rr_test_checkout_attempt(p_order uuid,p_buyer uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE o rr_sandbox.orders; total bigint;
BEGIN
 SELECT * INTO o FROM rr_sandbox.orders WHERE id=p_order;
 IF NOT FOUND OR p_buyer IS NULL OR o.buyer_id<>p_buyer THEN RAISE EXCEPTION 'Buyer order required'; END IF;
 SELECT GREATEST(o.item_cents+o.buyer_fee_cents,COALESCE((o.snapshot->>'totalCents')::bigint,0),
  COALESCE((a.snapshot->>'totalCents')::bigint,0)) INTO total
 FROM rr_sandbox.checkout_attempts a WHERE a.order_id=o.id;
 PERFORM rr_sandbox.check_seller_protection(o.seller_id,o.id,COALESCE(total,o.item_cents+o.buyer_fee_cents));
 RETURN rr_sandbox.rr_test_checkout_attempt(p_order,p_buyer);
END $$;
REVOKE ALL ON FUNCTION public.rr_test_checkout_attempt(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.rr_test_checkout_attempt(uuid,uuid) TO service_role;

-- One-way hold. Clearing it needs a separate reviewed workflow, not refresh.
CREATE FUNCTION public.rr_test_hold_seller(p_actor uuid,p_order uuid,p_reason text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE o rr_sandbox.orders;
BEGIN
 SELECT * INTO o FROM rr_sandbox.orders WHERE id=p_order;
 IF NOT FOUND OR p_actor IS NULL OR p_actor NOT IN (o.buyer_id,o.seller_id) THEN RAISE EXCEPTION 'Operator order required'; END IF;
 IF p_reason IS NULL OR p_reason NOT IN ('suspicious_activity','delivery_problem','verification_problem') THEN RAISE EXCEPTION 'Review reason required'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(o.seller_id::text,301103));
 UPDATE rr_sandbox.seller_protection_status SET held=true,held_at=clock_timestamp(),held_by=p_actor,hold_reason=p_reason
 WHERE seller_id=o.seller_id AND NOT held;
 IF NOT EXISTS(SELECT 1 FROM rr_sandbox.seller_protection_status WHERE seller_id=o.seller_id AND held) THEN RAISE EXCEPTION 'Bound seller status required'; END IF;
 RETURN jsonb_build_object('test',true,'orderId',o.id,'held',true,'releaseEnabled',false);
END $$;

-- Read-only operator readiness. It is deliberately NEVER a release permit.
-- Real tracking ingestion, live terms, tax/recovery, reserves and settlement
-- need independent implementation/acceptance. Test DELIVERED is not delivery.
CREATE FUNCTION public.rr_test_protection_review(p_actor uuid,p_order uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE o rr_sandbox.orders; s rr_sandbox.seller_protection_status; a rr_sandbox.seller_accounts;
 f rr_sandbox.charge_fee_evidence; blocks text[]:=ARRAY['live_acceptance_pending','real_delivery_unverified',
 'delivery_wait_unverified','seller_terms_pending','platform_reserve_unconfigured','tax_recovery_unverified','settlement_unavailable'];
 gross bigint; balance bigint; fee bigint;
BEGIN
 SELECT * INTO o FROM rr_sandbox.orders WHERE id=p_order;
 IF NOT FOUND OR p_actor IS NULL OR p_actor NOT IN (o.buyer_id,o.seller_id) THEN RAISE EXCEPTION 'Operator order required'; END IF;
 SELECT * INTO s FROM rr_sandbox.seller_protection_status WHERE seller_id=o.seller_id;
 SELECT * INTO a FROM rr_sandbox.seller_accounts WHERE seller_id=o.seller_id;
 IF s.provider_ready IS DISTINCT FROM true OR a.phase IS DISTINCT FROM 'known' OR a.account_id IS DISTINCT FROM s.account_id
  OR s.checked_at<clock_timestamp()-interval '5 minutes' OR s.checked_at>clock_timestamp()+interval '30 seconds'
  THEN blocks:=array_append(blocks,'seller_verification_required'); END IF;
 IF s.held IS TRUE THEN blocks:=array_append(blocks,'seller_review_hold'); END IF;
 SELECT COALESCE(sum(amount_cents) FILTER(WHERE kind='gross_receivable'),0),COALESCE(sum(amount_cents),0)
 INTO gross,balance FROM rr_sandbox.ledger_entries WHERE order_id=o.id;
 IF o.state<>'paid' OR o.payment_intent_id IS NULL OR gross IS DISTINCT FROM (o.snapshot->>'totalCents')::bigint
  THEN blocks:=array_append(blocks,'payment_unconfirmed'); END IF;
 IF balance<>0 THEN blocks:=array_append(blocks,'ledger_needs_reconciliation'); END IF;
 IF o.risk_status<>'clear' OR NOT EXISTS(SELECT 1 FROM rr_sandbox.risk_assessments r WHERE r.order_id=o.id
  AND r.decision='clear' AND r.checked_at>=clock_timestamp()-interval '5 minutes'
  AND r.checked_at<=clock_timestamp()+interval '30 seconds') THEN blocks:=array_append(blocks,'risk_review_required'); END IF;
 IF EXISTS(SELECT 1 FROM rr_sandbox.order_issues WHERE order_id=o.id) THEN blocks:=array_append(blocks,'buyer_issue_open'); END IF;
 IF o.refund_state<>'none' OR o.refunded_cents<>0 OR o.refund_pending_cents<>0
  OR EXISTS(SELECT 1 FROM rr_sandbox.refund_requests WHERE order_id=o.id)
  OR EXISTS(SELECT 1 FROM rr_sandbox.refunds WHERE order_id=o.id) THEN blocks:=array_append(blocks,'refund_review_required'); END IF;
 SELECT * INTO f FROM rr_sandbox.charge_fee_evidence WHERE order_id=o.id;
 IF f.order_id IS NULL OR f.evidence->>'paymentIntentId' IS DISTINCT FROM o.payment_intent_id
  OR f.evidence->>'grossCents' IS DISTINCT FROM o.snapshot->>'totalCents'
  THEN blocks:=array_append(blocks,'processing_fee_unverified');
 ELSE fee:=(f.evidence->>'feeCents')::bigint;
  IF fee IS NULL OR fee<0 OR fee>o.item_cents THEN blocks:=array_append(blocks,'seller_net_requires_review'); END IF;
 END IF;
 IF EXISTS(SELECT 1 FROM rr_sandbox.tracking_current WHERE order_id=o.id) THEN blocks:=array_append(blocks,'sample_tracking_only'); END IF;
 RETURN jsonb_build_object('test',true,'orderId',o.id,'state','held','blockers',to_jsonb(blocks),
  'releaseEnabled',false,'transferCreated',false,'payoutCreated',false);
END $$;

REVOKE ALL ON FUNCTION public.rr_test_record_seller_protection(uuid,text,boolean,bigint),
 public.rr_test_hold_seller(uuid,uuid,text),public.rr_test_protection_review(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.rr_test_record_seller_protection(uuid,text,boolean,bigint),
 public.rr_test_hold_seller(uuid,uuid,text),public.rr_test_protection_review(uuid,uuid) TO service_role;
COMMIT;
