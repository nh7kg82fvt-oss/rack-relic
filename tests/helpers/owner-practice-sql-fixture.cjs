'use strict';
// Disposable PGlite only. The positive policy below is an explicitly separate
// fictional derivative; the reviewed source retains NULL owner/window constants.
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {PGlite}=require('@electric-sql/pglite');
const CANONICAL=path.resolve(__dirname,'../..');
const PROPOSAL=path.resolve(CANONICAL,'supabase/test/20261113_owner_practice_seller.sql');
const OWNER='11111111-1111-4111-8111-111111111111',OTHER='22222222-2222-4222-8222-222222222222',SESSION='33333333-3333-4333-8333-333333333333';
const FIXTURE='77777777-7777-4777-8777-777777777777',LISTING='44444444-4444-4444-8444-444444444444',REQUEST='55555555-5555-4555-8555-555555555555';
const SOURCE_FILES=['supabase/test/20261109_command_owner_session.sql','supabase/test/20261102_seller_onboarding.sql','supabase/test/20261103_seller_protections.sql'];
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
function replaceOnce(value,from,to){assert.equal(value.split(from).length,2,'Exact single source activation marker required');return value.replace(from,to);}
async function sourceSql(){return fs.readFile(PROPOSAL,'utf8');}
async function dependencyPins(){return Promise.all(SOURCE_FILES.map(async name=>{const bytes=await fs.readFile(path.join(CANONICAL,name));return {path:name,bytes:bytes.length,sha256:sha(bytes)};}));}
function fictionalPolicyDerivative(source,change={}){
 const begin=source.indexOf('CREATE FUNCTION rr_sandbox.owner_fixture_seller_action('),end=source.indexOf('END $$;',begin);
 assert(begin>=0&&end>begin,'Exact private function source required');
 let derivative=source.slice(begin,end+'END $$;'.length);
 derivative=replaceOnce(derivative,'CREATE FUNCTION rr_sandbox.','CREATE OR REPLACE FUNCTION rr_sandbox.');
 const owner=Object.hasOwn(change,'ownerSql')?change.ownerSql:"'"+OWNER+"'::uuid";
 // Fixed fictional timestamps are captured once for this derivative. They do
 // not create a sliding/renewed window each time the SQL function is called.
 const stamp=Date.now();
 const from=Object.hasOwn(change,'fromSql')?change.fromSql:"'"+new Date(stamp-1800000).toISOString()+"'::timestamptz";
 const until=Object.hasOwn(change,'untilSql')?change.untilSql:"'"+new Date(stamp+1200000).toISOString()+"'::timestamptz";
 derivative=replaceOnce(derivative,'authorized_owner CONSTANT uuid := NULL;','authorized_owner CONSTANT uuid := '+owner+';');
 derivative=replaceOnce(derivative,'fixture CONSTANT uuid := NULL;','fixture CONSTANT uuid := '+(Object.hasOwn(change,'fixtureSql')?change.fixtureSql:"'"+FIXTURE+"'::uuid")+';');
 derivative=replaceOnce(derivative,'enabled_from CONSTANT timestamptz := NULL;','enabled_from CONSTANT timestamptz := '+from+';');
 derivative=replaceOnce(derivative,'enabled_until CONSTANT timestamptz := NULL;','enabled_until CONSTANT timestamptz := '+until+';');
 return '-- FICTIONAL DISPOSABLE PGLITE POLICY DERIVATIVE ONLY; NOT THE DISABLED SOURCE OR PROVIDER AUTHORITY.\n'+derivative;
}
async function rig({usage=true,omitDependency=null}={}){
 const db=new PGlite();
 try{
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE SCHEMA rr_sandbox; CREATE SCHEMA auth;
   GRANT USAGE ON SCHEMA rr_sandbox TO service_role;
   CREATE TABLE auth.users(id uuid PRIMARY KEY,deleted_at timestamptz,banned_until timestamptz);
   CREATE TABLE auth.sessions(id uuid PRIMARY KEY,user_id uuid NOT NULL,not_after timestamptz);
   CREATE TABLE rr_sandbox.catalog(id uuid PRIMARY KEY,seller_id uuid NOT NULL);
   INSERT INTO auth.users VALUES('${OWNER}',NULL,NULL),('${OTHER}',NULL,NULL);
   INSERT INTO auth.sessions VALUES('${SESSION}','${OWNER}',NULL);
   INSERT INTO rr_sandbox.catalog VALUES('${LISTING}','${FIXTURE}');`);
  await db.exec(await fs.readFile(path.join(CANONICAL,SOURCE_FILES[0]),'utf8'));
  await db.exec(await fs.readFile(path.join(CANONICAL,SOURCE_FILES[1]),'utf8'));
  const protection=await fs.readFile(path.join(CANONICAL,SOURCE_FILES[2]),'utf8');
  const marker='-- Test-only conservative caps:';
  assert.equal(protection.split(marker).length,2);
  // Exact existing table + record function section. No later order-policy
  // functions/triggers are installed or represented as needed dependencies.
  await db.exec(protection.slice(0,protection.indexOf(marker))+'\nCOMMIT;');
  if(!usage)await db.exec('REVOKE USAGE ON SCHEMA rr_sandbox FROM service_role');
  if(omitDependency){assert.equal(omitDependency,'save');await db.exec('DROP FUNCTION public.rr_test_save_seller(uuid,text)');}
  const source=await sourceSql(),sourceHash=sha(Buffer.from(source));
  return {
   db,source,sourceHash,
   async installDisabledSource(){await db.exec(source);},
   async installFictionalPolicyDerivative(change={}){await db.exec(fictionalPolicyDerivative(source,change));},
   async call(change={}){
    const p={owner:OWNER,session:SESSION,exp:Math.floor(Date.now()/1000)+1800,request:REQUEST,operation:'context',args:{},...change};
    await db.exec('SET ROLE service_role');
    try{return(await db.query('SELECT public.rr_test_owner_fixture_seller_action($1::uuid,$2::uuid,$3::bigint,$4::uuid,$5::text,$6::jsonb) AS value',[p.owner,p.session,p.exp,p.request,p.operation,JSON.stringify(p.args)])).rows[0].value;}
    finally{await db.exec('RESET ROLE');}
   },
   async sellerCount(){return(await db.query('SELECT count(*)::integer AS n FROM rr_sandbox.seller_accounts')).rows[0].n;},
   async assertSourceUnchanged(){assert.equal(sha(Buffer.from(await sourceSql())),sourceHash);},
   async close(){await db.close();}
  };
 }catch(error){await db.close();throw error;}
}
module.exports={rig,sourceSql,fictionalPolicyDerivative,dependencyPins,sha,OWNER,OTHER,SESSION,FIXTURE,REQUEST,SOURCE_FILES,CANONICAL};
