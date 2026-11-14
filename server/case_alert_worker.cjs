'use strict';
// OFF by default. Server-only injected transport; no route, schedule or secrets.
const {createHash}=require('node:crypto');
const {TEST_ENVIRONMENTS,selectTestEnvironment}=require('./test_environment_registry.cjs');
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const REF=/^[A-Za-z][A-Za-z0-9:_-]{0,127}$/;
const STATUS=new Set(['warning_received','warning_needs_response','warning_under_review','warning_closed','needs_response','under_review','appeal_needs_response','appeal_under_review','won','lost','prevented','conflicting_evidence']);
class CaseAlertError extends Error{constructor(code){super(code);this.code=code;}}
const fail=c=>{throw new CaseAlertError(c);};
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const flags=x=>x?.test===true&&x.releaseEnabled===false;
const id=x=>Number.isSafeInteger(x)&&x>0;
const date=x=>typeof x==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?(?:Z|[+-]\d\d:\d\d)$/.test(x)&&Number.isFinite(Date.parse(x));
function projectAlert(a,now,{historical=false}={}){
 if(!id(a?.alertId)||a.deliveryKey!=='rr_test_case_alert_'+a.alertId||!UUID.test(a.leaseToken||'')||!Number.isSafeInteger(a.attempt)||a.attempt<1||a.attempt>5||!date(a.leasedUntil)||!historical&&(Date.parse(a.leasedUntil)<=now+1000||Date.parse(a.leasedUntil)>now+95000)||!['case_changed','deadline'].includes(a.kind)||!Number.isInteger(a.severity)||a.severity<0||a.severity>3)fail('invalid_alert_lease');
 const c=a.case;
 if(c?.releaseEnabled!==false||c.test!==undefined&&c.test!==true||c.holdRequired!==true||!/^(du|issfr)_[A-Za-z0-9]+$/.test(c.caseId||'')||!UUID.test(c.orderId||'')||!['dispute','early_fraud_warning'].includes(c.kind)||!STATUS.has(c.status)||typeof c.requiresResponse!=='boolean'||typeof c.deadlineReviewRequired!=='boolean'||typeof c.evidenceConflict!=='boolean'||![c.dueBy,c.providerDueBy].every(x=>x===null||date(x)))fail('invalid_case_projection');
 if(c.kind==='dispute'&&!c.caseId.startsWith('du_')||c.kind==='early_fraud_warning'&&(!c.caseId.startsWith('issfr_')||c.status!=='warning_received'||c.dueBy!==null||c.providerDueBy!==null||c.requiresResponse!==false))fail('invalid_warning_deadline');
 // No customer names, provider payment refs, amounts, addresses or arbitrary text.
 const message={version:'rr-case-alert-message-v1',test:true,caseRef:c.caseId,orderRef:c.orderId,caseKind:c.kind,caseStatus:c.status,requiresResponse:c.requiresResponse,providerDueBy:c.providerDueBy,retainedDueBy:c.dueBy,deadlineReviewRequired:c.deadlineReviewRequired,evidenceConflict:c.evidenceConflict,severity:a.severity,holdRequired:true,releaseEnabled:false};
 return Object.freeze({alertId:a.alertId,deliveryKey:a.deliveryKey,leaseToken:a.leaseToken,leasedUntil:a.leasedUntil,attempt:a.attempt,message:Object.freeze(message),payloadHash:hash(message)});
}
function createCaseAlertWorker({enabled=false,branch,projectUrl,accountId,repository,transport,transportId,destinationId,clock=Date.now,operationTimeoutMs=5000}={}){
 const env=selectTestEnvironment({branch,projectUrl,accountId});
 const configured=enabled===true&&env===TEST_ENVIRONMENTS.acceptance&&REF.test(transportId||'')&&REF.test(destinationId||'')&&typeof clock==='function'&&Number.isInteger(operationTimeoutMs)&&operationTimeoutMs>=10&&operationTimeoutMs<=10000&&['claim','authority','finish','receiptContext','receiptQueue'].every(k=>typeof repository?.[k]==='function')&&['inspect','send','reconcile'].every(k=>typeof transport?.[k]==='function');
 async function bounded(fn){const controller=new AbortController();let timer;try{return await Promise.race([Promise.resolve().then(()=>fn(controller.signal)),new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new CaseAlertError('operation_outcome_unknown'));},operationTimeoutMs);})]);}catch{throw new CaseAlertError('operation_outcome_unknown');}finally{clearTimeout(timer);}}
 function open(workerId){if(!Number.isSafeInteger(clock()))fail('trusted_worker_clock_required');if(!configured)fail('case_alert_worker_not_configured');if(!UUID.test(workerId||'')||workerId==='00000000-0000-0000-0000-000000000000')fail('invalid_worker_identity');}
 async function inspect(){const started=clock(),r=await bounded(signal=>transport.inspect({signal}));if(r?.test!==true||r.transportId!==transportId||r.destinationId!==destinationId||r.idempotentSend!==true||r.readOnlyReconciliation!==true||!Number.isSafeInteger(r.checkedAt)||r.checkedAt<started||r.checkedAt>clock()+1000)fail('approved_transport_unverified');}
 const receiptInput=a=>({test:true,transportId,destinationId,deliveryKey:a.deliveryKey,payloadHash:a.payloadHash});
 function delivered(r,a){const expected=receiptInput(a);return r?.outcome==='delivered'&&r.delivered===true&&REF.test(r.providerReference||'')&&Object.entries(expected).every(([k,v])=>r[k]===v);}
 async function finish(a,workerId,outcome,reference=null){try{const r=await bounded(signal=>repository.finish({alertId:a.alertId,workerId,leaseToken:a.leaseToken,outcome,reference,signal}));if(!flags(r)||!['delivered','pending','unknown','exhausted','superseded'].includes(r.state))fail('receipt_confirmation_unknown');return r.state;}catch{return 'receipt_confirmation_unknown';}}
 async function authority(a,workerId){const r=await bounded(signal=>repository.authority({alertId:a.alertId,workerId,leaseToken:a.leaseToken,signal}));return flags(r)&&r.allowed===true&&Date.parse(a.leasedUntil)>clock()+1000;}
 async function reconcileContext(context,workerId,alertId){
  if(!flags(context)||context.cloudReady!==false||context.workerId!==workerId||context.alert?.alertId!==alertId||!['leased','unknown','delivered'].includes(context.state))fail('original_lease_context_required');
  const a=projectAlert(context.alert,clock(),{historical:true});await inspect();
  let r;try{r=await bounded(signal=>transport.reconcile({...receiptInput(a),signal}));}catch{}
  if(!delivered(r,a))return {test:true,cloudReady:false,releaseEnabled:false,state:'original_delivery_unverified'};
  return {test:true,cloudReady:false,releaseEnabled:false,state:await finish(a,workerId,'delivered',r.providerReference)};
 }
 return Object.freeze({
  async runOnce({workerId,limit=5}={}){
   open(workerId);if(!Number.isInteger(limit)||limit<1||limit>5)fail('bounded_worker_batch_required');
   await inspect();const batch=await bounded(signal=>repository.claim({workerId,limit,signal}));
   if(!flags(batch)||batch.cloudReady!==false||!Array.isArray(batch.alerts)||batch.alerts.length>limit)fail('invalid_alert_batch');
   // Validate the complete batch before any message leaves this process.
   const alerts=batch.alerts.map(a=>projectAlert(a,clock()));if(new Set(alerts.map(a=>a.alertId)).size!==alerts.length)fail('duplicate_alert_batch');
   const outcomes=[];
   for(const a of alerts){
    try{await inspect();if(!await authority(a,workerId)){outcomes.push({alertId:a.alertId,state:'authority_revoked'});continue;}}
    catch{outcomes.push({alertId:a.alertId,state:await finish(a,workerId,'outcome_unknown')});continue;}
    let response;try{response=await bounded(signal=>transport.send({...receiptInput(a),message:a.message,signal}));}catch{}
    let outcome='outcome_unknown',reference=null;
    if(delivered(response,a)){outcome='delivered';reference=response.providerReference;}
    else if(response?.confirmedNoDelivery===true&&Object.entries(receiptInput(a)).every(([k,v])=>response[k]===v)){
     if(response.outcome==='temporary_failure')outcome='temporary_failure';
     if(response.outcome==='permanent_failure')outcome='permanent_failure';
    }
    outcomes.push({alertId:a.alertId,state:await finish(a,workerId,outcome,reference)});
   }
   return {test:true,cloudReady:false,releaseEnabled:false,outcomes};
  },
  async reconcile({workerId,alertId}={}){
   open(workerId);if(!id(alertId))fail('invalid_alert_reference');
   const context=await bounded(signal=>repository.receiptContext({alertId,workerId,signal}));
   return reconcileContext(context,workerId,alertId);
  },
  async reconcilePending({workerId,limit=5,afterAlertId=null}={}){
   open(workerId);if(!Number.isInteger(limit)||limit<1||limit>5||afterAlertId!==null&&!id(afterAlertId))fail('bounded_receipt_queue_required');
   const page=await bounded(signal=>repository.receiptQueue({workerId,limit,afterAlertId,signal}));
   if(!flags(page)||page.cloudReady!==false||!Array.isArray(page.contexts)||page.contexts.length>limit||typeof page.hasMore!=='boolean'||(page.hasMore?!id(page.nextAlertCursor):page.nextAlertCursor!==null))fail('original_lease_context_required');
   let last=afterAlertId||0;
   for(const c of page.contexts){if(!id(c?.alert?.alertId)||c.alert.alertId<=last||c.workerId!==workerId||!['leased','unknown'].includes(c.state))fail('original_lease_context_required');projectAlert(c.alert,clock(),{historical:true});last=c.alert.alertId;}
   if(page.hasMore&&(!page.contexts.length||page.nextAlertCursor!==last))fail('original_lease_context_required');
   const outcomes=[];for(const c of page.contexts)outcomes.push({alertId:c.alert.alertId,...await reconcileContext(c,workerId,c.alert.alertId)});
   return {test:true,cloudReady:false,releaseEnabled:false,outcomes,hasMore:page.hasMore,nextAlertCursor:page.nextAlertCursor};
  }
 });
}
module.exports={createCaseAlertWorker,CaseAlertError,projectAlert};
