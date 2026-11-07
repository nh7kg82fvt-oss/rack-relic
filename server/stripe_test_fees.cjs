'use strict';
const {stripeEnvironment,matchesEnvironmentMetadata}=require('./test_stripe_environment.cjs');
// Evidence collection only. No fee allocation, balance release or provider write.
const VERSION='2026-10-28.endive';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
function createStripeTestFeeClient({secretKey,accountId,fetchImpl=globalThis.fetch,clock=Date.now}={}){
 const environment=stripeEnvironment(accountId);
 if(!/^(sk|rk)_test_[A-Za-z0-9]+$/.test(secretKey||'')||typeof fetchImpl!=='function')throw Error('Rack Relic test credentials required');
 async function get(path){
  let r;try{r=await fetchImpl('https://api.stripe.com'+path,{method:'GET',cache:'no-store',redirect:'error',signal:AbortSignal.timeout(10000),headers:{Authorization:'Bearer '+secretKey,'Stripe-Version':VERSION}});}catch{throw Error('Processing fee evidence unavailable');}
  const age=r.headers?.get('age');
  if(!r.ok||age!=null&&(!/^\d+$/.test(age)||Number(age)>0)||['x-vercel-cache','cf-cache-status'].some(k=>['HIT','STALE','UPDATING'].includes((r.headers?.get(k)||'').toUpperCase())))throw Error('Fresh processing fee evidence required');
  try{return await r.json();}catch{throw Error('Invalid processing fee evidence');}
 }
 return Object.freeze({async read(order){
  const o=Object.freeze({...order});
  if(o.test!==true||!UUID.test(o.orderId||'')||!/^pi_[A-Za-z0-9]+$/.test(o.paymentIntentId||'')||!Number.isSafeInteger(o.totalCents)||o.totalCents<1||o.totalCents>30000000)throw Error('Trusted paid test order required');
  const [account,balance]=await Promise.all([get('/v1/account'),get('/v1/balance')]);
  if(account.id!==environment.accountId||balance.livemode!==false)throw Error('Wrong Stripe test account');
  const p=await get('/v1/payment_intents/'+o.paymentIntentId);
  if(p.id!==o.paymentIntentId||p.livemode!==false||p.status!=='succeeded'||p.amount!==o.totalCents||p.amount_received!==o.totalCents||p.currency!=='usd'||p.metadata?.order_id!==o.orderId||!matchesEnvironmentMetadata(p.metadata,environment)||p.transfer_group!=='rr_test_'+o.orderId||!/^ch_[A-Za-z0-9]+$/.test(p.latest_charge||'')||p.transfer_data||p.application_fee_amount||p.on_behalf_of)throw Error('Platform test payment required');
  const c=await get('/v1/charges/'+p.latest_charge);
  // Refunded payments still incur an original charge fee. Never infer a refund fee here.
  if(c.object!=='charge'||c.id!==p.latest_charge||c.payment_intent!==p.id||c.livemode!==false||c.status!=='succeeded'||c.paid!==true||c.captured!==true||c.currency!=='usd'||c.amount!==o.totalCents||c.amount_captured!==o.totalCents||c.transfer||c.transfer_data||c.source_transfer||c.application_fee||c.application_fee_amount||c.on_behalf_of||!/^txn_[A-Za-z0-9]+$/.test(c.balance_transaction||''))throw Error('Captured platform charge evidence required');
  const b=await get('/v1/balance_transactions/'+c.balance_transaction);
  if(b.object!=='balance_transaction'||b.id!==c.balance_transaction||b.source!==c.id||b.currency!=='usd'||b.amount!==o.totalCents||!['charge','payment'].includes(b.type)||!['charge','payment'].includes(b.reporting_category)||!['pending','available'].includes(b.status)||!Number.isSafeInteger(b.fee)||b.fee<0||b.fee>b.amount||!Number.isSafeInteger(b.net)||b.net!==b.amount-b.fee||b.exchange_rate!=null)throw Error('Matching USD charge balance evidence required');
  if(!Array.isArray(b.fee_details)||b.fee_details.length>20||b.fee_details.some(d=>!['stripe_fee','tax'].includes(d.type)||d.currency!=='usd'||!Number.isSafeInteger(d.amount)||d.amount<0||d.application!=null)||b.fee_details.reduce((sum,d)=>sum+d.amount,0)!==b.fee)throw Error('Unresolved fee components');
  return Object.freeze({test:true,orderId:o.orderId,paymentIntentId:p.id,chargeId:c.id,balanceTransactionId:b.id,grossCents:b.amount,feeCents:b.fee,netCents:b.net,currency:'USD',feeDetails:b.fee_details.map(d=>({type:d.type,amountCents:d.amount,currency:'USD'})).sort((a,b)=>a.type.localeCompare(b.type)||a.amountCents-b.amountCents),checkedAt:clock()});
 }});
}
module.exports={createStripeTestFeeClient};
