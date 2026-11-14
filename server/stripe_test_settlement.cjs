'use strict';
const {getTestEnvironmentByAccount}=require('./test_environment_registry.cjs');
const {stripeEnvironment,integrationTag,environmentMetadata,matchesEnvironmentMetadata,idempotencyKey}=require('./test_stripe_environment.cjs');
// Server adapter for explicitly authorized sandbox simulations only. Its
// caller must obtain a single durable database dispatch claim first. A browser
// assertion or this module's input validation is never release authority.
const VERSION='2026-10-28.endive';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const IDS={account:/^acct_[A-Za-z0-9]+$/,transfer:/^tr_[A-Za-z0-9]+$/,payout:/^po_[A-Za-z0-9]+$/,reversal:/^trr_[A-Za-z0-9]+$/,transaction:/^txn_[A-Za-z0-9]+$/,bank:/^ba_[A-Za-z0-9]+$/};
const integer=(v,max=30000000)=>Number.isSafeInteger(v)&&v>=0&&v<=max;
class SettlementProviderError extends Error{
 constructor(code='provider_outcome_unknown'){super('Sandbox settlement evidence unavailable; keep the saved request held');this.name='SettlementProviderError';this.code=['provider_balance_insufficient','provider_outcome_unknown','provider_rejected'].includes(code)?code:'provider_outcome_unknown';}
}
const error=(code)=>new SettlementProviderError(code);
function validateBinding(q){
 if(q?.test!==true||q.simulationOnly!==true||!UUID.test(q.orderId||'')||!UUID.test(q.sellerId||'')
  ||!IDS.account.test(q.accountId||'')||getTestEnvironmentByAccount(q.accountId))throw error();
}
function snapshot(request,kind,creating){
 const q=Object.freeze({...request});validateBinding(q);
 if(!['transfer','payout','reversal'].includes(kind)||q.kind!==kind||!UUID.test(q.requestId||'')||q.currency!=='USD'||!integer(q.amountCents)||q.amountCents<1
  ||!integer(q.totalCents)||q.totalCents<q.amountCents||!integer(q.itemCents)||q.itemCents<1||q.itemCents>q.totalCents
  ||!integer(q.maxTransferCents)||q.maxTransferCents<1||q.maxTransferCents>q.itemCents
  ||!/^pi_[A-Za-z0-9]+$/.test(q.paymentIntentId||'')||!/^ch_[A-Za-z0-9]+$/.test(q.chargeId||'')
  ||q.transferGroup!=='rr_test_'+q.orderId||q.application_fee_amount!==undefined||q.transfer_data!==undefined||q.on_behalf_of!==undefined
  ||q.method!==undefined&&q.method!=='standard')throw error();
 if(creating?(q.phase!=='dispatched'||q.providerId!==null):(q.phase!=='known'||!IDS[kind].test(q.providerId||'')))throw error();
 if(kind==='transfer'){
  if(q.amountCents>q.maxTransferCents||q.parentProviderId!==null||q.parentRequestId!=null||!integer(q.platformReserveCents??0))throw error();
 }else if(!UUID.test(q.parentRequestId||'')||q.parentRequestId===q.requestId||!IDS.transfer.test(q.parentProviderId||'')
  ||!integer(q.parentAmountCents)||q.parentAmountCents<q.amountCents||q.parentAmountCents>q.maxTransferCents)throw error();
 if(kind==='payout'&&(!IDS.bank.test(q.bankAccountId||'')||!integer(q.payoutFeeReserveCents??0)))throw error();
 return q;
}
function createStripeTestSettlementClient({secretKey,accountId,fetchImpl=globalThis.fetch,clock=Date.now}={}){
 const environment=stripeEnvironment(accountId),ACCOUNT=environment.accountId;
 if(!/^(sk|rk)_test_[A-Za-z0-9]+$/.test(secretKey||'')||typeof fetchImpl!=='function'||typeof clock!=='function')throw Error('Rack Relic sandbox credentials required');
 async function call(path,{connected,body,key}={}){
  let r;try{r=await fetchImpl('https://api.stripe.com'+path,{method:body?'POST':'GET',redirect:'error',cache:'no-store',signal:AbortSignal.timeout(15000),headers:{Authorization:'Bearer '+secretKey,'Stripe-Version':VERSION,...(connected?{'Stripe-Account':connected}:{}),...(body?{'Content-Type':'application/x-www-form-urlencoded','Idempotency-Key':key}:{})},...(body?{body:body.toString()}:{})});}catch{throw error();}
  const age=r.headers?.get('age');
  if(age!=null&&(!/^\d+$/.test(age)||Number(age)>0)||['x-vercel-cache','cf-cache-status'].some(k=>['HIT','STALE','UPDATING'].includes((r.headers?.get(k)||'').toUpperCase())))throw error();
  if(!r.ok){
   let code;try{code=(await r.json())?.error?.code;}catch{}
   if(code==='balance_insufficient')throw error('provider_balance_insufficient');
   throw error(r.status>=400&&r.status<500&&![408,409].includes(r.status)?'provider_rejected':'provider_outcome_unknown');
  }
  try{return await r.json();}catch{throw error();}
 }
 function balance(b){
  if(b?.object!=='balance'||b.livemode!==false||!Array.isArray(b.available)||b.available.length>100
   ||b.available.some(v=>!v||typeof v!=='object'||!(/^[a-z]{3}$/).test(v.currency||'')||!Number.isSafeInteger(v.amount)||Math.abs(v.amount)>30000000))throw error();
  const usd=b.available.filter(v=>v.currency==='usd');
  if(usd.length>1)throw error();
  if(!usd.length)return 0;
  const card=usd[0].source_types?.card??0;
  // A negative balance must not hide existing payout failures from retrieval.
  // New writes independently require positive available card funds below.
  if(!Number.isSafeInteger(usd[0].amount)||Math.abs(usd[0].amount)>30000000||!Number.isSafeInteger(card)||Math.abs(card)>30000000)throw error();
  // Another payment rail can make the total USD balance lower than the card
  // bucket. Neither amount alone proves that a new transfer can be funded.
  return Math.min(usd[0].amount,card);
 }
 async function platform(){
  const [a,b]=await Promise.all([call('/v1/account'),call('/v1/balance')]);
  if(a?.object!=='account'||a.id!==ACCOUNT||a.country!=='US')throw error();
  return balance(b);
 }
 async function connected(q,{active=false,manual=false}={}){
  const fields=new URLSearchParams([['include[0]','configuration.recipient'],['include[1]','defaults'],['include[2]','identity'],['include[3]','requirements']]);
  const a=await call('/v2/core/accounts/'+q.accountId+'?'+fields);
  const status=a?.configuration?.recipient?.capabilities?.stripe_balance?.stripe_transfers?.status;
  if(a?.object!=='v2.core.account'||a.id!==q.accountId||a.livemode!==false||!/^us$/i.test(a.identity?.country||'')
   ||a.metadata?.rr_test_seller_id!==q.sellerId||a.metadata?.rr_test_platform!==ACCOUNT||!matchesEnvironmentMetadata(a.metadata,environment)
   ||!Array.isArray(a.applied_configurations)||!a.applied_configurations.includes('recipient')
   ||!['active','pending','restricted','unsupported','rejected'].includes(status)
   ||active&&(status!=='active'||a.dashboard!=='express'||a.defaults?.responsibilities?.fees_collector!=='application'||a.defaults?.responsibilities?.losses_collector!=='application'))throw error();
  const available=balance(await call('/v1/balance',{connected:q.accountId}));
  if(manual){
   // Stripe still manages payout settings through v1. Capability eligibility is
   // taken exclusively from the Accounts v2 response above.
   const settings=await call('/v1/accounts/'+q.accountId);
   if(settings?.object!=='account'||settings.id!==q.accountId||settings.settings?.payouts?.schedule?.interval!=='manual')throw error();
  }
  return available;
 }
 function matchesMetadata(v,q,kind=q.kind,requestId=q.requestId,parent=q.parentRequestId){
  return v?.integration===integrationTag(environment,'rack_relic_test_settlement')&&matchesEnvironmentMetadata(v,environment)&&v.platform_id===ACCOUNT&&v.request_id===requestId
   &&v.order_id===q.orderId&&v.seller_id===q.sellerId&&v.kind===kind
   &&(parent==null?v.parent_request_id==null:v.parent_request_id===parent);
 }
 function metadata(q){
  return {'metadata[integration]':integrationTag(environment,'rack_relic_test_settlement'),...Object.fromEntries(Object.entries(environmentMetadata(environment)).map(([k,v])=>['metadata['+k+']',v])),'metadata[platform_id]':ACCOUNT,'metadata[request_id]':q.requestId,
   'metadata[order_id]':q.orderId,'metadata[seller_id]':q.sellerId,'metadata[kind]':q.kind,...(q.parentRequestId?{'metadata[parent_request_id]':q.parentRequestId}:{})};
 }
 function transfer(t,q,{parent=false}={}){
  if(t?.object!=='transfer'||!IDS.transfer.test(t.id||'')||t.livemode!==false||t.currency!=='usd'
   ||t.amount!==(parent?q.parentAmountCents:q.amountCents)||t.destination!==q.accountId||t.source_transaction!==q.chargeId
   ||t.transfer_group!==q.transferGroup||!integer(t.amount_reversed)||t.amount_reversed>t.amount||typeof t.reversed!=='boolean'
   ||t.reversed!==(t.amount_reversed===t.amount)||!IDS.transaction.test(t.balance_transaction||'')
   ||!matchesMetadata(t.metadata,q,'transfer',parent?q.parentRequestId:q.requestId,null)
   ||(parent?t.id!==q.parentProviderId:q.providerId!==null&&t.id!==q.providerId))throw error();
  return t;
 }
 async function transaction(id,{source,amount,types,connected:scope,available=false,zeroFee=false}){
  if(!IDS.transaction.test(id||''))throw error();
  const b=await call('/v1/balance_transactions/'+id,{connected:scope});
  if(b?.object!=='balance_transaction'||b.id!==id||b.source!==source||b.currency!=='usd'||b.amount!==amount
   ||!types.includes(b.type)||!['available','pending'].includes(b.status)||available&&b.status!=='available'
   ||!integer(b.fee)||zeroFee&&b.fee!==0||!Number.isSafeInteger(b.net)||b.net!==b.amount-b.fee||b.exchange_rate!=null)throw error();
  return b;
 }
 async function paidCharge(q){
  const p=await call('/v1/payment_intents/'+q.paymentIntentId);
  if(p?.id!==q.paymentIntentId||p.livemode!==false||p.status!=='succeeded'||p.currency!=='usd'||p.amount!==q.totalCents||p.amount_received!==q.totalCents
   ||p.latest_charge!==q.chargeId||p.metadata?.order_id!==q.orderId||!matchesEnvironmentMetadata(p.metadata,environment)||p.transfer_group!==q.transferGroup||p.transfer_data||p.application_fee_amount||p.on_behalf_of)throw error();
  const c=await call('/v1/charges/'+q.chargeId);
  if(c?.object!=='charge'||c.id!==q.chargeId||c.payment_intent!==q.paymentIntentId||c.livemode!==false||c.status!=='succeeded'||c.paid!==true||c.captured!==true
   ||c.disputed!==false||c.refunded!==false||c.amount_refunded!==0||c.currency!=='usd'||c.amount!==q.totalCents||c.amount_captured!==q.totalCents
   ||c.transfer||c.transfer_data||c.source_transfer||c.application_fee||c.application_fee_amount||c.on_behalf_of||c.review!=null
   ||c.outcome?.type!=='authorized'||c.outcome?.risk_level!=='normal')throw error();
  // A refund can be pending while amount_refunded is still zero. Check the
  // complete charge-scoped inventory before starting a new money movement.
  const refunds=await call('/v1/refunds?'+new URLSearchParams({charge:q.chargeId,limit:'100'}));
  if(refunds?.object!=='list'||refunds.has_more!==false||!Array.isArray(refunds.data)||refunds.data.length>100
   ||refunds.data.some(r=>r?.object!=='refund'||!/^re_[A-Za-z0-9]+$/.test(r.id||'')||r.charge!==q.chargeId||r.payment_intent!==q.paymentIntentId
    ||r.livemode===true||r.currency!=='usd'||!integer(r.amount)||r.amount<1||r.amount>q.totalCents||!['failed','canceled'].includes(r.status)))throw error();
  const b=await transaction(c.balance_transaction,{source:c.id,amount:q.totalCents,types:['charge','payment'],available:true});
  if(b.fee>b.amount||!Array.isArray(b.fee_details)||b.fee_details.length>20||b.fee_details.some(d=>!['stripe_fee','tax'].includes(d?.type)
   ||d.currency!=='usd'||!integer(d.amount)||d.application!=null)||b.fee_details.reduce((n,d)=>n+d.amount,0)!==b.fee)throw error();
  return b;
 }
 function result(q,id,status,bt,failureBt=null,failureCode=null){
  const checkedAt=clock();if(!Number.isSafeInteger(checkedAt)||checkedAt<1000000000000)throw error();
  return Object.freeze({test:true,simulationOnly:true,source:'stripe_sandbox',requestId:q.requestId,orderId:q.orderId,kind:q.kind,
   providerId:id,parentProviderId:q.parentProviderId,accountId:q.accountId,currency:'USD',amountCents:q.amountCents,status,
   checkedAt,balanceTransactionId:bt,failureBalanceTransactionId:failureBt,failureCode});
 }
 async function transferEvidence(t,q){
  transfer(t,q);await transaction(t.balance_transaction,{source:t.id,amount:-q.amountCents,types:['transfer'],zeroFee:true});
  return result(q,t.id,'succeeded',t.balance_transaction);
 }
 async function payoutEvidence(p,q){
  if(p?.object!=='payout'||!IDS.payout.test(p.id||'')||q.providerId!==null&&p.id!==q.providerId||p.livemode!==false
   ||p.amount!==q.amountCents||p.currency!=='usd'||p.automatic!==false||p.method!=='standard'||p.type!=='bank_account'
   ||p.source_type!=='card'||p.destination!==q.bankAccountId||p.original_payout||p.reversed_by||p.application_fee||p.application_fee_amount
   ||!['pending','in_transit','paid','failed','canceled'].includes(p.status)||!matchesMetadata(p.metadata,q)
   ||p.balance_transaction!==null&&!IDS.transaction.test(p.balance_transaction||'')
   ||p.failure_balance_transaction!==null&&!IDS.transaction.test(p.failure_balance_transaction||'')
   ||p.failure_code!==null&&(typeof p.failure_code!=='string'||!/^[a-z0-9_]{1,80}$/.test(p.failure_code)))throw error();
  if(p.balance_transaction!==null)await transaction(p.balance_transaction,{source:p.id,amount:-q.amountCents,types:['payout'],connected:q.accountId});
  if(p.status==='paid'&&p.balance_transaction===null)throw error();
  if(!['failed','canceled'].includes(p.status)&&(p.failure_balance_transaction!==null||p.failure_code!==null))throw error();
  if(p.failure_balance_transaction!==null)await transaction(p.failure_balance_transaction,{source:p.id,amount:q.amountCents,types:['payout_failure','payout_cancel'],connected:q.accountId,available:true,zeroFee:true});
  return result(q,p.id,p.status,p.balance_transaction,p.failure_balance_transaction,p.failure_code);
 }
 async function reversalEvidence(r,q){
  // Stripe reversal objects have no livemode field. The fixed platform and
  // matching parent transfer supply the required test-mode binding.
  if(r?.object!=='transfer_reversal'||!IDS.reversal.test(r.id||'')||q.providerId!==null&&r.id!==q.providerId||r.livemode===true
   ||r.amount!==q.amountCents||r.currency!=='usd'||r.transfer!==q.parentProviderId||r.source_refund!=null||!matchesMetadata(r.metadata,q)
   ||!IDS.transaction.test(r.balance_transaction||''))throw error();
  await transaction(r.balance_transaction,{source:r.id,amount:q.amountCents,types:['transfer_refund'],available:true,zeroFee:true});
  return result(q,r.id,'succeeded',r.balance_transaction);
 }
 async function bank(q,id){
  if(!IDS.bank.test(id||''))throw error();
  const b=await call('/v1/accounts/'+q.accountId+'/external_accounts/'+id);
  if(b?.object!=='bank_account'||b.id!==id||b.account!==q.accountId||b.currency!=='usd'||b.country!=='US'||b.default_for_currency!==true
   ||!['new','validated','verified'].includes(b.status)||!Array.isArray(b.available_payout_methods)||!b.available_payout_methods.includes('standard'))throw error();
  return id;
 }
 const client=Object.freeze({
  async findExisting(request){
   const q=snapshot(request,request?.kind,true);await platform();await connected(q);
   const params=new URLSearchParams({limit:'100'});let path,scope;
   if(q.kind==='transfer'){path='/v1/transfers';params.set('transfer_group',q.transferGroup);params.set('destination',q.accountId);}
   else{
    transfer(await call('/v1/transfers/'+q.parentProviderId),q,{parent:true});
    if(q.kind==='payout'){
     path='/v1/payouts';scope=q.accountId;params.set('destination',q.bankAccountId);
     if(q.dispatchedAt!=null){
      if(!Number.isSafeInteger(q.dispatchedAt)||q.dispatchedAt<1000000000000||q.dispatchedAt>clock()+60000)throw error();
      params.set('created[gte]',String(Math.floor(q.dispatchedAt/1000)-1));
     }
    }else path='/v1/transfers/'+q.parentProviderId+'/reversals';
   }
   const list=await call(path+'?'+params,{connected:scope});
   // An incomplete inventory cannot prove uniqueness or absence. This routine
   // intentionally performs no retry, pagination, or creation after an unknown
   // write outcome, even if Stripe has not made the object visible yet.
   if(list?.object!=='list'||list.has_more!==false||!Array.isArray(list.data)||list.data.length>100)throw error();
   const matches=list.data.filter(v=>matchesMetadata(v?.metadata,q));
   if(matches.length===0)return null;
   if(matches.length!==1||!IDS[q.kind].test(matches[0].id||'')||matches[0].amount!==q.amountCents||matches[0].currency!=='usd')throw error();
   const known={...q,phase:'known',providerId:matches[0].id};
   return client[q.kind==='transfer'?'retrieveTransfer':q.kind==='payout'?'retrievePayout':'retrieveReversal'](known);
  },
  async inspectBinding(input){
   const q=Object.freeze({...input});validateBinding(q);await platform();await connected(q);
   const banks=await call('/v1/accounts/'+q.accountId+'/external_accounts?object=bank_account&limit=100');
   if(banks?.object!=='list'||banks.has_more!==false||!Array.isArray(banks.data)||banks.data.length>100)throw error();
   const defaults=banks.data.filter(b=>b?.currency==='usd'&&b.default_for_currency===true);
   if(defaults.length>1)throw error();
   const bankAccountId=defaults.length?await bank(q,defaults[0].id):null;
   const checkedAt=clock();if(!Number.isSafeInteger(checkedAt)||checkedAt<1000000000000)throw error();
   return Object.freeze({test:true,simulationOnly:true,source:'stripe_sandbox',accountId:q.accountId,bankAccountId,checkedAt});
  },
  async createTransfer(request){
   const q=snapshot(request,'transfer',true),available=await platform();await connected(q,{active:true,manual:true});const charge=await paidCharge(q);
   const retained=q.totalCents-q.maxTransferCents;if(retained<charge.fee)throw error();
   if(available<q.amountCents+retained-charge.fee+(q.platformReserveCents??0))throw error('provider_balance_insufficient');
   const form=new URLSearchParams({amount:String(q.amountCents),currency:'usd',destination:q.accountId,source_transaction:q.chargeId,transfer_group:q.transferGroup,...metadata(q)});
   return transferEvidence(await call('/v1/transfers',{body:form,key:idempotencyKey(environment,'rr_test_settlement_transfer_',q.requestId)}),q);
  },
  async retrieveTransfer(request){const q=snapshot(request,'transfer',false);await platform();await connected(q);return transferEvidence(await call('/v1/transfers/'+q.providerId),q);},
  async createPayout(request){
   const q=snapshot(request,'payout',true);await platform();const available=await connected(q,{active:true,manual:true});await paidCharge(q);
   const parent=transfer(await call('/v1/transfers/'+q.parentProviderId),q,{parent:true});
   if(q.amountCents>parent.amount-parent.amount_reversed)throw error();
   if(available<q.amountCents+(q.payoutFeeReserveCents??0))throw error('provider_balance_insufficient');await bank(q,q.bankAccountId);
   const form=new URLSearchParams({amount:String(q.amountCents),currency:'usd',destination:q.bankAccountId,method:'standard',source_type:'card',...metadata(q)});
   return payoutEvidence(await call('/v1/payouts',{connected:q.accountId,body:form,key:idempotencyKey(environment,'rr_test_settlement_payout_',q.requestId)}),q);
  },
  async retrievePayout(request){
   const q=snapshot(request,'payout',false);await platform();await connected(q);transfer(await call('/v1/transfers/'+q.parentProviderId),q,{parent:true});
   return payoutEvidence(await call('/v1/payouts/'+q.providerId,{connected:q.accountId}),q);
  },
  async createReversal(request){
   const q=snapshot(request,'reversal',true);await platform();const available=await connected(q);const parent=transfer(await call('/v1/transfers/'+q.parentProviderId),q,{parent:true});
   if(q.amountCents>parent.amount-parent.amount_reversed)throw error();
   if(available<q.amountCents)throw error('provider_balance_insufficient');
   const form=new URLSearchParams({amount:String(q.amountCents),...metadata(q)});
   return reversalEvidence(await call('/v1/transfers/'+q.parentProviderId+'/reversals',{body:form,key:idempotencyKey(environment,'rr_test_settlement_reversal_',q.requestId)}),q);
  },
  async retrieveReversal(request){
   const q=snapshot(request,'reversal',false);await platform();await connected(q);const parent=transfer(await call('/v1/transfers/'+q.parentProviderId),q,{parent:true});
   const r=await call('/v1/transfers/'+q.parentProviderId+'/reversals/'+q.providerId);
   if(parent.amount_reversed<q.amountCents)throw error();return reversalEvidence(r,q);
  }
 });
 return client;
}
module.exports={createStripeTestSettlementClient,SettlementProviderError};
