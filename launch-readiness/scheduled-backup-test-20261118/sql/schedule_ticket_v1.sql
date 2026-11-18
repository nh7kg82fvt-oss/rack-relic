-- UNINSTALLED LOCAL ONE-SLOT TEST SOURCE; fixed target tzymapahsfiyhgilsmxl ONLY.
-- Future installer must independently bind that exact managed branch/catalogue.
-- One atomic DO; no COMMIT, schema creation, extension, FK, old-table mutation,
-- runtime seed endpoint, key material, reset, rearm or retry. Empty by default.
-- Only trusted external DB owner may seed the one row after FINAL enrollment.
-- Owner/admin can alter/drop guards; this is not protection against that actor.
-- Owner memberships, superusers and predefined global data-administration roles
-- remain administrative trust; no guessed hosted admin-role allowlist is used.
DO $install$
DECLARE role_name text; fn regprocedure;
 prior_search_path text:=pg_catalog.current_setting('search_path');
BEGIN
 PERFORM pg_catalog.set_config('search_path','pg_catalog',true);
 IF to_regnamespace('rr_sandbox') IS NULL OR EXISTS(
  SELECT 1 FROM unnest(ARRAY['anon','authenticated','service_role']) n
  WHERE NOT EXISTS(SELECT 1 FROM pg_catalog.pg_roles r WHERE r.rolname=n))
  OR to_regclass('rr_sandbox.backup_schedule_ticket_v1') IS NOT NULL
  OR EXISTS(SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
   WHERE (n.nspname='rr_sandbox' AND p.proname='backup_schedule_ticket_no_reset_v1')
   OR (n.nspname='public' AND p.proname IN('rr_test_backup_schedule_ticket_read_v1','rr_test_backup_schedule_ticket_consume_v1')))
 THEN RAISE EXCEPTION 'SCHEDULE_TICKET_INSTALL_TARGET_HELD'; END IF;

 CREATE TABLE rr_sandbox.backup_schedule_ticket_v1 (
  singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
  ticket_id uuid NOT NULL UNIQUE CHECK(ticket_id<>'00000000-0000-0000-0000-000000000000'),
  cron text NOT NULL CHECK(length(cron)<=64 AND cron ~ '^[^[:space:]]+( [^[:space:]]+){4}$'),
  scheduled_time bigint NOT NULL CHECK(scheduled_time>0 AND scheduled_time<=9007199254735991 AND scheduled_time%60000=0),
  deadline bigint NOT NULL CHECK(deadline=scheduled_time+5000),
  root_sha256 text NOT NULL CHECK(root_sha256 ~ '^[a-f0-9]{64}$' AND root_sha256<>repeat('0',64)),
  acceptance_sha256 text NOT NULL CHECK(acceptance_sha256 ~ '^[a-f0-9]{64}$' AND acceptance_sha256<>repeat('0',64)),
  request_sha256 text NOT NULL CHECK(request_sha256 ~ '^[a-f0-9]{64}$' AND request_sha256<>repeat('0',64)),
  selection_sha256 text NOT NULL CHECK(selection_sha256 ~ '^[a-f0-9]{64}$' AND selection_sha256<>repeat('0',64)),
  envelope_text text NOT NULL CHECK(octet_length(envelope_text) BETWEEN 2 AND 65536),
  envelope_sha256 text NOT NULL CHECK(envelope_sha256 ~ '^[a-f0-9]{64}$' AND envelope_sha256<>repeat('0',64)
   AND envelope_sha256=encode(sha256(convert_to(envelope_text,'UTF8')),'hex')),
  claimed_nonce text CHECK(claimed_nonce ~ '^[a-f0-9]{32}$' AND claimed_nonce<>repeat('0',32)),
  claimed_at bigint,
  CHECK((claimed_nonce IS NULL)=(claimed_at IS NULL)),
  CHECK(claimed_at IS NULL OR (claimed_at>=scheduled_time AND claimed_at<deadline))
 );
 ALTER TABLE rr_sandbox.backup_schedule_ticket_v1 ENABLE ROW LEVEL SECURITY;
 REVOKE ALL ON rr_sandbox.backup_schedule_ticket_v1 FROM PUBLIC,anon,authenticated,service_role;

 CREATE FUNCTION rr_sandbox.backup_schedule_ticket_no_reset_v1() RETURNS trigger
 LANGUAGE plpgsql SET search_path=pg_catalog AS $guard$
 DECLARE e jsonb; actual_now bigint;
 BEGIN
  IF TG_OP IN('DELETE','TRUNCATE') THEN RAISE EXCEPTION 'SCHEDULE_TICKET_IMMUTABLE'; END IF;
  IF TG_OP='INSERT' THEN
   IF NEW.claimed_nonce IS NOT NULL OR NEW.claimed_at IS NOT NULL THEN RAISE EXCEPTION 'SCHEDULE_TICKET_INITIAL_CLAIM_HELD'; END IF;
   e:=NEW.envelope_text::jsonb;
   IF jsonb_typeof(e) IS DISTINCT FROM 'object' OR NOT(e ?& ARRAY['selection','request','ownerGrant','enrollment','custodyReview','collectorGrantReview','sourcePrincipalGrant','lease','signedWindowBinding'])
    OR e-ARRAY['selection','request','ownerGrant','enrollment','custodyReview','collectorGrantReview','sourcePrincipalGrant','lease','signedWindowBinding']<>'{}'::jsonb
    OR e#>>'{request,version}' IS DISTINCT FROM 'rr-cf-backup-root-request-v1'
    OR e#>>'{request,requestedAt}' IS DISTINCT FROM NEW.scheduled_time::text
    OR e#>>'{request,deadline}' IS DISTINCT FROM NEW.deadline::text
    OR e#>>'{request,selectionSha256}' IS DISTINCT FROM NEW.selection_sha256
   THEN RAISE EXCEPTION 'SCHEDULE_TICKET_ENVELOPE_HELD'; END IF;
   RETURN NEW;
  END IF;
  actual_now:=floor(extract(epoch FROM clock_timestamp())*1000)::bigint;
  IF ROW(NEW.singleton,NEW.ticket_id,NEW.cron,NEW.scheduled_time,NEW.deadline,NEW.root_sha256,NEW.acceptance_sha256,NEW.request_sha256,NEW.selection_sha256,NEW.envelope_text,NEW.envelope_sha256)
   IS DISTINCT FROM ROW(OLD.singleton,OLD.ticket_id,OLD.cron,OLD.scheduled_time,OLD.deadline,OLD.root_sha256,OLD.acceptance_sha256,OLD.request_sha256,OLD.selection_sha256,OLD.envelope_text,OLD.envelope_sha256)
   OR OLD.claimed_nonce IS NOT NULL OR OLD.claimed_at IS NOT NULL OR NEW.claimed_nonce IS NULL
   OR NEW.claimed_nonce !~ '^[a-f0-9]{32}$' OR NEW.claimed_nonce=repeat('0',32)
   OR NEW.claimed_at IS NULL OR NEW.claimed_at<OLD.scheduled_time OR NEW.claimed_at>=OLD.deadline
   OR actual_now<OLD.scheduled_time OR actual_now>=OLD.deadline OR NEW.claimed_at>actual_now
  THEN RAISE EXCEPTION 'SCHEDULE_TICKET_IMMUTABLE'; END IF;
  RETURN NEW;
 END $guard$;
 CREATE TRIGGER backup_schedule_ticket_immutable_v1 BEFORE INSERT OR UPDATE OR DELETE ON rr_sandbox.backup_schedule_ticket_v1 FOR EACH ROW EXECUTE FUNCTION rr_sandbox.backup_schedule_ticket_no_reset_v1();
 CREATE TRIGGER backup_schedule_ticket_no_truncate_v1 BEFORE TRUNCATE ON rr_sandbox.backup_schedule_ticket_v1 FOR EACH STATEMENT EXECUTE FUNCTION rr_sandbox.backup_schedule_ticket_no_reset_v1();

 CREATE FUNCTION public.rr_test_backup_schedule_ticket_read_v1(
  p_ticket_id uuid,p_cron text,p_scheduled_time bigint,p_deadline bigint,
  p_root_sha256 text,p_acceptance_sha256 text,p_request_sha256 text,p_selection_sha256 text
 ) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog SET lock_timeout='100ms' AS $read$
 DECLARE q rr_sandbox.backup_schedule_ticket_v1; actual_now bigint;
 BEGIN
  SELECT * INTO q FROM rr_sandbox.backup_schedule_ticket_v1 WHERE singleton FOR SHARE;
  actual_now:=floor(extract(epoch FROM clock_timestamp())*1000)::bigint;
  IF NOT FOUND OR ROW(q.ticket_id,q.cron,q.scheduled_time,q.deadline,q.root_sha256,q.acceptance_sha256,q.request_sha256,q.selection_sha256)
   IS DISTINCT FROM ROW(p_ticket_id,p_cron,p_scheduled_time,p_deadline,p_root_sha256,p_acceptance_sha256,p_request_sha256,p_selection_sha256)
   OR actual_now<q.scheduled_time OR actual_now>=q.deadline
  THEN RAISE EXCEPTION 'SCHEDULE_TICKET_SLOT_HELD'; END IF;
  IF q.claimed_nonce IS NOT NULL THEN RETURN jsonb_build_object('version','rr-schedule-ticket-consumed-v1','ticketId',q.ticket_id,'consumed',true); END IF;
  RETURN jsonb_build_object('version','rr-schedule-ticket-record-v1','ticketId',q.ticket_id,'cron',q.cron,'scheduledTime',q.scheduled_time,'deadline',q.deadline,
   'rootSha256',q.root_sha256,'acceptanceSha256',q.acceptance_sha256,'requestSha256',q.request_sha256,'selectionSha256',q.selection_sha256,
   'envelopeSha256',q.envelope_sha256,'envelopeText',q.envelope_text,'consumed',false);
 END $read$;
 CREATE FUNCTION public.rr_test_backup_schedule_ticket_consume_v1(
  p_ticket_id uuid,p_cron text,p_scheduled_time bigint,p_deadline bigint,
  p_root_sha256 text,p_acceptance_sha256 text,p_request_sha256 text,p_selection_sha256 text,
  p_envelope_sha256 text,p_nonce text
 ) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog SET lock_timeout='100ms' AS $consume$
 DECLARE q rr_sandbox.backup_schedule_ticket_v1; actual_now bigint;
 BEGIN
  IF p_nonce IS NULL OR p_nonce !~ '^[a-f0-9]{32}$' OR p_nonce=repeat('0',32) THEN RAISE EXCEPTION 'SCHEDULE_TICKET_NONCE_HELD'; END IF;
  SELECT * INTO q FROM rr_sandbox.backup_schedule_ticket_v1 WHERE singleton FOR UPDATE;
  -- Re-read wall clock AFTER the row lock; a waiter cannot use transaction time.
  actual_now:=floor(extract(epoch FROM clock_timestamp())*1000)::bigint;
  IF NOT FOUND OR ROW(q.ticket_id,q.cron,q.scheduled_time,q.deadline,q.root_sha256,q.acceptance_sha256,q.request_sha256,q.selection_sha256,q.envelope_sha256)
   IS DISTINCT FROM ROW(p_ticket_id,p_cron,p_scheduled_time,p_deadline,p_root_sha256,p_acceptance_sha256,p_request_sha256,p_selection_sha256,p_envelope_sha256)
   OR actual_now<q.scheduled_time OR actual_now>=q.deadline
  THEN RAISE EXCEPTION 'SCHEDULE_TICKET_SLOT_HELD'; END IF;
  IF q.claimed_nonce IS NOT NULL THEN RETURN jsonb_build_object('version','rr-schedule-ticket-consumed-v1','ticketId',q.ticket_id,'consumed',true); END IF;
  UPDATE rr_sandbox.backup_schedule_ticket_v1 SET claimed_nonce=p_nonce,claimed_at=actual_now WHERE singleton AND claimed_nonce IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'SCHEDULE_TICKET_CAS_HELD'; END IF;
  RETURN jsonb_build_object('version','rr-schedule-ticket-claim-v1','ticketId',q.ticket_id,'nonce',p_nonce,'envelopeSha256',q.envelope_sha256,'claimedAt',actual_now,'consumed',true);
 END $consume$;

 REVOKE ALL ON FUNCTION rr_sandbox.backup_schedule_ticket_no_reset_v1() FROM PUBLIC,anon,authenticated,service_role;
 REVOKE ALL ON FUNCTION public.rr_test_backup_schedule_ticket_read_v1(uuid,text,bigint,bigint,text,text,text,text) FROM PUBLIC,anon,authenticated,service_role;
 REVOKE ALL ON FUNCTION public.rr_test_backup_schedule_ticket_consume_v1(uuid,text,bigint,bigint,text,text,text,text,text,text) FROM PUBLIC,anon,authenticated,service_role;
 -- Default ACLs may grant unrelated custom roles even when the three runtime
 -- roles are closed. Reject every explicit/default grantee except each exact
 -- object owner; do not silently keep or broadly revoke another role's grants.
 IF EXISTS(
  SELECT 1 FROM pg_catalog.pg_class c,
   LATERAL pg_catalog.aclexplode(coalesce(c.relacl,pg_catalog.acldefault('r',c.relowner))) a
  WHERE c.oid='rr_sandbox.backup_schedule_ticket_v1'::regclass AND a.grantee<>c.relowner
 ) OR EXISTS(
  SELECT 1 FROM pg_catalog.pg_proc p,
   LATERAL pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
  WHERE p.oid=ANY(ARRAY[
   'rr_sandbox.backup_schedule_ticket_no_reset_v1()'::regprocedure::oid,
   'public.rr_test_backup_schedule_ticket_read_v1(uuid,text,bigint,bigint,text,text,text,text)'::regprocedure::oid,
   'public.rr_test_backup_schedule_ticket_consume_v1(uuid,text,bigint,bigint,text,text,text,text,text,text)'::regprocedure::oid])
   AND a.grantee<>p.proowner
 ) THEN RAISE EXCEPTION 'SCHEDULE_TICKET_OWNER_ONLY_ACL_HELD'; END IF;
 FOR role_name IN SELECT unnest(ARRAY['anon','authenticated','service_role']) LOOP
  IF has_table_privilege(role_name,'rr_sandbox.backup_schedule_ticket_v1','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') THEN RAISE EXCEPTION 'SCHEDULE_TICKET_EFFECTIVE_PRIVILEGE_HELD'; END IF;
  FOREACH fn IN ARRAY ARRAY[
   'rr_sandbox.backup_schedule_ticket_no_reset_v1()'::regprocedure,
   'public.rr_test_backup_schedule_ticket_read_v1(uuid,text,bigint,bigint,text,text,text,text)'::regprocedure,
   'public.rr_test_backup_schedule_ticket_consume_v1(uuid,text,bigint,bigint,text,text,text,text,text,text)'::regprocedure] LOOP
   IF has_function_privilege(role_name,fn,'EXECUTE') THEN RAISE EXCEPTION 'SCHEDULE_TICKET_EFFECTIVE_PRIVILEGE_HELD'; END IF;
  END LOOP;
 END LOOP;
 IF EXISTS(SELECT 1 FROM rr_sandbox.backup_schedule_ticket_v1) THEN RAISE EXCEPTION 'SCHEDULE_TICKET_INSTALL_EMPTY_HELD'; END IF;
 -- Preserve the enclosing migration/history transaction's original setting.
 PERFORM pg_catalog.set_config('search_path',prior_search_path,true);
END $install$;
