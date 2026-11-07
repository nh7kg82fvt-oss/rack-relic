'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),{Readable}=require('node:stream');
const {createTestSellerCostService}=require('../server/test_seller_cost_service.cjs');
const {createTestSellerCostHandler}=require('../server/test_seller_cost_handler.cjs');
const {createTestOrderRepository,OrderAccessDenied}=require('../server/test_order_repository.cjs');
const {createTestMarketplaceRuntime}=require('../server/test_marketplace_runtime.cjs');
const {publicSellerCostReview}=require('../test-seller-cost-review.js');
const O='11111111-1111-4111-8111-111111111111',S='22222222-2222-4222-8222-222222222222',B='33333333-3333-4333-8333-333333333333',NOW=1793685000000;
const input={authorization:'Bearer seller',orderId:O};
function fixture(options={}){
 const c={test:true,orderId:O,feePolicyVersion:'rr-fees-v2',order:{test:true,orderId:O,sellerId:S,currency:'USD',feePolicyVersion:'rr-fees-v2',itemCents:2500,buyerFeeCents:175,shippingCents:500,taxCents:0,totalCents:3175,settlementPeriod:'2026-11',payoutBatchId:O},disclosure:null,acceptance:null,costs:[],priorAllocations:[]};
 const calls=[];
 const repository={async sellerCostContext(v){calls.push(['read',v]);return structuredClone(c);},async prepareSellerCostDisclosure(v){calls.push(['prepare',v]);c.disclosure={...JSON.parse(v.document),hash:v.hash};},async acceptSellerCosts(v){calls.push(['accept',v]);c.acceptance={test:true,source:'server_verified_session',authenticated:true,orderId:O,sellerId:S,policyVersion:'rr-seller-costs-v1',feePolicyVersion:'rr-fees-v2',disclosureHash:v.disclosureHash,authenticatedAt:NOW};}};
 const q={test:true,orderId:O,sellerId:S,expiresAt:NOW+60000,maxTotalCents:500,costCaps:{processing:200,radar:10,connect_active_account:200,payout:90,insurance:0},selectedInsurance:false};
 return {c,calls,repository,q,service:createTestSellerCostService({repository,clock:()=>NOW,loadCostQuote:async order=>{calls.push(['quote',order]);return q;},...options})};
}
test('missing cost evidence stays pending and cannot promise zero-cost seller proceeds',async()=>{
 const f=fixture(),r=await f.service.status(input);assert.equal(r.state,'held');assert.equal(r.itemCents,2500);assert.equal(r.buyerFeeCents,175);assert.equal(r.sellerNetCents,null);assert.equal(r.accepted,false);assert.equal(r.releaseEnabled,false);assert.ok(r.blockers.includes('provider_cost_schedule_incomplete'));assert.ok(r.blockers.includes('cost_disclosure_required'));assert.deepEqual(publicSellerCostReview(r,O),r);
});
test('disclosure is constructed from trusted order and server quote, and acceptance binds its exact hash',async()=>{
 const f=fixture(),r=await f.service.prepare(input),write=f.calls.find(v=>v[0]==='prepare')[1],d=JSON.parse(write.document);
 assert.equal(d.buyerFeeCents,175);assert.equal(d.sellerId,S);assert.equal(d.payoutBatchId,O);assert.equal(d.maxTotalCents,500);assert.equal(r.accepted,false);assert.equal(r.disclosure.hash,write.hash);assert.equal(d.hash,undefined);
 const accepted=await f.service.accept({...input,disclosureHash:r.disclosure.hash});assert.equal(accepted.accepted,true);assert.equal(accepted.state,'held');assert.equal(accepted.sellerNetCents,null);assert.equal(accepted.releaseEnabled,false);assert.deepEqual(publicSellerCostReview(accepted,O),accepted);
 const preparedCount=f.calls.filter(v=>v[0]==='prepare').length;assert.deepEqual(await f.service.prepare(input),accepted);assert.equal(f.calls.filter(v=>v[0]==='prepare').length,preparedCount);
 for(const secret of [S,'server_verified_session','settlementPeriod','payoutBatchId'])assert.equal(JSON.stringify(accepted).includes(secret),false);
});
test('missing, expired, foreign, selected insurance and oversized cap quotes cannot prepare a disclosure',async()=>{
 const f=fixture();await assert.rejects(createTestSellerCostService({repository:f.repository,clock:()=>NOW}).prepare(input));
 for(const patch of [{test:false},{orderId:B},{sellerId:B},{expiresAt:NOW},{expiresAt:NOW+600001},{selectedInsurance:true},{maxTotalCents:2501},{costCaps:{...f.q.costCaps,insurance:1}},{costCaps:{...f.q.costCaps,unknown:1}}]){
  const x=fixture({loadCostQuote:async()=>({...f.q,...patch})});await assert.rejects(x.service.prepare(input));assert.equal(x.calls.some(v=>v[0]==='prepare'),false);
 }
});
test('malformed or substituted context, acceptance and disclosures fail before a consent write',async()=>{
 for(const patch of [{test:false},{orderId:B},{costs:null},{priorAllocations:null},{feePolicyVersion:'old'}]){const f=fixture();Object.assign(f.c,patch);await assert.rejects(f.service.status(input));}
 const f=fixture();await assert.rejects(f.service.accept({...input,disclosureHash:'a'.repeat(64)}));assert.equal(f.calls.some(v=>v[0]==='accept'),false);
 const r=await f.service.prepare(input);await assert.rejects(f.service.accept({...input,disclosureHash:'b'.repeat(64)}));assert.equal(f.calls.some(v=>v[0]==='accept'),false);
 f.c.disclosure.costCaps.radar++;await assert.rejects(f.service.accept({...input,disclosureHash:r.disclosure.hash}));assert.equal(f.calls.some(v=>v[0]==='accept'),false);
});
test('a write response alone is never proof that disclosure or seller consent was saved',async()=>{
 const f=fixture();f.repository.prepareSellerCostDisclosure=async()=>({test:true});await assert.rejects(f.service.prepare(input),/not confirmed/);
 const g=fixture(),r=await g.service.prepare(input);g.repository.acceptSellerCosts=async()=>({accepted:true});await assert.rejects(g.service.accept({...input,disclosureHash:r.disclosure.hash}),/not confirmed/);
});
const response=()=>({headers:{},setHeader(k,v){this.headers[k]=v;},end(v){this.body=JSON.parse(v);}});
function request(action,body={orderId:O},method='POST',suffix=''){
 return Object.assign(Readable.from([JSON.stringify(body)]),{method,url:'/api/test-marketplace?action='+action+suffix,headers:{authorization:'Bearer seller','content-type':'application/json'}});
}
test('HTTP accepts only order references and a reviewed hash, never caller costs or consent booleans',async()=>{
 const f=fixture(),h=createTestSellerCostHandler({costs:f.service,enabled:true});
 for(const body of [{orderId:O,costCaps:f.q.costCaps},{orderId:O,sellerId:S},{orderId:O,accepted:true},null,[]]){const r=response();await h(request('seller-cost-prepare',body),r);assert.equal(r.statusCode,400);}
 assert.equal(f.calls.length,0);
 const prepared=response();await h(request('seller-cost-prepare'),prepared);assert.equal(prepared.statusCode,200);
 const accepted=response();await h(request('seller-cost-accept',{orderId:O,disclosureHash:prepared.body.disclosure.hash}),accepted);assert.equal(accepted.statusCode,200);assert.equal(accepted.body.accepted,true);assert.match(accepted.headers['Cache-Control'],/no-store/);
 for(const action of ['seller-cost-record','seller-cost-release']){const r=response();await h(request(action,{orderId:O,amountCents:1}),r);assert.equal(r.statusCode,400);}
});
test('HTTP guard rejects ambiguous query, wrong method, large input and hides private failures',async()=>{
 const f=fixture(),h=createTestSellerCostHandler({costs:f.service,enabled:true});
 const cases=[['seller-cost-review',{},'POST','',405],['seller-cost-prepare',{},'GET','',405],['seller-cost-review',{},'GET','&orderId='+O+'&orderId='+O,400],['seller-cost-review',{},'GET','&orderId='+O+'&actor='+S,400],['seller-cost-prepare',{orderId:O},'POST','&action=seller-cost-prepare',400],['seller-cost-prepare',{orderId:O},'POST','&orderId='+O,400],['seller-cost-prepare',{orderId:O,padding:'x'.repeat(2000)},'POST','',413]];
 for(const [a,b,m,s,status]of cases){const r=response();await h(request(a,b,m,s),r);assert.equal(r.statusCode,status);}
 const off=response();await createTestSellerCostHandler({costs:f.service})(request('seller-cost-prepare'),off);assert.equal(off.statusCode,404);assert.equal(f.calls.length,0);
 const fail=response();await createTestSellerCostHandler({costs:{async status(){throw Error('private key');}},enabled:true})(request('seller-cost-review',{},'GET','&orderId='+O),fail);assert.equal(fail.statusCode,503);assert.equal(JSON.stringify(fail.body).includes('private key'),false);
 const denied=response();await createTestSellerCostHandler({costs:{async status(){throw new OrderAccessDenied('private actor');}},enabled:true})(request('seller-cost-review',{},'GET','&orderId='+O),denied);assert.equal(denied.statusCode,403);
});
test('repository reauthenticates every cost operation and derives actor from identity, never the browser',async()=>{
 const calls=[],repo=createTestOrderRepository({projectUrl:'https://zvtaqzcqfdjpuwnlpzln.supabase.co',serviceKey:'sb_secret_fixture',allowedMemberIds:[S,B],sellerCostsEnabled:true,fetchImpl:async(url,options)=>{calls.push([url,options]);return url.endsWith('/auth/v1/user')?Response.json({id:S}):Response.json({test:true});}});
 await repo.sellerCostContext({...input,actor:B});await repo.prepareSellerCostDisclosure({...input,document:'{}',hash:'a'.repeat(64),actor:B});await repo.acceptSellerCosts({...input,disclosureHash:'a'.repeat(64),actor:B});
 assert.equal(calls.filter(v=>v[0].endsWith('/auth/v1/user')).length,3);for(const [url,o]of calls.filter(v=>v[0].includes('/rpc/'))){assert.equal(JSON.parse(o.body).p_actor,S);assert.equal(o.headers.Authorization,undefined);assert.equal(o.headers.apikey,'sb_secret_fixture');assert.equal(o.cache,'no-store');}
 const off=createTestOrderRepository({projectUrl:'https://zvtaqzcqfdjpuwnlpzln.supabase.co',serviceKey:'sb_secret_fixture',fetchImpl:()=>assert.fail('network')});await assert.rejects(off.sellerCostContext(input),OrderAccessDenied);
});
test('cost runtime stays private and off by default, including with synthetic cap fixtures configured',async()=>{
 const env={VERCEL_ENV:'preview',VERCEL_GIT_COMMIT_REF:'test-only-marketplace-foundation',RACK_RELIC_TEST_CHECKOUT_ENABLED:'true',RACK_RELIC_TEST_SUPABASE_URL:'https://zvtaqzcqfdjpuwnlpzln.supabase.co',RACK_RELIC_TEST_MEMBER_IDS:S+','+B,RACK_RELIC_TEST_SUPABASE_SERVER_KEY:'sb_secret_fixture',RACK_RELIC_TEST_STRIPE_KEY:'sk_test_fixture',RACK_RELIC_TEST_STRIPE_ACCOUNT:'acct_1UWJZuGVbz9Pnhxd',RACK_RELIC_TEST_SUPABASE_PUBLISHABLE_KEY:'sb_publishable_fixture',RACK_RELIC_TEST_SELLER_COST_QUOTE_FIXTURE:JSON.stringify({version:'rr-cost-quote-fixture-v1',maxTotalCents:500})};
 for(const patch of [{},{VERCEL_ENV:'production',RACK_RELIC_TEST_SELLER_COSTS_ENABLED:'true'},{VERCEL_GIT_COMMIT_REF:'main',RACK_RELIC_TEST_SELLER_COSTS_ENABLED:'true'}]){const r=response();await createTestMarketplaceRuntime({env:{...env,...patch},fetchImpl:()=>assert.fail('network')})(request('seller-cost-prepare'),r);assert.equal(r.statusCode,404);}
 const config=response();await createTestMarketplaceRuntime({env})({method:'GET',url:'/api/test-marketplace?action=config'},config);assert.equal(config.body.sellerCostsEnabled,false);assert.equal(JSON.stringify(config.body).includes('costCaps'),false);
});
