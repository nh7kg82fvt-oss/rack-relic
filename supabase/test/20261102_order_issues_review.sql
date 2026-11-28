-- ISOLATED STAGING ONLY, after order_issues.sql. Acknowledgment is not resolution.
BEGIN;
CREATE TABLE rr_sandbox.issue_acknowledgments (
 order_id uuid PRIMARY KEY REFERENCES rr_sandbox.order_issues(order_id),
 actor_id uuid NOT NULL,
 acknowledged_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE rr_sandbox.issue_acknowledgments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON rr_sandbox.issue_acknowledgments FROM PUBLIC,anon,authenticated;
CREATE FUNCTION public.rr_test_issue_review(p_actor uuid) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT COALESCE(jsonb_agg(x),'[]'::jsonb) FROM (
  SELECT i.order_id,i.reason,i.reported_at,a.acknowledged_at,true AS participant
  FROM rr_sandbox.order_issues i JOIN rr_sandbox.orders o ON o.id=i.order_id
  LEFT JOIN rr_sandbox.issue_acknowledgments a ON a.order_id=i.order_id
  WHERE p_actor IS NOT NULL AND p_actor IN (o.buyer_id,o.seller_id)
  ORDER BY a.acknowledged_at IS NOT NULL,i.reported_at,i.order_id LIMIT 101
 ) x;
$$;
CREATE FUNCTION public.rr_test_acknowledge_issue(p_actor uuid,p_order uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE i rr_sandbox.order_issues; a rr_sandbox.issue_acknowledgments;
BEGIN
 -- Match buyer reporting's lock order; do not modify risk, jobs or ledger.
 PERFORM 1 FROM rr_sandbox.orders WHERE id=p_order AND p_actor IN (buyer_id,seller_id) FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Participating test operator required'; END IF;
 SELECT * INTO i FROM rr_sandbox.order_issues WHERE order_id=p_order;
 IF NOT FOUND THEN RAISE EXCEPTION 'Saved report required'; END IF;
 INSERT INTO rr_sandbox.issue_acknowledgments(order_id,actor_id) VALUES(p_order,p_actor) ON CONFLICT DO NOTHING;
 SELECT * INTO a FROM rr_sandbox.issue_acknowledgments WHERE order_id=p_order;
 RETURN jsonb_build_object('test',true,'orderId',i.order_id,'acknowledged',true,'acknowledgedAt',a.acknowledged_at);
END $$;
REVOKE ALL ON FUNCTION public.rr_test_issue_review(uuid),public.rr_test_acknowledge_issue(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.rr_test_issue_review(uuid),public.rr_test_acknowledge_issue(uuid,uuid) TO service_role;
COMMIT;
