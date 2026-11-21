'use strict';
// Additive bridge: modern backend API key is apikey ONLY; never a bearer JWT.
const {TEST_ENVIRONMENTS,selectTestEnvironment}=require('./test_environment_registry.cjs');
const W='a11e4700-0000-4000-8000-000000000001',CASE='issfr_RackOwnerAlertRehearsal';
const O='a11e4700-0000-4000-8000-000000000002';
const fail=()=>{throw Error('OWNER_ALERT_REHEARSAL_UNAVAILABLE');};
async function readJson(r,url,signal,limit=16384){
 if(signal.aborted||!(r instanceof Response)||r.status!==200||r.url!==url||r.redirected||r.headers.has('location')||
  !/^application\/json(?:\s*;|$)/i.test(r.headers.get('content-type')||'')||r.headers.has('age')&&r.headers.get('age')!=='0'||
  ['cf-cache-status','x-vercel-cache'].some(k=>/HIT|STALE|UPDATING/i.test(r.headers.get(k)||'')))fail();
 const n=r.headers.get('content-length');if(n!==null&&(!/^\d+$/.test(n)||Number(n)>limit))fail();
 const reader=r.body?.getReader();if(!reader)fail();const chunks=[];let size=0;
 const abort=()=>{reader.cancel().catch(()=>{});};signal.addEventListener('abort',abort,{once:true});
 try{for(;;){const p=await reader.read();if(signal.aborted)fail();if(p.done)break;size+=p.value.byteLength;if(size>limit){await reader.cancel();fail();}chunks.push(Buffer.from(p.value));}}
 finally{signal.removeEventListener('abort',abort);reader.releaseLock();}
 if(n!==null&&Number(n)!==size)fail();return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));
}
function createOwnerAlertRehearsalRepository({enabled=false,branch,projectUrl,accountId,serviceKey,fetchImpl}={}){
 if(enabled!==true||selectTestEnvironment({branch,projectUrl,accountId})!==TEST_ENVIRONMENTS.acceptance||
  !/^sb_secret_[A-Za-z0-9_-]{16,}$/.test(serviceKey||'')||typeof fetchImpl!=='function')fail();
 async function rpc(action,i){
  if(i.workerId!==W||i.limit!==undefined&&i.limit!==1)fail();
  const url=projectUrl+'/rest/v1/rpc/rr_test_owner_alert_rehearsal';
  const args={p_action:action,p_worker:W,p_alert:i.alertId??null,p_lease:i.leaseToken??null,p_outcome:i.outcome??null,p_reference:i.reference??null};
  const r=await fetchImpl(url,{method:'POST',redirect:'error',cache:'no-store',signal:i.signal,
   headers:{apikey:serviceKey,'Content-Type':'application/json','Cache-Control':'no-store'},body:JSON.stringify(args)});
  const result=await readJson(r,url,i.signal);
  if(result?.test!==true||result.releaseEnabled!==false)fail();
  const alerts=[...(Array.isArray(result.alerts)?result.alerts:[]),...(result.alert?[result.alert]:[])];
  for(const a of alerts){
   if(a?.case?.caseId!==CASE||a.case.orderId!==O||a.case.holdRequired!==true||a.case.releaseEnabled!==false)fail();
  }
  return result;
 }
 return Object.freeze({claim:i=>rpc('claim',i),authority:i=>rpc('authority',i),finish:i=>rpc('finish',i),
  receiptContext:i=>rpc('context',i),receiptQueue:()=>fail(),fixtureContext:i=>rpc('context',i)});
}
module.exports={createOwnerAlertRehearsalRepository,readJson,WORKER_ID:W,CASE_ID:CASE,ORDER_ID:O};
