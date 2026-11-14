-- ISOLATED TEST DATABASE ONLY. After cloud_case_alerts and its dependencies.
-- Read-only operator projection; no provider requests, worker claims, money,
-- issue acknowledgement, notification, credential or live authority is created.
BEGIN;
CREATE FUNCTION public.rr_test_admin_overview(p_owner uuid,p_actor uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE observed timestamptz:=clock_timestamp(); result jsonb;
BEGIN
 -- The server freshly authenticates the explicit participating operator first.
 -- Browser roles cannot call this RPC, even with another participant UUID.
 IF p_owner IS NULL OR p_actor IS DISTINCT FROM p_owner OR NOT (
  EXISTS(SELECT 1 FROM rr_sandbox.catalog WHERE seller_id=p_actor)
  OR EXISTS(SELECT 1 FROM rr_sandbox.orders WHERE buyer_id=p_actor OR seller_id=p_actor)
 ) THEN RAISE EXCEPTION 'Configured participating test owner required'; END IF;
 SELECT jsonb_build_object(
  'test',true,'live',false,'releaseEnabled',false,'observedAt',observed,
  'counts',jsonb_build_object(
   'orders',(SELECT count(*) FROM rr_sandbox.orders),
   'paidOrders',(SELECT count(*) FROM rr_sandbox.orders WHERE state='paid'),
   'heldOrders',(SELECT count(*) FROM rr_sandbox.orders WHERE state NOT IN ('expired','payment_failed','cancelled')),
   'sellers',(SELECT count(*) FROM rr_sandbox.seller_accounts),
   'openCases',(SELECT count(*) FROM rr_sandbox.case_alert_heads WHERE requires_response OR evidence_conflict),
   'alertDeliveryGaps',(SELECT count(*) FROM rr_sandbox.case_alert_outbox WHERE state IN ('pending','leased','unknown','exhausted') AND superseded_at IS NULL)
  ),
  'sources',jsonb_build_object(
   'stripeObservedAt',(SELECT max(v) FROM (
    SELECT max(processed_at) v FROM rr_sandbox.provider_events
    UNION ALL SELECT max(checked_at) FROM rr_sandbox.risk_assessments
    UNION ALL SELECT max(updated_at) FROM rr_sandbox.refunds
    UNION ALL SELECT max(observed_at) FROM rr_sandbox.case_alert_heads
   ) e),
   'sellerObservedAt',(SELECT max(checked_at) FROM rr_sandbox.seller_protection_status),
   'shippingObservedAt',(SELECT max(last_checked) FROM rr_sandbox.tracking_current)
  ),
  -- Combined order/case row budget is at most 25. Counts describe the complete
  -- private synthetic database; these rows are a bounded overview, not a ledger.
  'orders',coalesce((SELECT jsonb_agg(x ORDER BY x."observedAt" DESC,x."orderRef") FROM (
   SELECT id AS "orderRef",state,risk_status AS "riskStatus",refund_state AS "refundState",
    coalesce((snapshot->>'totalCents')::bigint,item_cents+buyer_fee_cents) AS "totalCents",
    updated_at AS "observedAt",true AS "holdRequired"
   FROM rr_sandbox.orders ORDER BY updated_at DESC,id LIMIT 15
  ) x),'[]'::jsonb),
  'cases',coalesce((SELECT jsonb_agg(x ORDER BY x."requiresResponse" DESC,x."dueBy" ASC NULLS LAST,(x.status='conflicting_evidence') DESC,x."observedAt" DESC,x."caseRef") FROM (
   SELECT 'case_'||md5(case_id) AS "caseRef",order_id AS "orderRef",kind,
    CASE WHEN evidence_conflict THEN 'conflicting_evidence' ELSE provider_status END AS status,
    requires_response AS "requiresResponse",due_by AS "dueBy",observed_at AS "observedAt",true AS "holdRequired"
   FROM rr_sandbox.case_alert_heads ORDER BY requires_response DESC,due_by ASC NULLS LAST,evidence_conflict DESC,observed_at DESC,case_id LIMIT 10
  ) x),'[]'::jsonb),
  'hasMoreOrders',(SELECT count(*)>15 FROM rr_sandbox.orders),
  'hasMoreCases',(SELECT count(*)>10 FROM rr_sandbox.case_alert_heads)
 ) INTO result;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.rr_test_admin_overview(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.rr_test_admin_overview(uuid,uuid) TO service_role;
COMMIT;
