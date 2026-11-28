'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const base='../scheduled-backup-test-20261118/';
const {fixture,withClock,memoryRepository,W}=require(base+'tests/helpers/scheduled-fixture.cjs');
const A=require(base+'server/schedule-admission.cjs');
const P=require(base+'runtime/server/backup_cf_window_ports_v1.cjs');
const {createCfPhotoSnapshotV1}=require(base+'runtime/server/backup_cf_photo_snapshot_v1.cjs');
const {createAuthenticatedControlPlaneCollectorV5}=require(base+'runtime/server/backup_authenticated_collector_v5.cjs');
const {createRlsSessionSourcePhotoFacade}=require(base+'runtime/server/backup_rls_source_photo_facade.cjs');
const {assemble,checkSourceSession}=require('./preflight.cjs');
const {reconcile}=require('./reconcile.cjs');
const sourceRef='tzymapahsfiyhgilsmxl';
const sourceHost=sourceRef+'.storage.supabase.co';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aY9sAAAAASUVORK5CYII=','base64');

function session(x) {
 const now=Math.floor(Date.now()/1000);
 const jwt=payload=>[
  Buffer.from('{"alg":"HS256"}'), Buffer.from(JSON.stringify(payload)), Buffer.from('synthetic'),
 ].map(b=>b.toString('base64url')).join('.');
 const principalGrant=x.wire.sourcePrincipalGrant;
 return {
  principalGrant,dedicatedPrincipalId:principalGrant.dedicatedPrincipalId,
  expectedGrantSha256:x.f.executionAcceptance.sourcePrincipalReview.scopeEvidenceSha256,
  legacyAnonKey:jwt({role:'anon',iss:'supabase',ref:sourceRef,exp:now+300}),
  userAccessToken:jwt({sub:principalGrant.dedicatedPrincipalId,iss:principalGrant.issuer,
   aud:'authenticated',role:'authenticated',iat:now,exp:now+300}),
  jwt,now,
 };
}
function sourceFacade(x,repo,reads) {
 const opts=session(x),last=new Date(Date.now()-1000);
 const path=x.wire.selection.sourcePath,etag='"fictional-etag"';
 return createRlsSessionSourcePhotoFacade({...opts,enabled:true,capabilityKey:x.keys.sourceCapability,
  inventorySealKey:x.keys.sourceSeal,region:'us-east-1',fetchImpl:async(url,request)=>{
   assert.equal(repo.consumed,true);
   assert.equal(new URL(url).host,sourceHost);
   assert.equal(request.method,'GET');
   const object=!url.includes('?');
   reads.push(object?'original':'list');
   const xml='<ListBucketResult><Name>listing-photos</Name><Prefix></Prefix><MaxKeys>5</MaxKeys>'+
    '<KeyCount>1</KeyCount><IsTruncated>false</IsTruncated><Contents><Key>'+path+
    '</Key><ETag>&quot;fictional-etag&quot;</ETag><Size>'+png.length+'</Size><LastModified>'+
    last.toISOString()+'</LastModified><StorageClass>STANDARD</StorageClass></Contents></ListBucketResult>';
   if (object) assert.equal(request.headers['if-match'],etag);
   const response=new Response(object?png:xml,{headers:{date:new Date(Date.now()).toUTCString(),
    etag,'last-modified':last.toUTCString(),'content-type':object?'image/png':'application/xml'}});
   Object.defineProperty(response,'url',{value:url});
   return response;
  }});
}
function archivePorts(x,options,repository,reads,{losePut=false}={}) {
 const objects=new Map(),rows=new Map(),dispatches=new Map(),puts=[];
 const bucket={
  async get(key) {
   const stored=objects.get(key);
   return stored?{size:stored.bytes.length,httpMetadata:{contentType:stored.contentType},
    body:new Response(stored.bytes).body}:null;
  },
  async put(key,bytes,opts) {
   assert.equal(opts.onlyIf.get('if-none-match'),'*');
   assert.ok(!objects.has(key));
   puts.push(key);
   objects.set(key,{bytes:Buffer.from(bytes),contentType:opts.httpMetadata.contentType});
   if (losePut) throw Error('synthetic lost acknowledgment after storing bytes');
   return {};
  },
 };
 const storage={
  async claimOriginalForDispatch(t,ctx) {
   assert.equal(rows.has(t.key),false);
   const row={...t,attemptId:randomUUID(),outcome:'unknown',sendAllowed:true};
   rows.set(t.key,row);
   dispatches.set(t.key,{...ctx,state:'reserved'});
   return {original:row,dispatchReservationState:'reserved'};
  },
  async consumeOriginalDispatch(t,ctx) {
   const row=rows.get(t.key),d=dispatches.get(t.key);
   assert.equal(row.attemptId,t.attemptId);
   assert.equal(d.state,'reserved');
   d.state='consumed';
   return {version:'rr-window-original-dispatch-v2',test:true,sourceProjectRef:sourceRef,
    identity:W.CF_WINDOW_IDENTITY,key:t.key,sha256:t.sha256,contentType:t.contentType,
    size:t.size,attemptId:t.attemptId,...ctx,sendAllowed:true,releaseEnabled:false};
  },
  async lookupOriginal(t) {return rows.get(t.key)??null;},
  async recordVerifiedOriginal(t) {rows.get(t.key).outcome='verified';},
 };
 function createPorts(window) {
  const role=name=>({...options,lease:window.lease,roleKeys:x.roleKeys(name)});
  const journalKey=x.f.testOnlyKeys.journal;
  const dispatch=P.createCfDispatchJournalV1({...role('journal'),repository:storage});
  return {
   source:P.createCfSourcePortV1({...role('source'),signedWindowBinding:window.signedWindowBinding,
    sourceFacade:sourceFacade(x,repository,reads),signingKey:x.f.testOnlyKeys.source}),
   claims:P.createCfClaimJournalV1({...role('journal'),repository:storage,signingKey:journalKey}),
   gateway:P.createCfGatewayV1({...role('gateway'),bucket,dispatchHost:dispatch}),
   journal:P.createCfTrustedReceiptJournalV1({...role('journal'),repository:storage,signingKey:journalKey,
    archiveReader:P.createCfReceiptReadGatewayV1({...role('gateway'),bucket})}),
  };
 }
 return {createPorts,objects,rows,dispatches,puts};
}

