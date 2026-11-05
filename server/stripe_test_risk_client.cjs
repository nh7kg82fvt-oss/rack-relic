'use strict';
const {evaluateTestCharge}=require('./stripe_test_risk.cjs');
const ACCOUNT='acct_1UWJZuGVbz9Pnhxd',VERSION='2026-10-28.endive';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
function createStripeTestRiskClient({secretKey,accountId,fetchImpl=globalThis.fetch,clock=Date.now}={}){
 if(accountId!==ACCOUNT||!/^(sk|rk)_test_[A-Za-z0-9]+$/.test(secretKey||'')||typeof fetchImpl!=='function')throw Error('Rack Relic test credentials required');
 async function get(path){
  let r;try{r=await fetchImpl('https://api.stripe.com'+path,{method:'GET',cache:'no-store',redirect:'error',signal:AbortSignal.timeout(10000),headers:{Authorization:'Bearer '+secretKey,'Stripe-Version':VERSION}});}catch{throw Error('Risk evidence unavailable');}
  const age=r.headers?.get('age');if(!r.ok||age!=null&&(!/^\d+$/.test(age)||Number(age)>0)||['x-vercel-cache','cf-cache-status'].some(k=>['HIT','STALE','UPDATING'].includes((r.headers?.get(k)||'').toUpperCase())))throw Error('Fresh risk evidence required');
  try{return await r.json();}catch{throw Error('Invalid risk evidence');}
 }
 return Object.freeze({async read(order){
  const o=Object.freeze({...order});if(o.test!==true||!UUID.test(o.orderId||'')||!/^pi_[A-Za-z0-9]+$/.test(o.paymentIntentId||'')||!Number.isSafeInteger(o.totalCents)||o.totalCents<1||o.totalCents>30000000)throw Error('Trusted paid test order required');
  const [a,b]=await Promise.all([get('/v1/account'),get('/v1/balance')]);if(a.id!==ACCOUNT||b.livemode!==false)throw Error('Wrong Stripe test account');
  const p=await get('/v1/payment_intents/'+o.paymentIntentId);
  if(p.id!==o.paymentIntentId||p.livemode!==false||p.status!=='succeeded'||p.amount!==o.totalCents||p.amount_received!==o.totalCents||p.currency!=='usd'||p.metadata?.order_id!==o.orderId||p.transfer_group!=='rr_test_'+o.orderId||!/^ch_[A-Za-z0-9]+$/.test(p.latest_charge||'')||p.transfer_data||p.application_fee_amount||p.on_behalf_of)throw Error('Matching platform test payment required');
  const c=await get('/v1/charges/'+p.latest_charge);
  if(c.object!=='charge'||c.id!==p.latest_charge||c.payment_intent!==p.id||c.status!=='succeeded'||c.amount_captured!==o.totalCents||c.transfer||c.transfer_data||c.source_transfer||c.application_fee||c.application_fee_amount||c.on_behalf_of)throw Error('Captured platform charge required');
  if(c.review){const id=typeof c.review==='string'?c.review:c.review.id;if(!/^prv_[A-Za-z0-9]+$/.test(id||''))throw Error('Review identity required');const review=await get('/v1/reviews/'+id);if(review.id!==id||review.object!=='review'||review.livemode!==false||review.charge!==c.id)throw Error('Matching test review required');c.review=review;}
  return evaluateTestCharge({charge:c,order:{test:true,orderId:o.orderId,totalCents:o.totalCents},checkedAt:clock(),shippingAddressChanged:false},clock());
 }});
}
module.exports={createStripeTestRiskClient};
