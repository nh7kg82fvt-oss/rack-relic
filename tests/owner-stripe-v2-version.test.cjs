'use strict';
// Synthetic streams and HTTP/Auth/RPC fixtures only. No credentials or provider requests.
const assert=require('node:assert/strict');
const {Readable}=require('node:stream');
const {createHash}=require('node:crypto');
const {createSellerGetPreflight,SellerGetPreflightHeld,ACCOUNT,API_VERSION,LIST_PATH}=require('../server/seller_get_preflight.cjs');
const {createOwnerStripeWireCheck,PATH}=require('../server/owner_stripe_wire_check.cjs');
const {fixture,wire,response,OWNER}=require('./helpers/owner-practice-runtime-fixture.cjs');
const NOW=Date.UTC(2026,10,21,20),ORIGIN='https://api.stripe.com';
const PATHS=['/v1/account','/v1/balance',LIST_PATH,'/v1/account','/v1/balance'];
const KEY=['rk','test','FictionalVersionOnly'].join('_');
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');

function direct(options={}){
 let wall=NOW,mono=100;
 const calls=[],hashes=[];
 const fetchImpl=async(url,init)=>{
  const index=calls.length,path=url.slice(ORIGIN.length);
  calls.push({url,method:init.method,headers:{...init.headers},bodyPresent:Object.hasOwn(init,'body')});
  assert.equal(url,ORIGIN+PATHS[index]);assert.equal(init.method,'GET');assert.equal(Object.hasOwn(init,'body'),false);
  assert.equal(init.headers.Authorization,'Bearer '+KEY);assert.equal(init.headers['Stripe-Version'],API_VERSION);
  assert.equal(init.headers['Accept-Encoding'],'identity');assert.equal(init.redirect,'manual');assert.equal(init.cache,'no-store');
  assert.equal(init.credentials,'omit');assert.equal(init.referrerPolicy,'no-referrer');
  for(const key of ['Stripe-Account','Stripe-Context','Idempotency-Key'])assert.equal(Object.hasOwn(init.headers,key),false);
  let value=path==='/v1/account'?{object:'account',id:ACCOUNT,privateDecoy:KEY}:path==='/v1/balance'
   ?{object:'balance',livemode:false,available:[{amount:765432,currency:'usd'}]}:{data:[],next_page_url:null,previous_page_url:null};
  if(options.value)value=options.value({index,path,value});
  const bytes=Buffer.from(JSON.stringify(value));hashes.push(digest(bytes));
  const headers=new Headers({'content-type':'application/json','content-length':String(bytes.length),date:new Date(wall).toUTCString(),
   'stripe-version':API_VERSION,'request-id':'req_FictionalVersion'+index});
  if(index===2&&options.v2Echo===null)headers.delete('stripe-version');
  else if(index===2&&Object.hasOwn(options,'v2Echo'))headers.set('stripe-version',options.v2Echo);
  const result={status:200,ok:true,url,redirected:false,headers,
   body:new ReadableStream({start(controller){controller.enqueue(Uint8Array.from(bytes));controller.close();}})};
  if(options.change)await options.change({index,path,init,result,setClocks:(w,m)=>{wall=w;mono=m;}});
  return result;
 };
 const observer=createSellerGetPreflight({enabled:true,secretKey:KEY,fetchImpl,clock:()=>wall,monotonicClock:()=>mono});
 return{calls,hashes,observer,run:()=>observer.run(new AbortController().signal)};
}

