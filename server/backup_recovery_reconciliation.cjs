'use strict';
// Read-only, test-only recovery assessment. It cannot dispatch a payment,
// recreate a refund, clear a hold or enable seller money.
const {TEST_ENVIRONMENTS}=require('./test_environment_registry.cjs');
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ID={paymentIntentId:/^pi_[A-Za-z0-9]+$/,chargeId:/^ch_[A-Za-z0-9]+$/,refund:/^re_[A-Za-z0-9]+$/,transfer:/^tr_[A-Za-z0-9]+$/,payout:/^po_[A-Za-z0-9]+$/,account:/^acct_[A-Za-z0-9]+$/};
const MAX_AMOUNT=30000000;
class RecoveryAssessmentError extends Error{constructor(code){super(code);this.code=code;}}
const fail=code=>{throw new RecoveryAssessmentError(code);};
function exact(value,fields){return value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join('|')===fields.slice().sort().join('|');}
const cents=(v,zero=false)=>Number.isSafeInteger(v)&&v>=(zero?0:1)&&v<=MAX_AMOUNT;
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
function ordered(items,idName,normalize){
 if(!Array.isArray(items)||items.length>100)fail('invalid_financial_inventory');
 const found=new Set(),result=[];
 for(const item of items){const value=normalize(item);if(found.has(value[idName]))fail('duplicate_financial_reference');found.add(value[idName]);result.push(value);}
 return result.sort((a,b)=>a[idName].localeCompare(b[idName]));
}
function normalizeOrder(o){
 if(!exact(o,['orderId','paymentIntentId','chargeId','amountCents','currency','state','refundedCents','refunds','transfers','payouts'])||!UUID.test(o.orderId||'')||!ID.paymentIntentId.test(o.paymentIntentId||'')||!ID.chargeId.test(o.chargeId||'')||!cents(o.amountCents)||o.currency!=='USD'||!['paid','partially_refunded','refunded'].includes(o.state)||!cents(o.refundedCents,true)||o.refundedCents>o.amountCents)fail('invalid_financial_inventory');
 const refunds=ordered(o.refunds,'id',r=>{
  if(!exact(r,['id','amountCents','status'])||!ID.refund.test(r.id||'')||!cents(r.amountCents)||r.amountCents>o.amountCents||!['succeeded','pending','requires_action','failed','canceled'].includes(r.status))fail('invalid_financial_inventory');
  return {id:r.id,amountCents:r.amountCents,status:r.status};
 });
 const platforms=Object.values(TEST_ENVIRONMENTS).map(e=>e.accountId);
 const transfers=ordered(o.transfers,'id',t=>{
  if(!exact(t,['id','destination','amountCents','reversedCents'])||!ID.transfer.test(t.id||'')||!ID.account.test(t.destination||'')||platforms.includes(t.destination)||!cents(t.amountCents)||t.amountCents>o.amountCents||!cents(t.reversedCents,true)||t.reversedCents>t.amountCents)fail('invalid_financial_inventory');
  return {id:t.id,destination:t.destination,amountCents:t.amountCents,reversedCents:t.reversedCents};
 });
 const payouts=ordered(o.payouts,'id',p=>{
  if(!exact(p,['id','sellerAccountId','transferId','amountCents','status'])||!ID.payout.test(p.id||'')||!ID.account.test(p.sellerAccountId||'')||platforms.includes(p.sellerAccountId)||!ID.transfer.test(p.transferId||'')||!cents(p.amountCents)||!['paid','pending','in_transit','failed','canceled'].includes(p.status))fail('invalid_financial_inventory');
  const transfer=transfers.find(t=>t.id===p.transferId);
  if(!transfer||transfer.destination!==p.sellerAccountId||p.amountCents>transfer.amountCents)fail('unbound_payout_reference');
  return {id:p.id,sellerAccountId:p.sellerAccountId,transferId:p.transferId,amountCents:p.amountCents,status:p.status};
 });
 const succeeded=refunds.filter(r=>r.status==='succeeded').reduce((n,r)=>n+r.amountCents,0);
 if(transfers.reduce((n,t)=>n+t.amountCents,0)>o.amountCents||transfers.some(t=>payouts.filter(p=>p.transferId===t.id).reduce((n,p)=>n+p.amountCents,0)>t.amountCents))fail('inconsistent_transfer_accounting');
 const state=succeeded===o.amountCents?'refunded':succeeded>0?'partially_refunded':'paid';
 if(succeeded!==o.refundedCents||state!==o.state)fail('inconsistent_refund_accounting');
 return {orderId:o.orderId,paymentIntentId:o.paymentIntentId,chargeId:o.chargeId,amountCents:o.amountCents,currency:o.currency,state:o.state,refundedCents:o.refundedCents,refunds,transfers,payouts};
}
function result(reasons,matchedOrders=0){return Object.freeze({test:true,consistent:reasons.length===0,matchedOrders,requiresOperatorReview:true,holdPayouts:true,releaseEnabled:false,productionRestoreEnabled:false,cloudReady:false,reasons:Object.freeze(reasons.map(r=>Object.freeze({...r})))});}
function createPostRestoreStripeReconciliation({enabled=false,environmentId,readRecoveryHold,readStripeIdentity,readRestoredPage,readStripePage,clock=Date.now,pageSize=50,maxPages=20,maxOrders=500,timeoutMs=60000}={}){
 const environment=Object.values(TEST_ENVIRONMENTS).find(e=>e.id===environmentId);
 const configured=enabled===true&&environment&&[readRecoveryHold,readStripeIdentity,readRestoredPage,readStripePage,clock].every(f=>typeof f==='function')&&Number.isSafeInteger(pageSize)&&pageSize>0&&pageSize<=100&&Number.isSafeInteger(maxPages)&&maxPages>0&&maxPages<=100&&Number.isSafeInteger(maxOrders)&&maxOrders>=0&&maxOrders<=5000&&Number.isSafeInteger(timeoutMs)&&timeoutMs>0&&timeoutMs<=300000;
 const fresh=(at,c)=>Number.isSafeInteger(at)&&at>=c.startedAt&&at<=clock()+1000;
 async function identity(context){
  context.open();const i=await readStripeIdentity({accountId:environment.accountId,signal:context.signal});context.open();
  if(!i||i.accountId!==environment.accountId||i.livemode!==false||!fresh(i.checkedAt,context))fail('fresh_test_stripe_identity_required');
 }
 async function hold(runId,context){
  context.open();const h=await readRecoveryHold({runId,projectRef:environment.projectRef,signal:context.signal});context.open();
  if(!h||h.runId!==runId||h.projectRef!==environment.projectRef||h.durable!==true||h.checkoutBlocked!==true||h.fulfillmentBlocked!==true||h.releaseBlocked!==true||!fresh(h.checkedAt,context))fail('durable_recovery_hold_required');
 }
 async function scan(reader,kind,context){
  const rows=[],refs=new Set(),orders=new Set(),financialRefs=new Set(),cursors=new Set();let cursor=null,snapshot=null;
  for(let n=0;n<maxPages;n++){
   context.open();const page=await reader({cursor,limit:pageSize,projectRef:environment.projectRef,accountId:environment.accountId,coverageFrom:0,signal:context.signal});context.open();
   if(!page||!fresh(page.checkedAt,context)||page.coverageFrom!==0||!Number.isSafeInteger(page.coverageThrough)||page.coverageThrough<context.startedAt||page.coverageThrough>clock()+1000||typeof page.snapshotId!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(page.snapshotId)||snapshot!==null&&page.snapshotId!==snapshot||!Array.isArray(page.items)||page.items.length>pageSize||!(page.nextCursor===null||typeof page.nextCursor==='string'&&/^[A-Za-z0-9_-]{1,512}$/.test(page.nextCursor)))fail('complete_financial_inventory_required');
   if(kind==='restored'&&page.projectRef!==environment.projectRef||kind==='stripe'&&(page.accountId!==environment.accountId||page.livemode!==false))fail('wrong_financial_inventory');
   snapshot=page.snapshotId;
   for(const candidate of page.items){
    const row=normalizeOrder(candidate);if(refs.has(row.paymentIntentId)||orders.has(row.orderId))fail('duplicate_financial_reference');refs.add(row.paymentIntentId);orders.add(row.orderId);
    for(const reference of [row.chargeId,...row.refunds.map(r=>r.id),...row.transfers.map(t=>t.id),...row.payouts.map(p=>p.id)]){if(financialRefs.has(reference))fail('duplicate_financial_reference');financialRefs.add(reference);}
    if(rows.length>=maxOrders)fail('financial_inventory_limit');rows.push(row);
   }
   if(page.nextCursor===null)return rows.sort((a,b)=>a.paymentIntentId.localeCompare(b.paymentIntentId));
   if(page.items.length===0||cursors.has(page.nextCursor))fail('complete_financial_inventory_required');cursors.add(page.nextCursor);cursor=page.nextCursor;
  }
  fail('complete_financial_inventory_required');
 }
 return Object.freeze({async reconcile({runId}={}){
  if(!configured)return result([{code:'recovery_reconciliation_not_configured'}]);
  if(!UUID.test(runId||''))return result([{code:'invalid_recovery_run'}]);
  const controller=new AbortController(),startedAt=clock();let timer;
  const context={startedAt,signal:controller.signal,open(){if(controller.signal.aborted||clock()>startedAt+timeoutMs)fail('recovery_evidence_unavailable');}};
  const assess=async()=>{
   if(!Number.isSafeInteger(startedAt)||startedAt<0)fail('recovery_evidence_unavailable');
   await hold(runId,context);await identity(context);
   const restored=await scan(readRestoredPage,'restored',context),provider=await scan(readStripePage,'stripe',context);
   // Re-list both complete inventories. A restore comparison made while either
   // side is changing must not become authority to resume seller money.
   const restoredAgain=await scan(readRestoredPage,'restored',context),providerAgain=await scan(readStripePage,'stripe',context);
   if(!same(restored,restoredAgain)||!same(provider,providerAgain))fail('financial_inventory_changed');
   await identity(context);await hold(runId,context);
   const reasons=[],providerMap=new Map(provider.map(o=>[o.paymentIntentId,o]));let matches=0;
   for(const order of restored){
    const p=providerMap.get(order.paymentIntentId);providerMap.delete(order.paymentIntentId);
    if(!p){reasons.push({orderId:order.orderId,code:'saved_payment_missing_from_provider'});continue;}
    if(!same(order,p)){reasons.push({orderId:order.orderId,code:'order_provider_mismatch'});continue;}
    if(p.refunds.some(r=>['pending','requires_action'].includes(r.status))){reasons.push({orderId:order.orderId,code:'unresolved_refund'});continue;}
    if(p.payouts.some(r=>['pending','in_transit'].includes(r.status))){reasons.push({orderId:order.orderId,code:'unresolved_payout'});continue;}
    if(p.transfers.some(t=>t.amountCents>t.reversedCents)&&p.refundedCents>0){reasons.push({orderId:order.orderId,code:'transferred_refund_needs_funding_review'});continue;}
    matches++;
   }
   for(const p of providerMap.values())reasons.push({orderId:p.orderId,code:'provider_payment_missing_from_restored_records'});
   return result(reasons,matches);
  };
  try{return await Promise.race([assess(),new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new RecoveryAssessmentError('recovery_evidence_unavailable'));},timeoutMs);})]);}
  catch(error){controller.abort();return result([{code:error instanceof RecoveryAssessmentError?error.code:'recovery_evidence_unavailable'}]);}
  finally{clearTimeout(timer);}
 }});
}
module.exports={createPostRestoreStripeReconciliation};
