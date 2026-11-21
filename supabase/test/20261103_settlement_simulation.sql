-- Separate sandbox settlement rehearsal only. Never install in production.
-- Existing ordinary seller_transfer/seller_payout jobs and release guards are
-- deliberately unchanged. Every projection is simulationOnly and liveReady=false.
BEGIN;
CREATE TABLE rr_sandbox.settlement_sim_bindings (
 simulation_only boolean NOT NULL DEFAULT true CHECK(simulation_only),
 order_id uuid PRIMARY KEY REFERENCES rr_sandbox.orders(id), account_id text NOT NULL,
 bank_account_id text CHECK(bank_account_id ~ '^ba_[A-Za-z0-9]+$'),
 checked_at timestamptz NOT NULL, recorded_by uuid NOT NULL,
 CHECK(account_id ~ '^acct_[A-Za-z0-9]+$')
);
CREATE TABLE rr_sandbox.settlement_sim_requests (
 simulation_only boolean NOT NULL DEFAULT true CHECK(simulation_only),
 id uuid PRIMARY KEY, order_id uuid NOT NULL REFERENCES rr_sandbox.orders(id),
 actor_id uuid NOT NULL, seller_id uuid NOT NULL, account_id text NOT NULL,
 kind text NOT NULL CHECK(kind IN ('transfer','payout','reversal')),
 amount_cents bigint NOT NULL CHECK(amount_cents BETWEEN 1 AND 10000000),
 max_transfer_cents bigint NOT NULL CHECK(max_transfer_cents BETWEEN 0 AND 10000000),
 parent_id uuid REFERENCES rr_sandbox.settlement_sim_requests(id), parent_provider_id text,
 parent_amount_cents bigint, bank_account_id text,
 phase text NOT NULL DEFAULT 'prepared' CHECK(phase IN ('prepared','dispatched','known')),
 provider_id text UNIQUE, status text NOT NULL DEFAULT 'not_recorded'
  CHECK(status IN ('not_recorded','succeeded','pending','in_transit','paid','failed','canceled')),
 needs_review boolean NOT NULL DEFAULT false, hold_reason text, held_by uuid, held_at timestamptz,
 evidence jsonb, checked_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), dispatched_at timestamptz,
 CHECK((kind='transfer' AND parent_id IS NULL AND parent_provider_id IS NULL AND parent_amount_cents IS NULL)
  OR (kind IN ('payout','reversal') AND parent_id IS NOT NULL AND parent_provider_id ~ '^tr_[A-Za-z0-9]+$' AND parent_amount_cents>0)),
 CHECK((kind='payout' AND bank_account_id IS NOT NULL AND bank_account_id ~ '^ba_[A-Za-z0-9]+$') OR (kind<>'payout' AND bank_account_id IS NULL)),
 CHECK((phase='prepared' AND dispatched_at IS NULL AND provider_id IS NULL)
  OR (phase='dispatched' AND dispatched_at IS NOT NULL AND provider_id IS NULL)
  OR (phase='known' AND dispatched_at IS NOT NULL AND provider_id IS NOT NULL))
);
CREATE UNIQUE INDEX rr_test_one_sim_transfer ON rr_sandbox.settlement_sim_requests(order_id) WHERE kind='transfer';
CREATE TABLE rr_sandbox.settlement_sim_receipts (
 simulation_only boolean NOT NULL DEFAULT true CHECK(simulation_only),
 request_id uuid NOT NULL REFERENCES rr_sandbox.settlement_sim_requests(id),
 evidence_hash text NOT NULL, evidence jsonb NOT NULL, recorded_by uuid NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(), PRIMARY KEY(request_id,evidence_hash)
);
CREATE TABLE rr_sandbox.settlement_sim_ledger (
 simulation_only boolean NOT NULL DEFAULT true CHECK(simulation_only),
 request_id uuid NOT NULL REFERENCES rr_sandbox.settlement_sim_requests(id),
 kind text NOT NULL, amount_cents bigint NOT NULL, currency text NOT NULL DEFAULT 'USD' CHECK(currency='USD'),
 PRIMARY KEY(request_id,kind)
);
ALTER TABLE rr_sandbox.settlement_sim_bindings ENABLE ROW LEVEL SECURITY;
ALTER TABLE rr_sandbox.settlement_sim_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE rr_sandbox.settlement_sim_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE rr_sandbox.settlement_sim_ledger ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON rr_sandbox.settlement_sim_bindings,rr_sandbox.settlement_sim_requests,
 rr_sandbox.settlement_sim_receipts,rr_sandbox.settlement_sim_ledger FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION rr_sandbox.guard_settlement_sim_audit() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP='DELETE' OR TG_TABLE_NAME IN ('settlement_sim_receipts','settlement_sim_ledger') THEN
  RAISE EXCEPTION 'Simulation financial evidence is immutable'; END IF;
 IF TG_TABLE_NAME='settlement_sim_requests' THEN
  IF ROW(NEW.id,NEW.order_id,NEW.actor_id,NEW.seller_id,NEW.account_id,NEW.kind,NEW.amount_cents,NEW.max_transfer_cents,
   NEW.parent_id,NEW.parent_provider_id,NEW.parent_amount_cents,NEW.bank_account_id,NEW.created_at)
   IS DISTINCT FROM ROW(OLD.id,OLD.order_id,OLD.actor_id,OLD.seller_id,OLD.account_id,OLD.kind,OLD.amount_cents,OLD.max_transfer_cents,
   OLD.parent_id,OLD.parent_provider_id,OLD.parent_amount_cents,OLD.bank_account_id,OLD.created_at)
   OR OLD.provider_id IS NOT NULL AND NEW.provider_id IS DISTINCT FROM OLD.provider_id
   OR OLD.dispatched_at IS NOT NULL AND NEW.dispatched_at IS DISTINCT FROM OLD.dispatched_at
   OR OLD.phase='dispatched' AND NEW.phase='prepared' OR OLD.phase='known' AND NEW.phase<>'known'
   OR OLD.needs_review AND NOT NEW.needs_review OR OLD.hold_reason IS NOT NULL AND NEW.hold_reason IS DISTINCT FROM OLD.hold_reason
   OR OLD.held_at IS NOT NULL AND NEW.held_by IS DISTINCT FROM OLD.held_by
   OR OLD.held_at IS NOT NULL AND NEW.held_at IS DISTINCT FROM OLD.held_at
   THEN RAISE EXCEPTION 'Simulation request binding, dispatch and audit are immutable'; END IF;
 ELSE
  IF NEW.order_id IS DISTINCT FROM OLD.order_id OR NEW.account_id IS DISTINCT FROM OLD.account_id
   OR NEW.recorded_by IS DISTINCT FROM OLD.recorded_by OR NEW.checked_at<OLD.checked_at
   OR OLD.bank_account_id IS NOT NULL AND NEW.bank_account_id IS DISTINCT FROM OLD.bank_account_id
   THEN RAISE EXCEPTION 'Simulation bank binding audit is immutable'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER rr_test_settlement_request_audit BEFORE UPDATE OR DELETE ON rr_sandbox.settlement_sim_requests
 FOR EACH ROW EXECUTE FUNCTION rr_sandbox.guard_settlement_sim_audit();
