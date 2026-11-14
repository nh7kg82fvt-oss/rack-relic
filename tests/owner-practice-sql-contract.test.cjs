'use strict';
// Actual new JS -> actual new SQL -> actual pinned legacy/current-session SQL
// on a disposable PGlite database. HTTP/GetUser/Stripe and all users are
// fictional. Positive policy is a separately labeled derivative, never a
// mutation or activation of the disabled proposal/source/provider environment.
const test=require('node:test'),assert=require('node:assert/strict');
const {rig,OWNER,SESSION,FIXTURE}=require('./helpers/owner-practice-sql-fixture.cjs');
const {fixture,ACCOUNT}=require('./helpers/owner-practice-runtime-fixture.cjs');
function serialized(){let queue=Promise.resolve();return run=>{const result=queue.then(run);queue=result.catch(()=>{});return result;};}
function sqlPorts(r,{loseClaimAck=false}={}){
 const queued=serialized();
 return {
  realtime:true,
  ownerRpc:b=>queued(async()=>{
   await r.db.exec('SET ROLE service_role');
   try{return(await r.db.query('SELECT public.rr_test_command_owner_session($1::uuid,$2::uuid,$3::uuid,$4::bigint,$5::uuid) AS value',
    [b.p_owner,b.p_actor,b.p_session,b.p_token_exp,b.p_nonce])).rows[0].value;}
   finally{await r.db.exec('RESET ROLE');}
  }),
  sqlRpc:b=>queued(async()=>{
   const value=await r.call({owner:b.p_owner,session:b.p_session,exp:b.p_token_exp,request:b.p_request,operation:b.p_operation,args:b.p_args});
   if(loseClaimAck&&b.p_operation==='claim')throw Error('Deliberately discarded fictional SQL claim ACK');
   return value;
  })
 };
}
test('actual JS-to-SQL contract: untouched NULL policy holds; separate fictional derivative permits only the closed rehearsal', {timeout:20000},async()=>{
 const r=await rig();
 try{
  await r.installDisabledSource();const f=fixture(sqlPorts(r));
  assert.equal((await f.request('GET')).statusCode,200); // Current owner read only, not seller authority.
  assert.equal((await f.request('POST','begin')).statusCode,503);assert.equal(await r.sellerCount(),0);assert.deepEqual(f.providerPosts,[]);
  await r.installFictionalPolicyDerivative(); // Explicit in-memory test derivative only.
  const started=performance.now(),begun=await f.request('POST','begin');assert.equal(begun.statusCode,303,begun.body);assert.equal(begun.body,'');
  const row=(await r.db.query('SELECT phase,account_id FROM rr_sandbox.seller_accounts')).rows[0];assert.deepEqual(row,{phase:'known',account_id:ACCOUNT});
  assert.equal((await f.request('POST','begin')).statusCode,503);assert.equal(f.providerPosts.filter(v=>v==='/v2/core/accounts').length,1);
  const observed=await f.request('POST','observe');assert.equal(observed.statusCode,200,observed.body);assert.match(observed.body,/Payments remain closed/);
  const protection=(await r.db.query('SELECT provider_ready,held FROM rr_sandbox.seller_protection_status')).rows[0];assert.deepEqual(protection,{provider_ready:true,held:false});
  assert.equal((await f.request('POST','refresh')).statusCode,303);assert.equal(f.providerPosts.filter(v=>v==='/v2/core/accounts').length,1);
  assert(performance.now()-started<15000); // Informational local composition, not a hosted latency acceptance.
  await r.assertSourceUnchanged();
 }finally{await r.close();}
});
test('lost actual disposable-SQL claim ACK leaves dispatched and cannot produce or recreate an account', {timeout:20000},async()=>{
 const r=await rig();
 try{
  await r.installDisabledSource();await r.installFictionalPolicyDerivative();const f=fixture(sqlPorts(r,{loseClaimAck:true}));
  assert.equal((await f.request('POST','begin')).statusCode,503);const rows=(await r.db.query('SELECT phase,account_id FROM rr_sandbox.seller_accounts')).rows;
  assert.deepEqual(rows,[{phase:'dispatched',account_id:null}]);assert.deepEqual(f.providerPosts,[]);
  assert.equal((await f.request('POST','begin')).statusCode,503);assert.deepEqual(f.providerPosts,[]);assert.equal(await r.sellerCount(),1);
  await r.assertSourceUnchanged();
 }finally{await r.close();}
});
test('equal owner and catalog target compose end-to-end with actual disposable SQL and no invented seller session', {timeout:20000},async()=>{
 const r=await rig(),otherSession='66666666-6666-4666-8666-666666666666';
 try{
  // All rows below are invented to exercise equal owner/fixture identifiers.
  // No real Auth row, password or token is copied.
  await r.db.query('INSERT INTO auth.users(id,deleted_at,banned_until) VALUES($1,NULL,NULL)',[FIXTURE]);
  await r.db.query('UPDATE auth.sessions SET user_id=$1 WHERE id=$2',[FIXTURE,SESSION]);
  await r.db.query('INSERT INTO auth.sessions(id,user_id,not_after) VALUES($1,$2,NULL)',[otherSession,OWNER]);
  await r.installDisabledSource();const ports=sqlPorts(r),owner=fixture({...ports,ownerId:FIXTURE});
  assert.equal((await owner.request('POST','begin')).statusCode,503);assert.equal(await r.sellerCount(),0);assert.deepEqual(owner.providerPosts,[]);
  await r.installFictionalPolicyDerivative({ownerSql:"'"+FIXTURE+"'::uuid"}); // Separate fictional derivative only.
  // This other configured owner really has a synthetic current session, but
  // the independent SQL policy is fixed to FIXTURE and must deny its claim.
  const wrongConfiguredOwner=fixture({...ports,ownerId:OWNER,sessionId:otherSession});
  assert.equal(wrongConfiguredOwner.instance.ready,true);assert.equal((await wrongConfiguredOwner.request('POST','begin')).statusCode,503);
  assert.equal(await r.sellerCount(),0);assert.deepEqual(wrongConfiguredOwner.providerPosts,[]);
  assert.equal((await owner.request('POST','begin',{cookies:{session:otherSession}})).statusCode,503);
  assert.equal((await owner.request('POST','begin',{cookies:{actor:OWNER}})).statusCode,503);
  assert.equal(await r.sellerCount(),0);assert.deepEqual(owner.providerPosts,[]);
  const begun=await owner.request('POST','begin');assert.equal(begun.statusCode,303,begun.body);assert.equal(begun.body,'');
  assert.equal((await owner.request('POST','begin')).statusCode,503);
  const observed=await owner.request('POST','observe');assert.equal(observed.statusCode,200,observed.body);assert.match(observed.body,/owner-operated rehearsal/);
  assert.equal((await owner.request('POST','refresh')).statusCode,303);assert.equal(await r.sellerCount(),1);
  assert.equal(owner.providerPosts.filter(v=>v==='/v2/core/accounts').length,1);
  assert.equal(owner.providerPosts.filter(v=>v==='/v2/core/account_links').length,2);
  const row=(await r.db.query('SELECT seller_id,phase,account_id FROM rr_sandbox.seller_accounts')).rows[0];
  assert.deepEqual(row,{seller_id:FIXTURE,phase:'known',account_id:ACCOUNT});
  assert(owner.sqlCalls.every(b=>b.p_owner===FIXTURE&&b.p_session===SESSION));
  assert(owner.ownerReplies.every(b=>b.ownerId===FIXTURE));await r.assertSourceUnchanged();
 }finally{await r.close();}
});
