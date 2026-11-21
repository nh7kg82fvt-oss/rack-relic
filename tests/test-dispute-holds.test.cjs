'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),{createHmac}=require('node:crypto');
const {verifyStripeTestEvent,stripeTestEventRpc}=require('../server/marketplace_test_checkout.cjs');
const now=Math.floor(Date.now()/1000),secret='whsec_fixture';
function notice(type='charge.dispute.created'){
 const warning=type==='radar.early_fraud_warning.created';
 return {id:'evt_riskNotice',created:now,livemode:false,type,data:{object:warning?{object:'radar.early_fraud_warning',id:'issfr_fixture',livemode:false,charge:'ch_fixture',payment_intent:'pi_fixture',actionable:true}:{object:'dispute',id:'du_fixture',livemode:false,charge:'ch_fixture',payment_intent:'pi_fixture',amount:3100,currency:'usd',status:'needs_response',evidence_details:{due_by:now+86400},evidence:{customer_email_address:'private@example.com'},metadata:{order_id:'untrusted'}}}};
}
const signed=e=>{const raw=Buffer.from(JSON.stringify(e));return {raw,signature:'t='+now+',v1='+createHmac('sha256',secret).update(now+'.').update(raw).digest('hex')};};
const verified=e=>{const v=signed(e);return verifyStripeTestEvent(v.raw,v.signature,{secret,nowSeconds:now});};
test('signed dispute and early fraud events project only payment bindings and minimal case evidence',()=>{
 for(const type of ['charge.dispute.created','charge.dispute.updated','charge.dispute.closed','radar.early_fraud_warning.created']){
  const e=notice(type);assert.equal(verified(e).type,type);const {raw}=signed(e);assert.throws(()=>stripeTestEventRpc(e,raw),/not activated/);
  const r=stripeTestEventRpc(e,raw,{disputesEnabled:true});assert.equal(r.name,'rr_test_process_risk_notice');assert.equal(r.payload.p_payment_intent,'pi_fixture');assert.equal(r.payload.p_charge,'ch_fixture');assert.equal(r.payload.p_order,undefined);assert.equal(JSON.stringify(r).includes('private@example.com'),false);assert.equal(JSON.stringify(r).includes('untrusted'),false);
  if(type.startsWith('radar.')){assert.equal(r.payload.p_amount,null);assert.equal(r.payload.p_due,null);}else assert.equal(r.payload.p_due,now+86400);
 }
});
test('forged, live, wrong-account, expanded identity and malformed dispute notices are rejected',()=>{
 for(const patch of [e=>e.livemode=true,e=>e.account='acct_other',e=>e.data.object.livemode=true,e=>e.data.object.charge={id:'ch_fixture'},e=>e.data.object.payment_intent={id:'pi_fixture'},e=>e.data.object.currency='eur',e=>e.data.object.amount=-1,e=>e.data.object.status='__proto__',e=>e.data.object.evidence_details.due_by=0,e=>e.created=now+31]){const e=notice();patch(e);assert.throws(()=>verified(e));}
 const {raw,signature}=signed(notice());assert.throws(()=>verifyStripeTestEvent(Buffer.concat([raw,Buffer.from(' ')]),signature,{secret,nowSeconds:now}));
 const w=notice('radar.early_fraud_warning.created');delete w.data.object.actionable;assert.throws(()=>verified(w));
});
test('nullable provider PaymentIntent is preserved for charge-bound recovery rather than metadata lookup',()=>{
 const e=notice('radar.early_fraud_warning.created');e.data.object.payment_intent=null;assert.equal(verified(e).data.object.payment_intent,null);assert.equal(stripeTestEventRpc(e,signed(e).raw,{disputesEnabled:true}).payload.p_payment_intent,null);
});
test('Edge receiver defaults off, retries unknown bindings, and only activated signed notices reach staging',async()=>{
 const {createTestEdgeWebhook}=await import('../supabase/functions/stripe-test-events/index.mjs');
 const options={projectUrl:'https://zvtaqzcqfdjpuwnlpzln.supabase.co',serviceKey:'sb_secret_fixture',webhookSecret:secret};
 const request=()=>{const s=signed(notice());return new Request('https://example.test',{method:'POST',headers:{'stripe-signature':s.signature},body:s.raw});};
 assert.equal((await createTestEdgeWebhook({...options,fetchImpl:()=>assert.fail('not activated')})(request())).status,503);
 let calls=0;const h=createTestEdgeWebhook({...options,disputesEnabled:true,fetchImpl:async(u,o)=>{calls++;assert.ok(u.endsWith('/rr_test_process_risk_notice'));assert.equal(JSON.parse(o.body).p_case,'du_fixture');return Response.json({duplicate:false,state:'held'});}});const r=await h(request());assert.equal(r.status,200);assert.deepEqual(await r.json(),{received:true});assert.equal(calls,1);
 const retry=createTestEdgeWebhook({...options,disputesEnabled:true,fetchImpl:async()=>new Response('Unknown bound payment',{status:400})});assert.equal((await retry(request())).status,503);
});
