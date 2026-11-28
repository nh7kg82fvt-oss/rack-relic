'use strict';
const W=require('../scheduled-backup-test-20261118/runtime/server/backup_cf_window_v1.cjs');

// Inputs are independently collected, scope-checked observations, never runtime
// ports. null means a successful scoped read found nothing. Undefined is unknown.
// This check never changes the journal and cannot approve hosted timing or restore.
function reconcile({plan,ticket,objects,terminal}) {
 const hold=reason=>Object.freeze({state:'held',reason,mayRetry:false});
 const same=(a,b)=>W.cfCanonical(a)===W.cfCanonical(b);
 const digest=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x)&&x!=='0'.repeat(64);
 if (!W.cfUuid(plan?.snapshotId)||!W.cfUuid(plan.ticketId)||
     !digest(plan.requestSha256)||
     !digest(plan.envelopeSha256)||
     !digest(plan.photoSha256)||
     !Number.isSafeInteger(plan.scheduledTime)||plan.scheduledTime<=0||plan.scheduledTime%60000!==0||
     !Number.isSafeInteger(plan.deadline)||plan.deadline!==plan.scheduledTime+5000||
     !Number.isSafeInteger(plan.photoSize)||plan.photoSize<1||plan.photoSize>2097152) return hold('PLAN_HELD');
 const prefix=W.CF_WINDOW_PREFIX+plan.snapshotId+'/';
 const keys=[prefix+'objects/'+plan.photoSha256,prefix+'manifest.json'];
 if (!Array.isArray(objects)||objects.length!==2||objects.some((x,i)=>x?.key!==keys[i])) return hold('READBACK_UNCERTAIN');
 const tupleMatches=()=>ticket?.ticketId===plan.ticketId&&ticket.requestSha256===plan.requestSha256&&
   ticket.envelopeSha256===plan.envelopeSha256;
 if (!tupleMatches()) return hold('TICKET_IDENTITY_UNCERTAIN');
 if (ticket.claimedAt===null&&ticket.claimedNonce===null&&objects.every(o=>o.row===null&&o.dispatch===null&&o.bytes===null)) {
  return Object.freeze({state:'no-capture-observed',mayRetry:false});
 }
 if (!Number.isSafeInteger(ticket.claimedAt)||ticket.claimedAt<plan.scheduledTime||ticket.claimedAt>=plan.deadline||
     typeof ticket.claimedNonce!=='string'||!/^[a-f0-9]{32}$/.test(ticket.claimedNonce)||
     ticket.claimedNonce==='0'.repeat(32)) return hold('TICKET_CLAIM_UNCERTAIN');
 const checked=[];
 for (const [i,{key,row,dispatch,bytes}] of objects.entries()) {
  const kind=i===0?'photo':'manifest',type=i===0?'image/png':'application/json';
  if (!row||row.outcome!=='verified'||!dispatch||dispatch.state!=='consumed'||
      row.key!==key||row.kind!==kind||row.contentType!==type||!W.cfUuid(row.attemptId)||
      dispatch.attemptId!==row.attemptId||dispatch.requestSha256!==plan.requestSha256||dispatch.snapshotId!==plan.snapshotId||
      !digest(dispatch.leaseSha256)||
      !(bytes instanceof Uint8Array)||bytes.length<1||bytes.length>(i===0?2097152:32768)||
      bytes.length!==row.size||W.cfHash(bytes)!==row.sha256||
      i===0&&(row.sha256!==plan.photoSha256||row.size!==plan.photoSize)) return hold('ORIGINAL_UNRESOLVED');
  const {outcome,...tuple}=row;
  checked.push(tuple);
 }
 try {
  const text=new TextDecoder('utf-8',{fatal:true}).decode(objects[1].bytes);
  const manifest=W.cfCopy(JSON.parse(text));
  if (W.cfCanonical(manifest)!==text||manifest.payload?.version!=='rr-cf-fixed-photo-manifest-v1'||
      manifest.payload.snapshotId!==plan.snapshotId||manifest.payload.rootRequestSha256!==plan.requestSha256||
      manifest.payload.leaseSha256!==objects[0].dispatch.leaseSha256||
      manifest.payload.leaseSha256!==objects[1].dispatch.leaseSha256||
      !same(manifest.payload.photoTuple,checked[0])) return hold('MANIFEST_UNRESOLVED');
 } catch {return hold('MANIFEST_UNRESOLVED');}
 // A scheduled return value alone may be unavailable in hosted observations.
 // Without terminal evidence from the original run, bytes prove only readback.
 if (terminal?.photoSnapshotComplete!==true||terminal.snapshotId!==plan.snapshotId||
     terminal.rootRequestSha256!==plan.requestSha256||terminal.sourceFacadeCalls!==5||
     !Array.isArray(terminal.unresolvedOriginalHolds)||terminal.unresolvedOriginalHolds.length!==0||
     !Array.isArray(terminal.finalReceiptSha256)||terminal.finalReceiptSha256.length!==4||
     !terminal.finalReceiptSha256.every(digest)||
     new Set(terminal.finalReceiptSha256).size!==4||
     !Array.isArray(terminal.resolvedOriginalReceipts)||terminal.resolvedOriginalReceipts.length!==2||
     checked.some(t=>!terminal.resolvedOriginalReceipts.some(r=>r?.originalAttemptId===t.attemptId&&
       terminal.finalReceiptSha256.includes(r.receiptSha256)))) {
  return Object.freeze({state:'verified-originals-observed',reason:'ORIGINAL_TERMINAL_EVIDENCE_HELD',mayRetry:false});
 }
 return Object.freeze({state:'original-run-and-readback-match',mayRetry:false});
}
module.exports={reconcile};
