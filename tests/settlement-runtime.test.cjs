'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),{Readable}=require('node:stream');
const {createTestMarketplaceRuntime}=require('../server/test_marketplace_runtime.cjs');
const B='22222222-2222-4222-8222-222222222222',S='33333333-3333-4333-8333-333333333333',O='11111111-1111-4111-8111-111111111111',R='44444444-4444-4444-8444-444444444444';
const env={VERCEL_ENV:'preview',VERCEL_GIT_COMMIT_REF:'test-only-marketplace-foundation',RACK_RELIC_TEST_CHECKOUT_ENABLED:'true',
 RACK_RELIC_TEST_SUPABASE_URL:'https://zvtaqzcqfdjpuwnlpzln.supabase.co',RACK_RELIC_TEST_MEMBER_IDS:B+','+S,
 RACK_RELIC_TEST_SUPABASE_SERVER_KEY:'sb_secret_fixture',RACK_RELIC_TEST_STRIPE_KEY:'rk_test_fixture',RACK_RELIC_TEST_STRIPE_ACCOUNT:'acct_1UWJZuGVbz9Pnhxd',RACK_RELIC_TEST_SUPABASE_PUBLISHABLE_KEY:'sb_publishable_fixture',
 RACK_RELIC_TEST_SHIPPING_MODE:'shippo_test',RACK_RELIC_TEST_SHIPPO_KEY:'shippo_test_fixture',RACK_RELIC_TEST_QUOTE_LIMITS_ENABLED:'true',RACK_RELIC_TEST_TRACKING_ENABLED:'true',
 RACK_RELIC_TEST_REFUNDS_ENABLED:'true',RACK_RELIC_TEST_REFUND_REQUESTS_ENABLED:'true',RACK_RELIC_TEST_REFUND_OPERATOR_IDS:S,
 RACK_RELIC_TEST_SELLER_PROTECTIONS_ENABLED:'true',RACK_RELIC_TEST_SELLER_COSTS_ENABLED:'true',RACK_RELIC_TEST_SETTLEMENT_SIMULATION_ENABLED:'true'};
