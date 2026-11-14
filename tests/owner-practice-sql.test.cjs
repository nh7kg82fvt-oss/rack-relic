'use strict';
// Actual new SQL + actual pinned existing helper/seller SQL, on fictional
// disposable PGlite Auth/catalog state only. No native/provider acceptance.
const test=require('node:test'),assert=require('node:assert/strict');
const {rig,sourceSql,fictionalPolicyDerivative,dependencyPins,sha,OWNER,OTHER,SESSION,FIXTURE,REQUEST}=require('./helpers/owner-practice-sql-fixture.cjs');
const ZERO='00000000-0000-0000-0000-000000000000',ACCOUNT='acct_fictionalOwnerRehearsal';
async function activated(){const r=await rig();try{await r.installDisabledSource();await r.installFictionalPolicyDerivative();return r;}catch(e){await r.close();throw e;}}

test('unchanged disabled source has NULL policy and denies before any seller claim or Auth change',async()=>{
 const r=await rig();try{
  await r.installDisabledSource();const before=await r.sellerCount();
  await assert.rejects(r.call({operation:'claim'}),/Owner fixture rehearsal held/);
  assert.equal(await r.sellerCount(),before);
  assert.equal((await r.db.query('SELECT count(*)::integer AS n FROM auth.users')).rows[0].n,2);
  assert.equal((await r.db.query('SELECT count(*)::integer AS n FROM auth.sessions')).rows[0].n,1);
  await r.assertSourceUnchanged();
 }finally{await r.close();}
});

test('source prerequisite denial creates no routines when service usage or existing dependency is unavailable',async()=>{
 for(const options of [{usage:false},{omitDependency:'save'}]){const r=await rig(options);try{
  await assert.rejects(r.installDisabledSource(),/Reviewed owner and seller dependencies required/);await r.db.exec('ROLLBACK');
  assert.equal((await r.db.query("SELECT to_regprocedure('public.rr_test_owner_fixture_seller_action(uuid,uuid,bigint,uuid,text,jsonb)') AS f")).rows[0].f,null);
 }finally{await r.close();}}
});

test('fictional policy derivative is labeled, separate and never edits the disabled source',async()=>{
 const source=await sourceSql(),before=sha(Buffer.from(source)),derived=fictionalPolicyDerivative(source);
 assert.match(derived,/FICTIONAL DISPOSABLE PGLITE POLICY DERIVATIVE ONLY/);
 assert.match(source,/fixture CONSTANT uuid := NULL;/);assert.match(source,/authorized_owner CONSTANT uuid := NULL;/);assert.match(source,/enabled_from CONSTANT timestamptz := NULL;/);assert.match(source,/enabled_until CONSTANT timestamptz := NULL;/);
 assert.notEqual(sha(Buffer.from(derived)),before);assert.equal(sha(Buffer.from(await sourceSql())),before);
 const pins=await dependencyPins();assert.equal(pins.length,3);for(const pin of pins){assert(pin.bytes>0);assert.match(pin.sha256,/^[a-f0-9]{64}$/);}
});

test('fictional policy NULL, zero, nonfinite, future, expired and excessive windows remain held',async()=>{
 const r=await rig();try{
  await r.installDisabledSource();
  const cases=[{fixtureSql:'NULL'},{fixtureSql:"'"+ZERO+"'::uuid"},{ownerSql:'NULL'},{ownerSql:"'"+ZERO+"'::uuid"},{fromSql:'NULL'},{untilSql:'NULL'},
   {fromSql:"'-infinity'::timestamptz"},{untilSql:"'infinity'::timestamptz"},
   {fromSql:"clock_timestamp()+interval '1 minute'",untilSql:"clock_timestamp()+interval '20 minutes'"},
   {fromSql:"clock_timestamp()-interval '20 minutes'",untilSql:"clock_timestamp()-interval '1 minute'"},
   {fromSql:"clock_timestamp()-interval '30 minutes'",untilSql:"clock_timestamp()+interval '31 minutes'"},
   {fromSql:"clock_timestamp()+interval '1 minute'",untilSql:"clock_timestamp()-interval '1 minute'"}];
  for(const change of cases){await r.installFictionalPolicyDerivative(change);await assert.rejects(r.call({operation:'claim'}),/Owner fixture rehearsal held/);assert.equal(await r.sellerCount(),0);}
  await r.assertSourceUnchanged();
 }finally{await r.close();}
});

