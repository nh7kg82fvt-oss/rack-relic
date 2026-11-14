'use strict';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const KINDS=['transfer','payout','reversal'],STATUSES=['not_recorded','succeeded','pending','in_transit','paid','failed','canceled'];
const cents=v=>Number.isSafeInteger(v)&&v>=0&&v<=30000000;
class SettlementPending extends Error{}
function validateSettlementRequest(q){
 if(q?.test!==true||q.simulationOnly!==true||!UUID.test(q.requestId||'')||!UUID.test(q.orderId||'')||!UUID.test(q.sellerId||'')
  ||!/^acct_[A-Za-z0-9]+$/.test(q.accountId||'')||!KINDS.includes(q.kind)||q.currency!=='USD'||!cents(q.amountCents)||q.amountCents<1
  ||!cents(q.itemCents)||!cents(q.totalCents)||q.totalCents<q.itemCents||!cents(q.maxTransferCents)||q.maxTransferCents>q.itemCents
  ||!cents(q.platformReserveCents)||!cents(q.payoutFeeReserveCents)||!/^pi_[A-Za-z0-9]+$/.test(q.paymentIntentId||'')
  ||!/^ch_[A-Za-z0-9]+$/.test(q.chargeId||'')||q.transferGroup!=='rr_test_'+q.orderId
  ||!['prepared','dispatched','known'].includes(q.phase)||!STATUSES.includes(q.status)||typeof q.needsReview!=='boolean'
  ||q.releaseEnabled!==false||q.liveReady!==false)throw Error('Invalid saved settlement simulation');
 const identity=q.kind==='transfer'?/^tr_[A-Za-z0-9]+$/:q.kind==='payout'?/^po_[A-Za-z0-9]+$/:/^trr_[A-Za-z0-9]+$/;
 if(q.phase==='known'?!identity.test(q.providerId||''):q.providerId!==null)throw Error('Invalid saved simulation identity');
 if(q.kind==='transfer'){
  if(q.parentRequestId!==null||q.parentProviderId!==null||q.parentAmountCents!==null||q.bankAccountId!==null||!cents(q.availableCents)||q.availableCents>q.amountCents||q.amountCents>q.maxTransferCents)throw Error('Invalid transfer binding');
 }else if(!UUID.test(q.parentRequestId||'')||!/^tr_[A-Za-z0-9]+$/.test(q.parentProviderId||'')||!cents(q.parentAmountCents)||q.parentAmountCents<q.amountCents
  ||q.kind==='payout'&&!/^ba_[A-Za-z0-9]+$/.test(q.bankAccountId||'')||q.kind==='reversal'&&q.bankAccountId!==null)throw Error('Invalid parent simulation binding');
 if(q.kind!=='payout'&&!['not_recorded','succeeded'].includes(q.status)||q.kind==='payout'&&q.status==='succeeded')throw Error('Invalid provider simulation status');
 return Object.freeze({...q});
}
function createTestSettlementService({repository,stripe}={}){
 if(['settlementContext','recordSettlementBinding','prepareSettlement','dispatchSettlement','saveSettlement','recordSettlement','holdSettlement'].some(k=>typeof repository?.[k]!=='function')
  ||['inspectBinding','createTransfer','retrieveTransfer','createPayout','retrievePayout','createReversal','retrieveReversal','findExisting'].some(k=>typeof stripe?.[k]!=='function'))throw Error('Sandbox settlement dependencies required');
 const publicRequest=q=>({test:true,simulationOnly:true,orderId:q.orderId,requestId:q.requestId,kind:q.kind,amountCents:q.amountCents,
  state:q.status==='not_recorded'?q.phase==='prepared'?'prepared':'outcome_unknown':q.status,availableCents:q.kind==='transfer'?q.availableCents:null,needsReview:q.needsReview,
  recoveryRequired:q.needsReview||['failed','canceled'].includes(q.status),releaseEnabled:false,liveReady:false});
 async function context(input){
  const c=await repository.settlementContext(input);
  if(c?.test!==true||c.simulationOnly!==true||c.orderId!==input.orderId||!UUID.test(c.orderId||'')||c.releaseEnabled!==false||c.liveReady!==false
   ||!Array.isArray(c.blockers)||c.blockers.length>30||c.blockers.some(v=>typeof v!=='string'||v.length>100)
   ||!Array.isArray(c.attempts)||c.attempts.length>100||c.order?.orderId!==c.orderId||!UUID.test(c.order.sellerId||'')
   ||!cents(c.maxTransferCents)||!cents(c.transferableCents)||c.maxTransferCents!==c.transferableCents)throw Error('Invalid sandbox settlement context');
  const attempts=c.attempts.map(validateSettlementRequest);
  if(new Set(attempts.map(q=>q.requestId)).size!==attempts.length||attempts.some(q=>q.orderId!==c.orderId||q.sellerId!==c.order.sellerId||q.accountId!==c.accountId))throw Error('Simulation ownership mismatch');
  return {...c,attempts};
 }
 function match(q,expected){
  validateSettlementRequest(q);
  for(const k of ['requestId','orderId','sellerId','accountId','kind','amountCents','currency','paymentIntentId','chargeId','itemCents','totalCents','maxTransferCents','platformReserveCents','payoutFeeReserveCents','parentRequestId','parentProviderId','parentAmountCents','bankAccountId','transferGroup'])if(expected[k]!==undefined&&q[k]!==expected[k])throw Error('Saved simulation changed');
  return q;
 }
 const method=(kind,prefix)=>prefix+(kind[0].toUpperCase()+kind.slice(1));
 async function reconcile(input,q){
  if(q.phase!=='known'||!q.providerId)throw new SettlementPending('Unknown simulation outcome; preserve the request and reconcile before retrying');
  const e=await stripe[method(q.kind,'retrieve')](q);
  if(e?.test!==true||e.simulationOnly!==true||e.source!=='stripe_sandbox'||e.requestId!==q.requestId||e.orderId!==q.orderId||e.kind!==q.kind
   ||e.providerId!==q.providerId||e.accountId!==q.accountId||e.amountCents!==q.amountCents||e.currency!==q.currency||e.parentProviderId!==q.parentProviderId)throw Error('Provider receipt does not match simulation');
  const saved=match(await repository.recordSettlement({authorization:input.authorization,requestId:q.requestId,evidence:e}),q);
  if(saved.providerId!==q.providerId)throw Error('Simulation receipt not confirmed');
  return publicRequest(saved);
 }
 async function start(input){
  if(!UUID.test(input.orderId||'')||!UUID.test(input.requestId||'')||!KINDS.includes(input.kind)||input.parentRequestId!==null&&input.parentRequestId!==undefined&&!UUID.test(input.parentRequestId))throw Error('Saved simulation references required');
  let c=await context(input),q=c.attempts.find(v=>v.requestId===input.requestId);
  if(q){
   if(q.kind!==input.kind||q.parentRequestId!==(input.parentRequestId??null))throw Error('A request cannot change operation');
   if(q.phase!=='prepared')return reconcile(input,q);
  }else{
   if(input.kind!=='reversal'){
    if(c.blockers.length)throw new SettlementPending('Sandbox simulation evidence remains held');
    const binding=await stripe.inspectBinding({test:true,simulationOnly:true,orderId:c.orderId,sellerId:c.order.sellerId,accountId:c.accountId});
    await repository.recordSettlementBinding({authorization:input.authorization,orderId:c.orderId,evidence:binding});
    c=await context(input);
    if(c.blockers.length)throw new SettlementPending('Sandbox simulation evidence changed');
   }
   const parent=input.kind==='transfer'?null:c.attempts.find(v=>v.requestId===input.parentRequestId&&v.kind==='transfer'&&v.phase==='known'&&v.status==='succeeded');
   if(input.kind!=='transfer'&&!parent)throw new SettlementPending('A confirmed matching test transfer is required');
   const amountCents=parent?parent.availableCents:c.transferableCents;
   if(!cents(amountCents)||amountCents<1)throw new SettlementPending('No unallocated test proceeds; recovery or reconciliation is required');
   q=validateSettlementRequest(await repository.prepareSettlement({...input,amountCents,parentRequestId:parent?.requestId??null}));
   match(q,{orderId:input.orderId,requestId:input.requestId,kind:input.kind,amountCents,parentRequestId:parent?.requestId??null,accountId:c.accountId,sellerId:c.order.sellerId});
  }
  const claim=await repository.dispatchSettlement({authorization:input.authorization,requestId:input.requestId});
  if(typeof claim?.dispatch!=='boolean')throw Error('Invalid simulation dispatch');
  match(claim.request,q);q=validateSettlementRequest(claim.request);
  if(!claim.dispatch)return reconcile(input,q);
  const preparedRecoveryContinuation=q.kind==='reversal'&&q.holdReason==='provider_refund_notice';
  if(q.phase!=='dispatched'||q.providerId!==null||q.needsReview&&!preparedRecoveryContinuation)throw Error('One durable simulation dispatch required');
  let created;
  try{created=await stripe[method(q.kind,'create')](q);}
  catch(e){
   const reason=['provider_balance_insufficient','provider_outcome_unknown','provider_rejected'].includes(e?.code)?e.code:'provider_outcome_unknown';
   await repository.holdSettlement({authorization:input.authorization,requestId:q.requestId,reason});
   throw new SettlementPending('Sandbox simulation needs recovery; the dispatched request will not be recreated');
  }
  if(created?.test!==true||created.simulationOnly!==true||created.requestId!==q.requestId||created.orderId!==q.orderId||created.kind!==q.kind||created.accountId!==q.accountId
   ||created.amountCents!==q.amountCents||created.currency!==q.currency||created.parentProviderId!==q.parentProviderId)throw Error('Created simulation does not match saved request');
  const saved=match(await repository.saveSettlement({authorization:input.authorization,requestId:q.requestId,providerId:created.providerId}),q);
  if(saved.phase!=='known'||saved.providerId!==created.providerId)throw Error('Provider simulation identity was not saved');
  // Even a successful POST response must be fetched by its saved identity before
  // this test accounting advances. Unknown requests are never blindly retried.
  return reconcile(input,saved);
 }
 return Object.freeze({
  start,
  async reconcile(input){
   const c=await context(input),q=c.attempts.find(v=>v.requestId===input.requestId);
   if(!q)throw new SettlementPending('Saved simulation request required');
   if(q.phase==='known')return reconcile(input,q);
   if(q.phase!=='dispatched'||q.providerId!==null)throw new SettlementPending('Only a dispatched unknown request can be reconciled');
   const found=await stripe.findExisting(q);
   if(found===null)throw new SettlementPending('No exact provider receipt found; keep this request held without recreating it');
   if(found?.test!==true||found.simulationOnly!==true||found.source!=='stripe_sandbox'||found.requestId!==q.requestId||found.orderId!==q.orderId||found.kind!==q.kind
    ||found.accountId!==q.accountId||found.amountCents!==q.amountCents||found.currency!==q.currency||found.parentProviderId!==q.parentProviderId)throw Error('Reconciled provider identity does not match saved request');
   const saved=match(await repository.saveSettlement({authorization:input.authorization,requestId:q.requestId,providerId:found.providerId}),q);
   if(saved.phase!=='known'||saved.providerId!==found.providerId)throw Error('Reconciled provider identity was not saved');
   return reconcile(input,saved);
  },
  async status(input){const c=await context(input),q=c.attempts.find(v=>v.requestId===input.requestId);if(!q)throw new SettlementPending('Saved simulation request required');return reconcile(input,q);},
  async review(input){const c=await context(input);return {test:true,simulationOnly:true,orderId:c.orderId,blockers:[...c.blockers],transferableCents:c.blockers.length?null:c.transferableCents,attempts:c.attempts.map(publicRequest),releaseEnabled:false,liveReady:false};}
 });
}
module.exports={createTestSettlementService,validateSettlementRequest,SettlementPending};