const res=()=>({headers:{},setHeader(k,v){this.headers[k]=v;},end(v){this.body=JSON.parse(v);}});
const request=(action='settlement-sim-review',body)=>Object.assign(Readable.from(body===undefined?[]:[JSON.stringify(body)]),{method:body===undefined?'GET':'POST',url:'/api/test-marketplace?action='+action+(body===undefined?'&orderId='+O:''),headers:{authorization:'Bearer fixture','content-type':'application/json'}});
test('sandbox settlement actions stay absent outside the exact preview and explicit dependent flags',async()=>{
 const patches=[{VERCEL_ENV:'production'},{VERCEL_ENV:'development'},{VERCEL_GIT_COMMIT_REF:'main'},
  {RACK_RELIC_TEST_SETTLEMENT_SIMULATION_ENABLED:undefined},{RACK_RELIC_TEST_SETTLEMENT_SIMULATION_ENABLED:'false'},
  {RACK_RELIC_TEST_SELLER_PROTECTIONS_ENABLED:'false'},{RACK_RELIC_TEST_SELLER_COSTS_ENABLED:'false'},
  {RACK_RELIC_TEST_TRACKING_ENABLED:'false'},{RACK_RELIC_TEST_SHIPPING_MODE:'simulated'},
  {RACK_RELIC_TEST_REFUNDS_ENABLED:'false'},{RACK_RELIC_TEST_REFUND_REQUESTS_ENABLED:'false'},{RACK_RELIC_TEST_REFUND_OPERATOR_IDS:''}];
 for(const patch of patches)for(const action of ['settlement-sim-review','settlement-sim-start','settlement-sim-reconcile']){
  const r=res();await createTestMarketplaceRuntime({env:{...env,...patch},fetchImpl:()=>assert.fail('Network must not run')})(request(action,action==='settlement-sim-review'?undefined:{orderId:O,requestId:R,kind:'transfer'}),r);assert.equal(r.statusCode,404,JSON.stringify(patch));
 }
});
test('live credentials, wrong sandbox account and production database never reach a settlement provider',async()=>{
 for(const patch of [{RACK_RELIC_TEST_STRIPE_KEY:'sk_live_fixture'},{RACK_RELIC_TEST_STRIPE_ACCOUNT:'acct_wrong'},{RACK_RELIC_TEST_SUPABASE_URL:'https://zrfztnbyynrdzfeblkeq.supabase.co'}]){
  const r=res();await createTestMarketplaceRuntime({env:{...env,...patch},fetchImpl:()=>assert.fail('Network must not run')})(request(),r);assert.equal(r.statusCode,503);
 }
});
test('private config exposes only the simulation feature boolean and no bank, actor, secret or reserve values',async()=>{
 for(const enabled of [undefined,'false','true']){const r=res();await createTestMarketplaceRuntime({env:{...env,RACK_RELIC_TEST_SETTLEMENT_SIMULATION_ENABLED:enabled}})({method:'GET',url:'/api/test-marketplace?action=config'},r);
  assert.equal(r.statusCode,200);assert.equal(r.body.settlementSimulationEnabled,enabled==='true');const json=JSON.stringify(r.body);
  for(const v of ['sb_secret_fixture','rk_test_fixture',S,B,'bankAccountId','platformReserveCents'])assert.equal(json.includes(v),false);
 }
});
test('ordinary member cannot reach settlement SQL or Stripe before fresh operator authorization',async()=>{
 for(const [action,body]of [['settlement-sim-review',undefined],['settlement-sim-start',{orderId:O,requestId:R,kind:'transfer'}],['settlement-sim-reconcile',{orderId:O,requestId:R}]]){
  const calls=[],r=res();await createTestMarketplaceRuntime({env,fetchImpl:async url=>{calls.push(url);assert.ok(url.endsWith('/auth/v1/user'));return Response.json({id:B});}})(request(action,body),r);
  assert.equal(r.statusCode,403);assert.equal(calls.length,1);
 }
});
test('operator review is read only and returns held simulation data without provider or bank identities',async()=>{
 const calls=[],r=res();await createTestMarketplaceRuntime({env,fetchImpl:async(url,options)=>{
  calls.push(url);if(url.endsWith('/auth/v1/user'))return Response.json({id:S});assert.ok(url.endsWith('/rr_test_settlement_context'));
  assert.deepEqual(JSON.parse(options.body),{p_actor:S,p_order:O});return Response.json({test:true,simulationOnly:true,orderId:O,accountId:'acct_fixture',order:{orderId:O,sellerId:S},
   transferableCents:1900,maxTransferCents:1900,blockers:['test_delivery_wait_required'],attempts:[],releaseEnabled:false,liveReady:false});
 }})(request(),r);
 assert.equal(r.statusCode,200);assert.equal(calls.length,2);assert.equal(r.body.transferableCents,null);assert.equal(r.body.releaseEnabled,false);assert.equal(r.body.liveReady,false);
 for(const v of ['acct_fixture',S,'bankAccountId'])assert.equal(JSON.stringify(r.body).includes(v),false);assert.match(r.headers['Cache-Control'],/no-store/);
});
test('browser amounts, bank references and evidence cannot reach financial simulation orchestration',async()=>{
 for(const patch of [{amountCents:1},{bankAccountId:'ba_wrong'},{providerId:'tr_wrong'},{actorId:S},{evidence:{test:true}}]){
  const r=res();await createTestMarketplaceRuntime({env,fetchImpl:()=>assert.fail('No authentication or provider request expected')})(request('settlement-sim-start',{orderId:O,requestId:R,kind:'transfer',...patch}),r);assert.equal(r.statusCode,400);
 }
});
