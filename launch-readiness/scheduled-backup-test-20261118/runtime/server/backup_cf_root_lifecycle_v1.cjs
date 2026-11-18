'use strict';
// Separate authenticated CF lifecycle. Date/timer semantics are explicitly owner
// accepted; no independent hosted elapsed or hard remote-commit guarantee.
const {authenticateCfRootV1,verifyCfEnvelopeV1,cfDigest:digest,cfCopy:copy,cfExact:exact,cfUuid:uuid,cfFail:fail,CF_WINDOW_IDENTITY:IDENTITY}=require('./backup_cf_window_v1.cjs');
const ACK_DOMAIN='rack-relic/cf-window-v1/first-claim';
function verifyCfFirstClaimV1(value,fixed,lease,expected=null){
 const p=verifyCfEnvelopeV1(value,fixed.construction.executionAcceptance.cfWindowProfile.journalReceiptKey,ACK_DOMAIN);
 if(!exact(p,['version','identity','tuple','rootRequestSha256','leaseSha256','sourcePathSha256','snapshotId','firstClaim','releaseEnabled'])||p.version!=='rr-cf-first-claim-v1'||p.identity!==IDENTITY||p.rootRequestSha256!==digest(fixed.request)||p.leaseSha256!==digest(lease)||p.sourcePathSha256!==fixed.selection.sourcePathSha256||p.snapshotId!==fixed.selection.snapshotId||p.firstClaim!==true||p.releaseEnabled!==false||!exact(p.tuple,['kind','key','sha256','contentType','size','attemptId'])||!uuid(p.tuple.attemptId)||expected&&Object.entries(expected).some(([k,v])=>p.tuple[k]!==v))fail();return p;
}
function createAuthenticatedCfRootLifecycleV1(options={}){
 const now=Date.now.bind(Date),schedule=setTimeout,unschedule=clearTimeout,Abort=AbortController;
 let currentStep=null,fixed=null,steps=null,last=null,controller=null,timer=null,started=false,terminal=false,reason='UNCONFIGURED',resolveStop;
 const stop=new Promise(resolve=>{resolveStop=resolve;}),unknown=[],claims=new Map();
 const finish=why=>{if(!terminal){terminal=true;reason=why;if(timer!==null)unschedule(timer);controller?.abort();resolveStop({stopped:true});}};
 const output=finished=>Object.freeze({version:'rr-authenticated-cf-root-lifecycle-v1',lifecycleFinished:finished,held:!finished,reason,rootRequestSha256:fixed?digest(fixed.request):null,originalDeadline:fixed?.request.deadline??null,unknownOriginalHolds:Object.freeze(unknown.map(copy)),independentElapsedClockProven:false,providerCommitBeforeDeadlineProven:false,objectWriteVerified:false,photoSnapshotComplete:false,backupConnected:false,restoreEnabled:false,releaseEnabled:false});
 const fence=()=>{const t=now();if(terminal||!Number.isSafeInteger(t)||t<last||t>=fixed.request.deadline){finish(t<last?'CLOCK_DECREASED':'EXPIRED_OR_CANCELLED');return false;}try{authenticateCfRootV1({...fixed,enabled:true},t);}catch{finish('ROOT_AUTHORITY_EXPIRED');return false;}last=t;return true;};
 try{
  fixed=authenticateCfRootV1(options,now());const rows=options.fixedSteps;
  if(!Array.isArray(rows)||Object.getPrototypeOf(rows)!==Array.prototype||rows.length<1||rows.length>64||Reflect.ownKeys(rows).length!==rows.length+1)fail();const ids=new Set();
  steps=rows.map(s=>{if(!exact(s,['id','kind','objectKind','perform'])||typeof s.id!=='string'||!/^[a-z0-9-]{1,64}$/.test(s.id)||ids.has(s.id)||!['read','claim','write'].includes(s.kind)||!['photo','manifest',null].includes(s.objectKind)||s.kind!=='read'&&s.objectKind===null||typeof s.perform!=='function')fail();ids.add(s.id);return Object.freeze({...s});});
  last=now();if(last<fixed.request.requestedAt||last>=fixed.request.deadline)fail();controller=new Abort();reason='READY';
  // This timer starts BEFORE collection and is never renewed across roles.
  timer=schedule(()=>finish('PRIVATE_TIMEOUT'),fixed.request.deadline-last);
 }catch{finish('UNCONFIGURED');}
 return Object.freeze({get ready(){return fixed!==null&&!terminal&&!started;},cancel(){finish('CANCELLED');},async run(snapshotId){
  if(!fixed||started||snapshotId!==fixed.selection.snapshotId){finish('UNCONFIGURED_OR_REUSED');return output(false);}started=true;
  try{for(const s of steps){currentStep=s.id;
   if(!fence())return output(false);
   let pendingHold=null;
   if(s.kind==='claim'){if(claims.has(s.objectKind))fail();pendingHold={stepId:s.id,kind:s.objectKind,rootRequestSha256:digest(fixed.request),originalAttemptId:null,outcome:'unknown'};unknown.push(pendingHold);}
   if(s.kind==='write'){const c=claims.get(s.objectKind);if(!c||!uuid(c.attemptId))fail();unknown.push({stepId:s.id,kind:s.objectKind,rootRequestSha256:digest(fixed.request),originalAttemptId:c.attemptId,outcome:'unknown'});}
   const job=Promise.resolve().then(()=>{if(!fence())return {stopped:true};return Promise.resolve(s.perform(Object.freeze({signal:controller.signal,originalDeadline:fixed.request.deadline,rootRequestSha256:digest(fixed.request)}))).then(result=>({completed:true,result}));});
   const r=await Promise.race([job,stop]);if(!r.completed||!fence())return output(false);
   if(s.kind==='claim'){
    if(!exact(r.result,['claimReceipt','lease']))fail();const p=verifyCfFirstClaimV1(r.result.claimReceipt,fixed,r.result.lease);
    if(p.tuple.kind!==s.objectKind)fail();claims.set(s.objectKind,copy(p.tuple));pendingHold.originalAttemptId=p.tuple.attemptId;
   }
  }
  // These historical UNKNOWN-at-I/O facts never clear just because callbacks
  // finish. A separate full receipt assessment may prove current resolution.
  finish('LIFECYCLE_FINISHED');return output(true);
  }catch(e){if(typeof __RR_NATIVE_LOCAL_AUDIT__==='boolean'&&__RR_NATIVE_LOCAL_AUDIT__)console.log('RR_CF_LOCAL_FAILURE lifecycle '+currentStep+' '+String(e?.message)+' '+String(e?.stack));finish('IO_OR_AUTHORITY_FAILED');return output(false);}
 }});
}
module.exports=Object.freeze({createAuthenticatedCfRootLifecycleV1,verifyCfFirstClaimV1,CF_FIRST_CLAIM_DOMAIN:ACK_DOMAIN});
