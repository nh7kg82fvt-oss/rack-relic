'use strict';
// Offline validation of existing signatures and exact ticket assembly.
// Returns private seed inputs in memory. No I/O, role grant or token issuance.
const base='../scheduled-backup-test-20261118/';
const W=require(base+'runtime/server/backup_cf_window_v1.cjs');
const {scheduleProfile}=require(base+'runtime/server/backup_scheduled_test_profile_v1.cjs');
const {createScopedV5ConstructionLoader}=require(base+'runtime/server/backup_scoped_execution_v5_root_loader.cjs');
const {createRlsSourceSessionCredentials,rlsSourceGrantSha256}=require(base+'runtime/server/rls_source_session_credentials.cjs');
const {validateScheduleTicketIdentityV1,validateScheduleTicketRecordV1}=require(base+'server/schedule-ticket-repository.cjs');

function assemble({loaderInput,reviewerKey,wire,expectedSource,observedAt}) {
 const held=()=>{throw Error('ONE_SLOT_PREFLIGHT_HELD');};
 const construction=createScopedV5ConstructionLoader(loaderInput).load();
 if (!construction) held();
 const {root,executionAcceptance,packetSha256,chunkCount}=construction;
 const p=scheduleProfile(executionAcceptance.scheduleProfile);
 const body=W.cfCopy(wire);
 const fields=['selection','request','ownerGrant','enrollment','custodyReview','collectorGrantReview',
  'sourcePrincipalGrant','lease','signedWindowBinding'];
 if (!W.cfExact(body,fields)||body.lease!==null||body.signedWindowBinding!==null||
     !Number.isSafeInteger(observedAt)||observedAt<0||observedAt>=p.scheduledTime||
     chunkCount!==executionAcceptance.constructionProfile.chunkCount) held();
 // Validate existing signatures for the exact signed slot. This creates no
 // live authority and the actual Workers still check their own wall clock.
 const {grantPayload}=W.authenticateCfRootV1({enabled:true,
  construction:{root,executionAcceptance,packetSha256,reviewerKey,enrollment:body.enrollment},
  selection:body.selection,request:body.request,ownerGrant:body.ownerGrant,
 },p.scheduledTime);
 const g=body.sourcePrincipalGrant;
 if (grantPayload.acceptedAt>observedAt||body.enrollment.payload.issuedAt>observedAt||
     !W.cfExact(expectedSource,['principalId','pathSha256','sha256','size','contentType'])||
     !W.cfUuid(expectedSource.principalId)||g?.dedicatedPrincipalId!==expectedSource.principalId||
     body.selection.sourcePathSha256!==expectedSource.pathSha256||
     typeof expectedSource.sha256!=='string'||!/^[a-f0-9]{64}$/.test(expectedSource.sha256)||
     expectedSource.sha256==='0'.repeat(64)||!Number.isSafeInteger(expectedSource.size)||
     expectedSource.size<1||expectedSource.size>2097152||expectedSource.contentType!=='image/png'||
     !body.selection.sourcePath.endsWith('.png')||
     executionAcceptance.sourcePrincipalReview.mode!=='rls-scoped-session'||
     g.reviewedAt>observedAt||g.expiresAt<=p.deadline||
     rlsSourceGrantSha256(g)!==executionAcceptance.sourcePrincipalReview.scopeEvidenceSha256||
     W.cfDigest(body.custodyReview)!==executionAcceptance.cfWindowProfile.capabilityCustodyReviewSha256||
     W.cfDigest(body.collectorGrantReview)!==executionAcceptance.collectorProvenance.custodyReviewSha256) held();
 const identity=validateScheduleTicketIdentityV1({
  ticketId:p.ticketId,cron:p.cron,scheduledTime:p.scheduledTime,deadline:p.deadline,
  rootSha256:W.cfDigest(root),acceptanceSha256:W.cfDigest(executionAcceptance),
  requestSha256:p.requestSha256,selectionSha256:p.selectionSha256,
 });
 const envelopeText=W.cfCanonical(body),envelopeSha256=W.cfHash(envelopeText);
 const ownerSeed=validateScheduleTicketRecordV1({
  version:'rr-schedule-ticket-record-v1',...identity,envelopeText,envelopeSha256,consumed:false,
 },identity);
 const reconciliationPlan=Object.freeze({
  ticketId:p.ticketId,scheduledTime:p.scheduledTime,deadline:p.deadline,
  snapshotId:body.selection.snapshotId,requestSha256:p.requestSha256,envelopeSha256,
  photoSha256:expectedSource.sha256,photoSize:expectedSource.size,
 });
 return Object.freeze({ownerSeed:Object.freeze(ownerSeed),packetSha256,reconciliationPlan});
}

// Source-custodian-only sanity check. Provider authentication is separate.
function checkSourceSession(input,{scheduledTime,deadline}) {
 if (!Number.isSafeInteger(scheduledTime)||deadline!==scheduledTime+5000) throw Error('SOURCE_SESSION_WINDOW_HELD');
 const credential=createRlsSourceSessionCredentials(input);
 if (!credential) throw Error('SOURCE_SESSION_WINDOW_HELD');
 credential.check(scheduledTime);
 credential.check(deadline-1);
 return true;
}
module.exports={assemble,checkSourceSession};
