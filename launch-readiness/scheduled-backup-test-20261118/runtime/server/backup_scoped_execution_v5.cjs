'use strict';
// ADDITIVE CARRIER-AWARE V5 SOURCE. Strict V3 is unchanged. No actual owner root,
// protected reviewer key, signed runtime enrollment or native wrapper installed.
// NODE-ONLY SOURCE PROPOSAL. No root, execution acceptance, collector, secret or
// global fetch. No native Worker/WebCrypto closure or compatibility flag change.
const {createHash,createPublicKey,verify}=require('node:crypto');
const {CF_PLATFORM_CLOCK_PROFILE_SHA256}=require('./cloudflare_window_lifecycle_proposal_v1.cjs');
const {verifyV5RuntimeEnrollment,copyV5ConstructionData}=require('./backup_runtime_enrollment_v5.cjs');
const {createR2ArchiveConfigurationVerifier}=require('./r2_archive_config_verifier.cjs');
const {scheduleProfile}=require('./backup_scheduled_test_profile_v1.cjs');
const VERSION='rr-backup-scoped-execution-v5-scheduled-test-v1',CHALLENGE='rr-backup-scoped-execution-challenge-v5-scheduled-test-v1';
const CARRIER_COUNT='RACK_RELIC_BACKUP_V5_CONFIG_COUNT';
const CARRIER_PARTS=Object.freeze(Array.from({length:13},(_,i)=>'RACK_RELIC_BACKUP_V5_CONFIG_'+String(i+1).padStart(2,'0')));
const CARRIER_PINS=Object.freeze(['RACK_RELIC_BACKUP_V5_ROOT_SHA256','RACK_RELIC_BACKUP_V5_ACCEPTANCE_SHA256']);
const ROLES=['caller','verifier','source','journal','gateway'];
const NAMES={caller:'rack-relic-r2-backup-caller',verifier:'rack-relic-r2-policy-verifier',source:'rack-relic-backup-source-reader',journal:'rack-relic-archive-journal',gateway:'rack-relic-private-photo-archive-gateway'};
const STAGES=Object.freeze({
 'archive-original-create':Object.freeze(['before-claim','before-send','after-send','before-read','after-read']),
 'archive-original-read':Object.freeze(['before-read','after-read']),
 'journal-original-verify':Object.freeze(['before-lookup','before-read','after-read','before-record','after-record']),
 'source-photo-read':Object.freeze(['before-inventory','after-inventory','before-read','after-read','before-recheck','after-recheck'])
});
const RESIDUALS=Object.freeze(['named-installer-and-independent-installation-review','Rack-account-administrators','Cloudflare-platform-and-administrators','Supabase-platform-and-administrators','accepted-collector-host-and-key-custody','account-scoped-verifier-R2-read-and-list-power','source-principal-separate-review-required-S3-keys-can-read-write-all-buckets-and-bypass-RLS','unobserved-copied-renamed-derived-or-inherited-authority-not-excluded','outside-accepted-profile-ingress-not-universally-excluded','non-atomic-observations-and-future-administrator-changes','protected-construction-reviewer-and-named-installer-secret-value-custody']);
const EXCLUSIONS=Object.freeze(['outside-accepted-account-zones-and-resources','unobservable-version-overrides-and-inbound-producers','unseen-credential-copies-and-inherited-authority','atomic-snapshot-and-future-administrator-change']);
const SECRETS={caller:['SOURCE_CAPABILITY_HMAC','JOURNAL_CAPABILITY_HMAC','RACK_RELIC_TEST_R2_CAPABILITY_HEX','RACK_RELIC_BACKUP_MANIFEST_HEX','ROOT_CONTROL_HMAC'],verifier:['ROOT_CONTROL_HMAC','RACK_RELIC_R2_CONFIG_READ_TOKEN','RACK_RELIC_R2_WORKER_READ_TOKEN','RACK_RELIC_BACKUP_V5_COLLECTOR_SIGNING_KEY'],source:['SOURCE_RLS_LEGACY_ANON_KEY','SOURCE_ATTESTATION_SIGNING_KEY','SOURCE_CAPABILITY_HMAC','SOURCE_INVENTORY_SEAL_HMAC','SOURCE_S3_ACCESS_KEY_ID','SOURCE_S3_SECRET_ACCESS_KEY','SOURCE_RLS_ACCESS_TOKEN','SOURCE_RLS_REFRESH_TOKEN'],journal:['ARCHIVE_DISPATCH_HMAC','JOURNAL_RECEIPT_SIGNING_KEY','RACK_RELIC_BACKUP_MANIFEST_HEX','JOURNAL_CAPABILITY_HMAC','JOURNAL_SUPABASE_SERVER_KEY','RACK_RELIC_TEST_R2_RECEIPT_READ_CAPABILITY_HEX'],gateway:['ARCHIVE_DISPATCH_HMAC','RACK_RELIC_BACKUP_MANIFEST_HEX','RACK_RELIC_TEST_R2_CAPABILITY_HEX','RACK_RELIC_TEST_R2_RECEIPT_READ_CAPABILITY_HEX']};
// Existing reviewed nonsecret configuration names only. A future native V5
// wrapper/root carrier requires its own schema review; no guessed flags/chunks.
const PLAINTEXT={caller:{RACK_RELIC_BACKUP_V2_ENABLED:'flag',RACK_RELIC_BACKUP_V5_ENABLED:'flag'},verifier:{RACK_RELIC_BACKUP_V2_OBSERVATION_ENABLED:'flag',RACK_RELIC_BACKUP_V5_OBSERVATION_ENABLED:'flag'},source:{SOURCE_FACADE_ENABLED:'flag',SOURCE_V5_FACADE_ENABLED:'flag',SOURCE_S3_REGION:'region'},journal:{JOURNAL_FACADE_ENABLED:'flag',JOURNAL_V5_FACADE_ENABLED:'flag'},gateway:{RACK_RELIC_TEST_R2_V5_GATEWAY_ENABLED:'flag',RACK_RELIC_TEST_R2_V5_RECEIPT_READ_ENABLED:'flag',RACK_RELIC_TEST_R2_GATEWAY_ENABLED:'flag',RACK_RELIC_TEST_R2_RECEIPT_READ_ENABLED:'flag',RACK_RELIC_TEST_R2_GATEWAY_ORIGIN:'origin',RACK_RELIC_TEST_R2_ARTIFACT_SHA256:'sha'}};
const CREDENTIAL_NAMES=new Set([...Object.values(SECRETS).flat(),'RACK_RELIC_TEST_SUPABASE_SERVER_KEY','SUPABASE_SERVICE_ROLE_KEY','SUPABASE_SECRET_KEYS','SUPABASE_DB_URL','CLOUDFLARE_API_TOKEN','R2_ACCESS_KEY_ID','R2_SECRET_ACCESS_KEY']);
const SCOPE=Object.freeze({version:VERSION,accountId:'7a3ed4f82692abebebc6447e5f5e217c',sourceProjectRef:'tzymapahsfiyhgilsmxl',sourceBucket:'listing-photos',archiveBucket:'rack-relic-private-photo-archive',archiveIdentity:'r2:7a3ed4f82692abebebc6447e5f5e217c:rack-relic-private-photo-archive',namespace:'snapshots/b3da65e2d3ec11eee93fa81c8e8f8fe2/',purposes:Object.freeze(Object.keys(STAGES)),maximumRecordMs:86400000,maximumObservationMs:5000,scheduledSingleTestOnly:true,clockRenewalAllowed:false,maximumObjectBytes:2097152,operationCapabilityRequired:true,absoluteAbsenceProven:false,residualTrust:RESIDUALS,profileExclusions:EXCLUSIONS});
const SHA=/^[a-f0-9]{64}$/,UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const HEX32=/^[a-f0-9]{32}$/,OPAQUE=/^[A-Za-z0-9_-]{1,128}$/;
const fail=()=>{throw Error('SCOPED_EXECUTION_V5_HELD');};
const exact=(x,keys)=>x&&Object.getPrototypeOf(x)===Object.prototype&&Reflect.ownKeys(x).length===Object.keys(x).length&&Object.values(Object.getOwnPropertyDescriptors(x)).every(p=>Object.hasOwn(p,'value')&&p.enumerable===true)&&Object.keys(x).sort().join('|')===keys.slice().sort().join('|');
const canonical=x=>JSON.stringify(x&&typeof x==='object'?Array.isArray(x)?x.map(v=>JSON.parse(canonical(v))):Object.fromEntries(Object.keys(x).sort().map(k=>[k,JSON.parse(canonical(x[k]))])):x);
const digest=x=>createHash('sha256').update(canonical(x)).digest('hex');
const same=(a,b)=>canonical(a)===canonical(b);
const sha=x=>typeof x==='string'&&SHA.test(x)&&x!=='0'.repeat(64);
const uuid=x=>typeof x==='string'&&UUID.test(x)&&x!=='00000000-0000-0000-0000-000000000000';
const opaque=x=>typeof x==='string'&&OPAQUE.test(x);
const nonce=x=>typeof x==='string'&&HEX32.test(x)&&x!=='0'.repeat(32);
const SCOPE_SHA=digest(SCOPE);
function copy(value,max=65536){const result=copyV5ConstructionData(value);if(Buffer.byteLength(canonical(result))>max)fail();return result;}
function strings(values,maximum=16){if(!Array.isArray(values)||values.length>maximum||values.some(v=>!opaque(v))||new Set(values).size!==values.length)fail();}
function time(start,end,now,maximum){if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>now||end<=now||end<=start||end-start>maximum)fail();}
function key(record){
 if(!exact(record,['keyId','spkiBase64'])||!sha(record.keyId)||typeof record.spkiBase64!=='string')fail();
 const der=Buffer.from(record.spkiBase64,'base64');
 if(der.length!==44||der.toString('base64')!==record.spkiBase64||der.subarray(0,12).toString('hex')!=='302a300506032b6570032100'||createHash('sha256').update(der).digest('hex')!==record.keyId)fail();
 const result=createPublicKey({key:der,format:'der',type:'spki'});if(result.asymmetricKeyType!=='ed25519')fail();return result;
}
function participants(rows,profile,schedule){
 if(!Array.isArray(rows)||rows.length!==5)fail();const ids={};
 for(let index=0;index<5;index++){const row=rows[index];if(!row||row.role!==ROLES[index]||!opaque(row.workerId))fail();ids[row.role]=row.workerId;}
 if(new Set(Object.values(ids)).size!==5)fail();
 const links=[];
 for(const row of rows){
  if(!exact(row,['role','name','workerId','module','compatibilityDate','compatibilityFlags','bindings','ingress'])||row.name!==NAMES[row.role]||row.compatibilityDate!=='2026-11-04')fail();
  strings(row.compatibilityFlags,4); // Exact actual reviewed flags, never inferred.
  const m=row.module;if(!exact(m,['name','bytes','sha256','contentType'])||typeof m.name!=='string'||!/^[-a-zA-Z0-9_.]{1,100}\.m?js$/.test(m.name)||!Number.isSafeInteger(m.bytes)||m.bytes<1||m.bytes>262144||!sha(m.sha256)||m.contentType!=='application/javascript+module')fail();
  const b=row.bindings;if(!exact(b,['services','secretNames','plainText','otherBindings'])||!Array.isArray(b.services)||b.services.length>8||!exact(b.plainText,Object.keys(b.plainText||{}))||Object.keys(b.plainText).length>16)fail();
  strings(b.secretNames,32);const carrier=[CARRIER_COUNT,...CARRIER_PARTS.slice(0,profile.chunkCount),...CARRIER_PINS];if(b.secretNames.some(name=>!SECRETS[row.role].includes(name)&&!carrier.includes(name))||carrier.some(name=>!b.secretNames.includes(name)))fail();
  for(const [name,value]of Object.entries(b.plainText)){
   if(!Object.hasOwn(PLAINTEXT[row.role],name)||CREDENTIAL_NAMES.has(name)||typeof value!=='string'||value.length>256)fail();
   const kind=PLAINTEXT[row.role][name];
   if(kind==='flag'&&!['true','false'].includes(value)||kind==='region'&&!/^[a-z]{2}(?:-gov)?-[a-z]+-[0-9]$/.test(value)||kind==='sha'&&!sha(value))fail();
   if(kind==='origin'){const origin=new URL(value);if(origin.protocol!=='https:'||origin.origin!==value||origin.username||origin.password)fail();}
  }
  const seen=new Set();for(const service of b.services){
   if(!exact(service,['binding','targetWorkerId','entrypoint'])||!opaque(service.binding)||!opaque(service.entrypoint)||!Object.values(ids).includes(service.targetWorkerId)||seen.has(service.binding))fail();seen.add(service.binding);
   const target=ROLES.find(role=>ids[role]===service.targetWorkerId);
   if(!({caller:['verifier','source','journal','gateway'],journal:['verifier','gateway'],gateway:['verifier','journal'],verifier:[],source:[]}[row.role]).includes(target)||row.role==='journal'&&target==='gateway'&&service.entrypoint!=='ArchiveReceiptReader'||row.role==='gateway'&&target==='journal'&&service.entrypoint!=='ArchiveDispatch')fail();
   links.push({fromWorkerId:row.workerId,binding:service.binding,targetWorkerId:service.targetWorkerId,entrypoint:service.entrypoint});
  }
  const resources=row.role==='gateway'?[{binding:'ARCHIVE_BUCKET',type:'r2_bucket',accountId:SCOPE.accountId,bucket:SCOPE.archiveBucket}]:[];
  if(!same(b.otherBindings,resources))fail();
  const g=row.ingress;if(!exact(g,['scope','workersDev','previews','routes','customDomains','schedules','queueConsumers','tailConsumers','emailTriggers','knownInboundBindings'])||g.scope!=='accepted-profile-only'||g.workersDev!==false||g.previews!==false||['routes','customDomains','queueConsumers','tailConsumers','emailTriggers'].some(k=>!same(g[k],[]))||!same(g.schedules,row.role==='caller'?[{cron:schedule.cron}]:[])||!Array.isArray(g.knownInboundBindings))fail();
 }
 for(const row of rows){const expected=links.filter(x=>x.targetWorkerId===row.workerId).map(({targetWorkerId,...x})=>x).sort((a,b)=>canonical(a).localeCompare(canonical(b)));if(!same(row.ingress.knownInboundBindings,expected))fail();}
 return ids;
}
function acceptance(fixed,now){
 const {root:r,executionAcceptance:a}=fixed;
 if(!exact(r,['version','rootId','acceptanceSha256','collectorKey'])||r.version!=='rr-backup-scoped-root-v5-scheduled-test-v1'||!uuid(r.rootId)||!sha(r.acceptanceSha256)||digest(a)!==r.acceptanceSha256)fail();
 if(!exact(a,['version','recordId','rootId','decision','acceptedAt','expiresAt','scopeSha256','gatewayOrigin','participants','coverageProfile','collectorProvenance','sourcePrincipalReview','ownerExecutionDecisionSha256','installationReviewSha256','constructionProfile','cfWindowProfile','scheduleProfile','residualTrust','absoluteAbsenceProven'])||a.version!=='rr-backup-execution-acceptance-v5-scheduled-test-v1'||!uuid(a.recordId)||a.rootId!==r.rootId||a.decision!=='ACCEPT_EXACT_SCOPED_EXECUTION_V5_SCHEDULED_SINGLE_TEST_V1'||a.scopeSha256!==SCOPE_SHA||!sha(a.ownerExecutionDecisionSha256)||!sha(a.installationReviewSha256)||!same(a.residualTrust,RESIDUALS)||a.absoluteAbsenceProven!==false)fail();
 time(a.acceptedAt,a.expiresAt,now,SCOPE.maximumRecordMs);
 const origin=new URL(a.gatewayOrigin);if(origin.protocol!=='https:'||origin.origin!==a.gatewayOrigin||origin.username||origin.password||!/^[-a-z0-9.]+$/.test(origin.hostname))fail();
 const windowProfile=a.cfWindowProfile;
 if(!exact(windowProfile,['version','clockProfileSha256','sourceAttestationKey','journalReceiptKey','capabilityCustodyReviewSha256','manifestKeyHolderRoles','dispatchKeyHolderRoles'])||windowProfile.version!=='rr-cf-window-compartment-profile-v1'||windowProfile.clockProfileSha256!==CF_PLATFORM_CLOCK_PROFILE_SHA256||!sha(windowProfile.capabilityCustodyReviewSha256)||!same(windowProfile.manifestKeyHolderRoles,['caller','journal','gateway'])||!same(windowProfile.dispatchKeyHolderRoles,['journal','gateway']))fail();
 key(windowProfile.sourceAttestationKey);key(windowProfile.journalReceiptKey);if(new Set([windowProfile.sourceAttestationKey.keyId,windowProfile.journalReceiptKey.keyId,r.collectorKey.keyId,a.constructionProfile.reviewerKeyId]).size!==4)fail();
 const carrier=a.constructionProfile;
 if(!exact(carrier,['version','delivery','chunkCount','hostRoles','reviewerKeyId','reviewSha256','custodyReviewSha256'])||carrier.version!=='rr-backup-secret-carrier-profile-v5'||carrier.delivery!=='fixed-secret-text-at-construction-external-runtime-enrollment'||!Number.isSafeInteger(carrier.chunkCount)||carrier.chunkCount<1||carrier.chunkCount>13||!same(carrier.hostRoles,ROLES)||!sha(carrier.reviewerKeyId)||carrier.reviewerKeyId===r.collectorKey.keyId||!sha(carrier.reviewSha256)||!sha(carrier.custodyReviewSha256))fail();
 const schedule=scheduleProfile(a.scheduleProfile);if(schedule.scheduledTime<a.acceptedAt||schedule.deadline>a.expiresAt)fail();
 const ids=participants(a.participants,carrier,schedule),profile=a.coverageProfile;
 const gatewayConfig=a.participants[4].bindings.plainText;
 if(Object.hasOwn(gatewayConfig,'RACK_RELIC_TEST_R2_GATEWAY_ORIGIN')&&gatewayConfig.RACK_RELIC_TEST_R2_GATEWAY_ORIGIN!==a.gatewayOrigin||Object.hasOwn(gatewayConfig,'RACK_RELIC_TEST_R2_ARTIFACT_SHA256')&&gatewayConfig.RACK_RELIC_TEST_R2_ARTIFACT_SHA256!==a.participants[4].module.sha256)fail();
 if(!exact(profile,['version','accountId','workerIds','zoneIds','queueIds','emailRuleIds','exclusions'])||profile.version!=='rr-accepted-control-plane-profile-v5'||profile.accountId!==SCOPE.accountId||!same(profile.workerIds,ROLES.map(role=>ids[role]))||!same(profile.exclusions,EXCLUSIONS))fail();
 for(const field of ['zoneIds','queueIds','emailRuleIds'])strings(profile[field],20);
 const p=a.collectorProvenance;
 if(!exact(p,['hostWorkerId','artifactSha256','collectorKeyId','origin','readbackEvidenceSha256','custodyReviewSha256','reviewerIdentity','reviewedAt','expiresAt'])||p.hostWorkerId!==ids.verifier||p.artifactSha256!==a.participants[1].module.sha256||p.collectorKeyId!==r.collectorKey.keyId||p.origin!=='independent-installation-and-custody-review'||!sha(p.readbackEvidenceSha256)||!sha(p.custodyReviewSha256)||!opaque(p.reviewerIdentity)||p.reviewedAt>a.acceptedAt||p.expiresAt>a.expiresAt)fail();
 time(p.reviewedAt,p.expiresAt,now,SCOPE.maximumRecordMs);
 const principal=a.sourcePrincipalReview;
 if(!exact(principal,['mode','sourceProjectRef','sourceBucket','codeBoundary','credentialScope','scopeEvidenceSha256','ownerGrantSha256'])||!['rls-scoped-session','owner-accepted-broad-s3-host'].includes(principal.mode)||principal.sourceProjectRef!==SCOPE.sourceProjectRef||principal.sourceBucket!==SCOPE.sourceBucket||principal.codeBoundary!=='fixed-source-get-only'||!sha(principal.scopeEvidenceSha256)||!sha(principal.ownerGrantSha256)||principal.credentialScope!==(principal.mode==='rls-scoped-session'?'reviewed-RLS-bound-source-scope':'all-buckets-all-S3-operations-bypass-RLS'))fail();
 const requiredSecrets={caller:['ROOT_CONTROL_HMAC','RACK_RELIC_BACKUP_MANIFEST_HEX'],verifier:['ROOT_CONTROL_HMAC'],source:['SOURCE_RLS_LEGACY_ANON_KEY','SOURCE_ATTESTATION_SIGNING_KEY'],journal:['ARCHIVE_DISPATCH_HMAC','JOURNAL_RECEIPT_SIGNING_KEY','RACK_RELIC_BACKUP_MANIFEST_HEX'],gateway:['ARCHIVE_DISPATCH_HMAC','RACK_RELIC_BACKUP_MANIFEST_HEX']};
 for(const participant of a.participants)if(requiredSecrets[participant.role].some(name=>!participant.bindings.secretNames.includes(name)))fail();
 const sourceSecrets=a.participants[2].bindings.secretNames;
 if(principal.mode==='rls-scoped-session'&&((!sourceSecrets.includes('SOURCE_RLS_ACCESS_TOKEN')||!sourceSecrets.includes('SOURCE_RLS_LEGACY_ANON_KEY'))||sourceSecrets.some(name=>['SOURCE_S3_ACCESS_KEY_ID','SOURCE_S3_SECRET_ACCESS_KEY'].includes(name)))||principal.mode==='owner-accepted-broad-s3-host'&&(!sourceSecrets.includes('SOURCE_S3_ACCESS_KEY_ID')||!sourceSecrets.includes('SOURCE_S3_SECRET_ACCESS_KEY')||sourceSecrets.some(name=>['SOURCE_RLS_ACCESS_TOKEN','SOURCE_RLS_REFRESH_TOKEN'].includes(name))))fail();
 const purposeFlags={'archive-original-create':[4,'RACK_RELIC_TEST_R2_V5_GATEWAY_ENABLED'],'archive-original-read':[4,'RACK_RELIC_TEST_R2_V5_RECEIPT_READ_ENABLED'],'source-photo-read':[2,'SOURCE_V5_FACADE_ENABLED'],'journal-original-verify':[3,'JOURNAL_V5_FACADE_ENABLED']};
 const targetFlag=purposeFlags[fixed.purpose];if(!targetFlag||a.participants[targetFlag[0]].bindings.plainText[targetFlag[1]]!=='true'||a.participants[1].bindings.plainText.RACK_RELIC_BACKUP_V5_OBSERVATION_ENABLED!=='true')fail();
 const runtime=verifyV5RuntimeEnrollment({root:r,executionAcceptance:a,packetSha256:fixed.packetSha256,reviewerKey:fixed.reviewerKey,enrollment:fixed.enrollment,now});
 return {acceptance:a,publicKey:key(r.collectorKey),collectorHostId:p.hostWorkerId,observedParticipants:runtime.observedParticipants,participantsSha256:digest(runtime.observedParticipants),enrollmentSha256:runtime.enrollmentSha256,enrollmentExpiresAt:runtime.expiresAt};
}
function challenge(value,purpose,now){
 const q=copy(value,4096);
 if(!exact(q,['version','purpose','stage','executionId','tupleSha256','nonce','requestedAt','deadline'])||q.version!==CHALLENGE||q.purpose!==purpose||!STAGES[purpose]?.includes(q.stage)||!nonce(q.executionId)||!sha(q.tupleSha256)||!nonce(q.nonce))fail();
 time(q.requestedAt,q.deadline,now,SCOPE.maximumObservationMs);return q;
}
function fixedOptions(options){
 try{if(typeof window!=='undefined'||options.enabled!==true||typeof options.purpose!=='string'||!Object.hasOwn(STAGES,options.purpose)||typeof options.clock!=='function')fail();return copy({purpose:options.purpose,root:options.root,executionAcceptance:options.executionAcceptance,packetSha256:options.packetSha256,reviewerKey:options.reviewerKey,enrollment:options.enrollment});}catch{return null;}
}
const common=purpose=>({version:VERSION,mode:'OWNER_ACCEPTED_SCOPED_EXECUTION',authorizationKind:'SCOPED_EXECUTION_CAPABILITY',strictV3Compatible:false,externalRuntimeEnrollmentRequired:true,purpose,legacyV1Compatible:false,operationCapabilityRequired:true,absoluteAbsenceProven:false,completeSnapshot:false,backupConnected:false,restoreEnabled:false,releaseEnabled:false,globalFinancialReleaseEnabled:false,financialReleaseEnabled:false});
const held=purpose=>Object.freeze({...common(purpose||null),scopedExecutionAuthorized:false,held:true});
function validate(fixed,q,envelope,now,clock,remember=()=>{}){
 const context=acceptance(fixed,now),e=copy(envelope),r=fixed.root,a=context.acceptance;
 if(!exact(e,['algorithm','keyId','payload','signature'])||e.algorithm!=='Ed25519'||e.keyId!==r.collectorKey.keyId||typeof e.signature!=='string')fail();
 const sig=Buffer.from(e.signature,'base64');if(sig.length!==64||sig.toString('base64')!==e.signature||!verify(null,Buffer.from('rack-relic/scoped-execution-v5-scheduled-test-v1/observation\n'+canonical(e.payload)),context.publicKey,sig))fail();
 const p=e.payload;
 if(!exact(p,['version','rootId','acceptanceSha256','collectorHostId','challengeSha256','observedFrom','checkedAt','expiresAt','configuration','participants','coverage','providerEvidenceSha256','enrollmentSha256'])||p.version!=='rr-backup-scoped-execution-observation-v5-scheduled-test-v1'||p.rootId!==r.rootId||p.acceptanceSha256!==r.acceptanceSha256||p.collectorHostId!==context.collectorHostId||p.challengeSha256!==digest(q)||!sha(p.providerEvidenceSha256)||p.enrollmentSha256!==context.enrollmentSha256||!same(p.participants,context.observedParticipants))fail();
 time(p.observedFrom,p.expiresAt,now,SCOPE.maximumObservationMs);
 if(p.observedFrom<q.requestedAt||!Number.isSafeInteger(p.checkedAt)||p.checkedAt<p.observedFrom||p.checkedAt>now||p.expiresAt>Math.min(q.deadline,a.expiresAt,a.collectorProvenance.expiresAt,context.enrollmentExpiresAt))fail();
 const c=p.configuration;
 if(!exact(c,['kind','accountId','bucket','sourceProjectRef','observedFrom','checkedAt','expiresAt','publicDevelopmentEnabled','customDomainCount','corsRuleCount','wholeBucketLock'])||c.kind!=='rr-control-configuration-v5'||c.accountId!==SCOPE.accountId||c.bucket!==SCOPE.archiveBucket||c.sourceProjectRef!==SCOPE.sourceProjectRef||c.publicDevelopmentEnabled!==false||c.customDomainCount!==0||c.corsRuleCount!==0||!same(c.wholeBucketLock,{type:'Age',maxAgeSeconds:604800,prefix:''}))fail();
 time(c.observedFrom,c.expiresAt,now,SCOPE.maximumObservationMs);
 if(c.observedFrom<q.requestedAt||!Number.isSafeInteger(c.checkedAt)||c.checkedAt<c.observedFrom||c.checkedAt>now||c.expiresAt<p.expiresAt)fail();
 const fields=['bucketConfiguration','activeArtifacts','bindings','namedWorkerMetadata','scopedIngressInventories'];
 if(!exact(p.coverage,fields)||fields.some(k=>p.coverage[k]!=='OBSERVED'))fail();
 const finished=clock();if(!Number.isSafeInteger(finished)||finished<now||finished>=Math.min(p.expiresAt,c.expiresAt,q.deadline))fail();remember(finished);
 return copy({...common(fixed.purpose),scopedExecutionAuthorized:true,held:false,rootId:r.rootId,scopeSha256:SCOPE_SHA,acceptanceSha256:r.acceptanceSha256,observationSha256:digest(e),collectorHostId:context.collectorHostId,
  accountId:SCOPE.accountId,sourceProjectRef:SCOPE.sourceProjectRef,sourceBucket:SCOPE.sourceBucket,sourceIdentity:'supabase:'+SCOPE.sourceProjectRef+':'+SCOPE.sourceBucket,sourceWorkerId:a.participants[2].workerId,sourceSha256:a.participants[2].module.sha256,sourcePrincipalMode:a.sourcePrincipalReview.mode,sourcePrincipalReviewSha256:digest(a.sourcePrincipalReview),archiveIdentity:SCOPE.archiveIdentity,namespace:SCOPE.namespace,gatewayOrigin:a.gatewayOrigin,gatewaySha256:a.participants[4].module.sha256,participantsSha256:context.participantsSha256,enrollmentSha256:context.enrollmentSha256,
  executionId:q.executionId,tupleSha256:q.tupleSha256,nonce:q.nonce,stage:q.stage,requestedAt:q.requestedAt,deadline:q.deadline,expiresAt:Math.min(p.expiresAt,c.expiresAt,q.deadline),residualTrust:RESIDUALS});
}
function createScopedExecutionV5Validator({enabled=false,purpose,root=null,executionAcceptance=null,clock=Date.now,packetSha256=null,reviewerKey=null,enrollment=null}={}){
 const fixed=fixedOptions({enabled,purpose,root,executionAcceptance,clock,packetSha256,reviewerKey,enrollment});let last=-Infinity;
 const validateRequest=function(request){
  try{if(!fixed||!exact(request,['challenge','observation']))fail();const now=clock();if(!Number.isSafeInteger(now)||now<last)fail();last=now;const q=challenge(request.challenge,fixed.purpose,now);const result=validate(fixed,q,request.observation,now,clock,value=>{last=value;});const finished=clock();if(!Number.isSafeInteger(finished)||finished<last||finished>=result.expiresAt)fail();last=finished;return result;}catch{return held(purpose);}
 };
 Object.defineProperty(validateRequest,'ready',{enumerable:true,get(){try{if(!fixed)fail();const now=clock();if(!Number.isSafeInteger(now)||now<last)fail();acceptance(fixed,now);last=now;return true;}catch{return false;}}});
 return Object.freeze(validateRequest);
}
function createScopedExecutionV5Producer({enabled=false,purpose,root=null,executionAcceptance=null,collector,clock=Date.now,timeoutMs=5000,packetSha256=null,reviewerKey=null,enrollment=null}={}){
 const fixed=fixedOptions({enabled,purpose,root,executionAcceptance,clock,packetSha256,reviewerKey,enrollment});let collect=null;try{if(typeof collector?.collect==='function')collect=collector.collect.bind(collector);}catch{}
 let busy=false,last=-Infinity;
 return Object.freeze({async observe(input,options){
  let q,started;try{if(!fixed||!collect||busy||!Number.isSafeInteger(timeoutMs)||timeoutMs<10||timeoutMs>5000||options!==undefined&&(!exact(options,['signal'])||!(options.signal instanceof AbortSignal))||options?.signal?.aborted)fail();started=clock();if(!Number.isSafeInteger(started)||started<last)fail();last=started;acceptance(fixed,started);q=challenge(input,fixed.purpose,started);}catch{fail();}
  busy=true;const controller=new AbortController(),abort=()=>controller.abort();let timer;
  options?.signal?.addEventListener('abort',abort,{once:true});if(options?.signal?.aborted)abort();
  const job=Promise.resolve().then(async()=>{if(controller.signal.aborted)fail();const observation=copy(await collect(q,{signal:controller.signal}));if(controller.signal.aborted)fail();const now=clock();if(!Number.isSafeInteger(now)||now<last)fail();last=now;validate(fixed,q,observation,now,clock,value=>{last=value;});return observation;});
  job.then(()=>{busy=false;},()=>{busy=false;});
  try{return await Promise.race([job,new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error('SCOPED_EXECUTION_V5_HELD'));},Math.max(1,Math.min(timeoutMs,q.deadline-started)));})]);}catch{fail();}finally{controller.abort();clearTimeout(timer);options?.signal?.removeEventListener('abort',abort);}
 }});
}
function createScopedExecutionV5ConfigurationProbe({enabled=false,readToken,fetchImpl,clock=Date.now,timeoutMs=5000}={}){
 // A narrow real GET-only observation port, not the complete signed collector.
 const base='https://api.cloudflare.com/client/v4/accounts/'+SCOPE.accountId,bucket=base+'/r2/buckets/'+SCOPE.archiveBucket;
 const allow=new Set([base,bucket,bucket+'/lock',bucket+'/domains/managed',bucket+'/domains/custom',bucket+'/cors']);
 const fetch=typeof fetchImpl==='function'?fetchImpl:null;
 const verifier=createR2ArchiveConfigurationVerifier({enabled:enabled===true&&Number.isSafeInteger(timeoutMs)&&timeoutMs>=10&&timeoutMs<=5000,readToken,clock,timeoutMs,fetchImpl:async(url,init)=>{if(!fetch||!allow.has(url)||init.method!=='GET')fail();return fetch(url,{...init,redirect:'manual'});}});
 return Object.freeze({async inspect(options){if(options!==undefined&&(!exact(options,['signal'])||!(options.signal instanceof AbortSignal)))fail();const e=await verifier.inspect(options),expiresAt=Math.min(e.expiresAt,e.observedFrom+5000);if(expiresAt<=e.checkedAt)fail();return copy({kind:'rr-control-configuration-v5',accountId:e.accountId,bucket:e.bucket,sourceProjectRef:e.sourceProjectRef,observedFrom:e.observedFrom,checkedAt:e.checkedAt,expiresAt,publicDevelopmentEnabled:e.publicDevelopmentEnabled,customDomainCount:e.customDomainCount,corsRuleCount:e.corsRuleCount,wholeBucketLock:e.wholeBucketLock});}});
}
const AUTHORIZED_FIELDS=Object.freeze([...Object.keys(common('source-photo-read')),'scopedExecutionAuthorized','held','rootId','scopeSha256','acceptanceSha256','observationSha256','collectorHostId','accountId','sourceProjectRef','sourceBucket','sourceIdentity','sourceWorkerId','sourceSha256','sourcePrincipalMode','sourcePrincipalReviewSha256','archiveIdentity','namespace','gatewayOrigin','gatewaySha256','participantsSha256','enrollmentSha256','executionId','tupleSha256','nonce','stage','requestedAt','deadline','expiresAt','residualTrust']);
module.exports=Object.freeze({createScopedExecutionV5Validator,createScopedExecutionV5Producer,createScopedExecutionV5ConfigurationProbe,canonicalV5:canonical,digestV5:digest,SCOPE_V5:SCOPE,SCOPE_SHA256_V5:SCOPE_SHA,STAGES_V5:STAGES,AUTHORIZED_FIELDS_V5:AUTHORIZED_FIELDS,DEFAULT_EXECUTION_ACCEPTANCE:null,V5_CARRIER_COUNT_NAME:CARRIER_COUNT,V5_CARRIER_PART_NAMES:CARRIER_PARTS,V5_CARRIER_PIN_NAMES:CARRIER_PINS});
