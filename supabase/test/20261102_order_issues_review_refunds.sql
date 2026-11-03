-- ISOLATED STAGING ONLY. After refund_requests and order_issues_review.
-- Read-only evidence; it cannot approve, prepare or dispatch a refund.
BEGIN;
CREATE FUNCTION public.rr_test_issue_refund_review(p_actor uuid,p_order uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE o rr_sandbox.orders; total bigint; confirmed bigint; pending bigint; unknown_count integer; conflict boolean; readiness text;
BEGIN
 SELECT * INTO o FROM rr_sandbox.orders WHERE id=p_order;
 IF NOT FOUND OR p_actor IS NULL OR p_actor NOT IN (o.buyer_id,o.seller_id) THEN RAISE EXCEPTION 'Participating operator required'; END IF;
 IF NOT EXISTS(SELECT 1 FROM rr_sandbox.order_issues WHERE order_id=o.id) THEN RETURN jsonb_build_object('test',true,'orderId',o.id,'state','not_reported','canPrepare',false,'fulfillmentReleased',false); END IF;
 total:=(o.snapshot->>'totalCents')::bigint;
 IF o.state NOT IN ('paid','review') OR o.payment_intent_id IS NULL OR total IS NULL OR total NOT BETWEEN 1 AND 30000000 OR NOT EXISTS(SELECT 1 FROM rr_sandbox.ledger_entries WHERE order_id=o.id AND kind='gross_receivable' AND amount_cents=total) THEN RAISE EXCEPTION 'Verified payment evidence required'; END IF;
 SELECT COALESCE(sum(amount_cents) FILTER(WHERE status='succeeded'),0),COALESCE(sum(amount_cents) FILTER(WHERE status IN ('pending','requires_action')),0) INTO confirmed,pending FROM rr_sandbox.refunds WHERE order_id=o.id;
 SELECT count(*) INTO unknown_count FROM rr_sandbox.refund_requests q WHERE q.order_id=o.id AND NOT EXISTS(SELECT 1 FROM rr_sandbox.refunds r WHERE r.id=q.refund_id);
 conflict:=o.refund_state IN ('review','failed') OR confirmed<>o.refunded_cents OR pending<>o.refund_pending_cents OR confirmed+pending>total
  OR (pending>0 AND o.refund_state<>'pending') OR (pending=0 AND confirmed>0 AND confirmed<total AND o.refund_state<>'partial') OR (pending=0 AND confirmed=0 AND o.refund_state<>'none')
  OR (confirmed=total AND o.refund_state<>'refunded') OR (confirmed<total AND o.refund_state='refunded')
  OR EXISTS(SELECT 1 FROM rr_sandbox.refunds WHERE order_id=o.id AND (payment_intent_id<>o.payment_intent_id OR needs_review OR status IN ('failed','canceled')))
  OR EXISTS(SELECT 1 FROM rr_sandbox.refund_requests q LEFT JOIN rr_sandbox.refunds r ON r.id=q.refund_id WHERE q.order_id=o.id AND (q.payment_intent_id<>o.payment_intent_id OR q.total_cents<>total OR (r.id IS NOT NULL AND (r.order_id<>o.id OR r.payment_intent_id<>q.payment_intent_id OR r.amount_cents<>q.amount_cents OR r.charge_id IS DISTINCT FROM q.charge_id OR q.phase<>'known'))));
 readiness:=CASE WHEN conflict THEN 'needs_reconciliation' WHEN pending>0 OR unknown_count>0 THEN 'pending' WHEN confirmed=total THEN 'refunded' WHEN NOT EXISTS(SELECT 1 FROM rr_sandbox.issue_acknowledgments WHERE order_id=o.id) THEN 'awaiting_acknowledgment' ELSE 'available_for_review' END;
 RETURN jsonb_build_object('test',true,'orderId',o.id,'state',readiness,'totalCents',total,'confirmedCents',confirmed,'pendingCents',pending,'unconfirmedRequestCount',unknown_count,'remainingCents',greatest(total-confirmed,0),'canPrepare',readiness='available_for_review','fulfillmentReleased',false);
END $$;
REVOKE ALL ON FUNCTION public.rr_test_issue_refund_review(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.rr_test_issue_refund_review(uuid,uuid) TO service_role;
COMMIT;
