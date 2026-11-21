'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {CURRENT_FEE_POLICY:V3,PREVIOUS_FEE_POLICY:V2,LEGACY_FEE_POLICY:V1,feePolicy,buyerFee}=require('../server/fee_policy.cjs');
const {buildTestCheckout,createStripeTestCheckoutClient}=require('../server/marketplace_test_checkout.cjs');
const {createSellerCostDisclosure,assessSellerCostAllocation}=require('../server/seller_cost_allocation.cjs');
const {createTestQuoteService}=require('../server/test_checkout_service.cjs');
const {destinationHash}=require('../server/stripe_test_tax.cjs');
const NOW=Date.now(),O='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222',S='33333333-3333-4333-8333-333333333333',L='44444444-4444-4444-8444-444444444444',P='55555555-5555-4555-8555-555555555555';
const UPDATED='2026-11-18T00:00:00Z',address={line1:'400 Broad St',city:'Seattle',state:'WA',postal_code:'98109',country:'US'};
function input(version=V3){const fee=buyerFee(2500,version);return {feePolicyVersion:version,orderId:O,buyerId:B,listing:{id:L,seller_id:S,price_cents:2500,updated_at:UPDATED,status:'published',moderation_status:'active',delivery_mode:'shipping'},shippingQuote:{test:true,orderId:O,listingId:L,listingUpdatedAt:UPDATED,amountCents:500,expiresAt:NOW+600000,destinationHash:destinationHash(address),rateId:'a'.repeat(32)},taxQuote:{test:true,orderId:O,status:'calculated',country:'US',currency:'USD',amountCents:327,baseCents:3000+fee,expiresAt:NOW+600000,destinationHash:destinationHash(address),taxCalculationId:'taxcalc_v3fixture'}};}
function session(total){return {id:'cs_test_v3fixture',livemode:false,mode:'payment',currency:'usd',amount_total:total,status:'open',payment_status:'unpaid',client_reference_id:O,metadata:{order_id:O,integration:'rack_relic_test'},expires_at:Math.floor(NOW/1000)+1800,url:'https://checkout.stripe.com/c/pay/cs_test_v3fixture'};}
test('new policy adds one dollar once, keeps half-up rounding, and preserves both saved versions',()=>{
 assert.equal(V3,'rr-fees-v3');assert.deepEqual(feePolicy(V3),{version:V3,percent:5,fixedCents:100});
 for(const [item,v1,v2,v3] of [[100,4,55,105],[109,4,55,105],[110,4,56,106],[113,5,56,106],[2500,100,175,225],[3000,120,200,250]]){
  assert.equal(buyerFee(item,V1),v1);assert.equal(buyerFee(item,V2),v2);assert.equal(buyerFee(item,V3),v3);
 }
 assert.equal(buyerFee(3000,V3),250);assert.equal(buyerFee(1000,V3)+buyerFee(2000,V3),350);
 assert.equal(buyerFee(2500),100);for(const v of [null,'rr-fees-v4',3,{},false])assert.throws(()=>feePolicy(v));
});
test('new fee enters the shipping/tax base; older quotes retain exact original totals',()=>{
 const v3=buildTestCheckout(input(V3),NOW),v2=buildTestCheckout(input(V2),NOW),v1=buildTestCheckout(input(V1),NOW);
 assert.deepEqual([v3.buyerFeeCents,v3.baseCents,v3.totalCents],[225,3225,3552]);
 assert.deepEqual([v2.buyerFeeCents,v2.baseCents,v2.totalCents],[175,3175,3502]);
 assert.deepEqual([v1.buyerFeeCents,v1.baseCents,v1.totalCents],[100,3100,3427]);
 const wrong=input(V3);wrong.taxQuote.baseCents=3175;assert.throws(()=>buildTestCheckout(wrong,NOW),/Tax quote does not match/);
});
test('one simulated Checkout POST discloses the new fee without an automatic seller transfer',async()=>{
 const calls=[],client=createStripeTestCheckoutClient({secretKey:'rk_test_fixture',fetchImpl:async(url,opts)=>{calls.push({url,opts});return Response.json(session(3552));}});
 const r=await client.createCheckout(input(V3));assert.equal(calls.length,1);assert.equal(calls[0].opts.method,'POST');
 const f=new URLSearchParams(calls[0].opts.body);assert.equal(f.get('line_items[1][price_data][product_data][name]'),'Buyer platform fee (5% + $1.00 per order)');
 assert.equal(f.get('line_items[1][price_data][unit_amount]'),'225');assert.equal(f.get('line_items[1][quantity]'),'1');assert.equal(f.get('payment_intent_data[transfer_data][destination]'),null);assert.equal(r.snapshot.feePolicyVersion,V3);
});
test('saved v2 and v3 recovery remains GET-only and never reprices old money',async()=>{
 for(const version of [V2,V3]){
  const snapshot=buildTestCheckout(input(version),NOW),before=JSON.stringify(snapshot),calls=[];
  const client=createStripeTestCheckoutClient({secretKey:'rk_test_fixture',fetchImpl:async(url,opts)=>{calls.push(opts);return Response.json(session(snapshot.totalCents));}});
  await client.retrieveCheckout({sessionId:'cs_test_v3fixture',snapshot});assert.equal(calls.length,1);assert.equal(calls[0].method,'GET');assert.equal(JSON.stringify(snapshot),before);
 }
});
test('fee relabelling and a missing fixed component are rejected before any simulated provider read',async()=>{
 let calls=0;const client=createStripeTestCheckoutClient({secretKey:'rk_test_fixture',fetchImpl:async()=>{calls++;throw Error('must not request');}});
 const v2=buildTestCheckout(input(V2),NOW),v3=buildTestCheckout(input(V3),NOW);
 for(const bad of [{...v2,feePolicyVersion:V3},{...v3,feePolicyVersion:V2},{...v3,buyerFeeCents:175,totalCents:3502},{...v3,feePolicyVersion:undefined}])await assert.rejects(client.retrieveCheckout({sessionId:'cs_test_v3fixture',snapshot:bad}));
 assert.equal(calls,0);
});
test('quote loader carries the reservation fee version and new base into the Tax port',async()=>{
 let captured;const service=createTestQuoteService({clock:()=>NOW,shipping:{quote:async()=>({test:true,rates:[{test:true,id:'a'.repeat(32),currency:'USD',amountCents:500}]})},tax:{quote:async i=>{captured=i;return input(V3).taxQuote;}},loadFulfillment:async()=>({test:true,sellerId:S,listingUpdatedAt:UPDATED,from:address,package:{length:10,width:8,height:2,weight:1},itemTaxCode:'txcd_30011000',buyerFeeTaxCode:'txcd_30011000'})});
 const q=await service.quote({order:{id:O,buyer_id:B,seller_id:S,listing_id:L,listing_updated_at:UPDATED,item_cents:2500,buyer_fee_cents:195,fee_policy_version:V3},to:address});
 assert.equal(q.feePolicyVersion,V3);assert.equal(captured.feePolicyVersion,V3);assert.equal(buildTestCheckout(q,NOW).buyerFeeCents,225);
});
test('seller-cost disclosure binds the saved fee and consent cannot cross policy versions',()=>{
 const make=version=>({...buildTestCheckout(input(version),NOW),settlementPeriod:'2026-11',payoutBatchId:P});
 const spec=order=>({order,maxTotalCents:250,costCaps:{processing:200,radar:0,connect_active_account:50,payout:0,insurance:0},selectedInsurance:false,createdAt:NOW});
 const order=make(V3),d=createSellerCostDisclosure(spec(order)),old=createSellerCostDisclosure(spec(make(V2)));
 assert.equal(d.feePolicyVersion,V3);assert.equal(old.feePolicyVersion,V2);assert.notEqual(d.hash,old.hash);
 const a={test:true,source:'server_verified_session',authenticated:true,orderId:O,sellerId:S,policyVersion:'rr-seller-costs-v1',feePolicyVersion:V2,disclosureHash:d.hash,authenticatedAt:NOW};
 const assessed=assessSellerCostAllocation({order,disclosure:d,acceptance:a,costs:[],priorAllocations:[]},NOW);
 assert.ok(assessed.blockers.includes('seller_cost_acceptance_required'));assert.equal(assessed.feePolicyVersion,V3);assert.equal(assessed.releaseEnabled,false);
});
test('buyer fee copy uses one dollar and keeps buying closed',()=>{
 const fs=require('node:fs'),path=require('node:path');
 for(const file of ['index.html','help-widget.js','policies/seller-guide.html','policies/support.html']){const s=fs.readFileSync(path.join(__dirname,'..',file),'utf8');assert.ok(s.includes('$1.00'),file);assert.equal(s.includes('$0.50'),false,file);}
 const source=fs.readFileSync(path.join(__dirname,'../server/marketplace_test_checkout.cjs'),'utf8');assert.ok(source.includes('quoteExpiresAt'));assert.ok(source.includes('dispatchAt>=quoteExpiresAt'));
});