CREATE TRIGGER rr_test_settlement_binding_audit BEFORE UPDATE OR DELETE ON rr_sandbox.settlement_sim_bindings
 FOR EACH ROW EXECUTE FUNCTION rr_sandbox.guard_settlement_sim_audit();
CREATE TRIGGER rr_test_settlement_receipt_audit BEFORE UPDATE OR DELETE ON rr_sandbox.settlement_sim_receipts
 FOR EACH ROW EXECUTE FUNCTION rr_sandbox.guard_settlement_sim_audit();
CREATE TRIGGER rr_test_settlement_ledger_audit BEFORE UPDATE OR DELETE ON rr_sandbox.settlement_sim_ledger
 FOR EACH ROW EXECUTE FUNCTION rr_sandbox.guard_settlement_sim_audit();

CREATE FUNCTION rr_sandbox.lock_settlement_order(p_actor uuid,p_order uuid) RETURNS rr_sandbox.orders
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE o rr_sandbox.orders;
BEGIN
 SELECT * INTO o FROM rr_sandbox.orders WHERE id=p_order;
 IF NOT FOUND OR p_actor IS NULL OR p_actor NOT IN (o.buyer_id,o.seller_id) OR o.test IS DISTINCT FROM true
  OR o.fee_policy_version<>'rr-fees-v2' THEN RAISE EXCEPTION 'Versioned participant sandbox order required'; END IF;
 -- Match startup/verification lock order; a competing seller hold wins before
 -- this transaction commits its irreversible dispatch claim.
 PERFORM pg_advisory_xact_lock(301103,1);
 PERFORM pg_advisory_xact_lock(hashtextextended(o.seller_id::text,301103));
 SELECT * INTO o FROM rr_sandbox.orders WHERE id=p_order FOR UPDATE;
 RETURN o;
END $$;
CREATE FUNCTION rr_sandbox.settlement_sim_request(p_request uuid) RETURNS jsonb
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE q rr_sandbox.settlement_sim_requests; o rr_sandbox.orders; f rr_sandbox.charge_fee_evidence;
BEGIN
 SELECT * INTO q FROM rr_sandbox.settlement_sim_requests WHERE id=p_request;
 IF NOT FOUND THEN RAISE EXCEPTION 'Saved simulation request required'; END IF;
 SELECT * INTO o FROM rr_sandbox.orders WHERE id=q.order_id;
 SELECT * INTO f FROM rr_sandbox.charge_fee_evidence WHERE order_id=q.order_id;
 RETURN jsonb_build_object('test',true,'simulationOnly',true,'requestId',q.id,'orderId',q.order_id,
  'sellerId',q.seller_id,'accountId',q.account_id,'kind',q.kind,'amountCents',q.amount_cents,'currency','USD',
  'totalCents',(o.snapshot->>'totalCents')::bigint,'itemCents',o.item_cents,'maxTransferCents',q.max_transfer_cents,
  'platformReserveCents',0,'payoutFeeReserveCents',0,'paymentIntentId',o.payment_intent_id,'chargeId',f.charge_id,
  'parentRequestId',q.parent_id,'parentProviderId',q.parent_provider_id,'parentAmountCents',q.parent_amount_cents,
  'availableCents',CASE WHEN q.kind='transfer' THEN rr_sandbox.settlement_sim_available(q.id,NULL) END,
  'bankAccountId',q.bank_account_id,'transferGroup','rr_test_'||o.id,
  'phase',q.phase,'providerId',q.provider_id,'status',q.status,'needsReview',q.needs_review,
  'createdAt',floor(extract(epoch FROM q.created_at)*1000)::bigint,
  'dispatchedAt',CASE WHEN q.dispatched_at IS NOT NULL THEN floor(extract(epoch FROM q.dispatched_at)*1000)::bigint END,
  'holdReason',q.hold_reason,'releaseEnabled',false,'liveReady',false);
END $$;
CREATE FUNCTION rr_sandbox.settlement_sim_context(p_actor uuid,p_order uuid) RETURNS jsonb
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE o rr_sandbox.orders; a rr_sandbox.seller_accounts; s rr_sandbox.seller_protection_status;
 f rr_sandbox.charge_fee_evidence; b rr_sandbox.settlement_sim_bindings; d rr_sandbox.seller_cost_disclosures;
 t rr_sandbox.tracking_current; l rr_sandbox.label_attempts; costs bigint; n bigint; wanted bigint;
 gross bigint; balanced bigint; ready_at timestamptz; blocks text[]:=ARRAY[]::text[]; attempts jsonb;
