-- Paired rollback of the private test-project proposal. Apply separately only after exact owner approval.
-- One existing service-only wrapper; no financial guard, grant, table or row changes.
BEGIN;
SET LOCAL search_path=pg_catalog,public;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='10s';
DO $rr_cache_patch$
DECLARE v_oid oid; v_before jsonb; v_after jsonb;
BEGIN
 IF current_user<>'postgres' OR session_user<>'postgres' OR current_database()<>'postgres'
 THEN RAISE EXCEPTION 'Reviewed installer context required'; END IF;
 v_oid:=to_regprocedure('public.rr_test_command_queue(uuid,uuid,bigint,uuid,text,jsonb)')::oid;
 IF v_oid IS NULL OR NOT EXISTS(
 SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid=p.prolang
 WHERE p.oid=v_oid AND pg_get_userbyid(p.proowner)='postgres' AND l.lanname='sql'
 AND p.provolatile='v' AND NOT p.prosecdef AND NOT p.proretset AND p.prorettype='jsonb'::regtype
 AND p.proconfig=ARRAY['search_path=pg_catalog']::text[]
 AND md5(p.prosrc)='d8a9cc0d687f0f4bf4dd346b65e7706e'
 AND NOT has_function_privilege('anon',p.oid,'EXECUTE')
 AND NOT has_function_privilege('authenticated',p.oid,'EXECUTE')
 AND has_function_privilege('service_role',p.oid,'EXECUTE')
 AND NOT EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
 WHERE a.grantee NOT IN(p.proowner,'service_role'::regrole::oid) OR a.privilege_type<>'EXECUTE'
 OR (a.grantee='service_role'::regrole::oid AND a.is_grantable)))
 THEN RAISE EXCEPTION 'Exact reviewed header wrapper required'; END IF;
 SELECT to_jsonb(p)-'prosrc' INTO v_before FROM pg_proc p WHERE p.oid=v_oid;
 EXECUTE $rr_cache_ddl$
 CREATE OR REPLACE FUNCTION public.rr_test_command_queue(p_owner uuid,p_session uuid,p_token_exp bigint,p_nonce uuid,p_operation text,p_args jsonb)
 RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path=pg_catalog AS $rr_cache_body$
 SELECT rr_sandbox.command_queue_action(p_owner,p_session,p_token_exp,p_nonce,p_operation,p_args)
$rr_cache_body$;
 $rr_cache_ddl$;
 SELECT to_jsonb(p)-'prosrc' INTO v_after FROM pg_proc p WHERE p.oid=v_oid;
 IF v_after IS DISTINCT FROM v_before OR NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=v_oid AND p.prosrc=$rr_expected$
 SELECT rr_sandbox.command_queue_action(p_owner,p_session,p_token_exp,p_nonce,p_operation,p_args)
$rr_expected$)
 THEN RAISE EXCEPTION 'Wrapper-only replacement must preserve identity and every attribute'; END IF;
END $rr_cache_patch$;
COMMIT;