test('fictional activated policy authenticates the actual owner/session while keeping fixture identity separate',async()=>{
 const r=await activated();try{
  for(const change of [{owner:OTHER},{owner:null},{session:ZERO},{session:null},{request:ZERO},{request:null},{exp:null},{exp:Math.floor(Date.now()/1000)-1},{exp:9007199254741}])await assert.rejects(r.call({operation:'claim',...change}));
  assert.equal(await r.sellerCount(),0);const before=Date.now(),v=await r.call();
  assert.deepEqual(Object.keys(v).sort(),['fixtureId','mode','observedAt','operation','ownerId','requestId','result','sessionId','tokenExp','version']);
  assert.equal(v.version,'rr-owner-fixture-seller-action-v1');assert.equal(v.mode,'owner-operated-fictional-rehearsal');assert.equal(v.ownerId,OWNER);assert.equal(v.sessionId,SESSION);assert.equal(v.fixtureId,FIXTURE);assert.notEqual(v.ownerId,v.fixtureId);assert.equal(v.requestId,REQUEST);assert.equal(v.operation,'context');
  assert(v.observedAt>=before-1000&&v.observedAt<=Date.now()+1000);assert.deepEqual(v.result,{test:true,sellerId:FIXTURE,phase:'prepared',accountId:null});
 }finally{await r.close();}
});

test('fictional finite policy permits exactly one hour and rejects one hour plus one millisecond',async()=>{
 const r=await rig();try{
  await r.installDisabledSource();const start=Date.now()-60000;
  const fromSql="'"+new Date(start).toISOString()+"'::timestamptz";
  await r.installFictionalPolicyDerivative({fromSql,untilSql:"'"+new Date(start+3600000).toISOString()+"'::timestamptz"});
  assert.equal((await r.call()).result.phase,'prepared');
  await r.installFictionalPolicyDerivative({fromSql,untilSql:"'"+new Date(start+3600001).toISOString()+"'::timestamptz"});
  await assert.rejects(r.call({operation:'claim'}),/Owner fixture rehearsal held/);assert.equal(await r.sellerCount(),0);
 }finally{await r.close();}
});

test('fictional owner may own the fixture: equal UUIDs still require the actual configured owner and its current session',async()=>{
 const r=await rig();try{
  await r.installDisabledSource();await r.installFictionalPolicyDerivative({ownerSql:"'"+FIXTURE+"'::uuid"});
  const foreignSession='99999999-9999-4999-8999-999999999999';
  // Additional Auth rows exist ONLY in this disposable fictional database.
  // Equality of IDs does not manufacture a second holder/session or accept
  // real verification: the actual unchanged helper checks this owner row.
  await r.db.exec(`INSERT INTO auth.users VALUES('${FIXTURE}',NULL,NULL);
   UPDATE auth.sessions SET user_id='${FIXTURE}' WHERE id='${SESSION}';
   INSERT INTO auth.sessions VALUES('${foreignSession}','${OTHER}',NULL);`);
  const context=await r.call({owner:FIXTURE});assert.equal(context.ownerId,FIXTURE);assert.equal(context.fixtureId,FIXTURE);
  assert.deepEqual(context.result,{test:true,sellerId:FIXTURE,phase:'prepared',accountId:null});
  for(const change of [{owner:OWNER},{owner:OTHER},{session:foreignSession},{session:ZERO}])await assert.rejects(r.call({owner:FIXTURE,operation:'claim',...change}));
  assert.equal(await r.sellerCount(),0);
  const claim=await r.call({owner:FIXTURE,operation:'claim'});assert.deepEqual(claim.result,{claimed:true,sellerId:FIXTURE});
  assert.equal((await r.call({owner:FIXTURE})).result.phase,'dispatched');
  assert.equal((await r.db.query('SELECT seller_id FROM rr_sandbox.seller_accounts')).rows[0].seller_id,FIXTURE);
  await r.assertSourceUnchanged();
 }finally{await r.close();}
});