BEGIN
 SELECT * INTO o FROM rr_sandbox.orders WHERE id=p_order;
 IF NOT FOUND OR p_actor IS NULL OR p_actor NOT IN (o.buyer_id,o.seller_id) OR o.test IS DISTINCT FROM true
  OR o.fee_policy_version<>'rr-fees-v2' THEN RAISE EXCEPTION 'Versioned participant sandbox order required'; END IF;
 SELECT * INTO a FROM rr_sandbox.seller_accounts WHERE seller_id=o.seller_id;
 SELECT * INTO s FROM rr_sandbox.seller_protection_status WHERE seller_id=o.seller_id;
 SELECT * INTO f FROM rr_sandbox.charge_fee_evidence WHERE order_id=o.id;
 SELECT * INTO b FROM rr_sandbox.settlement_sim_bindings WHERE order_id=o.id;
 SELECT * INTO d FROM rr_sandbox.seller_cost_disclosures WHERE order_id=o.id;
 IF a.phase IS DISTINCT FROM 'known' OR a.account_id IS DISTINCT FROM s.account_id OR s.provider_ready IS DISTINCT FROM true
  OR s.held IS DISTINCT FROM false OR s.checked_at<clock_timestamp()-interval '5 minutes'
  OR s.checked_at>clock_timestamp()+interval '30 seconds' THEN blocks:=array_append(blocks,'seller_verification_required'); END IF;
 SELECT coalesce(sum(amount_cents) FILTER(WHERE kind='gross_receivable'),0),coalesce(sum(amount_cents),0)
  INTO gross,balanced FROM rr_sandbox.ledger_entries WHERE order_id=o.id;
 IF o.state<>'paid' OR o.payment_intent_id IS NULL OR o.snapshot IS NULL OR gross IS DISTINCT FROM (o.snapshot->>'totalCents')::bigint
  OR balanced<>0 THEN blocks:=array_append(blocks,'paid_ledger_required'); END IF;
 IF f.order_id IS NULL OR f.evidence->>'paymentIntentId' IS DISTINCT FROM o.payment_intent_id
  OR f.evidence->>'grossCents' IS DISTINCT FROM o.snapshot->>'totalCents' THEN blocks:=array_append(blocks,'processing_fee_required'); END IF;
 IF o.risk_status<>'clear' OR NOT EXISTS(SELECT 1 FROM rr_sandbox.risk_assessments r WHERE r.order_id=o.id
  AND r.charge_id=f.charge_id AND r.decision='clear' AND r.checked_at>=clock_timestamp()-interval '5 minutes'
  AND r.checked_at<=clock_timestamp()+interval '30 seconds') THEN blocks:=array_append(blocks,'risk_review_required'); END IF;
 IF EXISTS(SELECT 1 FROM rr_sandbox.order_issues WHERE order_id=o.id) THEN blocks:=array_append(blocks,'buyer_issue_open'); END IF;
 IF o.refund_state<>'none' OR o.refunded_cents<>0 OR o.refund_pending_cents<>0
  OR EXISTS(SELECT 1 FROM rr_sandbox.refund_requests WHERE order_id=o.id)
  OR EXISTS(SELECT 1 FROM rr_sandbox.refunds WHERE order_id=o.id) THEN blocks:=array_append(blocks,'refund_review_required'); END IF;
 IF d.order_id IS NULL OR NOT EXISTS(SELECT 1 FROM rr_sandbox.seller_cost_acceptances WHERE order_id=o.id AND disclosure_hash=d.disclosure_hash)
  THEN blocks:=array_append(blocks,'seller_cost_acceptance_required'); END IF;
 SELECT coalesce(sum(amount_cents),0),count(*) INTO costs,n FROM rr_sandbox.seller_cost_allocations WHERE order_id=o.id;
 wanted:=CASE WHEN d.payload->'selectedInsurance'='true'::jsonb THEN 5 ELSE 4 END;
 IF n<>wanted OR NOT EXISTS(SELECT 1 FROM rr_sandbox.seller_cost_allocations WHERE order_id=o.id AND kind='processing' AND phase='confirmed')
  THEN blocks:=array_append(blocks,'bounded_cost_inventory_required'); END IF;
 IF d.order_id IS NOT NULL AND (costs>(d.payload->>'maxTotalCents')::bigint OR costs>=o.item_cents OR (d.payload->>'maxTotalCents')::bigint>=o.item_cents)
  THEN blocks:=array_append(blocks,'seller_proceeds_insufficient'); END IF;
 SELECT * INTO t FROM rr_sandbox.tracking_current WHERE order_id=o.id;
 SELECT * INTO l FROM rr_sandbox.label_attempts WHERE order_id=o.id;
 IF t.order_id IS NULL OR l.order_id IS NULL OR t.needs_review OR t.provider_status<>'DELIVERED'
  OR t.snapshot->>'status' IS DISTINCT FROM 'DELIVERED' OR l.result->>'status' IS DISTINCT FROM 'SUCCESS'
  OR t.snapshot->>'transactionId' IS DISTINCT FROM l.transaction_id OR t.snapshot->>'requestId' IS DISTINCT FROM l.request_id::text
  OR t.snapshot->'trackingNumber' IS DISTINCT FROM l.result->'trackingNumber'
  OR t.snapshot->>'source' IS DISTINCT FROM 'shippo_transaction' OR t.snapshot->'test' IS DISTINCT FROM 'true'::jsonb
  OR t.last_checked<clock_timestamp()-interval '5 minutes' OR t.last_checked>clock_timestamp()+interval '30 seconds'
  OR coalesce(t.snapshot->>'eventAt','') !~ '^[0-9]{13}$'
  THEN blocks:=array_append(blocks,'test_delivery_simulation_required');
 ELSE
  BEGIN ready_at:=rr_sandbox.delivery_wait_end(to_timestamp((t.snapshot->>'eventAt')::bigint/1000.0));
   IF ready_at>clock_timestamp() THEN blocks:=array_append(blocks,'test_delivery_wait_required'); END IF;
  EXCEPTION WHEN OTHERS THEN blocks:=array_append(blocks,'test_delivery_wait_required'); END;
 END IF;
 IF EXISTS(SELECT 1 FROM rr_sandbox.settlement_sim_requests WHERE order_id=o.id AND needs_review)
  THEN blocks:=array_append(blocks,'settlement_recovery_review_required'); END IF;
 IF EXISTS(SELECT 1 FROM rr_sandbox.settlement_sim_requests WHERE order_id=o.id
  AND (phase='dispatched' OR phase='known' AND status='not_recorded'))
  THEN blocks:=array_append(blocks,'settlement_reconciliation_required'); END IF;
 SELECT coalesce(jsonb_agg(rr_sandbox.settlement_sim_request(id) ORDER BY created_at,id),'[]'::jsonb) INTO attempts
  FROM rr_sandbox.settlement_sim_requests WHERE order_id=o.id;
 RETURN jsonb_build_object('test',true,'simulationOnly',true,'orderId',o.id,'accountId',a.account_id,
  'bankAccountId',CASE WHEN b.checked_at>=clock_timestamp()-interval '5 minutes' THEN b.bank_account_id END,
  'bindingCheckedAt',CASE WHEN b.order_id IS NOT NULL THEN floor(extract(epoch FROM b.checked_at)*1000)::bigint END,
  'order',jsonb_build_object('orderId',o.id,'sellerId',o.seller_id,'itemCents',o.item_cents,'buyerFeeCents',o.buyer_fee_cents,
   'shippingCents',o.snapshot->'shippingCents','taxCents',o.snapshot->'taxCents','totalCents',o.snapshot->'totalCents',
   'paymentIntentId',o.payment_intent_id,'chargeId',f.charge_id,'currency','USD'),
  -- Retain the entire immutable accepted ceiling before the first provisional
  -- test transfer. Later costs within that ceiling cannot overfund the seller.
  -- Any unused portion remains owed/held for final reconciliation, not profit.
  'transferableCents',greatest(0,o.item_cents-greatest(costs,coalesce((d.payload->>'maxTotalCents')::bigint,0))),
  'maxTransferCents',greatest(0,o.item_cents-greatest(costs,coalesce((d.payload->>'maxTotalCents')::bigint,0))),
  'platformReserveCents',0,'payoutFeeReserveCents',0,'blockers',to_jsonb(blocks),'attempts',attempts,
  'releaseEnabled',false,'liveReady',false);
