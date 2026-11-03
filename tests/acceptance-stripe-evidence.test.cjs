'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {TEST_ENVIRONMENTS}=require('../server/test_environment_registry.cjs');
const {createStripeTestFeeClient}=require('../server/stripe_test_fees.cjs');
const {createStripeTestRiskClient}=require('../server/stripe_test_risk_client.cjs');
const {createStripeTestRefundClient}=require('../server/stripe_test_refunds.cjs');
const {verifyStripeTestEvent,stripeTestEventRpc}=require('../server/marketplace_test_checkout.cjs');
const {createHmac}=require('node:crypto');
const A=TEST_ENVIRONMENTS.acceptance,L=TEST_ENVIRONMENTS.legacy;
const O='11111111-1111-4111-8111-111111111111',R='22222222-2222-4222-8222-222222222222';
const order={test:true,orderId:O,paymentIntentId:'pi_acceptance',totalCents:3427};
const request={id:R,order_id:O,payment_intent_id:'pi_acceptance',amount_cents:1000,total_cents:3427,phase:'dispatched',refund_id:null};
function provider(config={}){
 const calls=[],metadata={order_id:O,rr_test_environment:A.id};
 const fetchImpl=async(url,options)=>{
  const u=new URL(url);assert.equal(u.origin,'https://api.stripe.com');assert.equal(options.cache,'no-store');assert.equal(options.redirect,'error');calls.push({url,options});
  let data;
  if(u.pathname==='/v1/account')data={object:'account',id:A.accountId,country:'US'};
  if(u.pathname==='/v1/balance')data={object:'balance',livemode:false};
  if(u.pathname==='/v1/payment_intents/pi_acceptance')data={id:'pi_acceptance',livemode:false,status:'succeeded',amount:3427,amount_received:3427,currency:'usd',metadata,transfer_group:'rr_test_'+O,latest_charge:'ch_acceptance'};
  if(u.pathname==='/v1/charges/ch_acceptance')data={object:'charge',id:'ch_acceptance',payment_intent:'pi_acceptance',livemode:false,status:'succeeded',paid:true,captured:true,refunded:false,amount_refunded:0,disputed:false,currency:'usd',amount:3427,amount_captured:3427,metadata,balance_transaction:'txn_acceptance',outcome:{type:'authorized',risk_level:'normal'},payment_method_details:{type:'card',card:{checks:{cvc_check:'pass',address_postal_code_check:'pass',address_line1_check:'pass'},three_d_secure:{result:'authenticated'}}}};
  if(u.pathname==='/v1/balance_transactions/txn_acceptance')data={object:'balance_transaction',id:'txn_acceptance',source:'ch_acceptance',currency:'usd',amount:3427,fee:129,net:3298,type:'charge',reporting_category:'charge',status:'available',exchange_rate:null,fee_details:[{type:'stripe_fee',amount:129,currency:'usd'}]};
  if(u.pathname==='/v1/refunds'||u.pathname==='/v1/refunds/re_acceptance')data={object:'refund',id:'re_acceptance',payment_intent:'pi_acceptance',charge:'ch_acceptance',amount:1000,currency:'usd',status:'succeeded',metadata:{integration:'rack_relic_test_refund_acceptance_v1',request_id:R,order_id:O,rr_test_environment:A.id}};
  assert.ok(data,'unexpected synthetic request '+u.pathname);if(config.patch)data=config.patch(structuredClone(data),u,options)||data;
  return Response.json(data,{headers:config.headers});
 };
 return {calls,fetchImpl};
}
const factories=[['fee',createStripeTestFeeClient],['risk',createStripeTestRiskClient],['refund',createStripeTestRefundClient]];
function run(kind,client){return kind==='refund'?client.createRefund(request):client.read(order);}
test('fee, risk and refund adapters use fresh acceptance identity and bound payment metadata',async()=>{
 for(const [kind,create]of factories){const p=provider(),client=create({secretKey:'rk_test_fixture',accountId:A.accountId,fetchImpl:p.fetchImpl});const r=await run(kind,client);assert.equal(r.test,true);assert.ok(p.calls.some(c=>c.url.endsWith('/v1/account')));assert.ok(p.calls.some(c=>c.url.endsWith('/v1/balance')));
  if(kind==='fee'){assert.equal(r.feeCents,129);assert.ok(p.calls.every(c=>c.options.method==='GET'));}
  if(kind==='risk'){assert.equal(r.decision,'clear');assert.ok(p.calls.every(c=>c.options.method==='GET'));}
  if(kind==='refund'){const post=p.calls.filter(c=>c.options.method==='POST');assert.equal(post.length,1);const form=new URLSearchParams(post[0].options.body);assert.equal(form.get('metadata[rr_test_environment]'),A.id);assert.equal(form.get('metadata[integration]'),'rack_relic_test_refund_acceptance_v1');assert.equal(post[0].options.headers['Idempotency-Key'],'rr_test_refund_acceptance_v1_'+R);const n=p.calls.length;await client.retrieveRefund({...request,phase:'known',refund_id:r.refundId,charge_id:r.chargeId});assert.ok(p.calls.slice(n).every(c=>c.options.method==='GET'));}
 }
});
test('acceptance evidence rejects foreign/live/cached identity and legacy payment namespace without refund dispatch',async()=>{
 for(const [kind,create]of factories)for(const config of [
  {patch:(d,u)=>u.pathname==='/v1/account'?{...d,id:L.accountId}:d},
  {patch:(d,u)=>u.pathname==='/v1/balance'?{...d,livemode:true}:d},
  {headers:{age:'1'}},
  {patch:(d,u)=>u.pathname.startsWith('/v1/payment_intents/')?{...d,metadata:{order_id:O}}:d}
 ]){const p=provider(config),client=create({secretKey:'sk_test_fixture',accountId:A.accountId,fetchImpl:p.fetchImpl});await assert.rejects(run(kind,client));assert.equal(p.calls.some(c=>c.options.method==='POST'),false);}
 for(const [,create]of factories)for(const accountId of [undefined,'acct_foreign'])assert.throws(()=>create({secretKey:'sk_test_fixture',accountId,fetchImpl:()=>assert.fail('unapproved provider')}));
});
test('acceptance signed external refunds and disputes remain reference-bound without invented app metadata',()=>{
 const now=Math.floor(Date.now()/1000),sign=e=>{const raw=Buffer.from(JSON.stringify(e));return {raw,sig:'t='+now+',v1='+createHmac('sha256','whsec_fixture').update(now+'.').update(raw).digest('hex')};};
 const refund={id:'evt_externalRefund',created:now,livemode:false,account:A.accountId,type:'refund.created',data:{object:{object:'refund',id:'re_external',payment_intent:'pi_external',charge:'ch_external',amount:100,currency:'usd',status:'succeeded',metadata:{}}}};
 const dispute={id:'evt_externalDispute',created:now,livemode:false,account:A.accountId,type:'charge.dispute.created',data:{object:{object:'dispute',id:'du_external',livemode:false,payment_intent:'pi_external',charge:'ch_external',amount:100,currency:'usd',status:'needs_response',evidence_details:{due_by:now+86400}}}};
 for(const e of [refund,dispute]){const s=sign(e),verified=verifyStripeTestEvent(s.raw,s.sig,{secret:'whsec_fixture',accountId:A.accountId});const mapped=stripeTestEventRpc(verified,s.raw,{accountId:A.accountId,refundsEnabled:true,refundRequestsEnabled:true,disputesEnabled:true});assert.equal(mapped.payload.p_charge,'ch_external');if(e===refund)assert.equal(mapped.payload.p_request,null);assert.throws(()=>verifyStripeTestEvent(s.raw,s.sig,{secret:'whsec_fixture',accountId:L.accountId}));}
});

test('owned refund markers cannot be recast as external refunds to cross receiver namespaces',()=>{
 const t=Math.floor(Date.now()/1000),base={id:'evt_crossOwnedRefund',created:t,livemode:false,type:'refund.created',data:{object:{object:'refund',id:'re_cross',payment_intent:'pi_cross',charge:'ch_cross',amount:100,currency:'usd',status:'succeeded'}}};
 for(const [source,target]of [[A,L],[L,A]]){const e=structuredClone(base);e.data.object.metadata={integration:source.id==='legacy'?'rack_relic_test_refund':'rack_relic_test_refund_acceptance_v1',order_id:O,request_id:R,...(source.id==='legacy'?{}:{rr_test_environment:source.id})};const raw=Buffer.from(JSON.stringify(e)),sig='t='+t+',v1='+createHmac('sha256','whsec_fixture').update(t+'.').update(raw).digest('hex');assert.throws(()=>verifyStripeTestEvent(raw,sig,{secret:'whsec_fixture',accountId:target.accountId}),/environment/);assert.throws(()=>stripeTestEventRpc(e,raw,{accountId:target.accountId,refundsEnabled:true,refundRequestsEnabled:true}),/environment/);}
});
