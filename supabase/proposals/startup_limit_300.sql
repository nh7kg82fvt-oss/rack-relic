-- PROPOSAL ONLY: NOT an installation migration or approved launch policy.
-- Execute only in a disposable LOCAL scenario database to compare a $300
-- complete order ceiling. The approved starting policy remains $200.
-- Preserves the global one-unsettled-order lock and all other release holds.
BEGIN;
CREATE OR REPLACE FUNCTION rr_sandbox.check_startup_exposure(p_order uuid,p_total bigint) RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE outstanding bigint;
BEGIN
 PERFORM pg_advisory_xact_lock(301103,1);
 IF p_total IS NULL OR p_total NOT BETWEEN 1 AND 30000 THEN RAISE EXCEPTION 'Startup order limit requires review'; END IF;
 SELECT count(*) INTO outstanding FROM rr_sandbox.orders
 WHERE id<>p_order AND state NOT IN ('expired','payment_failed','cancelled');
 IF outstanding>=1 THEN RAISE EXCEPTION 'Startup marketplace exposure limit requires review'; END IF;
END $$;
REVOKE ALL ON FUNCTION rr_sandbox.check_startup_exposure(uuid,bigint) FROM PUBLIC,anon,authenticated,service_role;
-- Deliberately not a recognized approved policy in the browser projection.
CREATE OR REPLACE FUNCTION public.rr_test_protection_review(p_actor uuid,p_order uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 RETURN rr_sandbox.rr_test_protection_review(p_actor,p_order)||jsonb_build_object('policy',jsonb_build_object(
  'version','startup-proposed-300','maxOrderCents',30000,'maxUnsettledOrders',1,'maxUnsettledGrossCents',30000,
  'minBusinessDaysAfterDelivery',2,'automaticRelease',false));
END $$;
REVOKE ALL ON FUNCTION public.rr_test_protection_review(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.rr_test_protection_review(uuid,uuid) TO service_role;
COMMIT;