END $$;
CREATE FUNCTION public.rr_test_settlement_context(p_actor uuid,p_order uuid) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$ SELECT rr_sandbox.settlement_sim_context(p_actor,p_order) $$;
CREATE FUNCTION public.rr_test_record_settlement_binding(p_actor uuid,p_order uuid,p_evidence jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE o rr_sandbox.orders; a rr_sandbox.seller_accounts; b rr_sandbox.settlement_sim_bindings; e jsonb:=p_evidence; checked timestamptz;
BEGIN
 o:=rr_sandbox.lock_settlement_order(p_actor,p_order);
 SELECT * INTO a FROM rr_sandbox.seller_accounts WHERE seller_id=o.seller_id;
 IF a.phase IS DISTINCT FROM 'known' OR e IS NULL OR jsonb_typeof(e)<>'object'
  OR NOT(e ?& ARRAY['test','simulationOnly','source','accountId','bankAccountId','checkedAt'])
  OR (SELECT count(*) FROM jsonb_object_keys(e))<>6 OR e->'test' IS DISTINCT FROM 'true'::jsonb
  OR e->'simulationOnly' IS DISTINCT FROM 'true'::jsonb OR e->>'source' IS DISTINCT FROM 'stripe_sandbox'
  OR e->>'accountId' IS DISTINCT FROM a.account_id OR (e->'bankAccountId' IS DISTINCT FROM 'null'::jsonb AND coalesce(e->>'bankAccountId','') !~ '^ba_[A-Za-z0-9]+$')
  OR jsonb_typeof(e->'checkedAt') IS DISTINCT FROM 'number' OR coalesce(e->>'checkedAt','') !~ '^[0-9]{13}$'
  THEN RAISE EXCEPTION 'Verified sandbox binding required'; END IF;
 checked:=to_timestamp((e->>'checkedAt')::bigint/1000.0);
 IF checked<clock_timestamp()-interval '5 minutes' OR checked>clock_timestamp()+interval '30 seconds' THEN RAISE EXCEPTION 'Fresh binding required'; END IF;
 SELECT * INTO b FROM rr_sandbox.settlement_sim_bindings WHERE order_id=o.id;
 IF b.order_id IS NOT NULL AND (b.account_id<>a.account_id OR b.bank_account_id IS NOT NULL AND b.bank_account_id IS DISTINCT FROM e->>'bankAccountId')
  THEN RAISE EXCEPTION 'Changed bank binding requires review'; END IF;
 INSERT INTO rr_sandbox.settlement_sim_bindings(order_id,account_id,bank_account_id,checked_at,recorded_by)
  VALUES(o.id,a.account_id,e->>'bankAccountId',checked,p_actor)
 ON CONFLICT(order_id) DO UPDATE SET bank_account_id=excluded.bank_account_id,checked_at=excluded.checked_at
  WHERE excluded.checked_at>=settlement_sim_bindings.checked_at;
 RETURN rr_sandbox.settlement_sim_context(p_actor,p_order);
END $$;

CREATE FUNCTION rr_sandbox.settlement_sim_available(p_parent uuid,p_exclude uuid) RETURNS bigint
LANGUAGE sql SET search_path=pg_catalog AS $$
 SELECT p.amount_cents-coalesce(sum(c.amount_cents) FILTER(WHERE c.id IS DISTINCT FROM p_exclude
  AND NOT(c.kind='payout' AND c.status IN ('failed','canceled') AND c.evidence->>'failureBalanceTransactionId' IS NOT NULL)),0)
 FROM rr_sandbox.settlement_sim_requests p LEFT JOIN rr_sandbox.settlement_sim_requests c ON c.parent_id=p.id
 WHERE p.id=p_parent GROUP BY p.amount_cents
$$;
CREATE FUNCTION public.rr_test_prepare_settlement(p_actor uuid,p_order uuid,p_request uuid,p_kind text,p_amount bigint,p_parent uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE o rr_sandbox.orders; q rr_sandbox.settlement_sim_requests; parent rr_sandbox.settlement_sim_requests;
 c jsonb; b rr_sandbox.settlement_sim_bindings; maximum bigint;
BEGIN
 o:=rr_sandbox.lock_settlement_order(p_actor,p_order);
 IF p_request IS NULL OR p_kind IS NULL OR p_kind NOT IN ('transfer','payout','reversal') OR p_amount IS NULL OR p_amount NOT BETWEEN 1 AND o.item_cents
  OR (p_kind='transfer') IS DISTINCT FROM (p_parent IS NULL) THEN RAISE EXCEPTION 'Bound simulation request required'; END IF;
 SELECT * INTO q FROM rr_sandbox.settlement_sim_requests WHERE id=p_request;
 IF FOUND THEN
  IF q.order_id<>p_order OR q.actor_id<>p_actor OR q.kind<>p_kind OR q.amount_cents<>p_amount OR q.parent_id IS DISTINCT FROM p_parent
   THEN RAISE EXCEPTION 'Simulation request is immutable'; END IF;
  RETURN rr_sandbox.settlement_sim_request(q.id);
 END IF;
 c:=rr_sandbox.settlement_sim_context(p_actor,p_order);maximum:=(c->>'maxTransferCents')::bigint;
 IF p_kind IN ('transfer','payout') AND jsonb_array_length(c->'blockers')<>0 THEN RAISE EXCEPTION 'Simulation release evidence incomplete'; END IF;
 IF p_kind='transfer' THEN
  IF p_amount>maximum THEN RAISE EXCEPTION 'Seller simulation proceeds exceeded'; END IF;
 ELSE
  SELECT * INTO parent FROM rr_sandbox.settlement_sim_requests WHERE id=p_parent FOR UPDATE;
  IF NOT FOUND OR parent.order_id<>o.id OR parent.kind<>'transfer' OR parent.phase<>'known' OR parent.status<>'succeeded'
   OR parent.account_id IS DISTINCT FROM c->>'accountId' THEN RAISE EXCEPTION 'Confirmed bound parent transfer required'; END IF;
  IF p_amount>rr_sandbox.settlement_sim_available(parent.id,NULL) THEN RAISE EXCEPTION 'Parent funds allocated or recovery required'; END IF;
 END IF;
 IF p_kind='payout' THEN
  SELECT * INTO b FROM rr_sandbox.settlement_sim_bindings WHERE order_id=o.id;
  IF b.bank_account_id IS NULL OR b.account_id IS DISTINCT FROM c->>'accountId' OR b.checked_at<clock_timestamp()-interval '5 minutes'
   THEN RAISE EXCEPTION 'Fresh server-verified test bank binding required'; END IF;
 END IF;
 INSERT INTO rr_sandbox.settlement_sim_requests(id,order_id,actor_id,seller_id,account_id,kind,amount_cents,max_transfer_cents,
  parent_id,parent_provider_id,parent_amount_cents,bank_account_id)
 VALUES(p_request,o.id,p_actor,o.seller_id,c->>'accountId',p_kind,p_amount,maximum,p_parent,parent.provider_id,parent.amount_cents,
  CASE WHEN p_kind='payout' THEN b.bank_account_id END);
 RETURN rr_sandbox.settlement_sim_request(p_request);
END $$;
CREATE FUNCTION public.rr_test_dispatch_settlement(p_actor uuid,p_request uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE q rr_sandbox.settlement_sim_requests; parent rr_sandbox.settlement_sim_requests;
 o rr_sandbox.orders; c jsonb; b rr_sandbox.settlement_sim_bindings;
BEGIN
 SELECT * INTO q FROM rr_sandbox.settlement_sim_requests WHERE id=p_request;
 IF NOT FOUND THEN RAISE EXCEPTION 'Saved simulation required'; END IF;
 o:=rr_sandbox.lock_settlement_order(p_actor,q.order_id);
 SELECT * INTO q FROM rr_sandbox.settlement_sim_requests WHERE id=p_request FOR UPDATE;
 IF q.actor_id<>p_actor THEN RAISE EXCEPTION 'Original simulation operator required'; END IF;
 -- A signed external refund can arrive after an operator prepared recovery.
 -- Only that same, never-dispatched reversal may continue when explicitly
 -- started by its original operator. Preserve the notice and all review holds.
 IF q.phase<>'prepared' OR q.needs_review AND (q.kind<>'reversal' OR q.hold_reason IS DISTINCT FROM 'provider_refund_notice')
  THEN RETURN jsonb_build_object('dispatch',false,'request',rr_sandbox.settlement_sim_request(q.id)); END IF;
 c:=rr_sandbox.settlement_sim_context(p_actor,q.order_id);
 IF q.kind IN ('transfer','payout') AND (jsonb_array_length(c->'blockers')<>0 OR q.account_id IS DISTINCT FROM c->>'accountId'
  OR q.max_transfer_cents>(c->>'maxTransferCents')::bigint) THEN RAISE EXCEPTION 'Simulation release evidence changed'; END IF;
 IF q.kind<>'transfer' THEN
  SELECT * INTO parent FROM rr_sandbox.settlement_sim_requests WHERE id=q.parent_id FOR UPDATE;
  IF NOT FOUND OR parent.order_id<>q.order_id OR parent.kind<>'transfer' OR parent.phase<>'known' OR parent.status<>'succeeded'
   OR parent.account_id<>q.account_id OR parent.seller_id<>q.seller_id OR parent.provider_id IS DISTINCT FROM q.parent_provider_id
   OR parent.amount_cents IS DISTINCT FROM q.parent_amount_cents THEN RAISE EXCEPTION 'Confirmed bound parent transfer required'; END IF;
  IF q.amount_cents>rr_sandbox.settlement_sim_available(parent.id,q.id) THEN RAISE EXCEPTION 'Parent funds allocated or recovery required'; END IF;
 END IF;
 IF q.kind='payout' THEN
  SELECT * INTO b FROM rr_sandbox.settlement_sim_bindings WHERE order_id=q.order_id;
  IF b.bank_account_id IS DISTINCT FROM q.bank_account_id OR b.checked_at<clock_timestamp()-interval '5 minutes' THEN RAISE EXCEPTION 'Fresh test bank binding required'; END IF;
 END IF;
 UPDATE rr_sandbox.settlement_sim_requests SET phase='dispatched',dispatched_at=clock_timestamp() WHERE id=q.id;
 RETURN jsonb_build_object('dispatch',true,'request',rr_sandbox.settlement_sim_request(q.id));
END $$;
CREATE FUNCTION public.rr_test_save_settlement(p_actor uuid,p_request uuid,p_provider_id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE q rr_sandbox.settlement_sim_requests; o rr_sandbox.orders; prefix text;
BEGIN
 SELECT * INTO q FROM rr_sandbox.settlement_sim_requests WHERE id=p_request;
 IF NOT FOUND THEN RAISE EXCEPTION 'Saved simulation required'; END IF;
 o:=rr_sandbox.lock_settlement_order(p_actor,q.order_id);
 SELECT * INTO q FROM rr_sandbox.settlement_sim_requests WHERE id=p_request FOR UPDATE;
 prefix:=CASE q.kind WHEN 'transfer' THEN '^tr_' WHEN 'payout' THEN '^po_' ELSE '^trr_' END;
 IF q.actor_id<>p_actor OR q.phase='prepared' OR p_provider_id IS NULL OR p_provider_id !~ (prefix||'[A-Za-z0-9]+$')
  OR length(p_provider_id)>100 OR q.provider_id IS NOT NULL AND q.provider_id<>p_provider_id THEN RAISE EXCEPTION 'Matching dispatched provider identity required'; END IF;
 UPDATE rr_sandbox.settlement_sim_requests SET phase='known',provider_id=p_provider_id WHERE id=q.id;
 RETURN rr_sandbox.settlement_sim_request(q.id);
END $$;
CREATE FUNCTION public.rr_test_hold_settlement(p_actor uuid,p_request uuid,p_reason text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE q rr_sandbox.settlement_sim_requests; o rr_sandbox.orders;
BEGIN
 SELECT * INTO q FROM rr_sandbox.settlement_sim_requests WHERE id=p_request;
 IF NOT FOUND THEN RAISE EXCEPTION 'Saved simulation required'; END IF;
 o:=rr_sandbox.lock_settlement_order(p_actor,q.order_id);
 IF p_reason IS NULL OR p_reason NOT IN ('provider_balance_insufficient','provider_outcome_unknown','provider_rejected') THEN RAISE EXCEPTION 'Known simulation hold reason required'; END IF;
 UPDATE rr_sandbox.settlement_sim_requests SET needs_review=true,hold_reason=coalesce(hold_reason,p_reason),
  held_by=CASE WHEN held_at IS NULL THEN p_actor ELSE held_by END,held_at=coalesce(held_at,clock_timestamp()) WHERE id=q.id;
 RETURN rr_sandbox.settlement_sim_request(q.id);
END $$;
CREATE FUNCTION public.rr_test_record_settlement(p_actor uuid,p_request uuid,p_evidence jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE q rr_sandbox.settlement_sim_requests; o rr_sandbox.orders; e jsonb:=p_evidence; checked timestamptz; h text; st text;
 fields text[]:=ARRAY['test','simulationOnly','source','requestId','orderId','kind','providerId','accountId','currency','amountCents',
 'parentProviderId','status','checkedAt','balanceTransactionId','failureBalanceTransactionId','failureCode'];
BEGIN
 SELECT * INTO q FROM rr_sandbox.settlement_sim_requests WHERE id=p_request;
 IF NOT FOUND THEN RAISE EXCEPTION 'Saved simulation required'; END IF;
 o:=rr_sandbox.lock_settlement_order(p_actor,q.order_id);
 SELECT * INTO q FROM rr_sandbox.settlement_sim_requests WHERE id=p_request FOR UPDATE;
 IF q.actor_id<>p_actor OR q.phase<>'known' OR e IS NULL OR jsonb_typeof(e)<>'object' OR NOT(e ?& fields)
  OR EXISTS(SELECT 1 FROM jsonb_object_keys(e) x WHERE NOT(x=ANY(fields)))
  OR e->'test' IS DISTINCT FROM 'true'::jsonb OR e->'simulationOnly' IS DISTINCT FROM 'true'::jsonb
  OR e->>'source' IS DISTINCT FROM 'stripe_sandbox' OR e->>'requestId' IS DISTINCT FROM q.id::text
  OR e->>'orderId' IS DISTINCT FROM q.order_id::text OR e->>'kind' IS DISTINCT FROM q.kind
  OR e->>'providerId' IS DISTINCT FROM q.provider_id OR e->>'accountId' IS DISTINCT FROM q.account_id
  OR e->>'currency' IS DISTINCT FROM 'USD' OR e->'amountCents' IS DISTINCT FROM to_jsonb(q.amount_cents)
  OR e->>'parentProviderId' IS DISTINCT FROM q.parent_provider_id
  OR jsonb_typeof(e->'checkedAt') IS DISTINCT FROM 'number' OR coalesce(e->>'checkedAt','') !~ '^[0-9]{13}$'
  THEN RAISE EXCEPTION 'Matching verified sandbox receipt required'; END IF;
 checked:=to_timestamp((e->>'checkedAt')::bigint/1000.0);
 IF checked<clock_timestamp()-interval '5 minutes' OR checked>clock_timestamp()+interval '30 seconds' THEN RAISE EXCEPTION 'Fresh sandbox receipt required'; END IF;
 st:=e->>'status';
 IF st IS NULL OR (q.kind IN ('transfer','reversal') AND st<>'succeeded')
  OR (q.kind='payout' AND st NOT IN ('pending','in_transit','paid','failed','canceled'))
  OR (e->'balanceTransactionId' IS DISTINCT FROM 'null'::jsonb AND coalesce(e->>'balanceTransactionId','') !~ '^txn_[A-Za-z0-9]+$')
  OR (e->'failureBalanceTransactionId' IS DISTINCT FROM 'null'::jsonb AND coalesce(e->>'failureBalanceTransactionId','') !~ '^txn_[A-Za-z0-9]+$')
  OR (e->'failureCode' IS DISTINCT FROM 'null'::jsonb AND coalesce(e->>'failureCode','') !~ '^[a-z][a-z0-9_]{0,79}$')
  OR (q.kind<>'payout' AND (e->>'failureBalanceTransactionId' IS NOT NULL OR e->>'failureCode' IS NOT NULL))
  OR (st NOT IN ('failed','canceled') AND (e->>'failureBalanceTransactionId' IS NOT NULL OR e->>'failureCode' IS NOT NULL))
  OR (st IN ('succeeded','paid') AND e->>'balanceTransactionId' IS NULL)
  OR (e->>'failureBalanceTransactionId' IS NOT NULL AND e->>'balanceTransactionId' IS NULL)
  THEN RAISE EXCEPTION 'Invalid sandbox receipt status or balance identity'; END IF;
 IF q.checked_at IS NOT NULL AND checked<q.checked_at THEN RETURN rr_sandbox.settlement_sim_request(q.id); END IF;
 h:=encode(sha256(convert_to((e-'checkedAt')::text,'UTF8')),'hex');
 INSERT INTO rr_sandbox.settlement_sim_receipts(request_id,evidence_hash,evidence,recorded_by) VALUES(q.id,h,e,p_actor) ON CONFLICT DO NOTHING;
 -- A bank may return a payout after it was marked paid. That is a legitimate
 -- transition, but it still requires review and independently verified return
 -- accounting. No score or provider status automatically creates another payout.
 IF q.status='succeeded' AND st<>'succeeded' OR q.kind='payout' AND (
  q.status IN ('failed','canceled') AND st NOT IN (q.status)
  OR q.status='paid' AND st NOT IN ('paid','failed')
  OR q.status='in_transit' AND st='pending') THEN
  UPDATE rr_sandbox.settlement_sim_requests SET needs_review=true,hold_reason=coalesce(hold_reason,'receipt_conflict'),
   held_by=CASE WHEN held_at IS NULL THEN p_actor ELSE held_by END,held_at=coalesce(held_at,clock_timestamp()) WHERE id=q.id;
  RETURN rr_sandbox.settlement_sim_request(q.id);
 END IF;
 IF q.evidence IS NOT NULL AND (q.evidence->>'balanceTransactionId' IS NOT NULL AND q.evidence->>'balanceTransactionId' IS DISTINCT FROM e->>'balanceTransactionId'
  OR q.evidence->>'failureBalanceTransactionId' IS NOT NULL AND q.evidence->>'failureBalanceTransactionId' IS DISTINCT FROM e->>'failureBalanceTransactionId') THEN
  UPDATE rr_sandbox.settlement_sim_requests SET needs_review=true,hold_reason=coalesce(hold_reason,'receipt_conflict'),
   held_by=CASE WHEN held_at IS NULL THEN p_actor ELSE held_by END,held_at=coalesce(held_at,clock_timestamp()) WHERE id=q.id;
  RETURN rr_sandbox.settlement_sim_request(q.id);
 END IF;
 UPDATE rr_sandbox.settlement_sim_requests SET status=st,evidence=e,checked_at=checked,
  needs_review=needs_review OR st IN ('failed','canceled'),
  hold_reason=coalesce(hold_reason,CASE WHEN st IN ('failed','canceled') THEN 'payout_recovery_review' END),
  held_by=CASE WHEN held_at IS NULL AND st IN ('failed','canceled') THEN p_actor ELSE held_by END,
  held_at=coalesce(held_at,CASE WHEN st IN ('failed','canceled') THEN clock_timestamp() END) WHERE id=q.id;
 IF q.kind IN ('transfer','reversal') THEN
  INSERT INTO rr_sandbox.settlement_sim_ledger(request_id,kind,amount_cents) VALUES
   (q.id,CASE WHEN q.kind='transfer' THEN 'seller_transfer_out' ELSE 'seller_transfer_recovery' END,q.amount_cents),
   (q.id,CASE WHEN q.kind='transfer' THEN 'connected_seller_balance' ELSE 'connected_reversal_out' END,-q.amount_cents) ON CONFLICT DO NOTHING;
 ELSE
  IF e->>'balanceTransactionId' IS NOT NULL THEN
   INSERT INTO rr_sandbox.settlement_sim_ledger(request_id,kind,amount_cents) VALUES(q.id,'payout_in_transit',q.amount_cents),(q.id,'connected_payout_out',-q.amount_cents) ON CONFLICT DO NOTHING;
  END IF;
  IF st='paid' THEN
   INSERT INTO rr_sandbox.settlement_sim_ledger(request_id,kind,amount_cents) VALUES(q.id,'seller_bank_receipt',q.amount_cents),(q.id,'payout_transit_settled',-q.amount_cents) ON CONFLICT DO NOTHING;
  ELSIF st IN ('failed','canceled') AND e->>'failureBalanceTransactionId' IS NOT NULL THEN
   INSERT INTO rr_sandbox.settlement_sim_ledger(request_id,kind,amount_cents) VALUES(q.id,'connected_payout_return',q.amount_cents),
    (q.id,CASE WHEN EXISTS(SELECT 1 FROM rr_sandbox.settlement_sim_ledger WHERE request_id=q.id AND kind='seller_bank_receipt')
     THEN 'seller_bank_return' ELSE 'payout_transit_return' END,-q.amount_cents) ON CONFLICT DO NOTHING;
  END IF;
 END IF;
 RETURN rr_sandbox.settlement_sim_request(q.id);
END $$;

-- Refund preparation is permitted and establishes the existing sticky order
-- hold. Before the application dispatches its refund POST, serialize on the
-- already locked order and require known recovery of every simulated transfer.
-- An external provider refund notice is never rejected by this guard.
CREATE FUNCTION rr_sandbox.guard_refund_settlement_dispatch() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE t rr_sandbox.settlement_sim_requests; recovered bigint;
BEGIN
 IF NEW.phase<>'dispatched' OR TG_OP='UPDATE' AND OLD.phase='dispatched' THEN RETURN NEW; END IF;
 -- Existing refund dispatcher locks catalog -> order -> refund request. Do not
 -- acquire the startup/seller locks here; only lock child requests after order.
 PERFORM 1 FROM rr_sandbox.orders WHERE id=NEW.order_id FOR UPDATE;
 PERFORM 1 FROM rr_sandbox.settlement_sim_requests WHERE order_id=NEW.order_id ORDER BY id FOR UPDATE;
 IF EXISTS(SELECT 1 FROM rr_sandbox.settlement_sim_requests WHERE order_id=NEW.order_id AND (
  phase='dispatched' OR phase='known' AND status='not_recorded'
  OR kind='payout' AND status IN ('pending','in_transit')))
  THEN RAISE EXCEPTION 'Settlement outcome must be reconciled before app refund dispatch'; END IF;
 FOR t IN SELECT * FROM rr_sandbox.settlement_sim_requests WHERE order_id=NEW.order_id AND kind='transfer'
  AND phase='known' AND status='succeeded' LOOP
  SELECT coalesce(sum(amount_cents),0) INTO recovered FROM rr_sandbox.settlement_sim_requests
   WHERE parent_id=t.id AND kind='reversal' AND phase='known' AND status='succeeded';
  IF recovered<t.amount_cents THEN RAISE EXCEPTION 'Transfer recovery or explicit funding review required before app refund dispatch'; END IF;
 END LOOP;
 RETURN NEW;
END $$;
CREATE TRIGGER rr_test_refund_settlement_dispatch BEFORE INSERT OR UPDATE ON rr_sandbox.refund_requests
 FOR EACH ROW EXECUTE FUNCTION rr_sandbox.guard_refund_settlement_dispatch();
CREATE FUNCTION rr_sandbox.hold_settlement_on_refund_notice() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF (NEW.refund_state,NEW.refunded_cents,NEW.refund_pending_cents)
  IS DISTINCT FROM (OLD.refund_state,OLD.refunded_cents,OLD.refund_pending_cents)
  AND (NEW.refund_state<>'none' OR NEW.refunded_cents>0 OR NEW.refund_pending_cents>0) THEN
  UPDATE rr_sandbox.settlement_sim_requests SET needs_review=true,
   hold_reason=coalesce(hold_reason,'provider_refund_notice'),held_at=coalesce(held_at,clock_timestamp())
   WHERE order_id=NEW.id;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER rr_test_settlement_refund_notice AFTER UPDATE ON rr_sandbox.orders
 FOR EACH ROW EXECUTE FUNCTION rr_sandbox.hold_settlement_on_refund_notice();

-- Financial projections, identity, audit and irreversible dispatch are private.
-- No browser route is introduced, and no ordinary release job is touched.
REVOKE ALL ON FUNCTION rr_sandbox.guard_refund_settlement_dispatch(),rr_sandbox.hold_settlement_on_refund_notice(),
 rr_sandbox.guard_settlement_sim_audit(),rr_sandbox.lock_settlement_order(uuid,uuid),rr_sandbox.settlement_sim_request(uuid),
 rr_sandbox.settlement_sim_context(uuid,uuid),rr_sandbox.settlement_sim_available(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.rr_test_settlement_context(uuid,uuid),public.rr_test_record_settlement_binding(uuid,uuid,jsonb),
 public.rr_test_prepare_settlement(uuid,uuid,uuid,text,bigint,uuid),public.rr_test_dispatch_settlement(uuid,uuid),
 public.rr_test_save_settlement(uuid,uuid,text),public.rr_test_hold_settlement(uuid,uuid,text),
 public.rr_test_record_settlement(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.rr_test_settlement_context(uuid,uuid),public.rr_test_record_settlement_binding(uuid,uuid,jsonb),
 public.rr_test_prepare_settlement(uuid,uuid,uuid,text,bigint,uuid),public.rr_test_dispatch_settlement(uuid,uuid),
 public.rr_test_save_settlement(uuid,uuid,text),public.rr_test_hold_settlement(uuid,uuid,text),
 public.rr_test_record_settlement(uuid,uuid,jsonb) TO service_role;
COMMIT;
