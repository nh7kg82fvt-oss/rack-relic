'use strict';
// Private acceptance service client. Never instantiate from a browser request.
const {TEST_ENVIRONMENTS,selectTestEnvironment}=require('./test_environment_registry.cjs');
const {CaseAlertError}=require('./case_alert_worker.cjs');
function createCaseAlertRepository({enabled=false,branch,projectUrl,accountId,serviceKey,fetchImpl}={}){
 const environment=selectTestEnvironment({branch,projectUrl,accountId});
 if(enabled!==true||environment!==TEST_ENVIRONMENTS.acceptance||typeof serviceKey!=='string'||!/^sb_secret_[A-Za-z0-9_-]+$/.test(serviceKey)||typeof fetchImpl!=='function')throw new CaseAlertError('case_alert_repository_not_configured');
 async function rpc(name,args,signal){
  let r;try{r=await fetchImpl(environment.projectUrl+'/rest/v1/rpc/'+name,{method:'POST',redirect:'error',cache:'no-store',signal,headers:{apikey:serviceKey,'Content-Type':'application/json','Cache-Control':'no-store'},body:JSON.stringify(args)});}catch{throw new CaseAlertError('case_alert_database_unavailable');}
  const age=r.headers?.get('age');if(!r.ok||age!=null&&(!/^\d+$/.test(age)||Number(age)>0)||['cf-cache-status','x-vercel-cache'].some(k=>/^(HIT|STALE|UPDATING)$/i.test(r.headers?.get(k)||'')))throw new CaseAlertError('case_alert_database_unavailable');
  // Native streamed body is bounded before JSON parsing. Fixture transports use Response too.
  if(!r.body?.getReader)throw new CaseAlertError('bounded_database_body_required');
  const reader=r.body.getReader();let size=0,chunks=[];try{for(;;){const p=await reader.read();if(p.done)break;size+=p.value.byteLength;if(size>131072){await reader.cancel();throw new CaseAlertError('case_alert_database_unavailable');}chunks.push(Buffer.from(p.value));}}finally{reader.releaseLock();}
  try{return JSON.parse(Buffer.concat(chunks).toString());}catch{throw new CaseAlertError('case_alert_database_unavailable');}
 }
 return Object.freeze({
  claimExact:({workerId,scope,checkedAt,expiresAt,signal})=>rpc('rr_test_claim_enrolled_case_alert',{p_worker:workerId,p_scope:scope,p_checked_at:checkedAt,p_expires_at:expiresAt},signal),
  authorityExact:({alertId,workerId,leaseToken,scope,checkedAt,expiresAt,signal})=>rpc('rr_test_enrolled_case_alert_authority',{p_alert:alertId,p_worker:workerId,p_lease:leaseToken,p_scope:scope,p_checked_at:checkedAt,p_expires_at:expiresAt},signal),
  claim:({workerId,limit,signal})=>rpc('rr_test_claim_case_alerts',{p_worker:workerId,p_limit:limit},signal),
  authority:({alertId,workerId,leaseToken,signal})=>rpc('rr_test_case_alert_authority',{p_alert:alertId,p_worker:workerId,p_lease:leaseToken},signal),
  finish:({alertId,workerId,leaseToken,outcome,reference,signal})=>rpc('rr_test_finish_case_alert',{p_alert:alertId,p_worker:workerId,p_lease:leaseToken,p_outcome:outcome,p_delivery_reference:reference},signal),
  receiptQueue:({workerId,limit,afterAlertId,signal})=>rpc('rr_test_case_alert_receipt_queue',{p_worker:workerId,p_limit:limit,p_after_alert:afterAlertId},signal),
  receiptContext:({alertId,workerId,signal})=>rpc('rr_test_case_alert_receipt_context',{p_alert:alertId,p_worker:workerId},signal)
 });
}
module.exports={createCaseAlertRepository};
