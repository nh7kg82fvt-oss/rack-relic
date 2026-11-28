'use strict';
// One immutable, externally signed TEST slot. No environment discovery, seeding,
// clock delegation, automatic retry or authority creation occurs here.
const {randomBytes}=require('node:crypto');
const W=require('../runtime/server/backup_cf_window_v1.cjs');
const {scheduleProfile,scheduledController}=require('../runtime/server/backup_scheduled_test_profile_v1.cjs');
const {rlsSourceGrantSha256}=require('../runtime/server/rls_source_session_credentials.cjs');
const ADMIT_DOMAIN='rack-relic/cf-scheduled-single-test-v1/pre-root-admission';
const RECEIPT_DOMAIN='rack-relic/cf-scheduled-single-test-v1/ticket-consumed';
const WIREFIELDS=['selection','request','ownerGrant','enrollment','custodyReview','collectorGrantReview','sourcePrincipalGrant','lease','signedWindowBinding'];
const BASEFIELDS=['root','executionAcceptance','packetSha256','reviewerKey'];
const IDFIELDS=['ticketId','cron','scheduledTime','deadline','rootSha256','acceptanceSha256','requestSha256','selectionSha256'];
const fail=()=>{throw Error('SCHEDULED_SINGLE_TEST_ADMISSION_HELD');};
function base(value){
 const c=W.cfCopy(value);
 if(!W.cfExact(c,BASEFIELDS)||c.root?.version!=='rr-backup-scoped-root-v5-scheduled-test-v1'||c.executionAcceptance?.version!=='rr-backup-execution-acceptance-v5-scheduled-test-v1'||c.root.acceptanceSha256!==W.cfDigest(c.executionAcceptance))fail();
 const p=scheduleProfile(c.executionAcceptance.scheduleProfile);
 return {construction:c,profile:p,identity:W.cfCopy({ticketId:p.ticketId,cron:p.cron,scheduledTime:p.scheduledTime,deadline:p.deadline,rootSha256:W.cfDigest(c.root),acceptanceSha256:W.cfDigest(c.executionAcceptance),requestSha256:p.requestSha256,selectionSha256:p.selectionSha256})};
}
function capability(key){if(!Buffer.isBuffer(key)||key.length!==32||key.equals(Buffer.alloc(32)))fail();return Buffer.from(key);}
function nonce(value){return typeof value==='string'&&/^[a-f0-9]{32}$/.test(value)&&value!=='0'.repeat(32);}
function within(f,clock,last){const now=clock();if(!Number.isSafeInteger(now)||now<last||now<f.profile.scheduledTime||now>=f.profile.deadline)fail();return now;}
function requestBody(f,n){if(!nonce(n))fail();return W.cfCopy({version:'rr-scheduled-pre-root-admission-v1',...f.identity,nonce:n});}
function rootWire(f,value,now){
 const wire=W.cfCopy(value);
 if(!W.cfExact(wire,WIREFIELDS)||wire.lease!==null||wire.signedWindowBinding!==null||W.cfDigest(wire.request)!==f.identity.requestSha256||W.cfDigest(wire.selection)!==f.identity.selectionSha256)fail();
 const construction={...f.construction,enrollment:wire.enrollment};
 const authenticated=W.authenticateCfRootV1({enabled:true,construction,selection:wire.selection,request:wire.request,ownerGrant:wire.ownerGrant},now);
 // These free wire fields are pinned by the accepted profile before consumption.
 if(W.cfDigest(wire.collectorGrantReview)!==f.construction.executionAcceptance.collectorProvenance.custodyReviewSha256||f.construction.executionAcceptance.sourcePrincipalReview.mode!=='rls-scoped-session'||rlsSourceGrantSha256(wire.sourcePrincipalGrant)!==f.construction.executionAcceptance.sourcePrincipalReview.scopeEvidenceSha256)fail();
 return {wire,authenticated};
}
async function bounded(f,clock,work){
 const controller=new AbortController();let timer,last=within(f,clock,f.profile.scheduledTime);
 const check=()=>{if(controller.signal.aborted)fail();last=within(f,clock,last);return last;};
 const stopped=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error('SCHEDULED_SINGLE_TEST_ADMISSION_HELD'));},f.profile.deadline-last);});
 try{
  const job=Promise.resolve().then(()=>{check();return work({signal:controller.signal,check});}).then(r=>{check();return r;});
  return await Promise.race([job,stopped]);
 }finally{controller.abort();clearTimeout(timer);}
}
function createScheduledSingleTestCaller(options={}){
 let f=null,key,claim,run,clock;
 try{
  if(!W.cfExact(options,['enabled','construction','journalKey','claim','run','clock'])||options.enabled!==true||typeof options.claim!=='function'||typeof options.run!=='function'||typeof options.clock!=='function')fail();
  f=base(options.construction);key=capability(options.journalKey);claim=options.claim;run=options.run;clock=options.clock;
 }catch{f=null;}
 let attempted=false;
 return Object.freeze({get ready(){return !!f;},async scheduled(value){
  if(!f||attempted)fail();scheduledController(value,f.profile);within(f,clock,f.profile.scheduledTime);
  // This per-instance latch supplements the independent durable Journal claim.
  attempted=true;
  return bounded(f,clock,async({signal,check})=>{
   const n=randomBytes(16).toString('hex'),body=requestBody(f,n),message={body,mac:W.cfMac(key,ADMIT_DOMAIN,body)};
   const reply=W.cfCopy(await claim(message,{signal}));check();
   if(!W.cfExact(reply,['version','wire','receipt'])||reply.version!=='rr-scheduled-admission-return-v1')fail();
   const verified=rootWire(f,reply.wire,check()),encoded=W.cfCanonical(verified.wire),envelopeSha256=W.cfHash(encoded);
   const p=W.verifyCfEnvelopeV1(reply.receipt,f.construction.executionAcceptance.cfWindowProfile.journalReceiptKey,RECEIPT_DOMAIN);
   if(!W.cfExact(p,['version',...IDFIELDS,'nonce','envelopeSha256','claimedAt'])||p.version!=='rr-scheduled-ticket-consumed-receipt-v1'||IDFIELDS.some(k=>p[k]!==f.identity[k])||p.nonce!==n||p.envelopeSha256!==envelopeSha256||!Number.isSafeInteger(p.claimedAt)||p.claimedAt<f.profile.scheduledTime||p.claimedAt>=f.profile.deadline||p.claimedAt>check()+1000)fail();
   // The downstream run receives the original q; no field is regenerated.
   return run(verified.wire,{signal});
  });
 }});
}
function createScheduledSingleTestJournal(options={}){
 let f=null,key,keys,repository,signingKey,clock;
 try{
  if(!W.cfExact(options,['enabled','construction','journalKey','journalRoleKeys','repository','signingKey','clock'])||options.enabled!==true||typeof options.repository?.read!=='function'||typeof options.repository?.consume!=='function'||typeof options.clock!=='function')fail();
  f=base(options.construction);key=capability(options.journalKey);keys=options.journalRoleKeys;
  if(!Buffer.isBuffer(keys?.journalCapability)||!key.equals(keys.journalCapability))fail();
  repository=options.repository;signingKey=options.signingKey;clock=options.clock;
 }catch{f=null;}
 return Object.freeze({get ready(){return !!f;},async admit(value){
  if(!f)fail();
  const message=W.cfCopy(value);
  if(!W.cfExact(message,['body','mac'])||!W.cfExact(message.body,['version',...IDFIELDS,'nonce'])||message.body.version!=='rr-scheduled-pre-root-admission-v1'||IDFIELDS.some(k=>message.body[k]!==f.identity[k])||!nonce(message.body.nonce)||!W.cfSameMac(message.mac,W.cfMac(key,ADMIT_DOMAIN,message.body)))fail();
  return bounded(f,clock,async({signal,check})=>{
   const record=W.cfCopy(await repository.read(f.identity,{signal}));check();
   if(!W.cfExact(record,['version',...IDFIELDS,'envelopeSha256','envelopeText','consumed'])||record.version!=='rr-schedule-ticket-record-v1'||record.consumed!==false||IDFIELDS.some(k=>record[k]!==f.identity[k])||typeof record.envelopeText!=='string'||Buffer.byteLength(record.envelopeText)>65536||record.envelopeSha256!==W.cfHash(record.envelopeText))fail();
   const parsed=JSON.parse(record.envelopeText),verified=rootWire(f,parsed,check());
   if(W.cfCanonical(verified.wire)!==record.envelopeText)fail();
   W.validateCfCustodyV1(verified.wire.custodyReview,f.construction.executionAcceptance,'journal',keys);
   // Verify the held Journal signer BEFORE the only mutating port call.
   W.signCfEnvelopeV1(RECEIPT_DOMAIN,{},signingKey,f.construction.executionAcceptance.cfWindowProfile.journalReceiptKey);
   check();
   // A lost reply may already have consumed the row. There is no retry/finally
   // rearm, and a subsequent invocation only sees CONSUMED without the envelope.
   const consumed=W.cfCopy(await repository.consume({...f.identity,envelopeSha256:record.envelopeSha256,nonce:message.body.nonce},{signal}));check();
   if(!W.cfExact(consumed,['version','ticketId','nonce','envelopeSha256','claimedAt','consumed'])||consumed.version!=='rr-schedule-ticket-claim-v1'||consumed.ticketId!==f.identity.ticketId||consumed.nonce!==message.body.nonce||consumed.envelopeSha256!==record.envelopeSha256||consumed.consumed!==true||!Number.isSafeInteger(consumed.claimedAt)||consumed.claimedAt<f.profile.scheduledTime||consumed.claimedAt>=f.profile.deadline||consumed.claimedAt>check()+1000)fail();
   const receipt=W.signCfEnvelopeV1(RECEIPT_DOMAIN,{version:'rr-scheduled-ticket-consumed-receipt-v1',...f.identity,nonce:consumed.nonce,envelopeSha256:consumed.envelopeSha256,claimedAt:consumed.claimedAt},signingKey,f.construction.executionAcceptance.cfWindowProfile.journalReceiptKey);
   return W.cfCopy({version:'rr-scheduled-admission-return-v1',wire:verified.wire,receipt});
  });
 }});
}
module.exports=Object.freeze({createScheduledSingleTestCaller,createScheduledSingleTestJournal,ADMIT_DOMAIN,RECEIPT_DOMAIN});