function mounted(options={}){
 const f=fixture(),provider=[];
 const env={...f.settings,RACK_RELIC_TEST_REFUNDS_ENABLED:'false',RACK_RELIC_TEST_REFUND_REQUESTS_ENABLED:'false',
  RACK_RELIC_TEST_CHECKOUT_ENABLED:'false',RACK_RELIC_TEST_SUPABASE_SERVER_KEY:f.serverKey,
  RACK_RELIC_TEST_SUPABASE_PUBLISHABLE_KEY:f.publishableKey,RACK_RELIC_STRIPE_WIRE_PREFLIGHT_ENABLED:'true',
  RACK_RELIC_STRIPE_WIRE_PREFLIGHT_BINDING:JSON.stringify({version:'rr-owner-stripe-wire-window-v1',ownerId:OWNER,
   notBefore:f.now-1000,notAfter:f.now+1199000}),RACK_RELIC_STRIPE_WIRE_READ_KEY:f.restrictedKey};
 const fetchImpl=async(url,init)=>{
  if(!url.startsWith(ORIGIN+'/'))return f.fetchImpl(url,init);
  const index=provider.length,path=url.slice(ORIGIN.length);provider.push(path);
  assert.equal(path,PATHS[index]);assert.equal(init.method,'GET');assert.equal(Object.hasOwn(init,'body'),false);
  assert.equal(init.headers['Stripe-Version'],API_VERSION);assert.equal(init.headers.Authorization,'Bearer '+f.restrictedKey);
  const value=path==='/v1/account'?{object:'account',id:ACCOUNT}:path==='/v1/balance'
   ?{object:'balance',livemode:false}:{data:[],next_page_url:null,previous_page_url:null};
  const result=wire(url,value,f.now,{provider:true,headers:{'request-id':'req_FictionalMountedVersion'+index}});
  if(index===2)result.headers.delete('stripe-version');
  if(options.change)await options.change({index,path,result,f});
  return result;
 };
 const mount=createOwnerStripeWireCheck({env,fetchImpl,clock:f.ports.clock,monotonicClock:f.ports.monotonicClock});
 async function post(){
  const req=Readable.from([Buffer.from('action=wire-check')]);req.url=PATH;req.method='POST';
  req.headers={cookie:f.cookie(),origin:'https://rack-relic-git-codex-prelaunch-seller-protections-rack-relic.vercel.app',
   'sec-fetch-site':'same-origin','content-type':'application/x-www-form-urlencoded'};
  const res=response();await mount.handler(req,res);return res;
 }
 return{f,provider,post};
}
function noWrites(t){assert.deepEqual(t.f.writes,[]);assert.deepEqual(t.f.sqlCalls,[]);assert.deepEqual(t.f.providerPosts,[]);assert.equal(t.f.phase,'prepared');}
async function held(t,code,count){
 let error;try{await t.run();assert.fail('Expected a held diagnostic');}catch(e){error=e;}
 assert(error instanceof SellerGetPreflightHeld);assert.equal(error.code,code);assert.equal(t.calls.length,count);return error;
}
const checks=[
 ['missing echo on the exact v2 list GET retains null and records request-only evidence through five reads',async()=>{
  const t=direct({v2Echo:null}),out=await t.run();assert.equal(t.calls.length,5);
  assert.equal(out.requestedStripeVersion,API_VERSION);assert.equal(out.allResponseVersionsEchoed,false);
  const e=out.observations[2];assert.equal(e.stripeVersion,null);assert.equal(e.requestedStripeVersion,API_VERSION);
  assert.equal(e.responseVersionVerified,false);assert.equal(e.versionEvidence,'request-header-only');
  assert.deepEqual(out.observations.map(x=>x.responseSha256),t.hashes);assert(out.observations.every(x=>x.responseBytes>0));
  assert(out.observations.filter((_,i)=>i!==2).every(x=>x.responseVersionVerified&&x.versionEvidence==='request-and-response-header'));
 }],
 ['an exact v2 echo remains independently recorded as matched response evidence',async()=>{
  const t=direct(),out=await t.run();assert.equal(t.calls.length,5);assert.equal(out.allResponseVersionsEchoed,true);
  assert(out.observations.every(x=>x.stripeVersion===API_VERSION&&x.requestedStripeVersion===API_VERSION&&
   x.responseVersionVerified&&x.versionEvidence==='request-and-response-header'));
 }],
 ['explicit different, empty or malformed v2 version evidence cannot use the missing-header exception',async()=>{
  for(const v2Echo of ['2026-09-30.endive','',' ',API_VERSION+',other']){
   const t=direct({v2Echo}),error=await held(t,'returned_version',3),e=error.evidence[2];
   assert.equal(e.stripeVersion,'UNEXPECTED');assert.equal(e.requestedStripeVersion,API_VERSION);
   assert.equal(e.responseVersionVerified,false);assert.equal(e.versionEvidence,'unverified');assert.equal(e.responseSha256,undefined);
  }
 }],
 ['each surrounding v1 read still requires its exact returned-version header',async()=>{
  for(const position of [0,1,3,4]){
   const t=direct({v2Echo:null,change:({index,result})=>{if(index===position)result.headers.delete('stripe-version');}});
   const error=await held(t,'returned_version',position+1),e=error.evidence.at(-1);
   assert.equal(e.stripeVersion,null);assert.equal(e.responseVersionVerified,false);assert.equal(e.versionEvidence,'unverified');
  }
 }],
 ['missing v2 echo does not relax Date freshness',async()=>{
  for(const offset of [-31000,31000]){
   const t=direct({v2Echo:null,change:({index,result})=>{if(index===2)result.headers.set('date',new Date(NOW+offset).toUTCString());}});
   const error=await held(t,'returned_date',3);assert.equal(error.evidence[2].stripeVersion,null);
  }
 }],
 ['missing v2 echo does not relax actual unique request IDs',async()=>{
  for(const id of [null,'req_FictionalVersion0','not-a-request-id']){
   const t=direct({v2Echo:null,change:({index,result})=>{if(index===2)id===null?result.headers.delete('request-id'):result.headers.set('request-id',id);}});
   await held(t,'request_id',3);
  }
 }],
 ['v2 HTTP failures, a redirect or a changed response URL still hold before body acceptance',async()=>{
  for(const change of [r=>r.status=401,r=>r.ok=false,r=>r.redirected=true,r=>r.url+='&changed=1']){
   const t=direct({v2Echo:null,change:({index,result})=>{if(index===2)change(result);}});
   const error=await held(t,'response_boundary',3);assert.equal(error.evidence.length,2);
  }
 }],
 ['v2 cache, encoding, content-type and byte-length protections remain enforced with no echo',async()=>{
  for(const [key,value]of [['age','1'],['content-encoding','gzip'],['content-type','text/html'],['content-length','1'],['content-length','65537']]){
   const t=direct({v2Echo:null,change:({index,result})=>{if(index===2)result.headers.set(key,value);}});
   await held(t,'wire_held',3);
  }
 }],
 ['v2 list shape and TEST recipient identity checks still hold malformed or foreign-mode data',async()=>{
  const good={object:'v2.core.account',id:'acct_FictionalUnboundVersion',livemode:false,applied_configurations:['recipient']};
  for(const [list,code]of [[[], 'list_shape'],[{data:[],extra:true},'list_shape'],[{data:[good,good]},'list_shape'],
   [{data:[{...good,livemode:true}]},'list_mode'],[{data:[{...good,id:ACCOUNT}]},'list_mode'],
   [{data:[{...good,applied_configurations:['merchant']}]},'list_mode'],[{data:[],next_page_url:'https://foreign.example.invalid/page'},'list_shape']]){
   const t=direct({v2Echo:null,value:({index,value})=>index===2?list:value});await held(t,code,3);
  }
 }],
 ['final platform and balance reads cannot be replaced by the successful v2 observation',async()=>{
  for(const [position,code,change]of [[3,'platform_identity',v=>({...v,id:'acct_FictionalOtherVersion'})],[4,'platform_mode',v=>({...v,livemode:true})]]){
   const t=direct({v2Echo:null,value:({index,value})=>index===position?change(value):value});await held(t,code,position+1);
  }
 }],
 ['successful request-only version evidence is minimized and grants no seller or financial authority',async()=>{
  const t=direct({v2Echo:null,value:({index,value})=>index===2?{data:[{object:'v2.core.account',id:'acct_FictionalPrivateVersion',
   livemode:false,applied_configurations:['recipient'],contact_email:'private-version@example.invalid'}],next_page_url:'/v2/core/accounts?page=fictional'}:value});
  const out=await t.run(),text=JSON.stringify(out);assert.equal(out.returnedItemCount,1);assert.equal(out.nextPagePresent,true);
  for(const key of ['inventoryComplete','nativeExecutionVerified','sellerReadinessVerified','actionGrant','futurePostHeaderOrTimingGuaranteed','rawBodiesPersisted'])assert.equal(out[key],false);
  for(const decoy of [KEY,'private-version@example.invalid','acct_FictionalPrivateVersion','765432','available'])assert.equal(text.includes(decoy),false);
  assert(Object.isFrozen(out.observations[2]));await assert.rejects(t.run(),e=>e.code==='not_available');assert.equal(t.calls.length,5);
 }],
 ['a deadline reached on the v2 read still consumes the local attempt without a fourth request',async()=>{
  const t=direct({v2Echo:null,change:({index,setClocks})=>{if(index===2)setClocks(NOW+5000,5100);}});
  await held(t,'wire_held',3);await assert.rejects(t.run(),e=>e.code==='not_available');assert.equal(t.calls.length,3);
 }],
 ['the owner mount completes five synthetic reads with honest v2 missing-echo evidence and no writes',async()=>{
  const t=mounted(),res=await t.post();assert.equal(res.statusCode,200,res.body);const body=JSON.parse(res.body);
  assert.equal(body.state,'observed');assert.deepEqual(t.provider,PATHS);assert.equal(body.observation.allResponseVersionsEchoed,false);
  assert.equal(body.observation.observations[2].stripeVersion,null);assert.equal(body.observation.observations[2].versionEvidence,'request-header-only');
  assert.equal(body.observation.observations[2].responseVersionVerified,false);assert.equal(body.observation.observations[2].responseSha256.length,64);
  for(const key of ['providerWrites','sellerReadinessVerified','writePermissionsVerified','launchClearance','durableCrossRestartOneShot'])assert.equal(body[key],false);
  for(const secret of [t.f.restrictedKey,t.f.serverKey,t.f.publishableKey])assert.equal(res.body.includes(secret),false);
  noWrites(t);
 }],
 ['revocation or expiry at the owner boundary after v2 still blocks the remaining reads and acceptance',async()=>{
  for(const expire of [false,true]){
   const t=mounted({change:({index,f})=>{if(index===2)expire?f.advance(5001):f.revoke();}}),res=await t.post();
   assert.equal(res.statusCode,expire?503:401,res.body);assert.equal(t.provider.length,3);
   assert.equal(JSON.parse(res.body).state,undefined);assert.equal(res.body.includes('"state":"observed"'),false);noWrites(t);
  }
 }]
];
async function isolated(run){const original=globalThis.fetch;let unexpected=0;globalThis.fetch=()=>{unexpected++;throw Error('Real networking is forbidden in these checks');};try{await run();}finally{globalThis.fetch=original;assert.equal(unexpected,0);}}
async function runFocused(){const results=[];for(const [name,run]of checks){await isolated(run);results.push({name,passed:true});}return{kind:'new-v2-request-version-evidence-synthetic-checks',pass:results.length,fail:0,realProviderRequests:0,results};}
if(require.main===module){const {test}=require('node:test');for(const [name,run]of checks)test(name,()=>isolated(run));}
module.exports={runFocused};
