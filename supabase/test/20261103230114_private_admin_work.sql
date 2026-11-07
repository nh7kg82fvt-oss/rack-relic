-- PRIVATE ACCEPTANCE TEST DATABASE ONLY. CLI-generated migration filename.
-- Apply only after reviewed admin_overview dependencies in the isolated
-- acceptance database. Never apply to production or the preserved legacy flow.
-- Internal service follow-ups only. Completing one never changes a provider,
-- order, payment, financial hold, refund, shipment or seller payout.
BEGIN;
CREATE TABLE rr_sandbox.admin_work_items (
 id uuid PRIMARY KEY,
 owner_id uuid NOT NULL,
 service text NOT NULL CHECK(service IN ('stripe','shippo','supabase','vercel','backups','website')),
 title text NOT NULL CHECK(char_length(title) BETWEEN 1 AND 120 AND octet_length(title)<=480 AND btrim(title)=title AND title !~ '[[:cntrl:]]'),
 note text NOT NULL CHECK(char_length(note)<=2000 AND octet_length(note)<=8000 AND replace(replace(replace(note,chr(9),''),chr(10),''),chr(13),'') !~ '[[:cntrl:]]'),
 status text NOT NULL CHECK(status IN ('open','in_review','waiting','complete')),
 version bigint NOT NULL DEFAULT 1 CHECK(version BETWEEN 1 AND 1000000000),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 test boolean NOT NULL DEFAULT true CHECK(test),
 CHECK(updated_at>=created_at)
);
CREATE INDEX admin_work_owner_updated ON rr_sandbox.admin_work_items(owner_id,updated_at DESC,id);
CREATE TABLE rr_sandbox.admin_work_audit (
 request_id uuid PRIMARY KEY,
 owner_id uuid NOT NULL,
 actor_id uuid NOT NULL CHECK(actor_id=owner_id),
 item_id uuid NOT NULL REFERENCES rr_sandbox.admin_work_items(id),
 operation text NOT NULL CHECK(operation IN ('create','update')),
 command jsonb NOT NULL CHECK(octet_length(command::text)<=16384),
 result jsonb NOT NULL CHECK(octet_length(result::text)<=20000),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 test boolean NOT NULL DEFAULT true CHECK(test)
);
ALTER TABLE rr_sandbox.admin_work_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE rr_sandbox.admin_work_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON rr_sandbox.admin_work_items,rr_sandbox.admin_work_audit FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION rr_sandbox.admin_work_immutable_audit() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN RAISE EXCEPTION 'Private work audit is append only'; END $$;
CREATE TRIGGER admin_work_audit_no_change BEFORE UPDATE OR DELETE ON rr_sandbox.admin_work_audit FOR EACH ROW EXECUTE FUNCTION rr_sandbox.admin_work_immutable_audit();
CREATE TRIGGER admin_work_audit_no_truncate BEFORE TRUNCATE ON rr_sandbox.admin_work_audit FOR EACH STATEMENT EXECUTE FUNCTION rr_sandbox.admin_work_immutable_audit();
CREATE FUNCTION rr_sandbox.admin_work_owner(p_owner uuid,p_actor uuid) RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF p_owner IS NULL OR p_actor IS DISTINCT FROM p_owner OR NOT(
 EXISTS(SELECT 1 FROM rr_sandbox.catalog WHERE seller_id=p_actor)
 OR EXISTS(SELECT 1 FROM rr_sandbox.orders WHERE buyer_id=p_actor OR seller_id=p_actor)
 ) THEN RAISE EXCEPTION 'Configured participating test owner required'; END IF;
