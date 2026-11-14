-- SOURCE PROPOSAL ONLY: NULL owner/window constants keep every action OFF.
-- No existing function, table, Auth row/grant, fixture or provider is changed.
-- A future exact installation/activation requires a separate owner decision.
-- Official function-security guidance reviewed: https://supabase.com/docs/guides/database/functions
BEGIN;
DO $owner_fixture_dependencies$
BEGIN
 IF NOT has_schema_privilege('service_role','rr_sandbox','USAGE')
  OR to_regprocedure('public.rr_test_command_owner_session(uuid,uuid,uuid,bigint,uuid)') IS NULL
  OR to_regprocedure('public.rr_test_seller_context(uuid)') IS NULL
  OR to_regprocedure('public.rr_test_claim_seller(uuid)') IS NULL
  OR to_regprocedure('public.rr_test_save_seller(uuid,text)') IS NULL
  OR to_regprocedure('public.rr_test_record_seller_protection(uuid,text,boolean,bigint)') IS NULL
 THEN RAISE EXCEPTION 'Reviewed owner and seller dependencies required'; END IF;
END $owner_fixture_dependencies$;

CREATE FUNCTION rr_sandbox.owner_fixture_seller_action(
 p_owner uuid,p_session uuid,p_token_exp bigint,p_request uuid,p_operation text,p_args jsonb
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE
 -- Activation is deliberately a separately reviewed exact function body.
 authorized_owner CONSTANT uuid := NULL;
 enabled_from CONSTANT timestamptz := NULL;
 enabled_until CONSTANT timestamptz := NULL;
 fixture CONSTANT uuid := NULL;
 started timestamptz := clock_timestamp();
 finished timestamptz;
 observation jsonb;
 result jsonb;
 account_id text;
 ready_value boolean;
 checked_value bigint;
BEGIN
 -- Test every NULL explicitly: SQL UNKNOWN must never fall through a guard.
 IF authorized_owner IS NULL OR fixture IS NULL OR enabled_from IS NULL OR enabled_until IS NULL
  OR authorized_owner='00000000-0000-0000-0000-000000000000'::uuid
  OR fixture='00000000-0000-0000-0000-000000000000'::uuid
  OR NOT isfinite(enabled_from) OR NOT isfinite(enabled_until)
  OR enabled_until<=enabled_from OR enabled_until-enabled_from>interval '1 hour'
  OR started<enabled_from OR started>=enabled_until
  OR p_owner IS DISTINCT FROM authorized_owner
 THEN RAISE EXCEPTION 'Owner fixture rehearsal held'; END IF;
 IF p_session IS NULL OR p_session='00000000-0000-0000-0000-000000000000'::uuid
  OR p_request IS NULL OR p_request='00000000-0000-0000-0000-000000000000'::uuid
  OR p_token_exp IS NULL OR p_token_exp<=floor(extract(epoch FROM started))
  OR p_token_exp>9007199254740
  OR p_operation IS NULL OR p_operation NOT IN ('context','claim','save','protection')
  OR p_args IS NULL OR jsonb_typeof(p_args) IS DISTINCT FROM 'object'
 THEN RAISE EXCEPTION 'Exact owner fixture request required'; END IF;

 IF p_operation IN ('context','claim') THEN
  IF p_args<>'{}'::jsonb THEN RAISE EXCEPTION 'Empty fixture arguments required'; END IF;
 ELSE
  IF (p_operation='save' AND ((SELECT count(*) FROM jsonb_object_keys(p_args))<>1 OR NOT (p_args ? 'accountId')))
   OR (p_operation='protection' AND ((SELECT count(*) FROM jsonb_object_keys(p_args))<>3
    OR NOT (p_args ?& ARRAY['accountId','ready','checkedAt'])))
   OR jsonb_typeof(p_args->'accountId') IS DISTINCT FROM 'string'
  THEN RAISE EXCEPTION 'Exact fixture arguments required'; END IF;
  account_id:=p_args->>'accountId';
  IF account_id !~ '^acct_[A-Za-z0-9]+$'
   OR account_id IN ('acct_1UXdWBGppSOhWnq8','acct_1UWJZuGVbz9Pnhxd')
  THEN RAISE EXCEPTION 'Original fictional account required'; END IF;
  IF p_operation='protection' THEN
   IF jsonb_typeof(p_args->'ready') IS DISTINCT FROM 'boolean'
    OR jsonb_typeof(p_args->'checkedAt') IS DISTINCT FROM 'number'
    OR (p_args->>'checkedAt') !~ '^[1-9][0-9]{0,15}$'
    OR (p_args->>'checkedAt')::numeric>9007199254740991
   THEN RAISE EXCEPTION 'Fresh fictional observation required'; END IF;
   checked_value:=(p_args->>'checkedAt')::bigint;
   ready_value:=(p_args->>'ready')::boolean;
   IF checked_value<floor(extract(epoch FROM started)*1000)-5000
    OR checked_value>floor(extract(epoch FROM started)*1000)+1000
    OR checked_value<floor(extract(epoch FROM enabled_from)*1000)
   THEN RAISE EXCEPTION 'Fresh fictional observation required'; END IF;
  END IF;
 END IF;

 -- The actual authenticated actor stays the owner. The fixture is not a
 -- second Auth user/session. JWT verification is also required in the server.
 observation:=public.rr_test_command_owner_session(p_owner,p_owner,p_session,p_token_exp,p_request);
 IF jsonb_typeof(observation) IS DISTINCT FROM 'object'
  OR observation->>'version' IS DISTINCT FROM 'rr-command-owner-session-v1'
  OR observation->>'ownerId' IS DISTINCT FROM p_owner::text
  OR observation->>'sessionId' IS DISTINCT FROM p_session::text
  OR observation->'tokenExp' IS DISTINCT FROM to_jsonb(p_token_exp)
  OR observation->'accepted' IS DISTINCT FROM 'true'::jsonb
  OR observation->>'nonce' IS DISTINCT FROM p_request::text
 THEN RAISE EXCEPTION 'Current configured owner required'; END IF;

 -- Only these literal calls receive the fixed fictional fixture. No caller
 -- actor, function name, URL, query or dynamic SQL reaches this dispatcher.
 CASE p_operation
  WHEN 'context' THEN result:=public.rr_test_seller_context(fixture);
  WHEN 'claim' THEN result:=public.rr_test_claim_seller(fixture);
  WHEN 'save' THEN result:=public.rr_test_save_seller(fixture,account_id);
  WHEN 'protection' THEN result:=public.rr_test_record_seller_protection(fixture,account_id,ready_value,checked_value);
 END CASE;

 -- A visible denied post-observation rolls back this SQL action. These STABLE
 -- observations do not prove concurrent revocation linearization, and no SQL
 -- response proves a later remote provider commit occurred before a deadline.
 observation:=public.rr_test_command_owner_session(p_owner,p_owner,p_session,p_token_exp,p_request);
 finished:=clock_timestamp();
 IF jsonb_typeof(observation) IS DISTINCT FROM 'object'
  OR observation->>'version' IS DISTINCT FROM 'rr-command-owner-session-v1'
  OR observation->'accepted' IS DISTINCT FROM 'true'::jsonb
  OR observation->>'ownerId' IS DISTINCT FROM p_owner::text
  OR observation->>'sessionId' IS DISTINCT FROM p_session::text
  OR observation->'tokenExp' IS DISTINCT FROM to_jsonb(p_token_exp)
  OR observation->>'nonce' IS DISTINCT FROM p_request::text
  OR finished<started OR finished-started>=interval '5 seconds'
  OR finished>=enabled_until OR p_token_exp<=floor(extract(epoch FROM finished))
 THEN RAISE EXCEPTION 'Owner fixture action held'; END IF;

 -- This nonce is response correlation, not a durable consumed-nonce journal.
 -- Account creation still relies on the existing prepared->dispatched claim.
 -- Lost/ambiguous claim ACK never authorizes provider POST or claim reset.
 RETURN jsonb_build_object('version','rr-owner-fixture-seller-action-v1',
  'mode','owner-operated-fictional-rehearsal','ownerId',authorized_owner,
  'sessionId',p_session,'tokenExp',p_token_exp,'fixtureId',fixture,
  'operation',p_operation,'requestId',p_request,
  'observedAt',floor(extract(epoch FROM finished)*1000)::bigint,'result',result);
END $$;

CREATE FUNCTION public.rr_test_owner_fixture_seller_action(
 p_owner uuid,p_session uuid,p_token_exp bigint,p_request uuid,p_operation text,p_args jsonb
) RETURNS jsonb LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path=pg_catalog AS $$
 SELECT rr_sandbox.owner_fixture_seller_action(p_owner,p_session,p_token_exp,p_request,p_operation,p_args)
$$;
REVOKE ALL ON FUNCTION rr_sandbox.owner_fixture_seller_action(uuid,uuid,bigint,uuid,text,jsonb),
 public.rr_test_owner_fixture_seller_action(uuid,uuid,bigint,uuid,text,jsonb)
 FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION rr_sandbox.owner_fixture_seller_action(uuid,uuid,bigint,uuid,text,jsonb),
 public.rr_test_owner_fixture_seller_action(uuid,uuid,bigint,uuid,text,jsonb) TO service_role;
COMMIT;
