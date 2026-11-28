const {test}=require('node:test'),assert=require('node:assert/strict'),{Readable}=require('node:stream');
const {createStripeTestRiskClient}=require('../server/stripe_test_risk_client.cjs');
const {createTestRiskService}=require('../server/test_risk_service.cjs');
const {createTestRiskHandler}=require('../server/test_risk_handler.cjs');
const {createTestOrderRepository}=require('../server/test_order_repository.cjs');
const {createTestMarketplaceRuntime}=require('../server/test_marketplace_runtime.cjs');
const orderId='11111111-1111-4111-8111-111111111111',operator='22222222-2222-4222-8222-222222222222',other='33333333-3333-4333-8333-333333333333';
const order={test:true,orderId,totalCents:3559,paymentIntentId:'pi_fixture'};
function fixture(patch={}){
 return {account:{id:'acct_1UWJZuGVbz9Pnhxd'},balance:{livemode:false},pi:{id:'pi_fixture',livemode:false,status:'succeeded',amount:3559,amount_received:3559,currency:'usd',metadata:{order_id:orderId},transfer_group:'rr_test_'+orderId,latest_charge:'ch_fixture'},charge:{object:'charge',id:'ch_fixture',payment_intent:'pi_fixture',status:'succeeded',livemode:false,amount:3559,amount_captured:3559,currency:'usd',metadata:{order_id:orderId},paid:true,captured:true,refunded:false,amount_refunded:0,disputed:false,outcome:{type:'authorized',risk_level:'normal'},payment_method_details:{type:'card',card:{checks:{cvc_check:'pass',address_postal_code_check:'pass',address_line1_check:'pass'},three_d_secure:{result:'authenticated'}}}},...patch};
}
function client(f=fixture(),headers={}){
 const calls=[],transport=async(u,o)=>{calls.push({u,o});assert.equal(o.method,'GET');assert.equal(o.cache,'no-store');assert.equal(o.redirect,'error');const name={'/v1/account':'account','/v1/balance':'balance','/v1/payment_intents/pi_fixture':'pi','/v1/charges/ch_fixture':'charge','/v1/reviews/prv_fixture':'review'}[new URL(u).pathname];assert.ok(name);return Response.json(f[name],{headers});};
 return {calls,risk:createStripeTestRiskClient({secretKey:'rk_test_fixture',accountId:'acct_1UWJZuGVbz9Pnhxd',fetchImpl:transport})};
}
test('risk client binds account, balance, payment, charge and order before deriving a safe assessment',async()=>{
 const c=client(),r=await c.risk.read(order);assert.equal(r.decision,'clear');assert.equal(r.orderId,orderId);assert.deepEqual(r.reasonCodes,[]);assert.equal(c.calls.length,4);assert.equal(r.payment_method_details,undefined);assert.equal(r.client_secret,undefined);
 for(const args of [{secretKey:'sk_live_fixture',accountId:'acct_1UWJZuGVbz9Pnhxd'},{secretKey:'rk_test_fixture',accountId:'acct_foreign'}])assert.throws(()=>createStripeTestRiskClient(args));
});
test('foreign mode, identity, amount, order metadata and transfer-bearing evidence never clear risk',async()=>{
 for(const [name,patch] of [['account',{id:'acct_foreign'}],['balance',{livemode:true}],['pi',{livemode:true}],['pi',{metadata:{order_id:other}}],['pi',{transfer_group:'foreign'}],['pi',{amount_received:1}],['pi',{transfer_data:{destination:'acct_foreign'}}],['pi',{latest_charge:'invalid'}],['charge',{payment_intent:'pi_foreign'}],['charge',{livemode:true}],['charge',{metadata:{order_id:other}}],['charge',{amount_captured:1}],['charge',{source_transfer:'tr_foreign'}]]){
  const f=fixture();f[name]={...f[name],...patch};await assert.rejects(client(f).risk.read(order));
 }
});
test('unsuccessful authentication, AVS/CVC, refunds and dispute evidence produce holds rather than approval',async()=>{
 for(const patch of [{refunded:true,amount_refunded:3559},{disputed:true},{outcome:{type:'authorized',risk_level:'elevated'}},{payment_method_details:{type:'card',card:{checks:{cvc_check:'pass',address_postal_code_check:'pass',address_line1_check:'pass'},three_d_secure:{result:'attempt_acknowledged'}}}}]){
  const f=fixture();f.charge={...f.charge,...patch};assert.notEqual((await client(f).risk.read(order)).decision,'clear');
 }
});
test('reviews are retrieved freshly and must be bound to the same test charge; cached data is rejected',async()=>{
 const f=fixture();f.charge.review='prv_fixture';f.review={object:'review',id:'prv_fixture',livemode:false,charge:'ch_fixture',open:false,closed_reason:'approved'};assert.equal((await client(f).risk.read(order)).decision,'clear');
 for(const patch of [{charge:'ch_foreign'},{livemode:true},{id:'prv_foreign'}])await assert.rejects(client({...f,review:{...f.review,...patch}}).risk.read(order));
 assert.equal((await client({...f,review:{...f.review,open:true}}).risk.read(order)).decision,'review');
 for(const headers of [{age:'1'},{age:'invalid'},{'cf-cache-status':'HIT'},{'x-vercel-cache':'STALE'}])await assert.rejects(client(f,headers).risk.read(order),/Fresh/);
});
test('risk service checks authority before provider reads and never overrides a repository review hold',async()=>{
 let reads=0,writes=0;const denied=createTestRiskService({repository:{feeOrder:async()=>{throw Error('denied');},recordOperatorRisk:async()=>{writes++;}},stripe:{read:async()=>{reads++;}}});await assert.rejects(denied.assess({orderId}));assert.equal(reads+writes,0);
 const held=createTestRiskService({repository:{feeOrder:async()=>order,recordOperatorRisk:async()=>{throw Error('Manual review required');}},stripe:client().risk});await assert.rejects(held.assess({orderId}),/Manual review/);
 const service=createTestRiskService({repository:{feeOrder:async()=>order,recordOperatorRisk:async()=>({risk_status:'review'})},stripe:client().risk});const r=await service.assess({orderId});assert.equal(r.riskStatus,'review');assert.equal(r.labelGenerated,false);assert.equal(r.payoutCreated,false);assert.equal(r.chargeId,undefined);
});
test('operator authority and participant access are rechecked before storing provider-derived risk',async()=>{
 let auths=0,records=0;const repo=createTestOrderRepository({projectUrl:'https://zvtaqzcqfdjpuwnlpzln.supabase.co',serviceKey:'sb_secret_fixture',allowedMemberIds:[operator,other],allowedRefundOperatorIds:[operator],refundsEnabled:true,refundRequestsEnabled:true,fetchImpl:async(u,o)=>{
  if(u.endsWith('/auth/v1/user'))return Response.json({id:++auths===1?operator:other});
  if(u.endsWith('/rr_test_fee_order'))return Response.json({...order,recordedFee:null});
  records++;assert.fail('Risk must not be stored after operator access is lost');
 }});
 const service=createTestRiskService({repository:repo,stripe:client().risk});await assert.rejects(service.assess({orderId,authorization:'Bearer operator'}),/operator/);assert.equal(records,0);assert.equal(auths,2);
});
const response=()=>({headers:{},setHeader(k,v){this.headers[k]=v;},end(s){this.body=JSON.parse(s);}});
const req=(method='POST',body=JSON.stringify({orderId}),url='/api/test-marketplace?action=risk')=>Object.assign(Readable.from([body]),{method,url,headers:{authorization:'Bearer operator','content-type':'application/json'}});
test('risk HTTP action is opt-in, POST-only and rejects browser scores, charge IDs and extra query parameters',async()=>{
 let calls=0;const risk={assess:async a=>{calls++;return {test:true,orderId:a.orderId,riskStatus:'review',labelGenerated:false,payoutCreated:false};}},h=createTestRiskHandler({risk,enabled:true});
 for(const [method,body,url,status] of [['GET','{}','/api/test-marketplace?action=risk',405],['POST',JSON.stringify({orderId,decision:'clear'}),'/api/test-marketplace?action=risk',400],['POST','{}','/api/test-marketplace?action=risk&chargeId=ch_fixture',400],['POST','x'.repeat(1025),'/api/test-marketplace?action=risk',413],['POST','{}','/api/test-marketplace?action=risk&action=risk',400]]){const r=response();await h(req(method,body,url),r);assert.equal(r.statusCode,status);}assert.equal(calls,0);
 const r=response();await h(req(),r);assert.equal(r.statusCode,200);assert.equal(calls,1);assert.match(r.headers['Cache-Control'],/no-store/);const off=response();await createTestRiskHandler({risk})(req(),off);assert.equal(off.statusCode,404);
});
test('risk workflow is absent outside the exact preview and denies ordinary members before Stripe access',async()=>{
 const env={VERCEL_ENV:'preview',VERCEL_GIT_COMMIT_REF:'test-only-marketplace-foundation',RACK_RELIC_TEST_CHECKOUT_ENABLED:'true',RACK_RELIC_TEST_SUPABASE_URL:'https://zvtaqzcqfdjpuwnlpzln.supabase.co',RACK_RELIC_TEST_MEMBER_IDS:operator+','+other,RACK_RELIC_TEST_SUPABASE_SERVER_KEY:'sb_secret_fixture',RACK_RELIC_TEST_STRIPE_KEY:'rk_test_fixture',RACK_RELIC_TEST_STRIPE_ACCOUNT:'acct_1UWJZuGVbz9Pnhxd',RACK_RELIC_TEST_REFUNDS_ENABLED:'true',RACK_RELIC_TEST_REFUND_REQUESTS_ENABLED:'true',RACK_RELIC_TEST_REFUND_OPERATOR_IDS:operator,RACK_RELIC_TEST_RISK_CHECK_ENABLED:'true'};
 for(const [patch,status] of [[{VERCEL_ENV:'production'},404],[{VERCEL_GIT_COMMIT_REF:'main'},404],[{RACK_RELIC_TEST_RISK_CHECK_ENABLED:''},404],[{},403]]){const calls=[],r=response();await createTestMarketplaceRuntime({env:{...env,...patch},fetchImpl:async u=>{calls.push(u);assert.ok(u.endsWith('/auth/v1/user'));return Response.json({id:other});}})(req(),r);assert.equal(r.statusCode,status);assert.equal(calls.length,status===403?1:0);}
});
