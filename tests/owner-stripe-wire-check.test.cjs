'use strict';
// New mount/composition checks only. All HTTP/Auth/RPC responses are fictional.
const assert=require('node:assert/strict');
const {Readable}=require('node:stream');
const {fixture,wire,response,OWNER,OTHER}=require('./helpers/owner-practice-runtime-fixture.cjs');
const {createOwnerStripeWireCheck,PATH}=require('../server/owner_stripe_wire_check.cjs');
const {ENV,API_VERSION}=require('../server/owner_practice_runtime.cjs');
const {LIST_PATH}=require('../server/seller_get_preflight.cjs');
function setup(options={}){
 const f=fixture(),provider=[];
 const window={version:'rr-owner-stripe-wire-window-v1',ownerId:OWNER,notBefore:f.now-1000,notAfter:f.now+1199000};
 const env={...f.settings,RACK_RELIC_TEST_REFUNDS_ENABLED:'false',RACK_RELIC_TEST_REFUND_REQUESTS_ENABLED:'false',
  RACK_RELIC_TEST_CHECKOUT_ENABLED:'false',RACK_RELIC_TEST_SUPABASE_SERVER_KEY:f.serverKey,RACK_RELIC_TEST_SUPABASE_PUBLISHABLE_KEY:f.publishableKey,
  RACK_RELIC_STRIPE_WIRE_PREFLIGHT_ENABLED:'true',RACK_RELIC_STRIPE_WIRE_PREFLIGHT_BINDING:JSON.stringify(window),RACK_RELIC_STRIPE_WIRE_READ_KEY:f.restrictedKey,...options.env};
 const fetchImpl=async(url,init)=>{
  if(!url.startsWith('https://api.stripe.com/'))return f.fetchImpl(url,init);
  provider.push({url,method:init.method,headers:{...init.headers},bodyPresent:Object.hasOwn(init,'body')});
  assert.equal(init.method,'GET');assert.equal(init.redirect,'manual');assert.equal(init.headers.Authorization,'Bearer '+f.restrictedKey);
  assert.equal(init.headers['Accept-Encoding'],'identity');assert.equal(init.headers['Stripe-Version'],API_VERSION);
  assert.equal(init.headers['Stripe-Account'],undefined);assert.equal(init.headers.apikey,undefined);
  const path=url.slice('https://api.stripe.com'.length);
  const value=path==='/v1/account'?{object:'account',id:ENV.accountId}:path==='/v1/balance'?{object:'balance',livemode:false}:path===LIST_PATH?{data:[],next_page_url:null,previous_page_url:null}:assert.fail('Unexpected provider path');
  const r=wire(url,value,f.now,{provider:true,headers:{'request-id':'req_FictionalWire'+provider.length}});
  if(options.provider)await options.provider({url,init,response:r,fixture:f,provider});
  return r;
 };
 const mount=createOwnerStripeWireCheck({env,fetchImpl,clock:f.ports.clock,monotonicClock:f.ports.monotonicClock});
 async function request(method='POST',extra={}){
  const req=Readable.from(method==='POST'?[Buffer.from(extra.raw??'action=wire-check')]:[]);
  req.url=extra.url??PATH;req.method=method;
  req.headers={cookie:f.cookie(extra.cookies),origin:ENV.previewOrigin,'sec-fetch-site':'same-origin','content-type':'application/x-www-form-urlencoded',...extra.headers};
  if(Object.hasOwn(extra,'parsedBody'))req.body=extra.parsedBody;
  const res=response();await mount.handler(req,res);return res;
 }
 return {f,env,mount,request,provider};
}
function noMutation(t){assert.deepEqual(t.f.writes,[]);assert.deepEqual(t.f.sqlCalls,[]);assert.deepEqual(t.f.providerPosts,[]);assert(t.provider.every(r=>r.method==='GET'&&!r.bodyPresent));}
const checks=[
 ['OFF, wrong environment, missing binding, financial conflicts and unrestricted keys cause no I/O',async()=>{
  for(const env of [
   {RACK_RELIC_STRIPE_WIRE_PREFLIGHT_ENABLED:'false'},
   {VERCEL_ENV:'production'},
   {VERCEL_GIT_COMMIT_REF:'different-branch'},
   {RACK_RELIC_STRIPE_WIRE_PREFLIGHT_BINDING:''},
   {RACK_RELIC_TEST_ADMIN_OWNER_ID:OTHER},
   {RACK_RELIC_TEST_CHECKOUT_ENABLED:'true'},
   {RACK_RELIC_OWNER_PRACTICE_ENABLED:'true'},
   {RACK_PRACTICE_ENABLED:'true'},
   {RACK_PRACTICE_REFUND_ENABLED:'true'},
   {RACK_RELIC_STRIPE_WIRE_READ_KEY:['sk','test','NeverIssued'].join('_')}
  ]){const t=setup({env});assert.equal(t.mount.ready,false);assert.equal((await t.request()).statusCode,404);assert.deepEqual(t.f.calls,[]);assert.deepEqual(t.provider,[]);noMutation(t);}
 }],
 ['GET checks only the current owner and offers an explicit read-only form',async()=>{
  const t=setup(),r=await t.request('GET');assert.equal(r.statusCode,200,r.body);assert.match(r.body,/five read-only/);assert.match(r.body,/per request, not a durable cross-restart claim/);
  assert.equal(t.provider.length,0);assert(t.f.ownerReplies.length>0);assert.equal(r.headers['set-cookie'],undefined);assert.match(r.headers['cache-control'],/no-store/);noMutation(t);
 }],
 ['POST reuses five fixed GETs and preserves actual response evidence without minting action authority',async()=>{
  const t=setup(),r=await t.request();assert.equal(r.statusCode,200,r.body);const value=JSON.parse(r.body);
  assert.equal(value.state,'observed');assert.equal(value.providerWrites,false);assert.equal(value.writePermissionsVerified,false);assert.equal(value.sellerReadinessVerified,false);assert.equal(value.launchClearance,false);assert.equal(value.durableCrossRestartOneShot,false);
  assert.deepEqual(t.provider.map(x=>x.url.slice('https://api.stripe.com'.length)),['/v1/account','/v1/balance',LIST_PATH,'/v1/account','/v1/balance']);
  assert.equal(value.observation.nativeExecutionVerified,false);assert.equal(value.observation.actionGrant,false);assert.equal(value.observation.observations.length,5);assert(value.observation.observations.every(x=>x.stripeVersion===API_VERSION&&x.responseSha256.length===64));
  for(const secret of [t.f.restrictedKey,t.f.serverKey,t.f.publishableKey])assert(!r.body.includes(secret));noMutation(t);
 }],
 ['Missing version and source transport failures hold, with no fabricated header or leaked error secret',async()=>{
  const t=setup({provider:({response})=>response.headers.delete('stripe-version')}),r=await t.request();assert.equal(r.statusCode,503);const value=JSON.parse(r.body);assert.equal(value.state,'held');assert.equal(value.observation.code,'returned_version');assert.equal(value.observation.observations[0].stripeVersion,null);assert.equal(t.provider.length,1);noMutation(t);
  const a=setup({provider:({fixture})=>{throw Error('Never expose '+fixture.restrictedKey);}}),b=await a.request();assert.equal(b.statusCode,503);assert(!b.body.includes(a.f.restrictedKey));assert.equal(a.provider.length,1);noMutation(a);
 }],
 ['Revocation after the first provider response blocks every later provider request',async()=>{
  const t=setup({provider:({fixture})=>fixture.revoke()}),r=await t.request();assert.equal(r.statusCode,401);assert.equal(t.provider.length,1);assert(!r.body.includes('"state":"observed"'));noMutation(t);
 }],
 ['Wall/elapsed expiry and clock rollback cannot accept late evidence',async()=>{
  for(const delta of [5001,-1]){const t=setup({provider:({fixture})=>fixture.advance(delta,delta>0?delta:0)}),r=await t.request();assert.equal(r.statusCode,503);assert.equal(t.provider.length,1);noMutation(t);}
 }],
 ['Nonowner, cross-origin, wrong method/query and accessor/extra-field bodies cannot reach Stripe',async()=>{
  const variants=[['POST',{cookies:{actor:OTHER}}],['POST',{headers:{origin:'https://other.example.invalid'}}],['PUT',{}],['POST',{url:PATH+'?action=wire-check'}],['POST',{raw:'action=wire-check&extra=1'}],['POST',{parsedBody:{action:'wire-check',extra:1}}]];
  for(const [method,extra]of variants){const t=setup(),r=await t.request(method,extra);assert(r.statusCode>=400,r.body);assert.equal(t.provider.length,0);noMutation(t);}
  let touched=0;const body={};Object.defineProperty(body,'action',{enumerable:true,get(){touched++;return 'wire-check';}});const t=setup(),r=await t.request('POST',{parsedBody:body});assert.equal(r.statusCode,400);assert.equal(touched,0);assert.equal(t.provider.length,0);noMutation(t);
 }],
 ['Repeated explicit POSTs remain reads, disclose per-request limits and never consume the seller claim',async()=>{
  const t=setup();for(let i=0;i<2;i++){const r=await t.request();assert.equal(r.statusCode,200,r.body);assert.equal(JSON.parse(r.body).durableCrossRestartOneShot,false);}assert.equal(t.provider.length,10);assert.equal(t.f.phase,'prepared');noMutation(t);
 }]
];
async function runFocused(){const original=globalThis.fetch;let unexpected=0;globalThis.fetch=()=>{unexpected++;throw Error('Real networking is forbidden in these checks');};const results=[];try{for(const [name,run]of checks){try{await run();}catch(error){error.message=name+': '+error.message;throw error;}results.push({name,passed:true});}assert.equal(unexpected,0);return {kind:'new-readonly-mount-synthetic-composition',pass:results.length,fail:0,realProviderRequests:0,results};}finally{globalThis.fetch=original;}}
if(require.main===module){const {test}=require('node:test');test('new owner-only read-only Stripe mount composition',runFocused);}
module.exports={runFocused};
