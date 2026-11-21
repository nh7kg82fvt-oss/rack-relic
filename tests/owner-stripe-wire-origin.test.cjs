'use strict';
// Synthetic requests to the actual handler; no browser or provider acceptance.
const assert=require('node:assert/strict');
const {test}=require('node:test');
const {Readable}=require('node:stream');
const {fixture,wire,response,OWNER,OTHER}=require('./helpers/owner-practice-runtime-fixture.cjs');
const {createOwnerStripeWireCheck,PATH}=require('../server/owner_stripe_wire_check.cjs');
const {ENV,API_VERSION}=require('../server/owner_practice_runtime.cjs');
const {LIST_PATH}=require('../server/seller_get_preflight.cjs');
const EXPECTED_PATHS=['/v1/account','/v1/balance',LIST_PATH,'/v1/account','/v1/balance'];

function setup({env={},providerError=false}={}){
 const f=fixture(),provider=[];
 const settings={...f.settings,RACK_RELIC_TEST_REFUNDS_ENABLED:'false',RACK_RELIC_TEST_REFUND_REQUESTS_ENABLED:'false',
  RACK_RELIC_TEST_CHECKOUT_ENABLED:'false',RACK_RELIC_TEST_SUPABASE_SERVER_KEY:f.serverKey,
  RACK_RELIC_TEST_SUPABASE_PUBLISHABLE_KEY:f.publishableKey,RACK_RELIC_STRIPE_WIRE_PREFLIGHT_ENABLED:'true',
  RACK_RELIC_STRIPE_WIRE_PREFLIGHT_BINDING:JSON.stringify({version:'rr-owner-stripe-wire-window-v1',ownerId:OWNER,
   notBefore:f.now-1000,notAfter:f.now+1199000}),RACK_RELIC_STRIPE_WIRE_READ_KEY:f.restrictedKey,...env};
 const fetchImpl=async(url,init)=>{
  if(!url.startsWith('https://api.stripe.com/'))return f.fetchImpl(url,init);
  const path=url.slice('https://api.stripe.com'.length);provider.push(path);
  assert.equal(path,EXPECTED_PATHS[provider.length-1]);assert.equal(init.method,'GET');
  assert.equal(Object.hasOwn(init,'body'),false);assert.equal(init.redirect,'manual');
  assert.equal(init.headers.Authorization,'Bearer '+f.restrictedKey);
  assert.equal(init.headers['Stripe-Version'],API_VERSION);assert.equal(init.headers['Accept-Encoding'],'identity');
  for(const header of ['Stripe-Account','Stripe-Context','Idempotency-Key'])assert.equal(Object.hasOwn(init.headers,header),false);
  if(providerError)throw Error('Fictional provider transport failure');
  const value=path==='/v1/account'?{object:'account',id:ENV.accountId}
   :path==='/v1/balance'?{object:'balance',livemode:false}:{data:[],next_page_url:null,previous_page_url:null};
  return wire(url,value,f.now,{provider:true,headers:{'request-id':'req_FictionalOrigin'+provider.length}});
 };
 const mount=createOwnerStripeWireCheck({env:settings,fetchImpl,clock:f.ports.clock,monotonicClock:f.ports.monotonicClock});
 async function request(method='POST',{headers={},omitHeaders=[],cookies,url=PATH,raw='action=wire-check'}={}){
  const req=Readable.from(method==='POST'?[Buffer.from(raw)]:[]);
  req.url=url;req.method=method;req.headers={cookie:f.cookie(cookies),origin:ENV.previewOrigin,
   'sec-fetch-site':'same-origin','content-type':'application/x-www-form-urlencoded',...headers};
  for(const name of omitHeaders)delete req.headers[name];
  const res=response();await mount.handler(req,res);return res;
 }
 return {f,provider,request};
}
function noFinancialMutation(t){
 assert.deepEqual(t.f.writes,[]);assert.deepEqual(t.f.sqlCalls,[]);assert.deepEqual(t.f.providerPosts,[]);
 assert.equal(t.f.phase,'prepared');
}
function refusedBeforeIO(t,res){
 assert.equal(res.statusCode,403,res.body);assert.equal(res.headers['referrer-policy'],'no-referrer');
 assert.deepEqual(t.f.calls,[]);assert.deepEqual(t.provider,[]);noFinancialMutation(t);
}

