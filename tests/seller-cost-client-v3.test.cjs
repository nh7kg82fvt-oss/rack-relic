'use strict';
// New focused contract checks. Actual canonical service/client modules with a
// fictional in-memory repository adapted from the existing seller-cost fixture.
// No SQL, Auth/provider requests, real consent, storage or financial actions.
const {test}=require('node:test'),assert=require('node:assert/strict');
const client=require('../test-seller-cost-review.js'),fee=require('../server/fee_policy.cjs');
const {createTestSellerCostService}=require('../server/test_seller_cost_service.cjs');
const O='11111111-1111-4111-8111-111111111111',S='22222222-2222-4222-8222-222222222222',NOW=1795286400000;
const input={authorization:'Bearer fictional-seller',orderId:O};
function fixture(version='rr-fees-v3',itemCents=2500){
 const buyerFeeCents=fee.buyerFee(itemCents,version),calls=[],c={test:true,orderId:O,feePolicyVersion:version,order:{test:true,orderId:O,sellerId:S,currency:'USD',feePolicyVersion:version,itemCents,buyerFeeCents,shippingCents:500,taxCents:0,totalCents:itemCents+buyerFeeCents+500,settlementPeriod:'2026-11',payoutBatchId:O},disclosure:null,acceptance:null,costs:[],priorAllocations:[]};
 const q={test:true,orderId:O,sellerId:S,expiresAt:NOW+60000,maxTotalCents:Math.min(500,itemCents),costCaps:{processing:Math.min(200,itemCents),radar:Math.min(10,itemCents),connect_active_account:Math.min(200,itemCents),payout:Math.min(90,itemCents),insurance:0},selectedInsurance:false};
 const repository={async sellerCostContext(v){calls.push(['read',v]);return structuredClone(c);},async prepareSellerCostDisclosure(v){calls.push(['prepare',v]);c.disclosure={...JSON.parse(v.document),hash:v.hash};},async acceptSellerCosts(v){calls.push(['accept',v]);c.acceptance={test:true,source:'server_verified_session',authenticated:true,orderId:O,sellerId:S,policyVersion:'rr-seller-costs-v1',feePolicyVersion:version,disclosureHash:v.disclosureHash,authenticatedAt:NOW};}};
 const service=createTestSellerCostService({repository,clock:()=>NOW,loadCostQuote:async order=>{calls.push(['quote',order]);return q;}});
 return{c,calls,service};
}
test('actual service output passes the client with exact saved v2/v3 fees, including rounding boundaries',async()=>{
 for(const version of ['rr-fees-v2','rr-fees-v3'])for(const item of [100,101,109,110,2500]){const f=fixture(version,item),before=await f.service.status(input),prepared=await f.service.prepare(input),projected=client.publicSellerCostReview(prepared,O);
  assert.deepEqual(client.publicSellerCostReview(before,O),before);assert.deepEqual(projected,prepared);assert.equal(projected.buyerFeeCents,fee.buyerFee(item,version));assert.equal(projected.feePolicyVersion,version);assert.equal(projected.releaseEnabled,false);assert.equal(projected.accepted,false);assert.ok(Object.isFrozen(projected));assert.ok(Object.isFrozen(projected.disclosure.costCaps));
  if(item===2500)assert.equal(projected.buyerFeeCents,version==='rr-fees-v3'?225:175);
 }
});
test('normal review rejects swapped, unknown, missing or incorrect saved fee/version pairs',async()=>{
 for(const version of ['rr-fees-v2','rr-fees-v3']){const f=fixture(version),r=await f.service.prepare(input),other=version==='rr-fees-v3'?'rr-fees-v2':'rr-fees-v3';
  for(const patch of [{feePolicyVersion:other},{buyerFeeCents:fee.buyerFee(2500,other)},{feePolicyVersion:'unknown'},{feePolicyVersion:undefined},{feePolicyVersion:'rr-fees-v1'},{buyerFeeCents:r.buyerFeeCents-1},{buyerFeeCents:r.buyerFeeCents+1},{buyerFeeCents:0},{buyerFeeCents:String(r.buyerFeeCents)}]){
   const bad={...r,...patch};assert.throws(()=>client.publicSellerCostReview(bad,O));assert.throws(()=>client.sellerCostAction('seller-cost-accept',bad,O));
  }
  assert.equal(f.calls.some(v=>v[0]==='accept'),false);
 }
});
test('actual historical v1 and invalid-snapshot service results stay unavailable without repricing or consent',async()=>{
 const old=fixture('rr-fees-v1'),historical=await old.service.status(input),h=client.publicSellerCostReview(historical,O);assert.deepEqual(h,historical);assert.equal(h.buyerFeeCents,100);assert.deepEqual(h.blockers,['unsupported_fee_policy']);assert.equal(h.disclosure,null);assert.equal(h.sellerNetCents,null);assert.equal(h.sellerNetAfterReserveCents,null);assert.equal(h.accepted,false);assert.equal(h.releaseEnabled,false);
 const bad=fixture();bad.c.order.buyerFeeCents--;const unavailable=await bad.service.status(input),u=client.publicSellerCostReview(unavailable,O);assert.deepEqual(u,unavailable);assert.ok(u.blockers.includes('invalid_order_snapshot'));assert.equal(u.itemCents,null);assert.equal(u.buyerFeeCents,null);assert.equal(u.disclosure,null);assert.equal(u.sellerNetCents,null);
 for(const r of [h,u])for(const action of ['seller-cost-prepare','seller-cost-accept'])assert.throws(()=>client.sellerCostAction(action,r,O));assert.equal(old.calls.some(v=>v[0]!=='read'),false);assert.equal(bad.calls.some(v=>v[0]!=='read'),false);
});
test('v2/v3 consent commands contain only the original order and exact reviewed hash and never financial authority',async()=>{
 for(const version of ['rr-fees-v2','rr-fees-v3']){const f=fixture(version),initial=await f.service.status(input),prepare=client.sellerCostAction('seller-cost-prepare',initial,O);assert.equal(prepare.options.method,'POST');assert.deepEqual(JSON.parse(prepare.options.body),{orderId:O});
  const r=await f.service.prepare(input),accept=client.sellerCostAction('seller-cost-accept',r,O);assert.equal(accept.options.method,'POST');assert.deepEqual(JSON.parse(accept.options.body),{orderId:O,disclosureHash:r.disclosure.hash});assert.equal(f.calls.some(v=>v[0]==='accept'),false);
  await assert.rejects(f.service.accept({...input,disclosureHash:'b'.repeat(64)}));assert.equal(f.calls.some(v=>v[0]==='accept'),false);
  const accepted=await f.service.accept({...input,...JSON.parse(accept.options.body)}),saved=client.publicSellerCostReview(accepted,O);assert.equal(saved.accepted,true);assert.equal(saved.disclosure.hash,r.disclosure.hash);assert.equal(saved.state,'held');assert.equal(saved.releaseEnabled,false);assert.equal(saved.sellerNetCents,null);assert.equal(f.calls.filter(v=>v[0]==='accept').length,1);
  assert.throws(()=>client.sellerCostAction('seller-cost-accept',saved,O));assert.throws(()=>client.sellerCostAction('seller-cost-prepare',r,O));
 }
});
test('unknown costs, reserve/net contradictions, private evidence and release flags retain their existing holds',async()=>{
 const f=fixture(),r=await f.service.prepare(input),held=client.publicSellerCostReview({...r,providerReceipt:'private-fixture-only',allocationPlan:['private'],sellerId:S,payoutCreated:true},O);assert.ok(held.blockers.includes('provider_cost_schedule_incomplete'));assert.equal(held.sellerNetCents,null);assert.equal(held.sellerNetAfterReserveCents,null);assert.equal(held.releaseEnabled,false);for(const k of ['providerReceipt','allocationPlan','sellerId','payoutCreated'])assert.equal(Object.hasOwn(held,k),false);
 for(const patch of [{releaseEnabled:true},{test:false},{orderId:S},{confirmedCostCents:-1},{reservedCostCents:null},{reservedCostCents:1,sellerNetCents:2500,sellerNetAfterReserveCents:2500},{sellerNetAfterReserveCents:2499},{state:'reconciled_for_review'},{accepted:true,disclosure:null},{disclosure:{...r.disclosure,hash:'bad'}},{disclosure:{...r.disclosure,costCaps:{...r.disclosure.costCaps,insurance:1}}}])assert.throws(()=>client.publicSellerCostReview({...r,...patch},O));
 assert.equal(f.calls.some(v=>v[0]==='accept'),false);
});
