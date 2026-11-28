'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const data=require('../command-queue-data.js');
const proposal=fs.readFileSync(path.join(__dirname,'../supabase/proposals/command_queue_cache_headers.sql'),'utf8');
const args="'11111111-1111-4111-8111-111111111111'::uuid,'11111111-1111-4111-8111-111111111112'::uuid,123::bigint,'11111111-1111-4111-8111-111111111113'::uuid,'list'::text,'{}'::jsonb";
async function setup(){
 const db=new PGlite();
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE SCHEMA rr_sandbox;
 CREATE FUNCTION rr_sandbox.command_queue_action(p_owner uuid,p_session uuid,p_token_exp bigint,p_nonce uuid,p_operation text,p_args jsonb) RETURNS jsonb LANGUAGE plpgsql AS $f$
 BEGIN IF p_operation='closed' THEN RAISE EXCEPTION 'Command queue closed';END IF;RETURN jsonb_build_object('test',true,'live',false,'releaseEnabled',false);END $f$;
 CREATE FUNCTION public.rr_test_command_queue(p_owner uuid,p_session uuid,p_token_exp bigint,p_nonce uuid,p_operation text,p_args jsonb)
 RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path=pg_catalog AS $f$
 SELECT rr_sandbox.command_queue_action(p_owner,p_session,p_token_exp,p_nonce,p_operation,p_args)
$f$;
 REVOKE ALL ON FUNCTION public.rr_test_command_queue(uuid,uuid,bigint,uuid,text,jsonb) FROM PUBLIC,anon,authenticated;
 GRANT EXECUTE ON FUNCTION public.rr_test_command_queue(uuid,uuid,bigint,uuid,text,jsonb) TO service_role;`);
 return db;
}
async function header(db){return (await db.query("SELECT current_setting('response.headers',true) AS value")).rows[0].value;}
test('current strict response validator rejects absent RPC privacy policy',()=>{
 const missing=new Response('{}',{headers:{'content-type':'application/json','cf-cache-status':'DYNAMIC'}});
 assert.equal(data.cached(missing),true);
 const valid=new Response('{}',{headers:{'content-type':'application/json','cache-control':'private, no-store, max-age=0, no-transform','cf-cache-status':'DYNAMIC'}});
 assert.equal(data.cached(valid),false);
});
test('actual SQL wrapper publishes transaction response headers and preserves its result',async()=>{
 const db=await setup();try{
  assert.equal(await header(db),null);
  const before=(await db.query('SELECT public.rr_test_command_queue('+args+') value')).rows[0].value;
  assert.equal(await header(db),null);
  await db.exec(proposal);
  const after=(await db.query('SELECT public.rr_test_command_queue('+args+') value')).rows[0].value;
  assert.deepEqual(after,before);
  const headers=JSON.parse(await header(db));assert.equal(headers[0]['Cache-Control'],'private, no-store, max-age=0, no-transform');
  assert.equal(headers[1].Pragma,'no-cache');
 }finally{await db.close();}
});
test('replacement keeps OID, grants, fixed search path and invoker status',async()=>{
 const db=await setup();try{
  const metadata=async()=> (await db.query("SELECT to_jsonb(p)-'prosrc' AS value FROM pg_proc p WHERE oid='public.rr_test_command_queue(uuid,uuid,bigint,uuid,text,jsonb)'::regprocedure")).rows[0].value;
  const before=await metadata();await db.exec(proposal);assert.deepEqual(await metadata(),before);
  for(const role of ['anon','authenticated']){
   await db.exec('SET ROLE '+role);await assert.rejects(db.query('SELECT public.rr_test_command_queue('+args+')'),/permission denied/);await db.exec('RESET ROLE');
  }
 }finally{await db.close();}
});
test('closed delegate still fails and a different prior body cannot be overwritten',async()=>{
 const db=await setup();try{
  await db.exec(proposal);
  await assert.rejects(db.query('SELECT public.rr_test_command_queue('+args.replace("'list'::text","'closed'::text")+')'),/Command queue closed/);
  await assert.rejects(db.exec(proposal),/Exact existing closed queue wrapper required/);
 }finally{await db.close();}
});
test('paired rollback restores the exact prior wrapper without touching attributes',async()=>{
 const db=await setup();try{
  const read=async()=>(await db.query("SELECT to_jsonb(p) AS value FROM pg_proc p WHERE oid='public.rr_test_command_queue(uuid,uuid,bigint,uuid,text,jsonb)'::regprocedure")).rows[0].value;
  const before=await read();await db.exec(proposal);
  const rollback=fs.readFileSync(path.join(__dirname,'../supabase/proposals/command_queue_cache_headers_rollback.sql'),'utf8');
  await db.exec(rollback);assert.deepEqual(await read(),before);
  await assert.rejects(db.exec(rollback),/Exact reviewed header wrapper required/);
 }finally{await db.close();}
});

