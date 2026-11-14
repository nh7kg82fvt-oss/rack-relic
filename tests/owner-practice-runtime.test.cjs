'use strict';
// Actual pinned JS modules + synthetic HTTP/Auth/RPC under real-network denial.
const test=require('node:test'),assert=require('node:assert/strict'),{Readable}=require('node:stream');
const {fixture,response,OWNER,OTHER,SESSION,ACCOUNT,FIXTURE}=require('./helpers/owner-practice-runtime-fixture.cjs');
const {createClosedOwnerFixtureRuntime,RETURN_PATH,BEGIN_PATH,ENV,MODE}=require('../server/owner_practice_runtime.cjs');
test('NULL/OFF construction performs no I/O and returns404',async()=>{
 const runtime=createClosedOwnerFixtureRuntime(),res=response();await runtime.handler({url:RETURN_PATH,method:'GET'},res);assert.equal(runtime.ready,false);assert.equal(res.statusCode,404);
 const f=fixture({override:{stripeRestrictedKey:null}});assert.equal(f.instance.ready,false);assert.equal((await f.request('POST','begin')).statusCode,404);assert.deepEqual(f.calls,[]);
});
test('GET owner gate reuses actual current-cookie reader and invokes no seller/provider operation',async()=>{
 const f=fixture(),r=await f.request();assert.equal(r.statusCode,200,r.body);assert.match(r.body,/owner-operated fictional rehearsal/);
 assert.match(r.body,/Payments remain closed/);assert.equal(f.calls.filter(v=>v==='owner:user').length,1);assert.equal(f.calls.filter(v=>v==='owner:session').length,1);
 assert.deepEqual(f.sqlCalls,[]);assert.deepEqual(f.providerPosts,[]);assert.deepEqual(f.writes,[]);assert.equal(r.headers['cache-control'],'private, no-store');
});
test('one explicit begin composes actual claim/service/binding and emits only a confidential303',async()=>{
 const f=fixture(),r=await f.request('POST','begin');assert.equal(r.statusCode,303,r.body);assert.equal(r.body,'');assert.equal(f.phase,'known');assert.equal(f.accountId,ACCOUNT);
 assert.deepEqual(f.providerPosts,['/v2/core/accounts','/v2/core/account_links']);assert.deepEqual(f.writes,['claim','save']);
 assert(f.calls.indexOf('sql:claim')<f.calls.indexOf('POST /v2/core/accounts'));assert.match(r.headers.location,/^https:\/\/accounts\.stripe\.com\/r\//);
 assert.equal(Object.hasOwn(r.headers,'set-cookie'),false);assert.deepEqual(Object.keys(f.instance).sort(),['handler','ready']);
 assert(f.ownerReplies.every(v=>v.ownerId===OWNER&&v.sessionId===SESSION));
});
test('begin accepts only an exact same-origin native form, allowing top-level303 without a link JSON handoff',async()=>{
 const f=fixture();
 assert.equal((await f.request('POST','begin',{headers:{'content-type':'application/json'},raw:'{}'})).statusCode,415);
 for(const raw of ['','{}','action=refresh','action=begin&actor='+OWNER,'action=begin&action=begin','action=%62egin']){
  assert.equal((await f.request('POST','begin',{raw})).statusCode,400);
 }
 assert.equal((await f.request('POST','begin',{parsedBody:{}})).statusCode,400);
 assert.equal((await f.request('POST','begin',{parsedBody:{action:'begin',actor:OWNER}})).statusCode,400);
 assert.deepEqual(f.calls,[]);
 assert.equal((await f.request('POST','begin',{raw:'action=begin'})).statusCode,303);
 const parsed=fixture(),r=await parsed.request('POST','begin',{parsedBody:{action:'begin'}});assert.equal(r.statusCode,303,r.body);assert.equal(r.body,'');
 const page=await parsed.request('GET');assert(!page.body.includes(BEGIN_PATH));assert(!page.body.includes('value="begin"'));
});
test('an actual configured owner may also own the fictional fixture without a second identity',async()=>{
 const f=fixture({ownerId:FIXTURE}),r=await f.request('POST','begin');assert.equal(f.instance.ready,true);assert.equal(r.statusCode,303,r.body);
 assert(f.ownerReplies.every(v=>v.ownerId===FIXTURE&&v.sessionId===SESSION));assert(f.sqlCalls.every(v=>v.p_owner===FIXTURE));
 assert.deepEqual(f.writes,['claim','save']);assert.equal(f.providerPosts.filter(v=>v==='/v2/core/accounts').length,1);
 const nonowner=fixture({ownerId:FIXTURE});assert.equal((await nonowner.request('POST','begin',{cookies:{actor:OTHER}})).statusCode,503);assert.deepEqual(nonowner.sqlCalls,[]);assert.deepEqual(nonowner.providerPosts,[]);
 const wrongConfig=nonowner.build({configuration:{...nonowner.cfg,ownerId:OTHER},commandSettings:{...nonowner.settings,
  RACK_RELIC_TEST_ADMIN_OWNER_ID:OTHER,RACK_RELIC_TEST_MEMBER_IDS:OTHER+','+FIXTURE,RACK_RELIC_TEST_REFUND_OPERATOR_IDS:OTHER}});
 assert.equal(wrongConfig.ready,true);assert.equal((await nonowner.request('POST','begin',{instance:wrongConfig,cookies:{actor:OTHER}})).statusCode,503);
 assert.deepEqual(nonowner.sqlCalls,[]);assert.deepEqual(nonowner.providerPosts,[]);
});
test('a repeated begin cannot create again; explicit refresh is only for the original known account',async()=>{
 const f=fixture();assert.equal((await f.request('POST','begin')).statusCode,303);assert.equal((await f.request('POST','begin')).statusCode,503);
 assert.equal((await f.request('POST','refresh')).statusCode,303);assert.equal(f.providerPosts.filter(v=>v==='/v2/core/accounts').length,1);assert.equal(f.providerPosts.filter(v=>v==='/v2/core/account_links').length,2);
});
test('observe performs a genuine fresh fictional status read and scoped protection write, never a money action',async()=>{
 const f=fixture({phase:'known',requirement:true}),r=await f.request('POST','observe');assert.equal(r.statusCode,200,r.body);
 assert.match(r.body,/Provider setup still needs attention/);assert.match(r.body,/does not prove a real seller/);assert.deepEqual(f.writes,['protection']);assert.deepEqual(f.providerPosts,[]);
 assert.equal(f.sqlCalls.find(v=>v.p_operation==='protection').p_args.ready,false);assert(!r.body.includes(ACCOUNT));assert(!r.body.includes(f.restrictedKey));
});
test('caller-selected identities, unsafe raw paths and GET action attempts have no authority',async()=>{
 const f=fixture();
 for(const url of [RETURN_PATH+'?',RETURN_PATH+'#',RETURN_PATH+'?action=begin',ENV.previewOrigin+RETURN_PATH,BEGIN_PATH+'?']){
  assert.equal((await f.request('GET',null,{url})).statusCode,404);
 }
 assert.equal((await f.request('POST','begin',{raw:'action=begin&actor='+OWNER})).statusCode,400);
 assert.deepEqual(f.calls,[]);
});
test('cross-origin, wrong content type, extra forms and parsed actor fields are rejected before effects',async()=>{
 const f=fixture();
 assert.equal((await f.request('POST','begin',{headers:{origin:'https://example.invalid'}})).statusCode,403);
 assert.equal((await f.request('POST','begin',{headers:{'sec-fetch-site':'cross-site'}})).statusCode,403);
 assert.equal((await f.request('POST','begin',{headers:{'content-type':'text/plain'}})).statusCode,415);
 assert.equal((await f.request('POST','observe',{raw:'action=observe&actor='+OWNER})).statusCode,400);
 assert.equal((await f.request('POST','begin',{parsedBody:{actor:OWNER}})).statusCode,400);assert.deepEqual(f.calls,[]);
});
test('bearer-only, nonowner, duplicate and expired cookies never reach seller/provider transport',async()=>{
 for(const cookies of [{bearerOnly:true},{actor:OTHER},{duplicate:true},{exp:Math.floor(Date.UTC(2026,10,13,20,0,0)/1000)-1}]){
  const f=fixture(),r=await f.request('POST','begin',{cookies,headers:{authorization:'Bearer fictional-not-a-cookie'}});
  assert.equal(r.statusCode,503,r.body);assert.deepEqual(f.sqlCalls,[]);assert.deepEqual(f.providerPosts,[]);
  assert(!f.calls.some(v=>v.includes('token')||v.includes('logout')));
 }
});
test('wrong owner-session nonce or revoked current session holds before all seller actions',async()=>{
 const f=fixture({ownerNonceMismatch:true});assert.equal((await f.request('POST','begin')).statusCode,503);assert.deepEqual(f.sqlCalls,[]);
 const g=fixture();g.revoke();assert.equal((await g.request('POST','begin')).statusCode,503);assert.deepEqual(g.sqlCalls,[]);assert.deepEqual(g.providerPosts,[]);
});
test('RPC result fields bind owner/session/mode/fixture/operation/nonce and actual result shape',async()=>{
 const mutations=[v=>({...v,requestId:OTHER}),v=>({...v,ownerId:OTHER}),v=>({...v,sessionId:OTHER}),v=>({...v,mode:'seller-login'}),v=>({...v,fixtureId:OTHER}),v=>({...v,operation:'claim'}),v=>({...v,extra:true}),v=>({...v,result:{...v.result,extra:true}})];
 for(const mutateEnvelope of mutations){const f=fixture({mutateEnvelope});assert.equal((await f.request('POST','begin')).statusCode,503);assert.deepEqual(f.providerPosts,[]);}
});
test('a stale claim acknowledgment consumes no local dispatch capability even if fake DB claim committed',async()=>{
 const f=fixture({mutateEnvelope:(v,b)=>b.p_operation==='claim'?{...v,requestId:OTHER}:v});
 assert.equal((await f.request('POST','begin')).statusCode,503);assert.equal(f.phase,'dispatched');assert.deepEqual(f.providerPosts,[]);
 assert.equal((await f.request('POST','begin')).statusCode,503);assert.deepEqual(f.providerPosts,[]);assert.deepEqual(f.writes,['claim']);
});
test('lost claim/create/save acknowledgment preserves the original and never recreates it',async()=>{
 for(const key of ['lostClaim','lostCreate','lostSave']){
  const f=fixture({[key]:true}),r=await f.request('POST','begin');assert.equal(r.statusCode,503,r.body);assert(!r.body.includes(f.restrictedKey));
  assert.equal((await f.request('POST','begin')).statusCode,503);assert.equal(f.providerPosts.filter(v=>v==='/v2/core/accounts').length,key==='lostClaim'?0:1);
  assert.equal(f.phase,key==='lostSave'?'known':'dispatched');assert.equal(f.providerPosts.filter(v=>v==='/v2/core/account_links').length,0);
  if(key==='lostSave')assert.equal((await f.request('POST','refresh')).statusCode,303);
 }
});
test('actual platform/mode and strict wire provenance must pass before a claim',async()=>{
 for(const options of [{wrongPlatform:true},{liveBalance:true},{providerHeaders:{'stripe-version':'fictional-unpinned'}},{providerHeaders:{age:'2'}},{sqlHeaders:{'x-cache':'HIT'}},
  {providerStatus:NaN},{providerStatus:'200'},{providerStatus:200.5},{providerOk:'true'}]){
  const f=fixture(options);assert.equal((await f.request('POST','begin')).statusCode,503);assert.equal(f.phase,'prepared');assert.deepEqual(f.writes,[]);assert.deepEqual(f.providerPosts,[]);
 }
});
test('owner revocation after the account POST prevents save/link without discarding the original unknown',async()=>{
 const f=fixture({revokeAfterCreate:true});assert.equal((await f.request('POST','begin')).statusCode,503);assert.equal(f.phase,'dispatched');
 assert.deepEqual(f.providerPosts,['/v2/core/accounts']);assert.deepEqual(f.writes,['claim']);
});
test('body parsing, auth and all awaited work share one original budget',async()=>{
 const f=fixture({event(name,_data,c){if(name==='owner:user')c.advance(600);}});
 const stream=Readable.from((async function*(){yield Buffer.from('action=');f.advance(4500);yield Buffer.from('begin');})());
 assert.equal((await f.request('POST','begin',{stream})).statusCode,503);assert.equal(f.calls.filter(v=>v==='owner:user').length,1);assert(!f.calls.includes('owner:session'));assert.deepEqual(f.sqlCalls,[]);assert.deepEqual(f.providerPosts,[]);
});
test('rollback and invalid monotonic movement hold; an expired owner token cannot outlive the request scope',async()=>{
 for(const movement of [[-1,1],[1,-1],[5000,5000]]){
  let changed=false;const f=fixture({event(name,_data,c){if(name==='owner:user'&&!changed){changed=true;c.advance(...movement);}}});
  assert.equal((await f.request('POST','begin')).statusCode,503);assert.deepEqual(f.sqlCalls,[]);
 }
 const initial=Date.UTC(2026,10,13,20,0,0),f=fixture({tokenExp:initial/1000+1,event(name,_data,c){if(name==='sql:before')c.advance(1000);}});
 assert.equal((await f.request('POST','begin')).statusCode,503);assert.deepEqual(f.providerPosts,[]);
});
test('deadline crossed during a known account read blocks protection and private link delivery',async()=>{
 for(const op of ['observe','refresh']){
  const f=fixture({phase:'known',event(name,data,c){if(name==='provider:before'&&data.path==='/v2/core/accounts/'+ACCOUNT)c.advance(5000);}});
  const r=await f.request('POST',op);assert.equal(r.statusCode,503);assert.deepEqual(f.writes,[]);assert.equal(r.headers.location,undefined);
 }
});
test('parallel seller platform reads share one branded operation without nested-owner busy failures',async()=>{
 const f=fixture({phase:'known'}),r=await f.request('POST','refresh');assert.equal(r.statusCode,303,r.body);
 assert(f.calls.includes('GET /v1/account'));assert(f.calls.includes('GET /v1/balance'));assert.deepEqual(f.writes,[]);
 assert.equal(new Set(f.sqlCalls.map(v=>v.p_request)).size,f.sqlCalls.length);
});
test('two independent runtime instances still rely on one shared durable fictional claim',async()=>{
 const f=fixture(),second=f.build(),results=await Promise.all([f.request('POST','begin'),f.request('POST','begin',{instance:second})]);
 assert.deepEqual(results.map(v=>v.statusCode).sort(),[303,503]);assert.equal(f.providerPosts.filter(v=>v==='/v2/core/accounts').length,1);assert.deepEqual(f.writes,['claim','save']);
});
test('a stalled request body is bounded before any owner or seller authority', {timeout:12000},async()=>{
 const f=fixture(),stream={ [Symbol.asyncIterator](){return {next(){return new Promise(()=>{});},return(){return Promise.resolve({done:true});}};}};
 const start=performance.now(),r=await f.request('POST','begin',{stream});assert.equal(r.statusCode,503);assert(performance.now()-start>=4500);assert.deepEqual(f.calls,[]);
});
test('a delayed SQL claim acknowledgment after expiry never dispatches the provider', {timeout:12000},async()=>{
 const f=fixture({hangSql:'claim'}),r=await f.request('POST','begin');assert.equal(r.statusCode,503);assert.equal(f.phase,'dispatched');assert.deepEqual(f.providerPosts,[]);
 f.releaseRpc();await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(f.providerPosts,[]);assert.deepEqual(f.writes,['claim']);
});
test('a stalled account-create response body is fenced; retained late work cannot save or emit Location', {timeout:12000},async()=>{
 const f=fixture({hangProviderBody:true}),r=await f.request('POST','begin');assert.equal(r.statusCode,503);assert.equal(f.phase,'dispatched');assert.equal(r.headers.location,undefined);
 f.releaseProviderBody();await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(f.writes,['claim']);assert.deepEqual(f.providerPosts,['/v2/core/accounts']);assert.equal(r.headers.location,undefined);
});
test('passive-page final commit is still fenced by the original scope',async()=>{
 const f=fixture(),r=response(),set=r.setHeader.bind(r);let advanced=false;
 r.setHeader=(name,value)=>{set(name,value);if(name==='Content-Type'&&value==='text/html; charset=utf-8'&&!advanced){advanced=true;f.advance(5000);}};
 const result=await f.request('GET',null,{response:r});assert.equal(result.statusCode,503);assert(!result.body.includes('<html'));assert.deepEqual(f.sqlCalls,[]);
});
test('expired unsent redirects are cleared before a held response; failed cleanup closes the connection',async()=>{
 for(const failCleanup of [false,true]){
  const f=fixture({phase:'known'}),r=response(),set=r.setHeader.bind(r);let advanced=false;
  r.setHeader=(name,value)=>{set(name,value);if(name==='Location'&&!advanced){advanced=true;f.advance(5000);}};
  if(failCleanup)r.removeHeader=()=>{throw Error('Fictional failed header cleanup');};
  const result=await f.request('POST','refresh',{response:r});assert.equal(result.writableEnded,true);
  if(failCleanup){assert.equal(result.destroyed,true);assert.equal(result.body,'');assert.equal(result.headersSent,false);}
  else{assert.equal(result.statusCode,503);assert.equal(result.headers.location,undefined);assert(!result.body.includes('accounts.stripe.com'));assert.match(result.body,/held/);}
  assert.deepEqual(f.providerPosts,['/v2/core/account_links']);assert.deepEqual(f.writes,[]);
 }
 const f=fixture(),r=response();delete r.removeHeader;
 assert.equal((await f.request('POST','begin',{response:r})).statusCode,503);assert.deepEqual(f.sqlCalls,[]);assert.deepEqual(f.providerPosts,[]);
});
test('source API exposes no direct action, credentials or seller impersonation callback',async()=>{
 const f=fixture({phase:'known'}),r=await f.request('POST','observe');assert.equal(r.statusCode,200);assert(!r.body.includes(f.serverKey));assert(!r.body.includes(f.publishableKey));assert(!r.body.includes(f.restrictedKey));assert(!r.body.includes(SESSION));assert(!r.body.includes(OWNER));
 assert.equal(MODE,'owner-operated-fictional-rehearsal');assert.throws(()=>globalThis.fetch('https://example.invalid'),/Real network prohibited/);
});
