-- Owner-approved starting policy: $200 COMPLETE buyer total, one unsettled
-- order marketplace-wide. Additive staging-only change; older $100 evidence
-- remains historical. Does not enable checkout, settlement or live money.
BEGIN;
CREATE OR REPLACE FUNCTION rr_sandbox.check_startup_exposure(p_order uuid,p_total bigint) RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE outstanding bigint;
BEGIN
 PERFORM pg_advisory_xact_lock(301103,1);
 IF p_total IS NULL OR p_total NOT BETWEEN 1 AND 20000 THEN RAISE EXCEPTION 'Startup order limit requires review'; END IF;
 SELECT count(*) INTO outstanding FROM rr_sandbox.orders
 WHERE id<>p_order AND state NOT IN ('expired','payment_failed','cancelled');
 IF outstanding>=1 THEN RAISE EXCEPTION 'Startup marketplace exposure limit requires review'; END IF;
END $$;
REVOKE ALL ON FUNCTION rr_sandbox.check_startup_exposure(uuid,bigint) FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION public.rr_test_protection_review(p_actor uuid,p_order uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 RETURN rr_sandbox.rr_test_protection_review(p_actor,p_order)||jsonb_build_object('policy',jsonb_build_object(
  'version','startup-v2','maxOrderCents',20000,'maxUnsettledOrders',1,'maxUnsettledGrossCents',20000,
  'minBusinessDaysAfterDelivery',2,'automaticRelease',false));
END $$;
REVOKE ALL ON FUNCTION public.rr_test_protection_review(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.rr_test_protection_review(uuid,uuid) TO service_role;
COMMIT;
