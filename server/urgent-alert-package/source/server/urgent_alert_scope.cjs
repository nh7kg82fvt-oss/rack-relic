'use strict';
// One host-private reviewed row, not a browser capability or proof of consent.
const {projectAlert}=require('./case_alert_worker.cjs');
const UUID=/^(?!00000000-0000-0000-0000-000000000000$)[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const KEYS=['version','alertId','caseId','orderId','generation','evidenceHash','providerEventId','providerPayloadHash','createdAfter','payloadHash','payloadJson'].sort();
const fail=()=>{throw Error('EXACT_ALERT_SCOPE_REQUIRED');};
function validateScope(s,checkedAt){
 if(!s||Object.getPrototypeOf(s)!==Object.prototype||Object.keys(s).sort().join(',')!==KEYS.join(',')||s.version!=='rr-case-alert-scope-v1'||
  !Number.isSafeInteger(s.alertId)||s.alertId<1||!Number.isSafeInteger(s.generation)||s.generation<1||
  !/^(du|issfr)_[A-Za-z0-9]+$/.test(s.caseId||'')||!UUID.test(s.orderId||'')||
  s.caseId==='issfr_RackOwnerAlertRehearsal'||s.orderId==='a11e4700-0000-4000-8000-000000000002'||
  !/^[a-f0-9]{32}$/.test(s.evidenceHash||'')||!/^evt_[A-Za-z0-9]+$/.test(s.providerEventId||'')||
  !/^[a-f0-9]{64}$/.test(s.providerPayloadHash||'')||!/^[a-f0-9]{64}$/.test(s.payloadHash||'')||
  !Number.isSafeInteger(s.createdAfter)||s.createdAfter<1||s.createdAfter>checkedAt||s.createdAfter<checkedAt-300000||
  typeof s.payloadJson!=='string'||Buffer.byteLength(s.payloadJson)>8192)fail();
 let m;try{m=JSON.parse(s.payloadJson);}catch{fail();}
 const p=projectAlert({alertId:s.alertId,deliveryKey:'rr_test_case_alert_'+s.alertId,leaseToken:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  leasedUntil:'2031-01-01T00:00:00Z',attempt:1,kind:'case_changed',severity:m?.severity,
  case:{test:m?.test,releaseEnabled:m?.releaseEnabled,holdRequired:m?.holdRequired,caseId:m?.caseRef,orderId:m?.orderRef,kind:m?.caseKind,
   status:m?.caseStatus,requiresResponse:m?.requiresResponse,providerDueBy:m?.providerDueBy,dueBy:m?.retainedDueBy,
   deadlineReviewRequired:m?.deadlineReviewRequired,evidenceConflict:m?.evidenceConflict}},0,{historical:true});
 if(p.payloadHash!==s.payloadHash||JSON.stringify(p.message)!==s.payloadJson||p.message.caseRef!==s.caseId||p.message.orderRef!==s.orderId)fail();
 return Object.freeze({...s});
}
function createScopedAlertRepository(base,record,workerId,clock){
 const s=record.alertScope;let lease=null;
 const id=i=>{if(i?.alertId!==s.alertId||i?.workerId!==workerId)fail();};
 function send(i){if(!lease||i?.deliveryKey!=='rr_test_case_alert_'+s.alertId||i.payloadHash!==s.payloadHash||JSON.stringify(i.message)!==s.payloadJson)fail();}
 async function authority(i){id(i);if(!lease||i.leaseToken!==lease.leaseToken)fail();return base.authorityExact({...i,scope:s,checkedAt:record.checkedAt,expiresAt:record.expiresAt});}
 const repository=Object.freeze({
  async claim(i){if(i.workerId!==workerId||i.limit!==1)fail();
   const b=await base.claimExact({...i,scope:s,checkedAt:record.checkedAt,expiresAt:record.expiresAt});
   if(b?.test!==true||b.cloudReady!==false||b.releaseEnabled!==false||!Array.isArray(b.alerts)||b.alerts.length>1)fail();
   for(const a of b.alerts){const p=projectAlert(a,clock());if(a.alertId!==s.alertId||a.attempt!==1||a.case?.generation!==s.generation||
    a.evidenceHash!==s.evidenceHash||a.providerEventId!==s.providerEventId||a.providerPayloadHash!==s.providerPayloadHash||
    p.payloadHash!==s.payloadHash||JSON.stringify(p.message)!==s.payloadJson)fail();lease={...a};}
   return b;
  },authority,
  finish(i){id(i);if(!lease||i.leaseToken!==lease.leaseToken)fail();return base.finish(i);},
  receiptContext(i){id(i);return base.receiptContext(i);},
  receiptQueue(){fail();} // This finite wake never claims/reconciles an unrelated queue.
 });
 return Object.freeze({repository,assertSend:send,async recheck(signal){if(!lease)fail();const a=await authority({alertId:s.alertId,workerId,leaseToken:lease.leaseToken,signal});if(a?.test!==true||a.releaseEnabled!==false||a.allowed!==true)fail();}});
}
module.exports={validateScope,createScopedAlertRepository};
