-- Isolated staging only. No live refund, notification or transfer is dispatched.
BEGIN;
CREATE TABLE rr_sandbox.order_issues (
 order_id uuid PRIMARY KEY REFERENCES rr_sandbox.orders(id),
 buyer_id uuid NOT NULL,
 reason text NOT NULL CHECK(reason IN ('not_received','damaged','not_as_described')),
 state text NOT NULL DEFAULT 'review_required' CHECK(state='review_required'),
 reported_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE rr_sandbox.order_issues ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON rr_sandbox.order_issues FROM PUBLIC,anon,authenticated;
CREATE FUNCTION public.rr_test_order_issue(p_actor uuid,p_order uuid,p_reason text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE o rr_sandbox.orders; i rr_sandbox.order_issues;
BEGIN
 SELECT * INTO o FROM rr_sandbox.orders WHERE id=p_order FOR UPDATE;
 IF NOT FOUND OR p_actor IS NULL OR o.buyer_id<>p_actor THEN RAISE EXCEPTION 'Buyer order required'; END IF;
 IF p_reason IS NOT NULL THEN
  IF p_reason NOT IN ('not_received','damaged','not_as_described') OR NOT EXISTS(SELECT 1 FROM rr_sandbox.ledger_entries WHERE order_id=o.id AND kind='gross_receivable' AND amount_cents>0) THEN RAISE EXCEPTION 'Confirmed payment required'; END IF;
  INSERT INTO rr_sandbox.order_issues(order_id,buyer_id,reason) VALUES(o.id,p_actor,p_reason) ON CONFLICT DO NOTHING;
  SELECT * INTO i FROM rr_sandbox.order_issues WHERE order_id=o.id;
  IF i.reason<>p_reason THEN RAISE EXCEPTION 'Keep original report'; END IF;
  -- Do not overwrite a fraud block or clear an existing financial hold.
  UPDATE rr_sandbox.orders SET risk_status=CASE WHEN risk_status='blocked' THEN 'blocked' ELSE 'review' END,updated_at=now() WHERE id=o.id;
  UPDATE rr_sandbox.jobs SET state='held' WHERE order_id=o.id AND kind IN ('prepare_test_label','seller_sale_notice') AND state='pending';
  INSERT INTO rr_sandbox.jobs(order_id,kind,state) VALUES(o.id,'order_issue_review','held') ON CONFLICT DO NOTHING;
 ELSE
  SELECT * INTO i FROM rr_sandbox.order_issues WHERE order_id=o.id;
 END IF;
 IF i.order_id IS NULL THEN RETURN jsonb_build_object('test',true,'orderId',o.id,'state','not_reported'); END IF;
 RETURN jsonb_build_object('test',true,'orderId',i.order_id,'state',i.state,'reason',i.reason,'reportedAt',i.reported_at);
END $$;
REVOKE ALL ON FUNCTION public.rr_test_order_issue(uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.rr_test_order_issue(uuid,uuid,text) TO service_role;
COMMIT;
