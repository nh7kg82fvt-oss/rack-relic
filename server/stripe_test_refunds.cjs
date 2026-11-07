'use strict';
const {stripeEnvironment,integrationTag,environmentMetadata,matchesEnvironmentMetadata,idempotencyKey}=require('./test_stripe_environment.cjs');
const VERSION='2026-10-28.endive';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
function validateRequest(q){
 if(!UUID.test(q?.id||'')||!UUID.test(q?.order_id||'')||!/^pi_[A-Za-z0-9]+$/.test(q?.payment_intent_id||'')||!Number.isSafeInteger(q?.amount_cents)||!Number.isSafeInteger(q?.total_cents)||q.amount_cents<1||q.amount_cents>q.total_cents||q.total_cents>30000000)throw Error('Trusted refund request required');
}
function refundBaseline(value,total,requested){
 if(!Array.isArray(value)||value.length>100)throw Error('Verified refund inventory baseline required');
 const baseline=new Map();let completed=0;
 for(const r of value){
  if(!r||Object.keys(r).sort().join(',')!=='amount_cents,charge_id,id'||!/^re_[A-Za-z0-9]+$/.test(r.id||'')||!/^ch_[A-Za-z0-9]+$/.test(r.charge_id||'')
   ||!Number.isSafeInteger(r.amount_cents)||r.amount_cents<1||r.amount_cents>total||baseline.has(r.id))throw Error('Verified refund inventory baseline required');
  baseline.set(r.id,Object.freeze({amountCents:r.amount_cents,chargeId:r.charge_id}));completed+=r.amount_cents;
 }
 if(completed+requested>total)throw Error('Confirmed refund inventory exceeds payment');
 return {baseline,completed};
}
function createStripeTestRefundClient({secretKey,accountId,fetchImpl=globalThis.fetch}={}){
 const environment=stripeEnvironment(accountId);
 if(typeof secretKey!=='string'||!/^(sk|rk)_test_[A-Za-z0-9]+$/.test(secretKey)||typeof fetchImpl!=='function')throw Error('Rack Relic sandbox credentials required');
 async function call(path,{body,key}={}){
  let r;try{r=await fetchImpl('https://api.stripe.com'+path,{method:body?'POST':'GET',redirect:'error',cache:'no-store',signal:AbortSignal.timeout(15000),headers:{Authorization:'Bearer '+secretKey,'Stripe-Version':VERSION,...(body?{'Content-Type':'application/x-www-form-urlencoded','Idempotency-Key':key}:{})},...(body?{body:body.toString()}:{})});}catch{throw Error('Refund outcome unavailable; keep request held');}
  const age=r.headers?.get('age');
  if(!r.ok||age!=null&&(!/^\d+$/.test(age)||Number(age)>0)||['x-vercel-cache','cf-cache-status'].some(k=>['HIT','STALE','UPDATING'].includes((r.headers?.get(k)||'').toUpperCase())))throw Error('Refund evidence unavailable; keep request held');
  try{return await r.json();}catch{throw Error('Invalid refund evidence; keep request held');}
 }
 async function account(){
  const [a,b]=await Promise.all([call('/v1/account'),call('/v1/balance')]);
  if(a.id!==environment.accountId||b.livemode!==false)throw Error('Wrong Stripe sandbox');
 }
 function validateRefund(r,q,expectedCharge){
  if(r?.object!=='refund'||!/^re_[A-Za-z0-9]+$/.test(r.id||'')||r.livemode===true||r.payment_intent!==q.payment_intent_id||r.amount!==q.amount_cents||r.currency!=='usd'||!/^ch_[A-Za-z0-9]+$/.test(r.charge||'')||r.charge!==expectedCharge||q.refund_id&&r.id!==q.refund_id||r.metadata?.integration!==integrationTag(environment,'rack_relic_test_refund')||!matchesEnvironmentMetadata(r.metadata,environment)||r.metadata?.request_id!==q.id||r.metadata?.order_id!==q.order_id||r.source_transfer_reversal||r.transfer_reversal||!['pending','requires_action','succeeded','failed','canceled'].includes(r.status))throw Error('Refund does not match the saved request');
  return Object.freeze({test:true,refundId:r.id,chargeId:r.charge,status:r.status});
 }
 return Object.freeze({
  async createRefund(request){
   const q=Object.freeze({...request});validateRequest(q);
   if(q.phase!=='dispatched'||q.refund_id)throw Error('One durable dispatch claim required');
   // Copy the private database baseline before any await. Browser assertions
   // and a mutable caller-owned array cannot become refund authority.
   const {baseline,completed}=refundBaseline(q.refund_baseline,q.total_cents,q.amount_cents);
   await account();
   const p=await call('/v1/payment_intents/'+q.payment_intent_id);
   if(p.id!==q.payment_intent_id||p.livemode!==false||p.status!=='succeeded'||p.currency!=='usd'||p.amount!==q.total_cents||p.amount_received!==q.total_cents||p.metadata?.order_id!==q.order_id||!matchesEnvironmentMetadata(p.metadata,environment)||p.transfer_group!=='rr_test_'+q.order_id||!/^ch_[A-Za-z0-9]+$/.test(p.latest_charge||'')||p.transfer_data||p.application_fee_amount||p.on_behalf_of)throw Error('Verified platform test payment required');
   const charge=await call('/v1/charges/'+p.latest_charge);
   if(charge.object!=='charge'||charge.id!==p.latest_charge||charge.payment_intent!==p.id||charge.livemode!==false||charge.status!=='succeeded'||charge.paid!==true||charge.captured!==true||charge.disputed!==false||charge.refunded!==false||charge.currency!=='usd'||charge.amount!==q.total_cents||charge.amount_captured!==q.total_cents||!Number.isSafeInteger(charge.amount_refunded)||charge.amount_refunded<0||charge.amount_refunded+q.amount_cents>q.total_cents||charge.transfer||charge.transfer_data||charge.source_transfer||charge.application_fee||charge.application_fee_amount||charge.on_behalf_of)throw Error('Refundable platform test charge required');
   if(charge.amount_refunded!==completed)throw Error('Provider and saved refund totals require reconciliation');
   // amount_refunded alone cannot disclose a pending refund. Read the complete
   // charge-scoped inventory and match every succeeded refund by saved ID and
   // amount. Unknown, pending, conflicting or incomplete evidence stays held.
   const refunds=await call('/v1/refunds?'+new URLSearchParams({charge:charge.id,limit:'100'}));
   if(refunds?.object!=='list'||refunds.has_more!==false||!Array.isArray(refunds.data)||refunds.data.length>100)throw Error('Complete provider refund inventory required');
   const seen=new Set(),matched=new Set();
   for(const r of refunds.data){
    if(r?.object!=='refund'||!/^re_[A-Za-z0-9]+$/.test(r.id||'')||seen.has(r.id)||r.livemode===true
     ||r.charge!==charge.id||r.payment_intent!==q.payment_intent_id||r.currency!=='usd'
     ||!Number.isSafeInteger(r.amount)||r.amount<1||r.amount>q.total_cents||r.source_transfer_reversal||r.transfer_reversal
     ||!['succeeded','failed','canceled'].includes(r.status))throw Error('Provider refund inventory requires reconciliation');
    seen.add(r.id);
    if(r.status==='succeeded'){
     const saved=baseline.get(r.id);
     if(saved?.amountCents!==r.amount||saved.chargeId!==r.charge)throw Error('Unreconciled provider refund requires review');
     matched.add(r.id);
    }else if(baseline.has(r.id))throw Error('Confirmed refund status changed; keep request held');
   }
   if(matched.size!==baseline.size)throw Error('Saved refund missing from provider inventory');
   const form=new URLSearchParams({payment_intent:q.payment_intent_id,amount:String(q.amount_cents),reason:'requested_by_customer','metadata[integration]':integrationTag(environment,'rack_relic_test_refund'),...Object.fromEntries(Object.entries(environmentMetadata(environment)).map(([k,v])=>['metadata['+k+']',v])),'metadata[request_id]':q.id,'metadata[order_id]':q.order_id});
   // No retry loop: the durable dispatcher permits this POST only once, even
   // after Stripe's idempotency retention expires. No transfers are requested.
   return validateRefund(await call('/v1/refunds',{body:form,key:idempotencyKey(environment,'rr_test_refund_',q.id)}),q,p.latest_charge);
  },
  async retrieveRefund(request){
   const q=Object.freeze({...request});validateRequest(q);
   if(q.phase!=='known'||!/^re_[A-Za-z0-9]+$/.test(q.refund_id||'')||!/^ch_[A-Za-z0-9]+$/.test(q.charge_id||''))throw Error('Saved refund identity required');
   await account();
   return validateRefund(await call('/v1/refunds/'+q.refund_id),q,q.charge_id);
  }
 });
}
module.exports={createStripeTestRefundClient};
