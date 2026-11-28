'use strict';
// Exact Rack practice branch only. Empty owner-only installation, no authority.
const {readFrozen} = require('./frozen-inputs.cjs');
const { createHash } = require('node:crypto');
const DISPATCH = 'reviewed-inputs/archive_dispatch_once_v2.sql';
const TICKET = 'reviewed-inputs/schedule_ticket_v1.sql';
const SOURCE = 'tzymapahsfiyhgilsmxl';
const PRINCIPAL = '02b550b8-b65c-481c-a8eb-495ab79242a6';
const sha = x => createHash('sha256').update(x).digest('hex');
const literal = x => "'" + String(x).replaceAll("'", "''") + "'";
const NEW_FUNCTIONS = [
  'rr_sandbox.archive_dispatch_no_reset_v2',
  'rr_sandbox.archive_dispatch_context_v2',
  'rr_sandbox.archive_claim_for_dispatch_v2',
  'rr_sandbox.archive_dispatch_consume_v2',
  'public.rr_test_archive_claim_for_dispatch_v2',
  'public.rr_test_archive_dispatch_consume_v2',
  'rr_sandbox.backup_schedule_ticket_no_reset_v1',
  'public.rr_test_backup_schedule_ticket_read_v1',
  'public.rr_test_backup_schedule_ticket_consume_v1'
];
const CLAIM_ARGS = 'text,text,text,text,integer,text,text,text,uuid';
const CONSUME_ARGS = 'text,text,text,text,integer,uuid,text,text,text,uuid,uuid';
const TICKET_ARGS = 'uuid,text,bigint,bigint,text,text,text,text';
const NEW_SIGNATURES = NEW_FUNCTIONS.map((name, i) =>
  name + '(' + ['', 'text,text,text,text,text,uuid', CLAIM_ARGS, CONSUME_ARGS,
    CLAIM_ARGS, CONSUME_ARGS, '', TICKET_ARGS, TICKET_ARGS+',text,text'][i] + ')');
const LEGACY_NAMES = ['no_reset','validate','projection','claim','record','original']
  .map(name => 'archive_write_'+name);
function atomic(body) {
  // Pin data may contain a dollar-quote delimiter even inside a SQL literal.
  let tag = '$rr_closed_0$';
  for (let i=1;body.includes(tag);i++) tag = '$rr_closed_'+i+'$';
  return 'DO '+tag+body+tag+';\n';
}
const NEW_TABLES = ['rr_sandbox.archive_dispatch_once_v2', 'rr_sandbox.backup_schedule_ticket_v1'];
const eventsSQL = `SELECT coalesce(jsonb_agg(jsonb_build_object('name',e.evtname,'event',e.evtevent,'enabled',e.evtenabled,'tags',e.evttags,'function',n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')','function_md5',md5(pg_get_functiondef(e.evtfoid))) ORDER BY e.evtname),'[]'::jsonb) FROM pg_catalog.pg_event_trigger e JOIN pg_catalog.pg_proc p ON p.oid=e.evtfoid JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace`;
const functionsSQL = `SELECT coalesce(jsonb_agg(jsonb_build_object('oid',p.oid,'owner',p.proowner,'acl',p.proacl::text,'body',md5(pg_get_functiondef(p.oid))) ORDER BY p.oid),'[]'::jsonb) FROM pg_catalog.pg_proc p WHERE p.oid=ANY(old_functions)`;
const tablesSQL = `SELECT coalesce(jsonb_agg(jsonb_build_object('oid',c.oid,'owner',c.relowner,'acl',c.relacl::text,'rls',c.relrowsecurity,'forced',c.relforcerowsecurity) ORDER BY c.oid),'[]'::jsonb) FROM pg_catalog.pg_class c WHERE c.oid=ANY(old_tables)`;
const policiesSQL = `SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.oid),'[]'::jsonb) FROM pg_catalog.pg_policy p WHERE p.polrelid=ANY(old_tables)`;
const triggersSQL = `SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.oid),'[]'::jsonb) FROM pg_catalog.pg_trigger t WHERE t.tgrelid=ANY(old_tables)
 AND NOT (t.tgisinternal AND t.tgconstraint IN (
  SELECT c.oid FROM pg_catalog.pg_constraint c
  WHERE c.contype='f' AND c.conrelid=to_regclass('rr_sandbox.archive_dispatch_once_v2')
    AND c.confrelid=to_regclass('rr_sandbox.archive_write_entries')
    AND c.conname='archive_dispatch_once_v2_object_key_fkey'
 ))`;
