-- SOURCE PROPOSAL ONLY. No Auth row, Auth privilege, role, setting or
-- application/payment/activation guard changes. Installation needs review.
BEGIN;
DO $command_session_prerequisite$
DECLARE field record;
BEGIN
 IF NOT has_schema_privilege('service_role','rr_sandbox','USAGE') THEN
  RAISE EXCEPTION 'Existing private schema service usage required';
 END IF;
 FOR field IN SELECT * FROM (VALUES
  ('auth.users','id','uuid'),('auth.users','deleted_at','timestamp with time zone'),
  ('auth.users','banned_until','timestamp with time zone'),
  ('auth.sessions','id','uuid'),('auth.sessions','user_id','uuid'),
  ('auth.sessions','not_after','timestamp with time zone')
 ) AS required(relation_name,column_name,type_name) LOOP
  IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_attribute a
   WHERE a.attrelid=pg_catalog.to_regclass(field.relation_name)
    AND a.attname=field.column_name AND NOT a.attisdropped
    AND pg_catalog.format_type(a.atttypid,a.atttypmod)=field.type_name) THEN
   RAISE EXCEPTION 'Reviewed current Auth structure required';
  END IF;
 END LOOP;
END $command_session_prerequisite$;
CREATE FUNCTION rr_sandbox.command_owner_session(
 p_owner uuid,p_actor uuid,p_session uuid,p_token_exp bigint,p_nonce uuid
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE observed timestamptz:=clock_timestamp();accepted boolean:=false;
BEGIN
 IF p_owner IS NULL OR p_owner='00000000-0000-0000-0000-000000000000'::uuid
  OR p_actor IS DISTINCT FROM p_owner OR p_session IS NULL
  OR p_session='00000000-0000-0000-0000-000000000000'::uuid
  OR p_nonce IS NULL OR p_nonce='00000000-0000-0000-0000-000000000000'::uuid
  OR p_token_exp IS NULL OR p_token_exp<=floor(extract(epoch FROM observed))
  OR p_token_exp>9007199254740
 THEN RAISE EXCEPTION 'Fresh exact Command owner session required';END IF;
 -- The fixed server owner and actor come only after provider JWT validation.
 -- No participating seller/buyer predicate or financial guard grants access.
 SELECT EXISTS(SELECT 1 FROM auth.users u JOIN auth.sessions s ON s.user_id=u.id
  WHERE u.id=p_owner AND u.deleted_at IS NULL
   AND (u.banned_until IS NULL OR u.banned_until<=observed)
   AND s.id=p_session AND (s.not_after IS NULL OR s.not_after>observed)) INTO accepted;
 RETURN jsonb_build_object('version','rr-command-owner-session-v1',
  'ownerId',p_owner,'sessionId',p_session,'tokenExp',p_token_exp,
  'accepted',accepted,'nonce',p_nonce,
  'observedAt',floor(extract(epoch FROM observed)*1000)::bigint);
END $$;
CREATE FUNCTION public.rr_test_command_owner_session(
 p_owner uuid,p_actor uuid,p_session uuid,p_token_exp bigint,p_nonce uuid
) RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog AS $$
 SELECT rr_sandbox.command_owner_session(p_owner,p_actor,p_session,p_token_exp,p_nonce)
$$;
REVOKE ALL ON FUNCTION rr_sandbox.command_owner_session(uuid,uuid,uuid,bigint,uuid),
 public.rr_test_command_owner_session(uuid,uuid,uuid,bigint,uuid)
 FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION rr_sandbox.command_owner_session(uuid,uuid,uuid,bigint,uuid),
 public.rr_test_command_owner_session(uuid,uuid,uuid,bigint,uuid) TO service_role;
COMMIT;
