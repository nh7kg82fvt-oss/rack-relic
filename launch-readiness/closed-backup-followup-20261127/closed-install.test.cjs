'use strict';
const test=require('node:test'), assert=require('node:assert/strict');
const {readFrozen}=require('./frozen-inputs.cjs');
const {createDb}=process.env.RR_NATIVE_CONTAINER ? require('./native-client.cjs') : {createDb:async()=>new (require('@electric-sql/pglite').PGlite)()};
const {build,rollback,PRINCIPAL,NEW_FUNCTIONS,eventsSQL}=require('./closed-install.cjs');
const ROOT='reviewed-inputs/';
const managed=JSON.parse(readFrozen('fixture-pin.json'));
async function fixture(){
 const db=await createDb();
 await db.exec(`${db.peer ? "" : "CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE ROLE authenticator;"}
 CREATE SCHEMA rr_sandbox; CREATE SCHEMA auth; CREATE SCHEMA storage;
 CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,email_confirmed_at timestamptz,is_anonymous boolean,banned_until timestamptz);
 INSERT INTO auth.users VALUES('${PRINCIPAL}','rack-photo-backup-20261127@example.invalid',now(),false,null);
 CREATE TABLE storage.buckets(id text PRIMARY KEY,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 INSERT INTO storage.buckets VALUES('listing-photos',false,2097152,ARRAY['image/png']);
 CREATE FUNCTION public.rr_backup_source_data_api_boundary() RETURNS void LANGUAGE plpgsql AS $$BEGIN RETURN;END$$;
 ALTER ROLE authenticator SET pgrst.db_pre_request='public.rr_backup_source_data_api_boundary';
 ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon,authenticated,service_role;`);
 await db.exec(readFrozen(ROOT+'archive_write_journal.sql'));
 await db.exec(readFrozen(ROOT+'archive_write_original_lookup.sql'));
 const routines=(await db.query(`select n.nspname as schema,p.proname as name,md5(pg_get_functiondef(p.oid)) as body_md5 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='rr_sandbox' and p.proname like 'archive_write_%' order by p.proname`)).rows;
 const version=(await db.query(`select current_setting('server_version_num') as v`)).rows[0].v;
 const pin={...structuredClone(managed),server_version_num:version,event_triggers:[],catalogue:{routines}};
 return {db,pin};
}
async function fresh(fn){const x=await fixture();try{return await fn(x);}finally{await x.db.close();}}
async function newObjects(db){return (await db.query(`select to_regclass('rr_sandbox.archive_dispatch_once_v2') as dispatch,to_regclass('rr_sandbox.backup_schedule_ticket_v1') as ticket`)).rows[0];}
test('one atomic closed install creates exactly two empty RLS tables and nine owner-only routines',()=>fresh(async({db,pin})=>{
 await db.exec(`set search_path=public,rr_sandbox`);
 await db.exec(build(pin));
 assert.equal((await db.query(`show search_path`)).rows[0].search_path,'public, rr_sandbox');
 assert.equal((await db.query(`select count(*)::int as n from rr_sandbox.archive_dispatch_once_v2`)).rows[0].n,0);
 assert.equal((await db.query(`select count(*)::int as n from rr_sandbox.backup_schedule_ticket_v1`)).rows[0].n,0);
 const rows=(await db.query(`select n.nspname||'.'||p.proname as name,has_function_privilege('anon',p.oid,'execute') as anon,has_function_privilege('authenticated',p.oid,'execute') as authed,has_function_privilege('service_role',p.oid,'execute') as service from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname||'.'||p.proname=any($1::text[])`,[NEW_FUNCTIONS])).rows;
 assert.equal(rows.length,9);assert.ok(rows.every(r=>!r.anon&&!r.authed&&!r.service));
 assert.deepEqual((await db.query(`select revision,archive_identity from rr_sandbox.archive_write_guard`)).rows,[{revision:0,archive_identity:null}]);
 assert.equal((await db.query(`select count(*)::int as n from rr_sandbox.archive_write_entries`)).rows[0].n,0);
}));
test('wrong branch metadata and private source identity are rejected without installation',()=>fresh(async({db,pin})=>{
 assert.throws(()=>build({...pin,sourceProject:'xkxolhgafjadpknsfqqw'}),/PIN_HELD/);
 await db.exec(`update auth.users set is_anonymous=true where id='${PRINCIPAL}'`);
 await assert.rejects(db.exec(build(pin)),/EXACT_TARGET_HELD/);
 assert.deepEqual(await newObjects(db),{dispatch:null,ticket:null});
}));
test('changed event inventory and legacy journal body both hold before new objects',()=>fresh(async({db,pin})=>{
 await assert.rejects(db.exec(build({...pin,event_triggers:[{name:'unobserved_event'}]})),/EVENT_INVENTORY_CHANGED/);
 await db.exec(`create or replace function rr_sandbox.archive_write_validate(p_identity text,p_key text,p_sha256 text,p_type text,p_size integer) returns void language plpgsql as $$begin return;end$$`);
 await assert.rejects(db.exec(build(pin)),/LEGACY_JOURNAL_CHANGED/);
 assert.deepEqual(await newObjects(db),{dispatch:null,ticket:null});
}));
test('unexpected custom default grants cause full rollback rather than retaining access',()=>fresh(async({db,pin})=>{
 await db.exec(`create role unexpected_reader; alter default privileges in schema public grant execute on functions to unexpected_reader`);
 await assert.rejects(db.exec(build(pin)),/OWNER_ONLY/);
 assert.deepEqual(await newObjects(db),{dispatch:null,ticket:null});
 assert.equal((await db.query(`select count(*)::int as n from rr_sandbox.archive_write_entries`)).rows[0].n,0);
}));
test('existing archive identity/history is not reset or silently migrated',()=>fresh(async({db,pin})=>{
 await db.exec(`update rr_sandbox.archive_write_guard set archive_identity='r2:fixture-account:fixture-archive',revision=revision+1 where singleton`);
 await assert.rejects(db.exec(build(pin)),/LEGACY_ARCHIVE_STATE_CHANGED/);
 assert.deepEqual(await newObjects(db),{dispatch:null,ticket:null});
 assert.equal((await db.query(`select revision from rr_sandbox.archive_write_guard`)).rows[0].revision,1);
}));
test('repeated install refuses existing objects while preserving the completed empty state',()=>fresh(async({db,pin})=>{
 await db.exec(build(pin));
 await assert.rejects(db.exec(build(pin)),/ALREADY_PRESENT/);
 assert.ok((await newObjects(db)).dispatch);assert.ok((await newObjects(db)).ticket);
 assert.equal((await db.query(`select count(*)::int as n from rr_sandbox.backup_schedule_ticket_v1`)).rows[0].n,0);
}));
test('qualified provider event identities remain stable under the install search path',()=>fresh(async({db,pin})=>{
 await db.exec(`create function public.observed_provider_event() returns event_trigger language plpgsql as $$begin return;end$$;create event trigger observed_provider_event on ddl_command_end execute function public.observed_provider_event()`);
 pin.event_triggers=(await db.query(eventsSQL)).rows[0].coalesce;
 assert.equal(pin.event_triggers[0].function,'public.observed_provider_event()');
 await db.exec(build(pin));
 assert.ok((await newObjects(db)).dispatch);
 assert.deepEqual((await db.query(eventsSQL)).rows[0].coalesce,pin.event_triggers);
}));
test('empty rollback removes only the new objects and retains the original journal',()=>fresh(async({db,pin})=>{
 await db.exec(build(pin));await db.exec(rollback(pin));
 assert.deepEqual(await newObjects(db),{dispatch:null,ticket:null});
 assert.equal((await db.query(`select count(*)::int as n from rr_sandbox.archive_write_guard`)).rows[0].n,1);
 assert.equal((await db.query(`select count(*)::int as n from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='rr_sandbox' and p.proname like 'archive_write_%'`)).rows[0].n,6);
}));
test('global inherited maintenance access holds atomically even without an explicit object ACL',()=>fresh(async({db,pin})=>{
 await db.exec(`grant pg_maintain to service_role`);
 await assert.rejects(db.exec(build(pin)),/EFFECTIVE_ACL_HELD|EFFECTIVE_PRIVILEGE_HELD/);
 assert.deepEqual(await newObjects(db),{dispatch:null,ticket:null});
}));