for (const losePut of [false,true]) test(losePut?'nonempty photo PUT lost reply remains UNKNOWN and cannot retry':'nonempty scheduled photo and manifest exercise real signed ports against mock transports',()=>withClock(async()=>{
 const x=fixture(),repo=memoryRepository(x),reads=[];
 const options={enabled:true,construction:{...x.construction,enrollment:x.wire.enrollment},
  selection:x.wire.selection,request:x.wire.request,ownerGrant:x.wire.ownerGrant,custodyReview:x.wire.custodyReview,
  roleKeys:x.roleKeys('caller')};
 const archive=archivePorts(x,options,repo,reads,{losePut});
 const j=A.createScheduledSingleTestJournal({enabled:true,construction:x.construction,
  journalKey:x.keys.journalCapability,journalRoleKeys:x.roleKeys('journal'),repository:repo,
  signingKey:x.f.testOnlyKeys.journal,clock:Date.now});
 const createCaller=()=>A.createScheduledSingleTestCaller({enabled:true,construction:x.construction,
  journalKey:x.keys.journalCapability,clock:Date.now,claim:v=>j.admit(v),run:wire=>{
   assert.deepEqual(wire,W.cfCopy(x.wire));
   const issuer=W.createCfWindowV1Issuer({...options,roleKeys:x.roleKeys('verifier'),
    signingKey:x.f.testOnlyKeys.collector,collector:createAuthenticatedControlPlaneCollectorV5(x.h.options('archive-original-create'))});
   return createCfPhotoSnapshotV1({...options,createIssuer:()=>issuer,
    createPorts:archive.createPorts}).run(wire.selection.snapshotId);
  }});
 const output=await createCaller().scheduled(x.controller());
 assert.equal(x.h.calls.length,42);
 assert.equal(output.photoSnapshotComplete,!losePut,JSON.stringify(output));
 assert.equal(output.providerCommitBeforeDeadlineProven,false);
 assert.equal(output.databaseSnapshotComplete,false);
 assert.equal(archive.puts.length,losePut?1:2);
 assert.deepEqual(reads,losePut?['list','original','list']:['list','original','list','list','list']);
 assert.ok([...archive.rows.values()].every(r=>r.outcome===(losePut?'unknown':'verified')));
 assert.ok([...archive.dispatches.values()].every(r=>r.state==='consumed'));
 assert.deepEqual(archive.objects.get(archive.puts[0]).bytes,png);
 assert.ok(output.unresolvedOriginalHolds.length===(losePut?2:0));
 const requestSha256=W.cfDigest(x.wire.request),snapshotId=x.wire.selection.snapshotId;
 const envelopeSha256=W.cfDigest(x.wire),photoSha256=W.cfHash(png);
 const plan={snapshotId,requestSha256,envelopeSha256,photoSha256,photoSize:png.length,
  ticketId:x.profile.ticketId,scheduledTime:x.profile.scheduledTime,deadline:x.profile.deadline};
 const prefix=W.CF_WINDOW_PREFIX+snapshotId+'/';
 const objects=[prefix+'objects/'+photoSha256,prefix+'manifest.json'].map(key=>{
  const row=archive.rows.get(key);
  if (!row) return {key,row:null,dispatch:null,bytes:null};
  const {sendAllowed,...original}=row;
  return {key,row:original,dispatch:{...archive.dispatches.get(key),attemptId:row.attemptId},
   bytes:archive.objects.get(key)?.bytes};
 });
 const ticket={ticketId:plan.ticketId,requestSha256,envelopeSha256,
  claimedAt:plan.scheduledTime,claimedNonce:'1'.repeat(32)};
 const evidence={plan,ticket,objects,terminal:output};
 if (losePut) assert.deepEqual(reconcile(evidence),{state:'held',reason:'ORIGINAL_UNRESOLVED',mayRetry:false});
 else {
  assert.equal(reconcile(evidence).state,'original-run-and-readback-match');
  assert.equal(reconcile({...evidence,terminal:undefined}).state,'verified-originals-observed');
  const wrong=[{...objects[0],bytes:Buffer.from('unrelated')},objects[1]];
  assert.equal(reconcile({...evidence,objects:wrong}).state,'held');
  assert.equal(reconcile({...evidence,ticket:{...ticket,requestSha256:'e'.repeat(64)}}).state,'held');
 }
 await assert.rejects(createCaller().scheduled(x.controller()),/HELD/);
 assert.equal(archive.puts.length,losePut?1:2);
}));

