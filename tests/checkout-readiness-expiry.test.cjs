'use strict';
// Synthetic HTTP only. These checks neither create a Checkout nor prove payment.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createTestCheckoutService}=require('../server/test_checkout_service.cjs');
const {buildTestCheckout,createStripeTestCheckoutClient}=require('../server/marketplace_test_checkout.cjs');
const E=require('../server/test_environment_registry.cjs').TEST_ENVIRONMENTS.acceptance;
const orderId='11111111-1111-4111-8111-111111111111',buyerId='22222222-2222-4222-8222-222222222222';
const sellerId='33333333-3333-4333-8333-333333333333',listingId='44444444-4444-4444-8444-444444444444';
const start=1794240000000;
function fixture(t,{lease='shippingQuote',offset=1000,extend=false}={}){
 let now=start; t.mock.method(Date,'now',()=>now);
 const input={orderId,buyerId,feePolicyVersion:'rr-fees-v2',
  listing:{id:listingId,seller_id:sellerId,status:'published',moderation_status:'active',delivery_mode:'shipping',price_cents:2500,updated_at:'2026-11-09T00:00:00Z'},
  shippingQuote:{test:true,orderId,listingId,listingUpdatedAt:'2026-11-09T00:00:00Z',expiresAt:start+10000,amountCents:500,destinationHash:require('../server/stripe_test_tax.cjs').destinationHash({line1:'1 Fictional Way',city:'Seattle',state:'WA',postal_code:'98101',country:'US'})},
  taxQuote:{test:true,orderId,expiresAt:start+10000,status:'calculated',currency:'USD',country:'US',baseCents:3175,amountCents:318}};
 input[lease].expiresAt=start+1000;
 const calls=[];
 const client=createStripeTestCheckoutClient({secretKey:'rk_test_FICTIONALONLY',accountId:E.accountId,returnOrigin:E.previewOrigin,fetchImpl:async(url,o)=>{
  calls.push({url,method:o.method,body:o.body});
  if(url.endsWith('/v1/account'))return Response.json({object:'account',id:E.accountId,country:'US'});
  if(url.endsWith('/v1/balance')){now=start+offset;if(extend)input[lease].expiresAt=start+100000;return Response.json({livemode:false});}
  return Response.json({id:'cs_test_ExpiryFixture',livemode:false,mode:'payment',status:'open',payment_status:'unpaid',currency:'usd',amount_total:3493,client_reference_id:orderId,metadata:{order_id:orderId,integration:'rack_relic_test_acceptance_v1',rr_test_environment:E.id},expires_at:Math.floor(start/1000)+1800,url:'https://checkout.stripe.com/c/pay/cs_test_ExpiryFixture'});
 }});
 return{input,client,calls,setNow:n=>now=n,posts:()=>calls.filter(c=>c.method==='POST')};
}
for(const lease of ['shippingQuote','taxQuote'])for(const offset of [1000,1001])test(`${lease} expiring during readiness prevents Checkout POST at offset ${offset}`,async t=>{
 const f=fixture(t,{lease,offset});await assert.rejects(f.client.createCheckout(f.input),/quote|held/i);assert.equal(f.posts().length,0);assert.equal(f.calls.length,2);
});
test('mutating input expiry during readiness cannot extend the captured lease',async t=>{
 const f=fixture(t,{offset:1001,extend:true});await assert.rejects(f.client.createCheckout(f.input));assert.equal(f.posts().length,0);
});
test('a backwards wall clock during readiness cannot authorize Checkout creation',async t=>{
 const f=fixture(t,{offset:-1});await assert.rejects(f.client.createCheckout(f.input));assert.equal(f.posts().length,0);
});
test('a still-current v2 quote sends one exact four-component Checkout request',async t=>{
 const f=fixture(t,{offset:999});const result=await f.client.createCheckout(f.input);assert.equal(result.state,'open');assert.equal(f.posts().length,1);
 const body=new URLSearchParams(f.posts()[0].body);assert.deepEqual([0,1,2,3].map(i=>body.get(`line_items[${i}][price_data][unit_amount]`)),['2500','175','500','318']);assert.equal(body.get('automatic_tax[enabled]'),null);
});
test('expiry does not prevent GET-only reconciliation of an already-saved Checkout',async t=>{
 const f=fixture(t,{offset:1001}),snapshot=buildTestCheckout(f.input);f.setNow(start+2000);
 const result=await f.client.retrieveCheckout({sessionId:'cs_test_ExpiryFixture',snapshot});assert.equal(result.state,'open');assert.equal(f.posts().length,0);assert.equal(f.calls.length,3);
});
test('expiry after durable dispatch remains held on retry without preparing or sending again',async t=>{
 const f=fixture(t,{offset:1000});let dispatchCalls=0,prepareCalls=0;
 const attempt={phase:'prepared',input:f.input,snapshot:buildTestCheckout(f.input),quote_expires_at:new Date(start+1000).toISOString(),session_id:null};
 const repository={reserve:async()=>({id:orderId}),checkoutAttempt:async()=>({attempt}),dispatchCheckout:async()=>{dispatchCalls++;attempt.phase='dispatched';return{dispatch:true,attempt};},prepareCheckout:async()=>{prepareCalls++;throw Error('unexpected prepare');}};
 const service=createTestCheckoutService({repository,quotes:{quote:async()=>{throw Error('unexpected replacement quote');}},stripe:f.client});
 const request={authorization:'fictional-only',orderId,listingId,to:{line1:'1 Fictional Way',city:'Seattle',state:'WA',postal_code:'98101',country:'US'}};
 await assert.rejects(service.start(request));assert.equal(attempt.phase,'dispatched');await assert.rejects(service.start(request),/reconciliation/);assert.equal(f.posts().length,0);assert.equal(dispatchCalls,1);assert.equal(prepareCalls,0);
});