END $$;
CREATE FUNCTION rr_sandbox.admin_work_projection(w rr_sandbox.admin_work_items) RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('id',w.id,'service',w.service,'title',w.title,'note',w.note,'status',w.status,'version',w.version,'createdAt',w.created_at,'updatedAt',w.updated_at)
$$;
CREATE FUNCTION public.rr_test_admin_work_list(p_owner uuid,p_actor uuid,p_before timestamptz DEFAULT NULL,p_after uuid DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE result jsonb;
BEGIN
 PERFORM rr_sandbox.admin_work_owner(p_owner,p_actor);
 IF (p_before IS NULL) IS DISTINCT FROM (p_after IS NULL) OR p_before IS NOT NULL AND (p_before<'2001-09-09T01:46:40Z'::timestamptz OR p_before>clock_timestamp()+interval '30 seconds') THEN RAISE EXCEPTION 'Bounded private work page required'; END IF;
 WITH page AS (SELECT * FROM rr_sandbox.admin_work_items WHERE owner_id=p_owner AND (p_before IS NULL OR updated_at<p_before OR updated_at=p_before AND id>p_after) ORDER BY updated_at DESC,id LIMIT 26),
 visible AS (SELECT * FROM page ORDER BY updated_at DESC,id LIMIT 25)
 SELECT jsonb_build_object('test',true,'live',false,'releaseEnabled',false,'observedAt',clock_timestamp(),
 'items',coalesce((SELECT jsonb_agg(rr_sandbox.admin_work_projection(w) ORDER BY w.updated_at DESC,w.id) FROM visible w),'[]'::jsonb),
 'hasMore',(SELECT count(*)>25 FROM page),
 'nextAfter',CASE WHEN (SELECT count(*)>25 FROM page) THEN (SELECT jsonb_build_object('updatedAt',w.updated_at,'id',w.id) FROM visible w ORDER BY w.updated_at ASC,w.id DESC LIMIT 1) ELSE NULL END) INTO result;
 RETURN result;
END $$;
CREATE FUNCTION public.rr_test_admin_work_receipt(p_owner uuid,p_actor uuid,p_request uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE result jsonb;
BEGIN
 PERFORM rr_sandbox.admin_work_owner(p_owner,p_actor);
 IF p_request IS NULL THEN RAISE EXCEPTION 'Private work request required'; END IF;
 SELECT a.result||jsonb_build_object('replayed',true) INTO result FROM rr_sandbox.admin_work_audit a WHERE a.request_id=p_request AND a.owner_id=p_owner;
 RETURN coalesce(result,jsonb_build_object('test',true,'live',false,'releaseEnabled',false,'requestId',p_request,'state','unconfirmed'));
END $$;
CREATE FUNCTION public.rr_test_write_admin_work(p_owner uuid,p_actor uuid,p_command jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
<<work_command>>
DECLARE request_id uuid; item_id uuid; expected_version bigint; operation text; w rr_sandbox.admin_work_items; prior rr_sandbox.admin_work_audit; result jsonb; created timestamptz;
BEGIN
 PERFORM rr_sandbox.admin_work_owner(p_owner,p_actor);
 IF p_command IS NULL OR jsonb_typeof(p_command)<>'object' OR octet_length(p_command::text)>16384
  OR (SELECT count(*) FROM jsonb_object_keys(p_command))<>8
  OR NOT p_command ?& ARRAY['operation','requestId','itemId','version','service','title','note','status']
  OR jsonb_typeof(p_command->'version')<>'number' OR (p_command->>'version') !~ '^[0-9]+$'
  OR (SELECT bool_or(jsonb_typeof(p_command->k)<>'string') FROM unnest(ARRAY['operation','requestId','itemId','service','title','note','status']) k)
  OR p_command->>'operation' NOT IN ('create','update')
  OR p_command->>'requestId' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  OR p_command->>'itemId' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  OR p_command->>'service' NOT IN ('stripe','shippo','supabase','vercel','backups','website')
  OR p_command->>'status' NOT IN ('open','in_review','waiting','complete')
  OR char_length(p_command->>'title') NOT BETWEEN 1 AND 120 OR octet_length(p_command->>'title')>480
  OR btrim(p_command->>'title')<>p_command->>'title' OR p_command->>'title' ~ '[[:cntrl:]]'
  OR char_length(p_command->>'note')>2000 OR octet_length(p_command->>'note')>8000
  OR replace(replace(replace(p_command->>'note',chr(9),''),chr(10),''),chr(13),'') ~ '[[:cntrl:]]'
 THEN RAISE EXCEPTION 'Invalid private work request'; END IF;
 request_id:=(p_command->>'requestId')::uuid; item_id:=(p_command->>'itemId')::uuid; expected_version:=(p_command->>'version')::bigint; operation:=p_command->>'operation';
 IF expected_version<0 OR expected_version>=1000000000 OR operation='create' AND expected_version<>0 OR operation='update' AND expected_version<1 THEN RAISE EXCEPTION 'Invalid private work version'; END IF;
 PERFORM pg_advisory_xact_lock(hashtext('rr-admin-work-request'),hashtext(request_id::text));
 SELECT * INTO prior FROM rr_sandbox.admin_work_audit a WHERE a.request_id=work_command.request_id;
 IF FOUND THEN
  IF prior.owner_id IS DISTINCT FROM p_owner OR prior.command IS DISTINCT FROM p_command THEN RAISE EXCEPTION 'Work request conflict'; END IF;
  RETURN prior.result||jsonb_build_object('replayed',true);
 END IF;
 PERFORM pg_advisory_xact_lock(hashtext('rr-admin-work-owner'),hashtext(p_owner::text));
 PERFORM pg_advisory_xact_lock(hashtext('rr-admin-work-item'),hashtext(item_id::text));
 SELECT * INTO w FROM rr_sandbox.admin_work_items a WHERE a.id=item_id FOR UPDATE;
 IF operation='create' THEN
  IF FOUND THEN RAISE EXCEPTION 'Work item conflict'; END IF;
  IF (SELECT count(*) FROM rr_sandbox.admin_work_items WHERE owner_id=p_owner)>=1000 THEN RAISE EXCEPTION 'Private work capacity reached'; END IF;
  created:=clock_timestamp();
  INSERT INTO rr_sandbox.admin_work_items(id,owner_id,service,title,note,status,created_at,updated_at) VALUES(item_id,p_owner,p_command->>'service',p_command->>'title',p_command->>'note',p_command->>'status',created,created) RETURNING * INTO w;
 ELSE
  IF NOT FOUND OR w.owner_id IS DISTINCT FROM p_owner THEN RAISE EXCEPTION 'Work item conflict'; END IF;
  IF w.version<>expected_version THEN RAISE EXCEPTION 'Work version conflict'; END IF;
  UPDATE rr_sandbox.admin_work_items SET service=p_command->>'service',title=p_command->>'title',note=p_command->>'note',status=p_command->>'status',version=version+1,updated_at=greatest(clock_timestamp(),updated_at) WHERE id=item_id RETURNING * INTO w;
 END IF;
 result:=jsonb_build_object('test',true,'live',false,'releaseEnabled',false,'requestId',request_id,'replayed',false,'item',rr_sandbox.admin_work_projection(w));
 INSERT INTO rr_sandbox.admin_work_audit(request_id,owner_id,actor_id,item_id,operation,command,result) VALUES(request_id,p_owner,p_actor,item_id,operation,p_command,result);
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION rr_sandbox.admin_work_immutable_audit(),rr_sandbox.admin_work_owner(uuid,uuid),rr_sandbox.admin_work_projection(rr_sandbox.admin_work_items) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.rr_test_admin_work_list(uuid,uuid,timestamptz,uuid),public.rr_test_admin_work_receipt(uuid,uuid,uuid),public.rr_test_write_admin_work(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.rr_test_admin_work_list(uuid,uuid,timestamptz,uuid),public.rr_test_admin_work_receipt(uuid,uuid,uuid),public.rr_test_write_admin_work(uuid,uuid,jsonb) TO service_role;
COMMIT;