test('offline packet binds original signatures and source claims through the slot',()=>withClock(async()=>{
 const x=fixture(),values=x.f.secretValues();
 const {RACK_RELIC_BACKUP_V5_ROOT_SHA256:expectedRootSha256,
  RACK_RELIC_BACKUP_V5_ACCEPTANCE_SHA256:expectedAcceptanceSha256,...secretValues}=values;
 const input={loaderInput:{enabled:true,expectedRootSha256,expectedAcceptanceSha256,secretValues},
  reviewerKey:x.f.reviewerKey,wire:x.wire,observedAt:x.profile.scheduledTime-100,
  expectedSource:{principalId:x.wire.sourcePrincipalGrant.dedicatedPrincipalId,
   pathSha256:x.wire.selection.sourcePathSha256,sha256:W.cfHash(png),size:png.length,contentType:'image/png'}};
 const {ownerSeed,reconciliationPlan}=assemble(input);
 assert.equal(reconciliationPlan.envelopeSha256,ownerSeed.envelopeSha256);
 assert.equal(reconciliationPlan.photoSha256,W.cfHash(png));
 assert.equal(ownerSeed.envelopeText,W.cfCanonical(x.wire));
 assert.equal(ownerSeed.requestSha256,x.profile.requestSha256);
 assert.throws(()=>assemble({...input,wire:{...input.wire,request:{...x.wire.request,deadline:x.profile.deadline+1}}}),/HELD/);
 assert.throws(()=>assemble({...input,expectedSource:{...input.expectedSource,pathSha256:'f'.repeat(64)}}),/HELD/);
 const opts=session(x);
 assert.equal(checkSourceSession(opts,x.profile),true);
 assert.throws(()=>checkSourceSession({...opts,userAccessToken:opts.jwt({sub:opts.dedicatedPrincipalId,
  iss:opts.principalGrant.issuer,aud:'authenticated',role:'authenticated',iat:opts.now,exp:opts.now+4})},x.profile),/HELD/);
}));
