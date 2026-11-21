'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {createOwnerPracticeMount,createOwnerPracticeMarketplaceMount,reviewedHistoricalRead,RETURN_PATH,BEGIN_PATH}=require('../server/owner_practice_mount.cjs');
const {createTestMarketplaceRuntime}=require('../server/test_marketplace_runtime.cjs');
const {createTestAdminRuntime}=require('../server/test_admin_runtime.cjs');
const {createCommandSessionService}=require('../server/command_session.cjs');
const {TEST_ENVIRONMENTS}=require('../server/test_environment_registry.cjs');
const {fixture,response,FIXTURE,OWNER,OTHER}=require('./helpers/owner-practice-runtime-fixture.cjs');
const A=TEST_ENVIRONMENTS.acceptance,L=TEST_ENVIRONMENTS.legacy;
function environment(f,patch={}){return {...f.settings,RACK_RELIC_TEST_REFUNDS_ENABLED:'false',RACK_RELIC_TEST_REFUND_REQUESTS_ENABLED:'false',
 RACK_RELIC_TEST_CHECKOUT_ENABLED:'false',RACK_RELIC_OWNER_PRACTICE_ENABLED:'true',
 RACK_RELIC_OWNER_PRACTICE_BINDING:JSON.stringify({version:'rr-owner-practice-binding-v1',mode:'owner-operated-fictional-rehearsal',
  ownerId:f.cfg.ownerId,fixtureId:FIXTURE,notBefore:f.cfg.notBefore,notAfter:f.cfg.notAfter}),
 RACK_RELIC_TEST_SUPABASE_SERVER_KEY:f.serverKey,RACK_RELIC_TEST_SUPABASE_PUBLISHABLE_KEY:f.publishableKey,
 RACK_RELIC_OWNER_PRACTICE_STRIPE_KEY:f.restrictedKey,...patch};}
