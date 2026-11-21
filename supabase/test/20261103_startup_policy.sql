-- Isolated staging only, after seller_protections and provider_risk_holds.
-- Owner chose safety and minimal cost for the initial pilot. These stricter
-- marketplace-wide limits sit below the approved per-seller ceilings.
BEGIN;
ALTER FUNCTION rr_sandbox.check_seller_protection(uuid,uuid,bigint) RENAME TO check_seller_protection_baseline;
REVOKE ALL ON FUNCTION rr_sandbox.check_seller_protection_baseline(uuid,uuid,bigint) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION rr_sandbox.check_startup_exposure(p_order uuid,p_total bigint) RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE outstanding bigint;
BEGIN
 -- All checkouts acquire this before the seller lock. Different sellers
 -- cannot each consume the same startup risk allowance concurrently.
 PERFORM pg_advisory_xact_lock(301103,1);
 IF p_total IS NULL OR p_total NOT BETWEEN 1 AND 10000 THEN RAISE EXCEPTION 'Startup order limit requires review'; END IF;
 SELECT count(*) INTO outstanding FROM rr_sandbox.orders
 WHERE id<>p_order AND state NOT IN ('expired','payment_failed','cancelled');
 IF outstanding>=1 THEN RAISE EXCEPTION 'Startup marketplace exposure limit requires review'; END IF;
END $$;
REVOKE ALL ON FUNCTION rr_sandbox.check_startup_exposure(uuid,bigint) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION rr_sandbox.check_seller_protection(p_seller uuid,p_order uuid,p_total bigint) RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 PERFORM rr_sandbox.check_startup_exposure(p_order,p_total);
 PERFORM rr_sandbox.check_seller_protection_baseline(p_seller,p_order,p_total);
END $$;
REVOKE ALL ON FUNCTION rr_sandbox.check_seller_protection(uuid,uuid,bigint) FROM PUBLIC,anon,authenticated,service_role;

