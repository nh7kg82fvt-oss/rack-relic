'use strict';
// Synthetic signed envelopes only. No Stripe or hosted database requests.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createHmac}=require('node:crypto');
const M=require('../server/marketplace_test_checkout.cjs');
const {acceptance:E}=require('../server/test_environment_registry.cjs').TEST_ENVIRONMENTS;
const secret='whsec_FictionalAccountBoundary';
const order={test:true,orderId:'55555555-5555-4555-8555-555555555555',sessionId:'cs_test_Boundary',totalCents:3493};
const invalid=['',false,0,[],{},true,'acct_Other'];
function event(account){return {id:'evt_AccountBoundary',object:'event',type:'checkout.session.completed',livemode:false,created:Math.floor(Date.now()/1000),...(account===undefined?{}:{account}),data:{object:{object:'checkout.session',id:order.sessionId,livemode:false,mode:'payment',status:'complete',payment_status:'paid',currency:'usd',amount_total:order.totalCents,payment_intent:'pi_Boundary',client_reference_id:order.orderId,metadata:{integration:'rack_relic_test_acceptance_v1',rr_test_environment:E.id,order_id:order.orderId}}}};}
function signed(e){const raw=Buffer.from(JSON.stringify(e)),t=Math.floor(Date.now()/1000);return {raw,signature:`t=${t},v1=${createHmac('sha256',secret).update(t+'.').update(raw).digest('hex')}`};}
async function receiver(fetchImpl){return (await import('../supabase/functions/stripe-test-events/index.mjs')).createTestEdgeWebhook({projectUrl:E.projectUrl,accountId:E.accountId,serviceKey:'sb_secret_FictionalAccountBoundary',webhookSecret:secret,refundsEnabled:true,fetchImpl});}
async function deliver(h,e){const {raw,signature}=signed(e);return h(new Request('https://fixture.invalid',{method:'POST',body:raw,headers:{'stripe-signature':signature}}));}
test('signed non-null account values must exactly identify the selected account before any database call',async()=>{
 let calls=0;const h=await receiver(async()=>{calls++;return Response.json({duplicate:false,state:'paid'});});
 for(const account of invalid)assert.equal((await deliver(h,event(account))).status,400,`account ${JSON.stringify(account)}`);
 assert.equal(calls,0);
});
test('Node signature verification rejects falsey account substitutions',()=>{
 for(const account of invalid){const {raw,signature}=signed(event(account));assert.throws(()=>M.verifyStripeTestEvent(raw,signature,{secret,accountId:E.accountId}),undefined,`account ${JSON.stringify(account)}`);}
});
test('shared paid matcher and RPC routing reject the same malformed account values',()=>{
 for(const account of invalid){const e=event(account);assert.equal(M.matchesPaidTestOrder(e,order,{accountId:E.accountId}),false,`account ${JSON.stringify(account)}`);assert.throws(()=>M.stripeTestEventRpc(e,Buffer.from(JSON.stringify(e)),{accountId:E.accountId,refundsEnabled:true}));}
});
test('omitted and null platform account fields remain supported alongside the exact account',async()=>{
 let calls=0;const h=await receiver(async()=>{calls++;return Response.json({duplicate:false,state:'paid'});});
 for(const account of [undefined,null,E.accountId]){const e=event(account),{raw,signature}=signed(e);assert.equal(M.verifyStripeTestEvent(raw,signature,{secret,accountId:E.accountId}).id,e.id);assert.equal(M.matchesPaidTestOrder(e,order,{accountId:E.accountId}),true);assert.equal((await deliver(h,e)).status,200);}
 assert.equal(calls,3);
});