test('fictional deleted, banned, missing, foreign and expired sessions deny before the legacy claim',async()=>{
 for(const mutation of ["UPDATE auth.users SET deleted_at=clock_timestamp() WHERE id='"+OWNER+"'","UPDATE auth.users SET banned_until=clock_timestamp()+interval '1 day' WHERE id='"+OWNER+"'",'DELETE FROM auth.sessions',"UPDATE auth.sessions SET user_id='"+OTHER+"'","UPDATE auth.sessions SET not_after=clock_timestamp()-interval '1 second'"]){
  const r=await activated();try{await r.db.exec(mutation);await assert.rejects(r.call({operation:'claim'}),/Current configured owner required/);assert.equal(await r.sellerCount(),0);}finally{await r.close();}
 }
});

test('exact four-operation arguments reject actor/function/URL substitution, extra keys and JSON nulls',async()=>{
 const r=await activated();try{
  const bad=[{operation:null},{operation:'arbitrary'},{operation:'context',args:null},{operation:'context',args:[]},{operation:'context',args:{actor:OTHER}},{operation:'claim',args:{p_actor:FIXTURE}},
   {operation:'save',args:{}},{operation:'save',args:{accountId:ACCOUNT,extra:true}},{operation:'save',args:{accountId:null}},{operation:'save',args:{accountId:'https://example.invalid'}},{operation:'save',args:{accountId:'acct_1UXdWBGppSOhWnq8'}},{operation:'save',args:{accountId:'acct_1UWJZuGVbz9Pnhxd'}},
   {operation:'protection',args:{accountId:ACCOUNT,ready:null,checkedAt:Date.now()}},{operation:'protection',args:{accountId:ACCOUNT,ready:'true',checkedAt:Date.now()}},{operation:'protection',args:{accountId:ACCOUNT,ready:true,checkedAt:null}},{operation:'protection',args:{accountId:ACCOUNT,ready:true,checkedAt:'123'}},{operation:'protection',args:{accountId:ACCOUNT,ready:true,checkedAt:1.5}},{operation:'protection',args:{accountId:ACCOUNT,ready:true,checkedAt:9007199254740992}}];
  for(const change of bad)await assert.rejects(r.call(change));assert.equal(await r.sellerCount(),0);
 }finally{await r.close();}
});

test('nonce envelope correlation never replaces the existing durable prepared-to-dispatched create barrier',async()=>{
 const r=await activated();try{
  const first=await r.call({operation:'claim'});assert.deepEqual(first.result,{claimed:true,sellerId:FIXTURE});
  // Same nonce is deliberately not represented as a consumed-nonce journal.
  // The underlying durable claim independently denies another creation grant.
  const same=await r.call({operation:'claim'});assert.equal(same.requestId,REQUEST);assert.equal(same.result.claimed,false);
  const later='66666666-6666-4666-8666-666666666666',fresh=await r.call({operation:'claim',request:later});assert.equal(fresh.requestId,later);assert.equal(fresh.result.claimed,false);
  assert.equal((await r.call()).result.phase,'dispatched');assert.equal(await r.sellerCount(),1);
 }finally{await r.close();}
});

test('lost claim acknowledgment leaves the actual SQL claim dispatched and never grants a second claim',async()=>{
 const r=await activated();try{
  await r.call({operation:'claim'}); // Intentionally discard result: fictional lost HTTP ACK.
  assert.equal((await r.call({request:'77777777-7777-4777-8777-777777777777'})).result.phase,'dispatched');
  assert.equal((await r.call({operation:'claim',request:'88888888-8888-4888-8888-888888888888'})).result.claimed,false);
 }finally{await r.close();}
});

test('save permits only the original SQL binding, including a lost-save-ack reconciliation',async()=>{
 const r=await activated();try{
  await assert.rejects(r.call({operation:'save',args:{accountId:ACCOUNT}}),/Invalid binding/);
  await r.call({operation:'claim'});await r.call({operation:'save',args:{accountId:ACCOUNT}}); // Discard fictional save ACK.
  const c=await r.call();assert.equal(c.result.phase,'known');assert.equal(c.result.accountId,ACCOUNT);
  assert.deepEqual((await r.call({operation:'save',args:{accountId:ACCOUNT}})).result,{saved:true});
  await assert.rejects(r.call({operation:'save',args:{accountId:'acct_replacementNotAllowed'}}),/Invalid binding/);
  assert.equal((await r.call({operation:'claim'})).result.claimed,false);
 }finally{await r.close();}
});