test('rollback refuses busy tables and wrong signatures, preserves the caller path',()=>fresh(async({db,pin})=>{
 await db.exec(build(pin));
 if (db.peer) {
  const peer=await db.peer();
  try {
   await peer.exec('BEGIN; LOCK TABLE rr_sandbox.backup_schedule_ticket_v1 IN ROW EXCLUSIVE MODE;');
   await assert.rejects(db.exec(rollback(pin)),/could not obtain lock/);
  } finally { await peer.close(); }
 }
 await db.exec('DROP FUNCTION public.rr_test_backup_schedule_ticket_read_v1(uuid,text,bigint,bigint,text,text,text,text); CREATE FUNCTION public.rr_test_backup_schedule_ticket_read_v1() RETURNS int LANGUAGE sql AS $$SELECT 1$$');
 await assert.rejects(db.exec(rollback(pin)),/ROLLBACK_STATE_HELD/);
 assert.ok((await newObjects(db)).ticket);
}));
test('duplicates in the legacy pin cannot stand in for a missing routine',()=>fresh(async({pin})=>{
 pin.catalogue.routines[0]=pin.catalogue.routines[1];
 assert.throws(()=>build(pin),/LEGACY_JOURNAL_PIN_HELD/);
}));
test('installer bootstrap ignores caller path shadows and an event pin cannot close the DO quote',()=>fresh(async({db,pin})=>{
 await db.exec(`CREATE SCHEMA shadow; CREATE FUNCTION shadow.current_setting(text) RETURNS text LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'SHADOW'; END$$; SET search_path=shadow,pg_catalog;`);
 await assert.rejects(db.exec(build({...pin,event_triggers:[{name:'$rr_closed_0$'}]})),/EVENT_INVENTORY_CHANGED/);
 await db.exec(build(pin));
 await db.exec(rollback(pin));
 assert.equal((await db.query('SHOW search_path')).rows[0].search_path,'shadow, pg_catalog');
}));
