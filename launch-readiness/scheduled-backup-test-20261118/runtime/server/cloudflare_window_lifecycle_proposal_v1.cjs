'use strict';
// SOURCE PROPOSAL ONLY. This is a lifecycle fence, never object-send authority.
const {createHash}=require('node:crypto');
const PROFILE=Object.freeze({version:'rr-cf-platform-clock-lifecycle-profile-v1',maximumWindowMs:5000,clockModel:'cloudflare-last-io-wall-clock-plus-private-timer',deadlineOrigin:'authenticated-root-request-before-collection',synchronousExecutionModel:'owner-accepted-platform-clock-and-CPU-semantics',independentElapsedClock:false,providerCommitBeforeDeadlineProven:false,wholeRuntimeFit:'UNKNOWN'});
const PROFILE_SHA256=createHash('sha256').update(JSON.stringify(PROFILE)).digest('hex');
const SHA=/^[a-f0-9]{64}$/,HEX=/^[a-f0-9]{32}$/,UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
function record(value,keys){if(!value||Object.getPrototypeOf(value)!==Object.prototype||Reflect.ownKeys(value).length!==keys.length)return null;const d=Object.getOwnPropertyDescriptors(value);if(keys.some(k=>!Object.hasOwn(d[k]||{},'value')||!d[k].enumerable))return null;return Object.fromEntries(keys.map(k=>[k,d[k].value]));}
function createCloudflareWindowLifecycleProposal({enabled=false,rootRequestContext=null,executionAcceptance=null,fixedSteps=null}={}){
 // Capture trusted construction-time intrinsics privately. No run input can
 // supply a clock, timer, transport, deadline, URL, acceptance, or journal proof.
 const now=Date.now.bind(Date),schedule=setTimeout,cancelTimer=clearTimeout,Abort=AbortController;
 let context=null,steps=null,controller=null,timer=null,last=null,started=false,terminal=false,reason='UNCONFIGURED',wake=null;
 const stop=new Promise(resolve=>{wake=resolve;}),attempts=[];
 const finish=why=>{if(!terminal){terminal=true;reason=why;if(timer!==null)cancelTimer(timer);if(controller)controller.abort();wake({stopped:true});}};
 const held=()=>Object.freeze({version:'rr-cf-platform-lifecycle-result-v1',proposalOnly:true,lifecycleFinished:false,held:true,reason,unknownWriteHolds:Object.freeze([...attempts]),independentElapsedClockProven:false,objectSendAuthorized:false,objectWriteVerified:false,backupConnected:false,restoreEnabled:false,financialReleaseEnabled:false});
 const fence=()=>{const t=now();if(terminal||!Number.isSafeInteger(t)||t<last||t>=context.deadline){finish(t<last?'CLOCK_DECREASED':'EXPIRED_OR_CANCELLED');return false;}last=t;return true;};
 try{
  const c=record(rootRequestContext,['snapshotId','requestSha256','rootNonce','requestedAt','deadline']),a=record(executionAcceptance,['version','decision','profileSha256','snapshotId','requestSha256','rootNonce']);
  const t=now();if(enabled!==true||!c||!a||typeof c.snapshotId!=='string'||!UUID.test(c.snapshotId)||c.snapshotId==='00000000-0000-0000-0000-000000000000'||typeof c.requestSha256!=='string'||!SHA.test(c.requestSha256)||c.requestSha256==='0'.repeat(64)||typeof c.rootNonce!=='string'||!HEX.test(c.rootNonce)||c.rootNonce==='0'.repeat(32)||!Number.isSafeInteger(c.requestedAt)||!Number.isSafeInteger(c.deadline)||!Number.isSafeInteger(t)||c.requestedAt>t||c.deadline<=t||c.deadline-c.requestedAt<1||c.deadline-c.requestedAt>5000||a.version!=='rr-cf-platform-clock-execution-acceptance-v1'||a.decision!=='ACCEPT_EXACT_CF_PLATFORM_CLOCK_LIFECYCLE_V1'||a.profileSha256!==PROFILE_SHA256||a.snapshotId!==c.snapshotId||a.requestSha256!==c.requestSha256||a.rootNonce!==c.rootNonce||!Array.isArray(fixedSteps)||Object.getPrototypeOf(fixedSteps)!==Array.prototype||fixedSteps.length<1||fixedSteps.length>64)throw Error();
  const descriptors=Object.getOwnPropertyDescriptors(fixedSteps);if(Reflect.ownKeys(fixedSteps).length!==fixedSteps.length+1)throw Error();
  const ids=new Set();steps=Array.from({length:fixedSteps.length},(_,i)=>{if(!Object.hasOwn(descriptors[i]||{},'value'))throw Error();const s=record(descriptors[i].value,['id','kind','originalAttemptId','perform']);if(!s||typeof s.id!=='string'||!/^[a-z0-9-]{1,64}$/.test(s.id)||ids.has(s.id)||!['read','write'].includes(s.kind)||typeof s.perform!=='function'||s.kind==='read'&&s.originalAttemptId!==null||s.kind==='write'&&(typeof s.originalAttemptId!=='string'||!UUID.test(s.originalAttemptId)||s.originalAttemptId==='00000000-0000-0000-0000-000000000000'))throw Error();ids.add(s.id);return Object.freeze(s);});
  const constructedAt=now();if(!Number.isSafeInteger(constructedAt)||constructedAt<t||constructedAt>=c.deadline)throw Error();
  context=Object.freeze(c);last=constructedAt;controller=new Abort();reason='READY';
  // One original remaining duration; never renew/rearm after collection/I/O.
  timer=schedule(()=>finish('PRIVATE_TIMEOUT'),c.deadline-constructedAt);
 }catch{finish('UNCONFIGURED');}
 return Object.freeze({get ready(){return context!==null&&!terminal&&!started;},cancel(){finish('CANCELLED');},async run(snapshotId){
  if(!context||started||snapshotId!==context.snapshotId){finish('UNCONFIGURED_OR_REUSED');return held();}started=true;
  try{
   for(const step of steps){
    if(!fence())return held();
    if(step.kind==='write')attempts.push(Object.freeze({stepId:step.id,originalAttemptId:step.originalAttemptId,outcome:'unknown'}));
    const pending=Promise.resolve().then(()=>{if(!fence())return {stopped:true};return Promise.resolve(step.perform(Object.freeze({signal:controller.signal}))).then(()=>({completed:true}));});
    // An uncooperative late callback may still finish externally. Its result
    // cannot resume this sequence, authorize another step, or become verified.
    const outcome=await Promise.race([pending,stop]);
    if(!outcome.completed||!fence())return held();
   }
   // Finishing callbacks is not readback/journal verification. Every attempted
   // write retains its original UNKNOWN hold, including normal completion.
   finish('LIFECYCLE_FINISHED');return Object.freeze({...held(),held:false,lifecycleFinished:true});
  }catch{finish('IO_FAILED');return held();}
 }});
}
module.exports=Object.freeze({createCloudflareWindowLifecycleProposal,CF_PLATFORM_CLOCK_PROFILE:PROFILE,CF_PLATFORM_CLOCK_PROFILE_SHA256:PROFILE_SHA256,DEFAULT_CF_PLATFORM_CLOCK_EXECUTION_ACCEPTANCE:null});
