'use strict';
// NODE SOURCE with an explicit CF platform-clock contract; this is NOT an independent elapsed clock.
// No global fetch/env/key discovery, runtime entrypoint or grant.
const {createHash,createPrivateKey,createPublicKey,sign}=require('node:crypto');
const {createScopedExecutionV5Validator,STAGES_V5,SCOPE_V5,canonicalV5:canonical,digestV5:digest}=require('./backup_scoped_execution_v5.cjs');
const {CF_PLATFORM_CLOCK_PROFILE_SHA256}=require('./cloudflare_window_lifecycle_proposal_v1.cjs');
const {copyV5ConstructionData:copy,verifyV5RuntimeEnrollment}=require('./backup_runtime_enrollment_v5.cjs');
const {createR2ArchiveConfigurationObservationV2}=require('./r2_archive_configuration_observation_v2.cjs');
const {reviewEffectiveWorkerMetadata}=require('./cloudflare_effective_metadata_review_v5.cjs');
const {observedSchedules}=require('./backup_scheduled_test_profile_v1.cjs');
const ACCOUNT=SCOPE_V5.accountId,BASE='https://api.cloudflare.com/client/v4/accounts/'+ACCOUNT,BUCKET=BASE+'/r2/buckets/'+SCOPE_V5.archiveBucket;
const CONFIG_PATHS=Object.freeze([BASE,BUCKET,BUCKET+'/lock',BUCKET+'/domains/managed',BUCKET+'/domains/custom',BUCKET+'/cors']);
const NORMALIZER_ORDER=['journal','source','gateway','caller','verifier'];
const RESIDUAL_POWERS=Object.freeze(['account-R2-configuration-and-object-read-list','account-Workers-Scripts-Read-code-and-settings','token-metadata-reviewed-outside-operation-not-refetched','accepted-provider-installer-administrator-and-key-custody-trust']);
const SHA=/^[a-f0-9]{64}$/,TOKEN=/^[A-Za-z0-9_-]{20,256}$/;
const fail=()=>{throw Error('AUTHENTICATED_COLLECTOR_V5_HELD');};
const hash=x=>createHash('sha256').update(x).digest('hex');
const object=x=>x&&Object.getPrototypeOf(x)===Object.prototype;
const exact=(x,names)=>object(x)&&Reflect.ownKeys(x).length===names.length&&names.every(k=>Object.hasOwn(x,k))&&Object.values(Object.getOwnPropertyDescriptors(x)).every(d=>Object.hasOwn(d,'value')&&d.enumerable===true);
const only=(x,names)=>object(x)&&Object.keys(x).every(k=>names.includes(k));
const same=(a,b)=>canonical(a)===canonical(b);
const sha=x=>typeof x==='string'&&SHA.test(x)&&x!=='0'.repeat(64);
const keyNames=['root','executionAcceptance','packetSha256','reviewerKey','enrollment'];
function envelope(e){if(!only(e,['success','errors','messages','result','result_info'])||e.success!==true||!Array.isArray(e.errors)||e.errors.length||!Array.isArray(e.messages))fail();return e.result;}
function grant(fixed,g,workerToken,configToken,now){
 const a=fixed.executionAcceptance;
 if(!exact(g,['version','accountId','collectorWorkerId','artifactSha256','reviewerIdentity','reviewedAt','expiresAt','coverageProfileSha256','credentials','effectivePolicies','residualPowers'])||g.version!=='rr-cf-collector-custody-review-v1'||g.accountId!==ACCOUNT||g.collectorWorkerId!==a.participants[1].workerId||g.artifactSha256!==a.participants[1].module.sha256||g.reviewerIdentity!==a.collectorProvenance.reviewerIdentity||digest(g)!==a.collectorProvenance.custodyReviewSha256||g.coverageProfileSha256!==digest(a.coverageProfile)||!same(g.residualPowers,RESIDUAL_POWERS))fail();
 if(!Number.isSafeInteger(g.reviewedAt)||!Number.isSafeInteger(g.expiresAt)||g.reviewedAt>a.acceptedAt||g.reviewedAt>now||g.expiresAt<=now||g.expiresAt>a.expiresAt||g.expiresAt-g.reviewedAt>86400000)fail();
 if(!Array.isArray(g.credentials)||g.credentials.length!==2||!Array.isArray(g.effectivePolicies)||g.effectivePolicies.length!==5)fail();
 const expected=[{binding:'RACK_RELIC_R2_WORKER_READ_TOKEN',tokenSha256:hash(workerToken),permissions:['Individual Workers Content Read-Only'],resourceScope:'five-exact-workers',workerIds:a.coverageProfile.workerIds},{binding:'RACK_RELIC_R2_CONFIG_READ_TOKEN',tokenSha256:hash(configToken),permissions:['Workers R2 Storage Read','Workers Scripts Read'],resourceScope:'entire-fixed-account',workerIds:[]}];
 for(let i=0;i<2;i++){
  const c=g.credentials[i];if(!exact(c,['binding','tokenId','tokenSha256','tokenMetadataEvidenceSha256','permissions','resourceScope','workerIds'])||typeof c.tokenId!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(c.tokenId)||!sha(c.tokenMetadataEvidenceSha256))fail();
  for(const [k,v]of Object.entries(expected[i]))if(!same(c[k],v))fail();
 }
 // This finite42 plan covers no named zone/queue/email inventory. An accepted
 // nonempty profile requires actual additional endpoints, never guessed absence.
 for(const k of ['zoneIds','queueIds','emailRuleIds'])if(!same(a.coverageProfile[k],[]))fail();
 for(let i=0;i<5;i++){
  const p=g.effectivePolicies[i],w=a.participants[i];
  if(!exact(p,['workerId','settings','versionRuntimeExtras'])||p.workerId!==w.workerId||!object(p.settings)||!object(p.versionRuntimeExtras))fail();
 }
 return g;
}
function rawBindings(w,participants){
 const b=w.bindings,rows=[];
 for(const [name,text]of Object.entries(b.plainText))rows.push({name,type:'plain_text',text});
 for(const name of b.secretNames)rows.push({name,type:'secret_text'});
 for(const s of b.services){const target=participants.find(x=>x.workerId===s.targetWorkerId);if(!target)fail();rows.push({name:s.binding,type:'service',service:target.name,entrypoint:s.entrypoint});}
 for(const r of b.otherBindings){if(r.type!=='r2_bucket'||r.accountId!==ACCOUNT)fail();rows.push({name:r.binding,type:'r2_bucket',bucket_name:r.bucket});}
 return rows.sort((a,b)=>a.name.localeCompare(b.name));
}
function expectedReferences(w,participants){
 const seen=new Set(),workers=[];
 for(const s of w.ingress.knownInboundBindings){if(!seen.has(s.fromWorkerId)){const source=participants.find(p=>p.workerId===s.fromWorkerId);if(!source)fail();workers.push({id:source.workerId,name:source.name});seen.add(source.workerId);}}
 workers.sort((a,b)=>a.id.localeCompare(b.id));
 return {workers,domains:[],dispatch_namespace_outbounds:[],durable_objects:[],queues:[]};
}
function partialMatches(observed,expected){
 if(Array.isArray(observed)||observed===null||typeof observed!=='object'){if(!same(observed,expected))fail();return;}
 if(!object(expected))fail();for(const [k,v]of Object.entries(observed)){if(!Object.hasOwn(expected,k))fail();partialMatches(v,expected[k]);}
}
function effectiveInputs(w,rows,policies,participants,schedule){
 const meta=envelope(rows.metadata),sub=envelope(rows.subdomain),settings=envelope(rows.settings),schedules=envelope(rows.schedules);
 if(!object(meta)||meta.id!==w.workerId||meta.name!==w.name||!exact(sub,['enabled','previews_enabled'])||sub.enabled!==false||sub.previews_enabled!==false)fail();
 if(!only(settings,['logpush','observability','tags','tail_consumers'])||typeof settings.logpush!=='boolean'||!object(settings.observability)||!same(settings.tail_consumers,[])||settings.tags!==undefined&&(!Array.isArray(settings.tags)||settings.tags.some(x=>typeof x!=='string')))fail();
 if(!same(observedSchedules(w.role,schedules,schedule),w.ingress.schedules))fail();
 const fullSettings={logpush:settings.logpush,observability:settings.observability,tailConsumers:[]};
 if(!same(fullSettings,policies.settings))fail();
 if(meta.logpush!==undefined&&meta.logpush!==settings.logpush||meta.observability!==undefined&&!object(meta.observability))fail();
 if(meta.observability!==undefined)partialMatches(meta.observability,settings.observability);
 if(!only(meta.subdomain,['enabled','previews_enabled','url','preview_url_suffix']))fail();
 for(const k of ['enabled','previews_enabled'])if(meta.subdomain[k]!==undefined&&meta.subdomain[k]!==sub[k])fail();
 if(!same(meta.tail_consumers,[]))fail();
 const normalizedMeta={...meta,subdomain:{...meta.subdomain,...sub},logpush:settings.logpush,observability:settings.observability};
 if(!object(normalizedMeta.references)||!Array.isArray(normalizedMeta.references.workers))fail();
 normalizedMeta.references={...normalizedMeta.references,workers:normalizedMeta.references.workers.slice().sort((a,b)=>String(a.id).localeCompare(String(b.id)))};
 return {normalizedMeta,profile:{role:w.role,name:w.name,workerId:w.workerId,deploymentId:w.deploymentId,versionId:w.versions[0].versionId,module:w.module,compatibilityDate:w.compatibilityDate,compatibilityFlags:w.compatibilityFlags,bindings:rawBindings(w,participants),subdomain:normalizedMeta.subdomain,references:expectedReferences(w,participants),effectiveSettings:fullSettings,versionRuntimeExtras:policies.versionRuntimeExtras}};
}
async function bytesJSON(r,signal,maximum){
 const length=r.headers.get('content-length');if(length!==null&&(!/^\d+$/.test(length)||Number(length)>maximum))fail();const reader=r.body?.getReader();if(!reader)fail();
 let size=0;const parts=[],abort=()=>{reader.cancel().catch(()=>{});};signal.addEventListener('abort',abort,{once:true});
 try{for(;;){if(signal.aborted)fail();const v=await reader.read();if(signal.aborted)fail();if(v.done)break;size+=v.value.byteLength;if(size>maximum){reader.cancel().catch(()=>{});fail();}parts.push(Buffer.from(v.value));}}finally{signal.removeEventListener('abort',abort);reader.releaseLock();}
 if(length!==null&&Number(length)!==size)fail();const bytes=Buffer.concat(parts),text=new TextDecoder('utf-8',{fatal:true}).decode(bytes),value=JSON.parse(text);
 let at=0,nodes=0;const ws=()=>{while(at<text.length&&/[ \t\r\n]/.test(text[at]))at++;};
 const str=()=>{const start=at++;while(at<text.length){if(text[at]==='\\'){at+=2;continue;}if(text[at++]==='"')return JSON.parse(text.slice(start,at));}fail();};
 function scan(depth){if(++nodes>8192||depth>18)fail();ws();if(text[at]==='{'){at++;ws();const names=new Set();if(text[at]==='}'){at++;return;}for(;;){ws();const name=str();if(names.has(name))fail();names.add(name);ws();at++;scan(depth+1);ws();if(text[at++]==='}')return;}}if(text[at]==='['){at++;ws();if(text[at]===']'){at++;return;}for(;;){scan(depth+1);ws();if(text[at++]===']')return;}}if(text[at]==='"'){str();return;}while(at<text.length&&!/[\s,}\]]/.test(text[at]))at++;}
 scan(0);return {value,sha256:hash(bytes),bytes:size};
}
function completeDomains(e,participants){
 const rows=envelope(e),i=e.result_info;
 if(!Array.isArray(rows)||rows.length>1000||!exact(i,['count','page','per_page','total_count','total_pages'])||i.page!==1||i.count!==rows.length||i.total_count!==rows.length||i.total_pages!==1||!Number.isSafeInteger(i.per_page)||i.per_page<Math.max(1,rows.length))fail();
 const ids=new Set();for(const r of rows){
  if(!only(r,['id','cert_id','enabled','environment','hostname','previews_enabled','service','zone_id','zone_name'])||['id','cert_id','environment','hostname','service','zone_id','zone_name'].some(k=>typeof r[k]!=='string'||!r[k]||r[k].length>256)||typeof r.enabled!=='boolean'||typeof r.previews_enabled!=='boolean'||ids.has(r.id))fail();ids.add(r.id);
  if(participants.some(w=>w.name===r.service))fail();
 }
}
function createAuthenticatedControlPlaneCollectorV5(options={}){
 let fixed=null,privateKey=null,transport=null,workerToken=null,configToken=null,custody=null,purpose=null,clock=null,monotonic=null;
 try{
  if(!exact(options,['enabled',...keyNames,'grantReview','workerReadToken','configurationReadToken','signingKey','fetchImpl','clockProfileSha256','purpose'])||options.enabled!==true||typeof options.fetchImpl!=='function'||options.clockProfileSha256!==CF_PLATFORM_CLOCK_PROFILE_SHA256||!Object.hasOwn(STAGES_V5,options.purpose)||!TOKEN.test(options.workerReadToken)||!TOKEN.test(options.configurationReadToken)||options.workerReadToken===options.configurationReadToken)fail();
  fixed=copy(Object.fromEntries(keyNames.map(k=>[k,options[k]])));custody=copy(options.grantReview);workerToken=options.workerReadToken;configToken=options.configurationReadToken;purpose=options.purpose;clock=Date.now.bind(Date);monotonic=clock;
  if(!createScopedExecutionV5Validator({enabled:true,...fixed,purpose,clock}).ready)fail();grant(fixed,custody,workerToken,configToken,clock());
  privateKey=options.signingKey?.type==='private'?options.signingKey:createPrivateKey(options.signingKey);
  if(privateKey.asymmetricKeyType!=='ed25519'||createPublicKey(privateKey).export({format:'der',type:'spki'}).toString('base64')!==fixed.root.collectorKey.spkiBase64)fail();
  transport=options.fetchImpl;
 }catch{fixed=null;privateKey=null;transport=null;}
 let busy=false,lastEvidence=null;
 function ready(){try{return !!fixed&&!!privateKey&&!!transport&&createScopedExecutionV5Validator({enabled:true,...fixed,purpose,clock}).ready&&!!grant(fixed,custody,workerToken,configToken,clock());}catch{return false;}}
 async function collectEvidence(input){
  if(!ready()||busy)fail();busy=true;lastEvidence=null;const controller=new AbortController();let signal,timer,job;
  try{
   if(!only(input,['requestedAt','deadline','signal']))fail();const descriptors=Object.getOwnPropertyDescriptors(input);if(Reflect.ownKeys(input).length!==Object.keys(input).length||Object.values(descriptors).some(d=>!Object.hasOwn(d,'value')||d.enumerable!==true))fail();
   const requestedAt=input.requestedAt,deadline=input.deadline;signal=input.signal;
   if(signal!==undefined&&!(signal instanceof AbortSignal)||signal?.aborted)fail();
   const start=clock(),monoStart=monotonic();let last=start,lastMono=monoStart,count=0,oldest=Infinity;
   if(!Number.isSafeInteger(start)||!Number.isFinite(monoStart)||!Number.isSafeInteger(requestedAt)||!Number.isSafeInteger(deadline)||requestedAt>start||deadline<=start||deadline-requestedAt>5000)fail();
   const abort=()=>controller.abort();signal?.addEventListener('abort',abort,{once:true});
   const check=()=>{const now=clock(),m=monotonic();if(controller.signal.aborted||!Number.isSafeInteger(now)||now<last||now>=deadline||!Number.isFinite(m)||m<lastMono||m-monoStart>=deadline-start)fail();last=now;lastMono=m;grant(fixed,custody,workerToken,configToken,now);return now;};
   const runtime=verifyV5RuntimeEnrollment({...fixed,now:start}),participants=runtime.observedParticipants,a=fixed.executionAcceptance;
   const allowed=new Map();
   for(const w of participants){const d=BASE+'/workers/scripts/'+w.name+'/deployments?page=1&per_page=1';allowed.set(d,'worker');allowed.set(BASE+'/workers/workers/'+w.workerId,'worker');allowed.set(BASE+'/workers/workers/'+w.workerId+'/versions/'+w.versions[0].versionId+'?include=modules','worker');for(const suffix of ['subdomain','script-settings','schedules'])allowed.set(BASE+'/workers/scripts/'+w.name+'/'+suffix,'worker');}
   for(const u of CONFIG_PATHS)allowed.set(u,'configuration');allowed.set(BASE+'/workers/domains','configuration');
   const audit=[];
   async function get(url,{responseOnly=false}={}){
    check();const credential=allowed.get(url);if(!credential||++count>42)fail();
    const r=await transport(url,{method:'GET',redirect:'manual',cache:'no-store',signal:controller.signal,headers:{Authorization:'Bearer '+(credential==='worker'?workerToken:configToken),Accept:'application/json','Cache-Control':'no-store',...(url.startsWith(BUCKET)?{'cf-r2-jurisdiction':'default'}:{})}}),now=check();
    if(!(r instanceof Response)||r.status!==200&&!(responseOnly&&url===BUCKET+'/cors'&&r.status===404)||r.url!==url||r.redirected||r.headers.has('location')||r.headers.has('link')||!/^application\/json(?:\s*;|$)/i.test(r.headers.get('content-type')||''))fail();
    const date=Date.parse(r.headers.get('date')||'');if(!Number.isFinite(date)||date>now+1000||now-date>5000||r.headers.has('age')&&r.headers.get('age')!=='0'||/HIT|STALE|UPDATING|REVALIDATED/i.test(r.headers.get('cf-cache-status')||''))fail();oldest=Math.min(oldest,date);
    const body=await bytesJSON(responseOnly?r.clone():r,controller.signal,credential==='worker'?524288:65536);check();
    audit.push({method:'GET',url,credentialBinding:credential==='worker'?'RACK_RELIC_R2_WORKER_READ_TOKEN':'RACK_RELIC_R2_CONFIG_READ_TOKEN',httpStatus:r.status,providerDate:date,responseSha256:body.sha256,responseBytes:body.bytes});
    return responseOnly?r:body.value;
   }
   const run=async()=>{
    const settled=await Promise.allSettled(participants.map(async w=>{
     const prefix=BASE+'/workers/scripts/'+w.name,deployments=prefix+'/deployments?page=1&per_page=1',r={};
     r.before=await get(deployments);r.metadata=await get(BASE+'/workers/workers/'+w.workerId);r.version=await get(BASE+'/workers/workers/'+w.workerId+'/versions/'+w.versions[0].versionId+'?include=modules');r.subdomain=await get(prefix+'/subdomain');r.settings=await get(prefix+'/script-settings');r.schedules=await get(prefix+'/schedules');r.after=await get(deployments);return r;
    }));if(settled.some(r=>r.status!=='fulfilled'))fail();const raw=settled.map(r=>r.value);
    const prepared=participants.map((w,i)=>effectiveInputs(w,raw[i],custody.effectivePolicies[i],participants,a.scheduleProfile));
    const profile={kind:'rr-effective-metadata-review-profile-v1',accountId:ACCOUNT,workers:NORMALIZER_ORDER.map(role=>prepared[participants.findIndex(w=>w.role===role)].profile)};
    for(let i=0;i<5;i++){const r=reviewEffectiveWorkerMetadata({profile,workerId:participants[i].workerId,before:raw[i].before,metadata:{...raw[i].metadata,result:prepared[i].normalizedMeta},version:raw[i].version,after:raw[i].after});if(r.status!=='COMPONENT_KNOWN')fail();}
    const verifier=createR2ArchiveConfigurationObservationV2({enabled:true,readToken:configToken,fetchImpl:async(url,init)=>{if(!CONFIG_PATHS.includes(url)||init.method!=='GET'||init.headers.Authorization!=='Bearer '+configToken)fail();return get(url,{responseOnly:true});},clock,monotonicClock:monotonic,timeoutMs:Math.max(10,deadline-check())});
    const configuration=await verifier.inspect({signal:controller.signal});check();
    completeDomains(await get(BASE+'/workers/domains'),participants);check();if(count!==42||audit.length!==42)fail();
    const checkedAt=check(),expiresAt=Math.min(deadline,start+5000,oldest+5000,custody.expiresAt,a.expiresAt,a.collectorProvenance.expiresAt,runtime.expiresAt);if(expiresAt<=checkedAt)fail();
    const provenance={kind:'rr-accepted-custody-bound-collector-v1',grantReviewSha256:digest(custody),credentialBinding:'accepted-token-value-hashes',providerTokenMetadataReadDuringOperation:false,transport:'fixed-construction-fetch',scope:'exact-accepted-profile-only',snapshotAtomic:false,apiGETCount:42};
    const evidenceRecord=copy({version:'rr-control-plane-read-audit-v5',rootSha256:digest(fixed.root),acceptanceSha256:fixed.root.acceptanceSha256,enrollmentSha256:runtime.enrollmentSha256,coverageProfile:a.coverageProfile,provenance,configurationWire:configuration.wireObservation,requests:audit});
    const evidence=copy({version:'rr-fixed-control-plane-evidence-v5',rootSha256:digest(fixed.root),acceptanceSha256:fixed.root.acceptanceSha256,enrollmentSha256:runtime.enrollmentSha256,collectorHostId:a.participants[1].workerId,observedFrom:start,checkedAt,expiresAt,configuration:{kind:'rr-control-configuration-v5',accountId:configuration.accountId,bucket:configuration.bucket,sourceProjectRef:configuration.sourceProjectRef,observedFrom:configuration.observedFrom,checkedAt:configuration.checkedAt,expiresAt,publicDevelopmentEnabled:configuration.publicDevelopmentEnabled,customDomainCount:configuration.customDomainCount,corsRuleCount:configuration.corsRuleCount,wholeBucketLock:configuration.wholeBucketLock},participants,coverage:{bucketConfiguration:'OBSERVED',activeArtifacts:'OBSERVED',bindings:'OBSERVED',namedWorkerMetadata:'OBSERVED',scopedIngressInventories:'OBSERVED'},providerEvidenceSha256:digest(evidenceRecord),provenance});
    check();lastEvidence=evidenceRecord;return evidence;
   };
   job=Promise.resolve().then(run);job.then(()=>{busy=false;},()=>{busy=false;});
   try{return await Promise.race([job,new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error('AUTHENTICATED_COLLECTOR_V5_HELD'));},Math.max(1,deadline-start));})]);}finally{signal?.removeEventListener('abort',abort);}
  }catch{fail();}finally{controller.abort();clearTimeout(timer);if(!job)busy=false;}
 }
 const result={async collect(input,options){
  try{
   if(!ready())fail();const began=clock(),monoBegan=monotonic();if(!Number.isSafeInteger(began)||!Number.isFinite(monoBegan))fail();
   const q=copy(input);if(!exact(q,['version','purpose','stage','executionId','tupleSha256','nonce','requestedAt','deadline'])||q.version!=='rr-backup-scoped-execution-challenge-v5-scheduled-test-v1'||q.purpose!==purpose||!STAGES_V5[purpose]?.includes(q.stage)||!/^([a-f0-9]{32})$/.test(q.executionId)||q.executionId==='0'.repeat(32)||!sha(q.tupleSha256)||!/^[a-f0-9]{32}$/.test(q.nonce)||q.nonce==='0'.repeat(32))fail();
   if(options!==undefined&&(!exact(options,['signal'])||!(options.signal instanceof AbortSignal)))fail();
   const e=await collectEvidence({requestedAt:q.requestedAt,deadline:q.deadline,...(options?{signal:options.signal}:{})});
   const payload=copy({version:'rr-backup-scoped-execution-observation-v5-scheduled-test-v1',rootId:fixed.root.rootId,acceptanceSha256:e.acceptanceSha256,collectorHostId:e.collectorHostId,challengeSha256:digest(q),observedFrom:e.observedFrom,checkedAt:e.checkedAt,expiresAt:e.expiresAt,configuration:e.configuration,participants:e.participants,coverage:e.coverage,providerEvidenceSha256:e.providerEvidenceSha256,enrollmentSha256:e.enrollmentSha256});
   const observation=copy({algorithm:'Ed25519',keyId:fixed.root.collectorKey.keyId,payload,signature:sign(null,Buffer.from('rack-relic/scoped-execution-v5-scheduled-test-v1/observation\n'+canonical(payload)),privateKey).toString('base64')});
   if(!createScopedExecutionV5Validator({enabled:true,...fixed,purpose,clock})({challenge:q,observation}).scopedExecutionAuthorized)fail();
   const finished=clock(),monoFinished=monotonic();if(!Number.isSafeInteger(finished)||finished<began||finished>=e.expiresAt||!Number.isFinite(monoFinished)||monoFinished<monoBegan||monoFinished-monoBegan>=Math.min(q.deadline,e.expiresAt)-began)fail();return observation;
  }catch{fail();}
 },collectEvidence,lastEvidence(){return lastEvidence;}};
 Object.defineProperty(result,'ready',{enumerable:true,get:ready});return Object.freeze(result);
}
module.exports=Object.freeze({createAuthenticatedControlPlaneCollectorV5,COLLECTOR_RESIDUAL_POWERS:RESIDUAL_POWERS,DEFAULT_EXECUTION_ACCEPTANCE:null});
