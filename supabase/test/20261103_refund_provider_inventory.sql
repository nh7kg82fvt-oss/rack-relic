-- ISOLATED TEST DATABASE ONLY. After refund_requests and all installed
-- dispatch guards. Existing grants, settlement fences and history remain.
-- This adds a private receipt baseline to existing authorized test dispatch.
BEGIN;
ALTER FUNCTION public.rr_test_dispatch_refund(uuid,uuid) SET SCHEMA rr_sandbox;
REVOKE ALL ON FUNCTION rr_sandbox.rr_test_dispatch_refund(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.rr_test_dispatch_refund(p_request uuid,p_actor uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE result jsonb; q rr_sandbox.refund_requests; o rr_sandbox.orders;
 baseline jsonb; n bigint; completed bigint;
BEGIN
 -- The original function retains catalog -> order -> request locks and every
 -- existing trigger. A later failure rolls its dispatch claim back as well.
 result:=rr_sandbox.rr_test_dispatch_refund(p_request,p_actor);
 IF result->'dispatch' IS DISTINCT FROM 'true'::jsonb THEN RETURN result; END IF;
 SELECT * INTO q FROM rr_sandbox.refund_requests WHERE id=p_request;
 SELECT * INTO o FROM rr_sandbox.orders WHERE id=q.order_id;
 IF EXISTS(SELECT 1 FROM rr_sandbox.refunds r WHERE r.order_id=o.id AND
  (r.needs_review OR r.status NOT IN ('succeeded','failed','canceled')
   OR r.payment_intent_id<>q.payment_intent_id)) THEN
  RAISE EXCEPTION 'Refund inventory requires reconciliation';
 END IF;
 SELECT count(*),coalesce(sum(r.amount_cents),0),
  coalesce(jsonb_agg(jsonb_build_object('id',r.id,'amount_cents',r.amount_cents,'charge_id',r.charge_id) ORDER BY r.id),'[]'::jsonb)
 INTO n,completed,baseline FROM rr_sandbox.refunds r WHERE r.order_id=o.id AND r.status='succeeded';
 IF n>100 OR completed<>o.refunded_cents OR completed+q.amount_cents>q.total_cents THEN
  RAISE EXCEPTION 'Confirmed refund inventory requires reconciliation';
 END IF;
 RETURN jsonb_set(result,'{request}',(result->'request')||jsonb_build_object('refund_baseline',baseline));
END $$;
REVOKE ALL ON FUNCTION public.rr_test_dispatch_refund(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.rr_test_dispatch_refund(uuid,uuid) TO service_role;
COMMIT;