const defaultsSQL = `SELECT coalesce(jsonb_agg(to_jsonb(d) ORDER BY d.oid),'[]'::jsonb) FROM pg_catalog.pg_default_acl d`;
function build(pin) {
  if (pin?.sourceProject !== SOURCE || pin.install_actor !== 'postgres' || pin.private_schema_owner !== 'postgres' ||
      !/^1[78]\d{4}$/.test(pin.server_version_num) || !Array.isArray(pin.event_triggers) ||
      pin.dedicated_machine?.id !== PRINCIPAL || pin.dedicated_machine.confirmed !== true || pin.dedicated_machine.active !== true ||
      pin.source_bucket?.id !== 'listing-photos' || pin.source_bucket.public !== false ||
      pin.old_archive_entries?.total !== 0 || pin.old_archive_entries.unknown !== 0 || pin.old_archive_entries.verified !== 0 ||
      !Array.isArray(pin.catalogue?.routines)) throw Error('CLOSED_ADMISSION_PIN_HELD');
  let dispatch = readFrozen(DISPATCH), ticket = readFrozen(TICKET);
  if (sha(dispatch) !== 'd3a58a032f41c67117f31cdabadfb5ccf8704535a87f5f72363b45d54bf7c3e2' ||
      sha(ticket) !== '097aea882ec2c2a7f8109aba4c6d4b46105635cda44d88f4ddc7b357155021b5') throw Error('REVIEWED_SQL_BYTES_CHANGED');
  // Preserve reviewed routine bodies. This closed stage removes only the four
  // proposed service-role grants and its standalone transaction delimiters.
  dispatch = dispatch.replace(/^BEGIN;\s*$/m, '').replace(/^COMMIT;\s*$/m, '');
  const grant = /GRANT EXECUTE ON FUNCTION[\s\S]+?TO service_role;\s*$/;
  if (!grant.test(dispatch)) throw Error('DISPATCH_GRANT_SHAPE_HELD');
  dispatch = dispatch.replace(grant, '');
  const fnNames = 'ARRAY[' + NEW_FUNCTIONS.map(literal).join(',') + ']';
  const tableNames = 'ARRAY[' + NEW_TABLES.map(literal).join(',') + ']';
  const legacyPins = pin.catalogue.routines.filter(x => x.schema === 'rr_sandbox' && x.name.startsWith('archive_write_'));
  if (legacyPins.length !== LEGACY_NAMES.length || LEGACY_NAMES.some(name =>
      legacyPins.filter(x => x.name === name && /^[a-f0-9]{32}$/.test(x.body_md5)).length !== 1)) throw Error('LEGACY_JOURNAL_PIN_HELD');
  const legacyChecks = legacyPins.map(x => `IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='rr_sandbox' AND p.proname=${literal(x.name)} AND md5(pg_get_functiondef(p.oid))=${literal(x.body_md5)}) THEN RAISE EXCEPTION 'LEGACY_JOURNAL_CHANGED'; END IF;`).join('\n');
  const expectedEvents = literal(JSON.stringify(pin.event_triggers));
  return `-- Rack practice project ${SOURCE}. One atomic, closed, EMPTY installation.\n` +
atomic(`
DECLARE
 prior_path text:=pg_catalog.current_setting('search_path');
 old_functions oid[]; old_tables oid[];
 before_functions jsonb; before_tables jsonb; before_policies jsonb; before_triggers jsonb; before_defaults jsonb;
 before_guard jsonb; before_entries jsonb; observed jsonb;
 actor text; fn regprocedure; target regclass;
 new_function_names text[]:=${fnNames}; new_table_names text[]:=${tableNames};
BEGIN
 PERFORM pg_catalog.set_config('search_path','pg_catalog',true);
 IF current_user<>'postgres' OR current_setting('server_version_num')<>${literal(pin.server_version_num)}
  OR (SELECT pg_get_userbyid(nspowner) FROM pg_namespace WHERE nspname='rr_sandbox') IS DISTINCT FROM 'postgres'
  OR NOT EXISTS(SELECT 1 FROM auth.users WHERE id='${PRINCIPAL}' AND email='rack-photo-backup-20261127@example.invalid' AND email_confirmed_at IS NOT NULL AND NOT is_anonymous AND (banned_until IS NULL OR banned_until<now()))
  OR NOT EXISTS(SELECT 1 FROM storage.buckets WHERE id='listing-photos' AND NOT public AND file_size_limit=2097152 AND allowed_mime_types=ARRAY['image/png']::text[])
  OR NOT EXISTS(SELECT 1 FROM pg_db_role_setting s JOIN pg_roles r ON r.oid=s.setrole WHERE r.rolname='authenticator' AND 'pgrst.db_pre_request=public.rr_backup_source_data_api_boundary'=ANY(s.setconfig))
 THEN RAISE EXCEPTION 'CLOSED_ADMISSION_EXACT_TARGET_HELD'; END IF;
 SELECT (${eventsSQL}) INTO observed;
 IF observed IS DISTINCT FROM ${expectedEvents}::jsonb THEN RAISE EXCEPTION 'EVENT_INVENTORY_CHANGED'; END IF;
 IF EXISTS(SELECT 1 FROM unnest(new_table_names) t WHERE to_regclass(t) IS NOT NULL)
  OR EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname||'.'||p.proname=ANY(new_function_names))
 THEN RAISE EXCEPTION 'CLOSED_ADMISSION_ALREADY_PRESENT'; END IF;
 ${legacyChecks}
 IF EXISTS(SELECT 1 FROM rr_sandbox.archive_write_entries) OR
  (SELECT coalesce(jsonb_agg(to_jsonb(g) ORDER BY singleton),'[]'::jsonb) FROM rr_sandbox.archive_write_guard g) IS DISTINCT FROM '[{"revision":0,"singleton":true,"archive_identity":null}]'::jsonb
 THEN RAISE EXCEPTION 'LEGACY_ARCHIVE_STATE_CHANGED'; END IF;
 SELECT array_agg(p.oid) INTO old_functions FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE p.prokind='f' AND n.nspname IN('public','rr_sandbox');
 SELECT array_agg(c.oid) INTO old_tables FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind='r' AND n.nspname IN('public','rr_sandbox');
 SELECT (${functionsSQL}) INTO before_functions;
 SELECT (${tablesSQL}) INTO before_tables;
 SELECT (${policiesSQL}) INTO before_policies;
 SELECT (${triggersSQL}) INTO before_triggers;
 SELECT (${defaultsSQL}) INTO before_defaults;
 SELECT coalesce(jsonb_agg(to_jsonb(g) ORDER BY singleton),'[]'::jsonb) INTO before_guard FROM rr_sandbox.archive_write_guard g;
 SELECT coalesce(jsonb_agg(to_jsonb(e) ORDER BY object_key),'[]'::jsonb) INTO before_entries FROM rr_sandbox.archive_write_entries e;

 EXECUTE $dispatch_payload$${dispatch}$dispatch_payload$;
 EXECUTE $ticket_payload$${ticket}$ticket_payload$;

 IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname||'.'||p.proname=ANY(new_function_names))<>9
  OR EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace, LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE n.nspname||'.'||p.proname=ANY(new_function_names) AND a.grantee<>p.proowner)
  OR EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace, LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a WHERE n.nspname||'.'||c.relname=ANY(new_table_names) AND (a.grantee<>c.relowner OR NOT c.relrowsecurity))
 THEN RAISE EXCEPTION 'CLOSED_ADMISSION_OWNER_ONLY_HELD'; END IF;
 FOR actor IN SELECT unnest(ARRAY['anon','authenticated','service_role']) LOOP
  FOR fn IN SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname||'.'||p.proname=ANY(new_function_names) LOOP
   IF has_function_privilege(actor,fn,'EXECUTE') THEN RAISE EXCEPTION 'CLOSED_ADMISSION_EFFECTIVE_ACL_HELD'; END IF;
  END LOOP;
  FOREACH target IN ARRAY ARRAY['rr_sandbox.archive_dispatch_once_v2'::regclass,'rr_sandbox.backup_schedule_ticket_v1'::regclass] LOOP
   IF has_table_privilege(actor,target,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN') THEN RAISE EXCEPTION 'CLOSED_ADMISSION_EFFECTIVE_ACL_HELD'; END IF;
  END LOOP;
 END LOOP;
 IF EXISTS(SELECT 1 FROM rr_sandbox.archive_dispatch_once_v2) OR EXISTS(SELECT 1 FROM rr_sandbox.backup_schedule_ticket_v1) THEN RAISE EXCEPTION 'CLOSED_ADMISSION_NOT_EMPTY'; END IF;
 IF (${functionsSQL}) IS DISTINCT FROM before_functions OR (${tablesSQL}) IS DISTINCT FROM before_tables
  OR (${policiesSQL}) IS DISTINCT FROM before_policies OR (${triggersSQL}) IS DISTINCT FROM before_triggers
  OR (${defaultsSQL}) IS DISTINCT FROM before_defaults
  OR (SELECT coalesce(jsonb_agg(to_jsonb(g) ORDER BY singleton),'[]'::jsonb) FROM rr_sandbox.archive_write_guard g) IS DISTINCT FROM before_guard
  OR (SELECT coalesce(jsonb_agg(to_jsonb(e) ORDER BY object_key),'[]'::jsonb) FROM rr_sandbox.archive_write_entries e) IS DISTINCT FROM before_entries
  OR (${eventsSQL}) IS DISTINCT FROM ${expectedEvents}::jsonb
 THEN RAISE EXCEPTION 'EXISTING_OBJECT_OR_ARCHIVE_CHANGED'; END IF;
 PERFORM set_config('search_path',prior_path,true);
END
`);
}
function rollback(pin) {
 // Apply the same offline pin validation before constructing rollback SQL.
 build(pin);
 const names='ARRAY['+NEW_FUNCTIONS.map(literal).join(',')+']';
 const signatures='ARRAY['+NEW_SIGNATURES.map(literal).join(',')+']';
 return '-- Exact empty closed Rack practice additions only; no CASCADE.\n'+atomic(`
DECLARE
 prior_path text:=pg_catalog.current_setting('search_path');
 names text[]:=${names}; signatures text[]:=${signatures};
 fn regprocedure;
BEGIN
 PERFORM pg_catalog.set_config('search_path','pg_catalog',true);
 IF current_user<>'postgres' OR current_setting('server_version_num')<>${literal(pin.server_version_num)}
  OR (SELECT pg_get_userbyid(nspowner) FROM pg_namespace WHERE nspname='rr_sandbox') IS DISTINCT FROM 'postgres'
  OR NOT EXISTS(SELECT 1 FROM auth.users WHERE id='${PRINCIPAL}' AND email='rack-photo-backup-20261127@example.invalid')
  OR to_regclass('rr_sandbox.archive_dispatch_once_v2') IS NULL OR to_regclass('rr_sandbox.backup_schedule_ticket_v1') IS NULL
  OR (${eventsSQL}) IS DISTINCT FROM ${literal(JSON.stringify(pin.event_triggers))}::jsonb
 THEN RAISE EXCEPTION 'EMPTY_ADMISSION_ROLLBACK_TARGET_HELD'; END IF;
 -- Keep the emptiness proof valid until the drops finish.
 LOCK TABLE rr_sandbox.backup_schedule_ticket_v1,rr_sandbox.archive_dispatch_once_v2 IN ACCESS EXCLUSIVE MODE NOWAIT;
 IF EXISTS(SELECT 1 FROM rr_sandbox.archive_dispatch_once_v2) OR EXISTS(SELECT 1 FROM rr_sandbox.backup_schedule_ticket_v1)
  OR (SELECT count(*) FROM pg_class WHERE oid IN('rr_sandbox.archive_dispatch_once_v2'::regclass,'rr_sandbox.backup_schedule_ticket_v1'::regclass)
      AND relkind='r' AND relrowsecurity AND relowner=current_user::regrole)<>2
  OR (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname||'.'||p.proname=ANY(names))<>9
  OR EXISTS(SELECT 1 FROM unnest(signatures) s LEFT JOIN pg_proc p ON p.oid=to_regprocedure(s)
            WHERE p.oid IS NULL OR p.proowner<>current_user::regrole)
 THEN RAISE EXCEPTION 'EMPTY_ADMISSION_ROLLBACK_STATE_HELD'; END IF;
 DROP TABLE rr_sandbox.backup_schedule_ticket_v1;
 DROP TABLE rr_sandbox.archive_dispatch_once_v2;
 FOR fn IN SELECT to_regprocedure(s) FROM unnest(signatures) s ORDER BY (s LIKE 'public.%') DESC LOOP
  EXECUTE format('DROP FUNCTION %s',fn);
 END LOOP;
 IF (${eventsSQL}) IS DISTINCT FROM ${literal(JSON.stringify(pin.event_triggers))}::jsonb
 THEN RAISE EXCEPTION 'EMPTY_ADMISSION_ROLLBACK_EVENT_CHANGED'; END IF;
 PERFORM pg_catalog.set_config('search_path',prior_path,true);
END
`);
}
module.exports = { build, rollback, NEW_FUNCTIONS, NEW_TABLES, SOURCE, PRINCIPAL, eventsSQL };
