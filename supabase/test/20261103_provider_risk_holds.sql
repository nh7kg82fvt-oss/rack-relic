-- Isolated staging only, after seller_protections. Signature verification in
-- the Node/Edge receiver is mandatory. No case outcome automatically releases
-- money; no dispute balance debit is invented in the financial ledger.
BEGIN;
CREATE TABLE rr_sandbox.provider_risk_notices (
 event_id text PRIMARY KEY REFERENCES rr_sandbox.provider_events(id),
 order_id uuid NOT NULL REFERENCES rr_sandbox.orders(id),
 case_id text NOT NULL,
 charge_id text NOT NULL CHECK(charge_id ~ '^ch_[A-Za-z0-9]+$'),
 kind text NOT NULL CHECK(kind IN ('dispute','early_fraud_warning')),
 status text NOT NULL,
 amount_cents bigint,
 due_by timestamptz,
 event_created bigint NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE rr_sandbox.provider_risk_notices ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON rr_sandbox.provider_risk_notices FROM PUBLIC,anon,authenticated;
CREATE FUNCTION public.rr_test_process_risk_notice(p_event text,p_payload_hash text,p_type text,p_case text,
 p_charge text,p_payment_intent text,p_amount bigint,p_currency text,p_status text,p_due bigint,p_created bigint) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE o rr_sandbox.orders; e rr_sandbox.provider_events; f rr_sandbox.charge_fee_evidence;
 warning boolean; oid uuid; listing uuid;
BEGIN
 IF p_event IS NULL OR p_event !~ '^evt_[A-Za-z0-9]+$' OR p_payload_hash IS NULL OR p_payload_hash !~ '^[a-f0-9]{64}$'
  OR p_type IS NULL OR p_type NOT IN ('charge.dispute.created','charge.dispute.updated','charge.dispute.closed','radar.early_fraud_warning.created')
  OR p_charge IS NULL OR p_charge !~ '^ch_[A-Za-z0-9]+$' OR p_created IS NULL OR p_created<1 OR p_created>extract(epoch FROM clock_timestamp())+30
  OR p_payment_intent IS NOT NULL AND p_payment_intent !~ '^pi_[A-Za-z0-9]+$' THEN RAISE EXCEPTION 'Invalid provider notice'; END IF;
 warning:=p_type='radar.early_fraud_warning.created';
 IF warning THEN
  IF p_case IS NULL OR p_case !~ '^issfr_[A-Za-z0-9]+$' OR p_status IS DISTINCT FROM 'warning_received'
   OR p_amount IS NOT NULL OR p_currency IS NOT NULL OR p_due IS NOT NULL THEN RAISE EXCEPTION 'Invalid fraud warning'; END IF;
 ELSE
  IF p_case IS NULL OR p_case !~ '^du_[A-Za-z0-9]+$' OR p_amount IS NULL OR p_amount NOT BETWEEN 1 AND 30000000 OR p_currency IS DISTINCT FROM 'usd'
   OR p_status IS NULL OR p_status NOT IN ('warning_needs_response','warning_under_review','warning_closed','needs_response','under_review','appeal_needs_response','appeal_under_review','won','lost','prevented')
   OR p_due IS NOT NULL AND p_due<1 THEN RAISE EXCEPTION 'Invalid dispute'; END IF;
 END IF;
 -- Use signed provider identities, never order IDs supplied in metadata.
 IF p_payment_intent IS NOT NULL THEN
  SELECT id,listing_id INTO oid,listing FROM rr_sandbox.orders WHERE payment_intent_id=p_payment_intent;
 ELSE
  SELECT o1.id,o1.listing_id INTO oid,listing FROM rr_sandbox.orders o1
   JOIN rr_sandbox.charge_fee_evidence f1 ON f1.order_id=o1.id WHERE f1.charge_id=p_charge;
 END IF;
 -- An out-of-order payment/fee binding must be retried and reconciled. Never
 -- acknowledge an unmapped notice as processed or pick a seller by metadata.
 IF oid IS NULL THEN RAISE EXCEPTION 'Payment binding required; retry provider notice'; END IF;
 PERFORM 1 FROM rr_sandbox.catalog WHERE id=listing FOR UPDATE;
 SELECT * INTO o FROM rr_sandbox.orders WHERE id=oid FOR UPDATE;
 PERFORM pg_advisory_xact_lock(hashtextextended(o.seller_id::text,301103));
 SELECT * INTO f FROM rr_sandbox.charge_fee_evidence WHERE order_id=oid;
 IF o.state NOT IN ('paid','review') OR o.payment_intent_id IS NULL
  OR p_payment_intent IS NOT NULL AND p_payment_intent<>o.payment_intent_id
  OR f.order_id IS NOT NULL AND f.charge_id<>p_charge
  OR NOT warning AND p_amount>(o.snapshot->>'totalCents')::bigint
  OR NOT EXISTS(SELECT 1 FROM rr_sandbox.ledger_entries WHERE order_id=oid AND kind='gross_receivable' AND amount_cents>0)
  THEN RAISE EXCEPTION 'Provider notice payment mismatch'; END IF;
 IF EXISTS(SELECT 1 FROM rr_sandbox.provider_risk_notices WHERE case_id=p_case AND (order_id<>oid OR charge_id<>p_charge)) THEN RAISE EXCEPTION 'Provider case identity collision'; END IF;
 SELECT * INTO e FROM rr_sandbox.provider_events WHERE id=p_event;
 IF FOUND THEN
  IF e.payload_hash<>p_payload_hash OR e.order_id<>oid OR e.event_type<>p_type THEN RAISE EXCEPTION 'Provider event collision'; END IF;
  RETURN jsonb_build_object('duplicate',true,'state','held');
 END IF;
 INSERT INTO rr_sandbox.provider_events(id,payload_hash,order_id,event_type) VALUES(p_event,p_payload_hash,oid,p_type);
 INSERT INTO rr_sandbox.provider_risk_notices(event_id,order_id,case_id,charge_id,kind,status,amount_cents,due_by,event_created)
 VALUES(p_event,oid,p_case,p_charge,CASE WHEN warning THEN 'early_fraud_warning' ELSE 'dispute' END,p_status,p_amount,
  CASE WHEN p_due IS NULL THEN NULL ELSE to_timestamp(p_due) END,p_created);
 UPDATE rr_sandbox.orders SET risk_status='blocked',updated_at=clock_timestamp() WHERE id=oid;
 UPDATE rr_sandbox.jobs SET state='held' WHERE order_id=oid AND state IN ('pending','leased')
  AND kind IN ('record_tax_transaction','fraud_assessment','prepare_test_label','buyer_receipt','seller_sale_notice');
 INSERT INTO rr_sandbox.jobs(order_id,kind,state) VALUES(oid,'provider_dispute_review','held') ON CONFLICT DO NOTHING;
 RETURN jsonb_build_object('duplicate',false,'state','held');
END $$;
REVOKE ALL ON FUNCTION public.rr_test_process_risk_notice(text,text,text,text,text,text,bigint,text,text,bigint,bigint) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.rr_test_process_risk_notice(text,text,text,text,text,text,bigint,text,text,bigint,bigint) TO service_role;
COMMIT;
