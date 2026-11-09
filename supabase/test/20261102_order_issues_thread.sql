-- ISOLATED STAGING ONLY, after order_issues_review.sql. No financial decisions.
BEGIN;
CREATE TABLE rr_sandbox.issue_seller_responses (
 order_id uuid PRIMARY KEY REFERENCES rr_sandbox.order_issues(order_id),
 seller_id uuid NOT NULL,
 response text NOT NULL CHECK(response IN ('investigating','propose_return','request_review')),
 submitted_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE rr_sandbox.issue_seller_responses ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON rr_sandbox.issue_seller_responses FROM PUBLIC,anon,authenticated;
CREATE FUNCTION public.rr_test_issue_thread(p_actor uuid,p_order uuid,p_response text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE o rr_sandbox.orders; i rr_sandbox.order_issues; r rr_sandbox.issue_seller_responses; a rr_sandbox.issue_acknowledgments;
BEGIN
 SELECT * INTO o FROM rr_sandbox.orders WHERE id=p_order FOR UPDATE;
 IF NOT FOUND OR p_actor IS NULL OR p_actor NOT IN (o.buyer_id,o.seller_id) THEN RAISE EXCEPTION 'Order participant required'; END IF;
 SELECT * INTO i FROM rr_sandbox.order_issues WHERE order_id=p_order;
 IF p_response IS NOT NULL THEN
  IF i.order_id IS NULL OR p_actor<>o.seller_id OR p_response NOT IN ('investigating','propose_return','request_review') THEN RAISE EXCEPTION 'Seller response unavailable'; END IF;
  INSERT INTO rr_sandbox.issue_seller_responses(order_id,seller_id,response) VALUES(p_order,p_actor,p_response) ON CONFLICT DO NOTHING;
  SELECT * INTO r FROM rr_sandbox.issue_seller_responses WHERE order_id=p_order;
  IF r.response<>p_response THEN RAISE EXCEPTION 'Keep original seller response'; END IF;
 END IF;
 IF i.order_id IS NULL THEN RETURN jsonb_build_object('test',true,'orderId',p_order,'state','not_reported'); END IF;
 SELECT * INTO r FROM rr_sandbox.issue_seller_responses WHERE order_id=p_order;
 SELECT * INTO a FROM rr_sandbox.issue_acknowledgments WHERE order_id=p_order;
 RETURN jsonb_build_object('test',true,'orderId',p_order,'state','review_required','reason',i.reason,'reportedAt',i.reported_at,'acknowledgedAt',a.acknowledged_at,'sellerResponse',CASE WHEN r.order_id IS NULL THEN NULL ELSE jsonb_build_object('kind',r.response,'submittedAt',r.submitted_at) END);
END $$;
CREATE OR REPLACE FUNCTION public.rr_test_issue_review(p_actor uuid) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT COALESCE(jsonb_agg(x),'[]'::jsonb) FROM (
  SELECT i.order_id,i.reason,i.reported_at,a.acknowledged_at,true AS participant,r.response AS seller_response,r.submitted_at AS seller_submitted_at
  FROM rr_sandbox.order_issues i JOIN rr_sandbox.orders o ON o.id=i.order_id
  LEFT JOIN rr_sandbox.issue_acknowledgments a ON a.order_id=i.order_id
  LEFT JOIN rr_sandbox.issue_seller_responses r ON r.order_id=i.order_id
  WHERE p_actor IS NOT NULL AND p_actor IN (o.buyer_id,o.seller_id)
  ORDER BY a.acknowledged_at IS NOT NULL,i.reported_at,i.order_id LIMIT 101
 ) x;
$$;
REVOKE ALL ON FUNCTION public.rr_test_issue_thread(uuid,uuid,text),public.rr_test_issue_review(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.rr_test_issue_thread(uuid,uuid,text),public.rr_test_issue_review(uuid) TO service_role;
COMMIT;