function ports(f,env){return {env,fetchImpl:f.fetchImpl,clock:f.ports.clock,monotonicClock:f.ports.monotonicClock};}
async function call(handler,url,{method='GET',cookie='',body}={}){const r=response();await handler({url,method,headers:{cookie},...(body?{body}:{})},r);return r;}
test('package defaults and incomplete or expired private bindings remain OFF without provider contact',async()=>{
 const f=fixture(),defaults=createOwnerPracticeMount();assert.equal(defaults.localAvailability(),false);
 assert.equal((await call(defaults.beginHandler,BEGIN_PATH)).statusCode,404);
 for(const patch of [{RACK_RELIC_OWNER_PRACTICE_ENABLED:'false'},{RACK_RELIC_OWNER_PRACTICE_BINDING:''},
  {RACK_RELIC_OWNER_PRACTICE_BINDING:'{}'},{RACK_RELIC_OWNER_PRACTICE_STRIPE_KEY:''},{RACK_RELIC_TEST_ADMIN_OWNER_ID:OTHER},
  {VERCEL_ENV:'production'},{RACK_RELIC_TEST_STRIPE_ACCOUNT:L.accountId}]){
  const m=createOwnerPracticeMount(ports(f,environment(f,patch)));assert.equal(m.localAvailability(),false);
  assert.equal((await call(m.beginHandler,BEGIN_PATH)).statusCode,404);
 }
 const m=createOwnerPracticeMount(ports(f,environment(f)));assert.equal(m.localAvailability(),true);f.advance(3600000);assert.equal(m.localAvailability(),false);
 assert.deepEqual(f.calls,[]);assert.deepEqual(f.providerPosts,[]);
});
test('owner confirmation GET authenticates only and never creates or checks seller/provider readiness',async()=>{
 const f=fixture(),env=Object.freeze(environment(f)),before=JSON.stringify(env),m=createOwnerPracticeMount(ports(f,env));
 const r=await f.request('GET',null,{url:BEGIN_PATH,instance:{handler:m.beginHandler}});assert.equal(r.statusCode,200,r.body);
 assert.match(r.body,/<form method="post" action="\/api\/closed-practice-seller\/begin">/);assert.match(r.body,/name="action" value="begin"/);
 assert.match(r.body,/Provider readiness is unverified/);assert.match(r.headers['content-security-policy'],/form-action 'self'/);
 for(const v of [OWNER,FIXTURE,f.serverKey,f.restrictedKey,A.projectUrl])assert.equal(r.body.includes(v),false);
 assert(f.calls.length>0&&f.calls.every(v=>v.startsWith('owner:')));assert.deepEqual(f.sqlCalls,[]);assert.deepEqual(f.providerPosts,[]);
 assert.equal(JSON.stringify(env),before);assert.equal(env.RACK_RELIC_TEST_REFUNDS_ENABLED,'false');assert.equal(env.RACK_RELIC_TEST_CHECKOUT_ENABLED,'false');
 const denied=fixture();const dm=createOwnerPracticeMount(ports(denied,environment(denied)));
 assert.equal((await denied.request('GET',null,{url:BEGIN_PATH,cookies:{actor:OTHER},instance:{handler:dm.beginHandler}})).statusCode,503);
 assert.deepEqual(denied.sqlCalls,[]);assert.deepEqual(denied.providerPosts,[]);
});
test('packaged native begin redirects privately while actual checkout/refund globals stay false',async()=>{
 const f=fixture({ownerId:FIXTURE}),env=Object.freeze(environment(f)),m=createOwnerPracticeMount(ports(f,env));
 assert.equal(m.localAvailability(),true);
 assert.equal((await f.request('POST','begin',{instance:{handler:m.beginHandler},headers:{'content-type':'application/json'},raw:'{}'})).statusCode,415);
 for(const raw of ['action=refresh','action=begin&extra=x','action=begin&action=begin','action=%62egin'])
  assert.equal((await f.request('POST','begin',{instance:{handler:m.beginHandler},raw})).statusCode,400);
 assert.deepEqual(f.providerPosts,[]);
 const r=await f.request('POST','begin',{instance:{handler:m.beginHandler}});assert.equal(r.statusCode,303,r.body);assert.equal(r.body,'');
 assert.match(r.headers.location,/^https:\/\/accounts\.stripe\.com\//);assert.equal(r.headers['set-cookie'],undefined);
 assert.equal((await f.request('POST','begin',{instance:{handler:m.beginHandler}})).statusCode,503);
 assert.equal(f.providerPosts.filter(v=>v==='/v2/core/accounts').length,1);
 assert.equal(env.RACK_RELIC_TEST_REFUNDS_ENABLED,'false');assert.equal(env.RACK_RELIC_TEST_REFUND_REQUESTS_ENABLED,'false');
});
test('new return mount accepts only exact owner path and preserves narrowly reviewed historical callbacks',async()=>{
 const f=fixture(),env=environment(f),m=createOwnerPracticeMarketplaceMount(ports(f,env));
 const owner=await f.request('GET',null,{instance:m});assert.equal(owner.statusCode,200);assert.match(owner.body,/Returning from Stripe does not confirm verification/);
 assert.deepEqual(f.sqlCalls,[]);assert.deepEqual(f.providerPosts,[]);
 const shapes=[RETURN_PATH+'?action=config',RETURN_PATH+'?action=orders',RETURN_PATH+'?code=fictional_code',RETURN_PATH+'?view=cancel',RETURN_PATH+'?view=return&session_id=cs_test_fictional123'];
 for(const url of shapes)assert.equal(reviewedHistoricalRead({method:'GET',url}),true,url);
 for(const url of [RETURN_PATH+'?',RETURN_PATH+'#',A.previewOrigin+RETURN_PATH,RETURN_PATH+'?code=x&code=x',RETURN_PATH+'?code=x&actor='+OWNER,
  RETURN_PATH+'?%63ode=x',RETURN_PATH+'?action=config&action=orders',RETURN_PATH+'?view=return&session_id=cs_live_bad',RETURN_PATH+'?session_id=cs_test_x&view=return',RETURN_PATH+'?action=begin']){
  assert.equal((await call(m.handler,url)).statusCode,400,url);assert.equal(reviewedHistoricalRead({method:'GET',url}),false,url);
 }
 assert.equal(reviewedHistoricalRead({method:'POST',url:RETURN_PATH+'?code=x'}),false);
});
test('legacy branch and existing acceptance read/callback response bytes delegate unchanged',async()=>{
 for(const row of [A,L]){
  const f=fixture(),env=environment(f,{VERCEL_GIT_COMMIT_REF:row.branch,RACK_RELIC_TEST_SUPABASE_URL:row.projectUrl,RACK_RELIC_TEST_STRIPE_ACCOUNT:row.accountId});
  const p=ports(f,env),mounted=createOwnerPracticeMarketplaceMount(p),legacy=createTestMarketplaceRuntime(p);
  const urls=row===A?[RETURN_PATH+'?action=config',RETURN_PATH+'?code=fictional_code',RETURN_PATH+'?view=cancel',RETURN_PATH+'?view=return&session_id=cs_test_x']:
   [RETURN_PATH,RETURN_PATH+'?action=config',RETURN_PATH+'?unrecognized=preserved'];
  for(const url of urls){const a=await call(mounted.handler,url),b=await call(legacy,url);assert.equal(a.statusCode,b.statusCode);assert.equal(a.body,b.body);assert.deepEqual(a.headers,b.headers);}
  assert.deepEqual(f.calls,[]);
 }
});
test('all packaged entrypoints preserve raw body handling and public runtime imports are package-relative',()=>{
 for(const file of ['api/test-marketplace.js','api/closed-practice-seller/begin.js','api/command-center.js']){
  const entry=require('../'+file);assert.deepEqual(entry.config,{api:{bodyParser:false}});
 }
 for(const file of ['server/owner_practice_runtime.cjs','server/owner_practice_page.cjs','server/owner_practice_mount.cjs']){
  const s=fs.readFileSync(path.join(__dirname,'..',file),'utf8');assert.equal(/actual_source|review-2026|cloud-current/.test(s),false);
 }
});
test('availability boolean is produced only after authenticated owner overview and never in public config or denied responses',async()=>{
 const f=fixture({realtime:true}),env=environment(f,{RACK_RELIC_TEST_REFUNDS_ENABLED:'true',RACK_RELIC_TEST_REFUND_REQUESTS_ENABLED:'true'});
 const snapshot={test:true,live:false,releaseEnabled:false,observedAt:new Date().toISOString(),
  counts:{orders:0,paidOrders:0,heldOrders:0,sellers:0,openCases:0,alertDeliveryGaps:0},orders:[],cases:[],hasMoreOrders:false,hasMoreCases:false,
  sources:{stripeObservedAt:null,sellerObservedAt:null,shippingObservedAt:null}};
 let reads=0,availabilityCalls=0;
 const fetchImpl=async(url,init)=>{
  if(url.endsWith('/rr_test_admin_overview')){reads++;return Response.json(snapshot);}
  const r=await f.fetchImpl(url,init);return {...r,json:()=>new Response(r.body).json()};
 };
 const commandSession=createCommandSessionService({env,fetchImpl,clock:Date.now});
 const make=available=>createTestAdminRuntime({env,fetchImpl,commandSession,clock:Date.now,ownerFixtureSetupAvailable:()=>{availabilityCalls++;return available;}});
 const h=make(true),config=await call(h,'/api/command-center?action=config');assert.equal(config.statusCode,200);
 assert.equal(Object.hasOwn(JSON.parse(config.body),'ownerFixtureSetupAvailable'),false);assert.equal(availabilityCalls,0);assert.equal(reads,0);
 const denied=await call(h,'/api/command-center?action=overview');assert.equal(denied.statusCode,401);assert.equal(availabilityCalls,0);assert.equal(reads,0);
 const owner=await call(h,'/api/command-center?action=overview',{cookie:f.cookie()});assert.equal(owner.statusCode,200,owner.body);
 assert.equal(JSON.parse(owner.body).ownerFixtureSetupAvailable,true);assert.equal(availabilityCalls,1);assert.equal(reads,1);
 for(const v of [OWNER,FIXTURE,f.serverKey,f.restrictedKey])assert.equal(owner.body.includes(v),false);
 const off=await call(make(false),'/api/command-center?action=overview',{cookie:f.cookie()});assert.equal(off.statusCode,200,off.body);
 assert.equal(Object.hasOwn(JSON.parse(off.body),'ownerFixtureSetupAvailable'),false);
});
test('both originating form policies allow only self and the exactly validated Stripe host; Command form policy is unchanged',async()=>{
 const f=fixture(),m=createOwnerPracticeMount(ports(f,environment(f)));
 for(const url of [BEGIN_PATH,RETURN_PATH]){
  const handler=url===BEGIN_PATH?m.beginHandler:m.returnHandler,r=await f.request('GET',null,{url,instance:{handler}});
  assert.equal(r.statusCode,200);const policy=r.headers['content-security-policy'];
  assert.equal(policy.split(';').map(v=>v.trim()).find(v=>v.startsWith('form-action ')),"form-action 'self' https://accounts.stripe.com");
  assert.equal(policy.includes('*'),false);
 }
 const source=fs.readFileSync(path.join(__dirname,'../server/test_admin_runtime.cjs'),'utf8');assert.match(source,/form-action 'none'/);
 for(const linkUrl of ['https://example.invalid/r/acct_fictionalOwnerPractice#alu_test_FictionalOnly',
  'https://accounts.stripe.com.evil.invalid/r/acct_fictionalOwnerPractice#alu_test_FictionalOnly',
  'https://accounts.stripe.com:444/r/acct_fictionalOwnerPractice#alu_test_FictionalOnly',
  'https://accounts.stripe.com/r/acct_other#alu_test_FictionalOnly']){
  const bad=fixture({phase:'known',linkUrl}),mount=createOwnerPracticeMount(ports(bad,environment(bad)));
  const r=await bad.request('POST','refresh',{instance:{handler:mount.returnHandler}});assert.equal(r.statusCode,503);assert.equal(r.headers.location,undefined);
  assert.deepEqual(bad.providerPosts,['/v2/core/account_links']);assert.deepEqual(bad.writes,[]);
 }
});
test('NULL or zero trusted fixture configuration cannot create local authority',async()=>{
 const f=fixture();
 for(const fixtureId of [null,'00000000-0000-0000-0000-000000000000','',OTHER+'x']){
  const built=f.build({configuration:{...f.cfg,fixtureId}});assert.equal(built.ready,false);
  assert.equal((await f.request('POST','begin',{instance:built})).statusCode,404);
 }
 assert.deepEqual(f.calls,[]);
});

test('conflicting checkout true holds the owner runtime without falling through to legacy financial routes',async()=>{
 const f=fixture(),env=Object.freeze(environment(f,{RACK_RELIC_TEST_CHECKOUT_ENABLED:'true'})),before=JSON.stringify(env);
 const mount=createOwnerPracticeMount(ports(f,env)),marketplace=createOwnerPracticeMarketplaceMount(ports(f,env));
 assert.equal(mount.featureSelected,true);assert.equal(mount.localAvailability(),false);assert.equal(marketplace.localAvailability(),false);
 for(const [url,handler] of [[BEGIN_PATH,mount.beginHandler],[RETURN_PATH,marketplace.handler]]){
  assert.equal((await f.request('GET',null,{url,instance:{handler}})).statusCode,404);
  assert.equal((await f.request('POST','begin',{url,instance:{handler}})).statusCode,404);
 }
 for(const url of [RETURN_PATH+'?action=checkout',RETURN_PATH+'?action=create',RETURN_PATH+'?action=refund'])
  assert.equal((await f.request('POST','begin',{url,instance:marketplace})).statusCode,400);
 assert.deepEqual(f.calls,[]);assert.deepEqual(f.sqlCalls,[]);assert.deepEqual(f.providerPosts,[]);assert.deepEqual(f.writes,[]);
 const legacy=createTestMarketplaceRuntime(ports(f,env));
 for(const url of [RETURN_PATH+'?action=config',RETURN_PATH+'?action=orders']){
  const a=await call(marketplace.handler,url),b=await call(legacy,url);assert.equal(a.statusCode,b.statusCode);assert.equal(a.body,b.body);
 }
 assert.equal(JSON.stringify(env),before);assert.equal(env.RACK_RELIC_TEST_CHECKOUT_ENABLED,'true');
});
