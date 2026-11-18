'use strict';
// New integration fixture only. Every authority, token and provider response is
// synthetic. It never turns the stored historical Worker bytes into V5 proof.
const {randomUUID,sign}=require('node:crypto');
const W=require('../../runtime/server/backup_cf_window_v1.cjs');
const {cronForSlot}=require('../../runtime/server/backup_scheduled_test_profile_v1.cjs');
const {createCollectorFixtureV5}=require('./authenticated-collector-v5-fixture.cjs');
const {rlsSourceGrantSha256}=require('../../runtime/server/rls_source_session_credentials.cjs');
const ROLES={caller:['rootControl','sourceCapability','journalCapability','upload','manifest'],verifier:['rootControl'],source:['sourceCapability','sourceSeal'],journal:['journalCapability','read','dispatch','manifest'],gateway:['upload','read','dispatch','manifest']};
async function withClock(work){
 const original=Date.now;let now=Math.floor(original()/60000)*60000;
 Date.now=()=>now;
 try{return await work({now:()=>now,set:t=>{now=t;}});}finally{Date.now=original;}
}
function fixture(){
 const h=createCollectorFixtureV5(),f=h.f,now=f.now;
 const keys=Object.fromEntries(['rootControl','sourceCapability','sourceSeal','journalCapability','upload','read','dispatch','manifest'].map((n,i)=>[n,Buffer.alloc(32,31+i)]));
 const roleKeys=role=>Object.fromEntries(ROLES[role].map(k=>[k,Buffer.from(keys[k])]));
 const custodyReview={version:'rr-cf-capability-custody-review-v1',keySha256:Object.fromEntries(Object.entries(keys).map(([k,v])=>[k,W.cfHash(v)])),holderRoles:Object.fromEntries(Object.keys(keys).map(k=>[k,Object.keys(ROLES).filter(r=>ROLES[r].includes(k))])),sourceKeyId:f.executionAcceptance.cfWindowProfile.sourceAttestationKey.keyId,journalKeyId:f.executionAcceptance.cfWindowProfile.journalReceiptKey.keyId,independentlyReadSecretValues:false};
 const sourcePrincipalGrant={version:'rr-rls-source-principal-grant-v1',projectRef:'tzymapahsfiyhgilsmxl',bucket:'listing-photos',dedicatedPrincipalId:randomUUID(),issuer:'https://tzymapahsfiyhgilsmxl.supabase.co/auth/v1',audience:'authenticated',purpose:'dedicated-machine-storage-select-only',bucketPrivate:true,selectPolicySha256:'a'.repeat(64),mutationDenyPolicySha256:'b'.repeat(64),otherPrivilegesReviewSha256:'c'.repeat(64),ownerAuthorizationSha256:'d'.repeat(64),reviewedAt:now-1000,expiresAt:now+60000};
 f.executionAcceptance.sourcePrincipalReview.scopeEvidenceSha256=rlsSourceGrantSha256(sourcePrincipalGrant);
 f.executionAcceptance.cfWindowProfile.capabilityCustodyReviewSha256=W.cfDigest(custodyReview);
 const sourcePath=randomUUID()+'/'+randomUUID()+'/fictional.png';
 const selection={snapshotId:randomUUID(),sourceProjectRef:'tzymapahsfiyhgilsmxl',sourceBucket:'listing-photos',sourcePath,sourcePathSha256:W.cfHash(sourcePath)};
 const request={version:'rr-cf-backup-root-request-v1',selectionSha256:W.cfDigest(selection),executionId:'a'.repeat(32),nonce:'b'.repeat(32),requestedAt:now,deadline:now+5000};
 const profile={version:'rr-cf-scheduled-single-test-profile-v1',ticketId:randomUUID(),cron:cronForSlot(now),scheduledTime:now,deadline:now+5000,requestSha256:W.cfDigest(request),selectionSha256:W.cfDigest(selection)};
 f.executionAcceptance.scheduleProfile=profile;f.participants[0].ingress.schedules=[{cron:profile.cron}];
 const scheduleURL='https://api.cloudflare.com/client/v4/accounts/7a3ed4f82692abebebc6447e5f5e217c/workers/scripts/'+f.participants[0].name+'/schedules';
 h.data.set(scheduleURL,{success:true,errors:[],messages:[],result:{schedules:[{cron:profile.cron,created_on:new Date(now-1000).toISOString()}]}});
 h.repin();
 const payload={version:'rr-cf-window-scheduled-single-test-owner-execution-grant-v1',recordId:randomUUID(),decision:'ACCEPT_EXACT_ONE_SCHEDULED_TEST_CF_PLATFORM_CLOCK_WINDOW_V1',scopeSha256:W.cfDigest(W.CF_WINDOW_V1_SCOPE),rootId:f.root.rootId,rootSha256:W.cfDigest(f.root),acceptanceSha256:W.cfDigest(f.executionAcceptance),enrollmentSha256:W.cfDigest(f.enrollment),participantsSha256:W.cfDigest(f.observedParticipants()),requestSha256:W.cfDigest(request),selectionSha256:W.cfDigest(selection),clockProfileSha256:W.CF_WINDOW_V1_SCOPE.clockProfileSha256,capabilityCustodyReviewSha256:W.cfDigest(custodyReview),acceptedAt:now-500,expiresAt:now+5000,residualTrust:[...W.CF_WINDOW_V1_SCOPE.residualTrust]};
 const ownerGrant={algorithm:'Ed25519',keyId:f.reviewerKey.keyId,payload,signature:sign(null,Buffer.from('rack-relic/cf-window-scheduled-single-test-v1/owner-execution-grant\n'+W.cfCanonical(payload)),f.testOnlyKeys.reviewer).toString('base64')};
 const construction={root:f.root,executionAcceptance:f.executionAcceptance,packetSha256:f.packetSha(),reviewerKey:f.reviewerKey};
 const wire={selection,request,ownerGrant,enrollment:f.enrollment,custodyReview,collectorGrantReview:h.grantReview,sourcePrincipalGrant,lease:null,signedWindowBinding:null};
 return {h,f,keys,roleKeys,construction,wire,profile,scheduleURL,controller:()=>({cron:profile.cron,scheduledTime:profile.scheduledTime})};
}
function memoryRepository(x,hooks={}){
 const text=W.cfCanonical(x.wire),envelopeSha256=W.cfHash(text),p=x.profile;
 const identity={ticketId:p.ticketId,cron:p.cron,scheduledTime:p.scheduledTime,deadline:p.deadline,rootSha256:W.cfDigest(x.f.root),acceptanceSha256:W.cfDigest(x.f.executionAcceptance),requestSha256:p.requestSha256,selectionSha256:p.selectionSha256};
 let consumed=false;const calls=[];
 return {calls,get consumed(){return consumed;},async read(value,{signal}){
  calls.push('read');if(signal.aborted||W.cfCanonical(value)!==W.cfCanonical(identity))throw Error('held');
  if(hooks.read)return hooks.read(value,{signal});
  return consumed?{version:'rr-schedule-ticket-consumed-v1',ticketId:p.ticketId,consumed:true}:{version:'rr-schedule-ticket-record-v1',...identity,envelopeSha256,envelopeText:text,consumed:false};
 },async consume(value,{signal}){
  calls.push('consume');if(signal.aborted)throw Error('held');
  if(consumed)return {version:'rr-schedule-ticket-consumed-v1',ticketId:p.ticketId,consumed:true};
  consumed=true;
  if(hooks.afterConsume)return hooks.afterConsume(value,{signal});
  return {version:'rr-schedule-ticket-claim-v1',ticketId:p.ticketId,nonce:value.nonce,envelopeSha256,claimedAt:Date.now(),consumed:true};
 }};
}
module.exports={fixture,withClock,memoryRepository,W};
