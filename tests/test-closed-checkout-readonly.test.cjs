'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {createTestMarketplaceRuntime}=require('../server/test_marketplace_runtime.cjs');
const {TEST_ENVIRONMENTS}=require('../server/test_environment_registry.cjs');
const A=TEST_ENVIRONMENTS.acceptance,OWNER='11111111-1111-4111-8111-111111111111',BUYER='22222222-2222-4222-8222-222222222222';
const settings={VERCEL_ENV:'preview',VERCEL_GIT_COMMIT_REF:A.branch,RACK_RELIC_TEST_SUPABASE_URL:A.projectUrl,RACK_RELIC_TEST_STRIPE_ACCOUNT:A.accountId,RACK_RELIC_TEST_SUPABASE_SERVER_KEY:'sb_secret_fixture',RACK_RELIC_TEST_SUPABASE_PUBLISHABLE_KEY:'sb_publishable_fixture',RACK_RELIC_TEST_MEMBER_IDS:OWNER+','+BUYER,RACK_RELIC_TEST_CHECKOUT_ENABLED:'false',RACK_RELIC_TEST_ADMIN_OVERVIEW_ENABLED:'true',RACK_RELIC_TEST_SHIPPING_MODE:'shippo_test',RACK_RELIC_TEST_LISTING_ID:'not-configured'};
const response=()=>({headers:{},setHeader(k,v){this.headers[k]=v;},end(v){this.body=v;this.data=JSON.parse(v);}});
async function call({patch={},method='GET',action='config',url,authorization='Bearer fixture',fetchImpl=()=>assert.fail('Unexpected database/provider access')}={}){const res=response();await createTestMarketplaceRuntime({env:{...settings,...patch},fetchImpl})({method,url:url||'/api/test-marketplace?action='+action,headers:{authorization}},res);return res;}
test('acceptance sign-in configuration remains available with checkout closed and no Stripe, shipping or catalog setup',async()=>{
 for(const flag of [undefined,'false','TRUE']){
  const r=await call({patch:{RACK_RELIC_TEST_CHECKOUT_ENABLED:flag,RACK_RELIC_TEST_SELLER_ONBOARDING_ENABLED:'true',RACK_RELIC_TEST_SETTLEMENT_SIMULATION_ENABLED:'true'}});
  assert.equal(r.statusCode,200);assert.equal(r.data.checkoutEnabled,false);assert.equal(r.data.environmentId,A.id);assert.equal(r.data.projectUrl,A.projectUrl);assert.equal(r.data.returnUrl,A.returnUrl);assert.equal(r.data.publishableKey,'sb_publishable_fixture');assert.equal(r.data.adminOverviewEnabled,true);assert.equal(r.data.listing,null);assert.equal(r.data.shippingMode,'disabled');assert.match(r.data.notice,/checkout is closed/);
  assert.equal(r.data.sellerOnboardingEnabled,undefined);assert.equal(r.data.settlementSimulationEnabled,undefined);for(const secret of ['sb_secret_fixture',OWNER,BUYER])assert.equal(r.body.includes(secret),false);assert.match(r.headers['Cache-Control'],/no-store/);
 }
});
test('closed-checkout member reads authenticate freshly, scope the RPC to that member and reject outsiders before records',async()=>{
 for(const actor of [OWNER,BUYER,'33333333-3333-4333-8333-333333333333']){
  const calls=[],r=await call({action:'orders',fetchImpl:async(u,o)=>{calls.push({u,o});assert.equal(new URL(u).origin,A.projectUrl);if(u.endsWith('/auth/v1/user'))return Response.json({id:actor});assert.equal(u,A.projectUrl+'/rest/v1/rpc/rr_test_member_orders');assert.deepEqual(JSON.parse(o.body),{p_member:actor});return Response.json([]);}});
  assert.equal(r.statusCode,[OWNER,BUYER].includes(actor)?200:401);assert.equal(calls.length,[OWNER,BUYER].includes(actor)?2:1);if(r.statusCode===200)assert.deepEqual(r.data,{orders:[]});
 }
 const anonymous=await call({action:'orders',authorization:null});assert.equal(anonymous.statusCode,401);
 const revoked=await call({action:'orders',fetchImpl:async u=>{assert.ok(u.endsWith('/auth/v1/user'));return Response.json({error:'revoked'},{status:401});}});assert.equal(revoked.statusCode,401);
});
test('closed-checkout read-only requests reject wrong methods and ambiguous query shapes without database access',async()=>{
 for(const action of ['config','orders']){
  for(const method of ['POST','PUT','PATCH','DELETE','HEAD']){const r=await call({action,method});assert.equal(r.statusCode,405);assert.equal(r.headers.Allow,'GET');}
  for(const suffix of ['&actor='+OWNER,'&action='+action,'&unexpected=1']){const r=await call({url:'/api/test-marketplace?action='+action+suffix});assert.equal(r.statusCode,400);}
 }
});
test('closed checkout blocks every mutation and provider-evidence action even with all other feature flags and credentials present',async()=>{
 const patch={RACK_RELIC_TEST_STRIPE_KEY:'sk_test_fixture',RACK_RELIC_TEST_SHIPPO_KEY:'shippo_test_fixture',RACK_RELIC_TEST_LISTING_ID:'73737373-7373-4373-8373-737373737373',RACK_RELIC_TEST_QUOTE_LIMITS_ENABLED:'true',RACK_RELIC_TEST_REFUNDS_ENABLED:'true',RACK_RELIC_TEST_REFUND_REQUESTS_ENABLED:'true',RACK_RELIC_TEST_REFUND_OPERATOR_IDS:OWNER,RACK_RELIC_TEST_SELLER_ONBOARDING_ENABLED:'true',RACK_RELIC_TEST_ORDER_ISSUES_ENABLED:'true',RACK_RELIC_TEST_ISSUE_REVIEW_ENABLED:'true',RACK_RELIC_TEST_ISSUE_RESPONSES_ENABLED:'true',RACK_RELIC_TEST_ISSUE_REFUND_REVIEW_ENABLED:'true',RACK_RELIC_TEST_SELLER_PROTECTIONS_ENABLED:'true',RACK_RELIC_TEST_SELLER_COSTS_ENABLED:'true',RACK_RELIC_TEST_SETTLEMENT_SIMULATION_ENABLED:'true',RACK_RELIC_TEST_TRACKING_ENABLED:'true',RACK_RELIC_TEST_LABEL_REQUESTS_ENABLED:'true',RACK_RELIC_TEST_RISK_CHECK_ENABLED:'true'};
 const actions=['checkout','cancel-preparation','refund','refund-access','refund-review','fee','shipping-quote','fulfillment','sample-label','risk','tracking','seller-onboarding','order-issue','issue-review','issue-thread','issue-refund-review','protection-review','protection-hold','seller-cost-review','seller-cost-prepare','seller-cost-accept','settlement-sim-review','settlement-sim-start','settlement-sim-reconcile','unknown'];
 for(const action of actions)for(const method of ['GET','POST','PUT','DELETE']){const r=await call({patch,action,method});assert.equal(r.statusCode,503,method+' '+action);assert.match(r.data.error,/checkout is closed/);}
});
test('closed-checkout access still requires exact isolated identity, a private key and two distinct valid members',async()=>{
 for(const patch of [{RACK_RELIC_TEST_MEMBER_IDS:OWNER+','+OWNER},{RACK_RELIC_TEST_MEMBER_IDS:''},{RACK_RELIC_TEST_SUPABASE_SERVER_KEY:''},{RACK_RELIC_TEST_SUPABASE_PUBLISHABLE_KEY:'sb_secret_fixture'},{RACK_RELIC_TEST_STRIPE_ACCOUNT:'acct_other'},{RACK_RELIC_TEST_SUPABASE_URL:TEST_ENVIRONMENTS.legacy.projectUrl}]){const r=await call({patch});assert.equal(r.statusCode,503);}
 const legacy=TEST_ENVIRONMENTS.legacy,r=await call({patch:{VERCEL_GIT_COMMIT_REF:legacy.branch,RACK_RELIC_TEST_SUPABASE_URL:legacy.projectUrl,RACK_RELIC_TEST_STRIPE_ACCOUNT:legacy.accountId}});assert.equal(r.statusCode,503);
 for(const patch of [{VERCEL_ENV:'production'},{VERCEL_GIT_COMMIT_REF:'main'}]){const r=await call({patch});assert.equal(r.statusCode,404);}
});