test('wire form GET uses same-origin referrer policy after owner authentication, without Stripe I/O',async()=>{
 const t=setup(),res=await t.request('GET');
 assert.equal(res.statusCode,200,res.body);assert.equal(res.headers['referrer-policy'],'same-origin');
 assert.equal(res.headers['content-type'],'text/html; charset=utf-8');
 assert(res.body.includes('<form method="post" action="'+PATH+'">'));
 assert.match(res.headers['cache-control'],/no-store/);assert.match(res.headers['content-security-policy'],/form-action 'self'/);
 assert.equal(res.headers['set-cookie'],undefined);assert.deepEqual(t.f.calls,['owner:user','owner:session']);
 assert.deepEqual(t.provider,[]);noFinancialMutation(t);
});

test('same-origin form POST retains the five fixed Stripe GETs and the no-referrer result policy',async()=>{
 const t=setup();assert.equal((await t.request('GET')).headers['referrer-policy'],'same-origin');
 const res=await t.request(),body=JSON.parse(res.body);
 assert.equal(res.statusCode,200,res.body);assert.equal(res.headers['referrer-policy'],'no-referrer');
 assert.deepEqual(t.provider,EXPECTED_PATHS);assert.equal(body.state,'observed');
 for(const name of ['providerWrites','sellerReadinessVerified','writePermissionsVerified','launchClearance','durableCrossRestartOneShot'])assert.equal(body[name],false);
 assert.equal(res.headers['set-cookie'],undefined);noFinancialMutation(t);
});

test('null, absent and foreign Origin remain denied before authentication or provider I/O',async()=>{
 for(const options of [{headers:{origin:'null'}},{omitHeaders:['origin']},
  {headers:{origin:'https://other.example.invalid'}},{headers:{origin:ENV.previewOrigin+'/'}}]){
  const t=setup();refusedBeforeIO(t,await t.request('POST',options));
 }
});

test('non-same-origin and absent Fetch Metadata remain denied before any I/O',async()=>{
 for(const site of ['same-site','cross-site','none','']){
  const t=setup();refusedBeforeIO(t,await t.request('POST',{headers:{'sec-fetch-site':site}}));
 }
 const t=setup();refusedBeforeIO(t,await t.request('POST',{omitHeaders:['sec-fetch-site']}));
});

test('nonowner and revoked sessions never receive the form policy or reach Stripe',async()=>{
 for(const method of ['GET','POST']){
  for(const revoked of [false,true]){
   const t=setup();if(revoked)t.f.revoke();
   const res=await t.request(method,revoked?{}:{cookies:{actor:OTHER,refresh:false}});
   assert([401,403].includes(res.statusCode),res.body);assert.equal(res.headers['referrer-policy'],'no-referrer');
   assert.deepEqual(t.provider,[]);assert.equal(res.headers['set-cookie'],undefined);noFinancialMutation(t);
  }
 }
});

test('closed, invalid and failed requests retain no-referrer without relaxing the form guard',async()=>{
 const variants=[
  {config:{env:{RACK_RELIC_STRIPE_WIRE_PREFLIGHT_ENABLED:'false'}},method:'GET',status:404},
  {method:'GET',request:{url:PATH+'?other=1'},status:404},
  {method:'PUT',status:405},
  {request:{headers:{'content-type':'application/json'}},status:415},
  {request:{raw:'action=wire-check&extra=1'},status:400},
  {config:{providerError:true},status:503,providerCount:1}
 ];
 for(const v of variants){
  const t=setup(v.config),res=await t.request(v.method??'POST',v.request);
  assert.equal(res.statusCode,v.status,res.body);assert.equal(res.headers['referrer-policy'],'no-referrer');
  assert.equal(t.provider.length,v.providerCount??0);noFinancialMutation(t);
 }
});