test('fresh protection recording uses the original binding and preserves equal-time restrictions',async()=>{
 const r=await activated();try{
  await r.call({operation:'claim'});await r.call({operation:'save',args:{accountId:ACCOUNT}});
  await assert.rejects(r.call({operation:'protection',args:{accountId:'acct_wrongOriginal',ready:true,checkedAt:Date.now()}}),/Seller binding required/);
  for(const checkedAt of [Date.now()-6000,Date.now()+2000])await assert.rejects(r.call({operation:'protection',args:{accountId:ACCOUNT,ready:true,checkedAt}}),/Fresh fictional observation required/);
  const stamp=Date.now();assert.deepEqual((await r.call({operation:'protection',args:{accountId:ACCOUNT,ready:false,checkedAt:stamp}})).result,{test:true,recorded:true});
  await r.call({operation:'protection',args:{accountId:ACCOUNT,ready:true,checkedAt:stamp}});
  const row=(await r.db.query('SELECT provider_ready,held FROM rr_sandbox.seller_protection_status')).rows[0];assert.equal(row.provider_ready,false);assert.equal(row.held,false);
 }finally{await r.close();}
});

test('new routines are service-only, fixed-path invoker/definer, adding no Auth or direct-table grants',async()=>{
 const r=await rig();try{
  const oldNames=['rr_test_seller_context','rr_test_claim_seller','rr_test_save_seller','rr_test_record_seller_protection','rr_test_command_owner_session','command_owner_session'];
  const defs=async()=>(await r.db.query("SELECT n.nspname,p.proname,md5(pg_get_functiondef(p.oid)) AS hash FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE p.proname=ANY($1::text[]) ORDER BY n.nspname,p.proname",[oldNames])).rows;
  const before=await defs();await r.installDisabledSource();assert.deepEqual(await defs(),before);
  const rows=(await r.db.query("SELECT n.nspname,p.proname,p.prosecdef,p.provolatile,p.proconfig,has_function_privilege('anon',p.oid,'EXECUTE') AS anon,has_function_privilege('authenticated',p.oid,'EXECUTE') AS authenticated,has_function_privilege('service_role',p.oid,'EXECUTE') AS server FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE p.proname IN('owner_fixture_seller_action','rr_test_owner_fixture_seller_action') ORDER BY n.nspname")).rows;
  assert.equal(rows.length,2);assert.equal(rows[0].prosecdef,false);assert.equal(rows[1].prosecdef,true);
  for(const row of rows){assert.equal(row.provolatile,'v');assert.deepEqual(row.proconfig,['search_path=pg_catalog']);assert.equal(row.anon,false);assert.equal(row.authenticated,false);assert.equal(row.server,true);}
  for(const role of ['anon','authenticated']){await r.db.exec('SET ROLE '+role);try{await assert.rejects(r.db.query(`SELECT public.rr_test_owner_fixture_seller_action('${OWNER}','${SESSION}',${Math.floor(Date.now()/1000)+1000},'${REQUEST}','claim','{}')`),/permission denied/);}finally{await r.db.exec('RESET ROLE');}}
  const grants=(await r.db.query("SELECT count(*)::integer AS n FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace CROSS JOIN LATERAL aclexplode(c.relacl)x JOIN pg_roles r ON r.oid=x.grantee WHERE n.nspname IN('auth','rr_sandbox') AND r.rolname IN('service_role','anon','authenticated')")).rows[0].n;assert.equal(grants,0);
  await r.db.exec('SET ROLE service_role');try{await assert.rejects(r.db.query('SELECT * FROM auth.sessions'),/permission denied/);}finally{await r.db.exec('RESET ROLE');}
  assert.equal(await r.sellerCount(),0);await r.assertSourceUnchanged();
 }finally{await r.close();}
});