-- Independent triggers ensure existing cached function plans cannot retain an
-- older per-seller-only guard after migration. Names run before seller guards.
CREATE FUNCTION rr_sandbox.guard_startup_exposure() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF TG_TABLE_NAME='orders' THEN
  IF TG_OP='INSERT' THEN PERFORM rr_sandbox.check_startup_exposure(NEW.id,NEW.item_cents+NEW.buyer_fee_cents);
  ELSIF OLD.state='reserved' AND NEW.state='checkout_open' THEN PERFORM rr_sandbox.check_startup_exposure(NEW.id,(NEW.snapshot->>'totalCents')::bigint); END IF;
 ELSIF OLD.phase='prepared' AND NEW.phase='dispatched' THEN
  PERFORM rr_sandbox.check_startup_exposure(NEW.order_id,(NEW.snapshot->>'totalCents')::bigint);
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION rr_sandbox.guard_startup_exposure() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER rr_test_00_startup_orders BEFORE INSERT OR UPDATE ON rr_sandbox.orders FOR EACH ROW EXECUTE FUNCTION rr_sandbox.guard_startup_exposure();
CREATE TRIGGER rr_test_00_startup_dispatch BEFORE UPDATE ON rr_sandbox.checkout_attempts FOR EACH ROW EXECUTE FUNCTION rr_sandbox.guard_startup_exposure();
CREATE OR REPLACE FUNCTION public.rr_test_checkout_attempt(p_order uuid,p_buyer uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE o rr_sandbox.orders; total bigint;
BEGIN
 SELECT * INTO o FROM rr_sandbox.orders WHERE id=p_order;
 IF NOT FOUND OR p_buyer IS NULL OR o.buyer_id<>p_buyer THEN RAISE EXCEPTION 'Buyer order required'; END IF;
 SELECT GREATEST(o.item_cents+o.buyer_fee_cents,COALESCE((o.snapshot->>'totalCents')::bigint,0),
  COALESCE((a.snapshot->>'totalCents')::bigint,0)) INTO total FROM rr_sandbox.checkout_attempts a WHERE a.order_id=o.id;
 PERFORM rr_sandbox.check_startup_exposure(o.id,COALESCE(total,o.item_cents+o.buyer_fee_cents));
 PERFORM rr_sandbox.check_seller_protection_baseline(o.seller_id,o.id,COALESCE(total,o.item_cents+o.buyer_fee_cents));
 RETURN rr_sandbox.rr_test_checkout_attempt(p_order,p_buyer);
END $$;

-- Two business days, preserving Pacific wall-clock time. Weekends and the
-- observed US federal holidays listed by OPM are excluded. Bounded calendar:
-- https://www.opm.gov/policy-data-oversight/pay-leave/federal-holidays/
-- Dec 31 2027 observes New Year's Day 2028. Unknown years fail closed.
CREATE FUNCTION rr_sandbox.delivery_wait_end(p_delivered timestamptz) RETURNS timestamptz
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE local_time timestamp; d date; days integer:=0;
 holidays date[]:=ARRAY['2026-01-01','2026-01-19','2026-02-16','2026-05-25','2026-06-19','2026-07-03',
 '2026-09-07','2026-10-12','2026-11-11','2026-11-26','2026-12-25',
 '2027-01-01','2027-01-18','2027-02-15','2027-05-31','2027-06-18','2027-07-05','2027-09-06',
 '2027-10-11','2027-11-11','2027-11-25','2027-12-24','2027-12-31']::date[];
BEGIN
 IF p_delivered IS NULL OR NOT isfinite(p_delivered) THEN RAISE EXCEPTION 'Verified delivery time required'; END IF;
 local_time:=p_delivered AT TIME ZONE 'America/Los_Angeles';d:=local_time::date;
 IF d<DATE '2026-01-01' OR d>DATE '2027-12-31' THEN RAISE EXCEPTION 'Delivery calendar requires review'; END IF;
 WHILE days<2 LOOP
  d:=d+1;
  IF d>DATE '2027-12-31' THEN RAISE EXCEPTION 'Delivery calendar requires review'; END IF;
  IF extract(isodow FROM d)<6 AND NOT d=ANY(holidays) THEN days:=days+1; END IF;
 END LOOP;
 RETURN (d+local_time::time) AT TIME ZONE 'America/Los_Angeles';
END $$;
REVOKE ALL ON FUNCTION rr_sandbox.delivery_wait_end(timestamptz) FROM PUBLIC,anon,authenticated,service_role;

-- Future workers cannot silently create a releasable money job while live
-- delivery binding, reserve verification, recovery and terms are incomplete.
-- Holding a job is allowed; dispatch/completion requires a reviewed replacement
-- of this guard and final owner authorization, never a browser toggle.
CREATE FUNCTION rr_sandbox.guard_money_release_job() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF NEW.kind IN ('seller_transfer','seller_payout') AND NEW.state IN ('pending','leased','done') THEN
  RAISE EXCEPTION 'Seller release disabled pending verified delivery, waiting period, reserves and acceptance';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION rr_sandbox.guard_money_release_job() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER rr_test_money_release_guard BEFORE INSERT OR UPDATE ON rr_sandbox.jobs
 FOR EACH ROW EXECUTE FUNCTION rr_sandbox.guard_money_release_job();

ALTER FUNCTION public.rr_test_protection_review(uuid,uuid) SET SCHEMA rr_sandbox;
REVOKE ALL ON FUNCTION rr_sandbox.rr_test_protection_review(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.rr_test_protection_review(p_actor uuid,p_order uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 RETURN rr_sandbox.rr_test_protection_review(p_actor,p_order)||jsonb_build_object('policy',jsonb_build_object(
  'version','startup-v1','maxOrderCents',10000,'maxUnsettledOrders',1,'maxUnsettledGrossCents',10000,
  'minBusinessDaysAfterDelivery',2,'automaticRelease',false));
END $$;
REVOKE ALL ON FUNCTION public.rr_test_protection_review(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.rr_test_protection_review(uuid,uuid) TO service_role;
COMMIT;
