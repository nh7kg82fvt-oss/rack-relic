'use strict';
// ADDITIVE V5 bound for the measured private CF wrapper (under256KiB).
// Legacy metadata normalizer and its128KiB bound remain unchanged.
// NODE-ONLY SOURCE REVIEW. A component observation is never execution authority.
// No default fetch, credential, root, execution acceptance, signer or entrypoint.
const {createHash}=require('node:crypto');
// This V5 component uses the accepted CF wall-clock, never an independent elapsed clock.
const ACCOUNT='7a3ed4f82692abebebc6447e5f5e217c';
const BASE='https://api.cloudflare.com/client/v4/accounts/'+ACCOUNT;
const IDENTITIES=Object.freeze([
 ['journal','rack-relic-archive-journal','1cea9c31fbef47bb9e2705ad88edb03d'],
 ['source','rack-relic-backup-source-reader','cf24bfc351b1429f95039b713e9233c0'],
 ['gateway','rack-relic-private-photo-archive-gateway','d01911069df74ce38caec7f364cc9cb4'],
 ['caller','rack-relic-r2-backup-caller','2c3d72b65787409a8f1badab9f43d5d8'],
 ['verifier','rack-relic-r2-policy-verifier','63c8f95ae75343ca9445c11ac85d3fe7']
]);
const SHA=/^[a-f0-9]{64}$/,UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const LIMIT=524288,WINDOW=5000;
const hash=x=>createHash('sha256').update(x).digest('hex');
const canonical=x=>JSON.stringify(x&&typeof x==='object'?Array.isArray(x)?x.map(v=>JSON.parse(canonical(v))):Object.fromEntries(Object.keys(x).sort().map(k=>[k,JSON.parse(canonical(x[k]))])):x);
const digest=x=>hash(canonical(x));
class Unknown extends Error{}
class Mismatch extends Error{}
const unknown=reason=>{throw new Unknown(reason);};
const mismatch=reason=>{throw new Mismatch(reason);};
const object=x=>x&&Object.getPrototypeOf(x)===Object.prototype;
const owns=(x,k)=>Object.hasOwn(x,k);
const keys=(x,allowed)=>object(x)&&Object.keys(x).every(k=>allowed.includes(k));
const same=(a,b)=>canonical(a)===canonical(b);
const nonempty=x=>typeof x==='string'&&x.length>0&&x.length<=256;
function clone(value){
 let count=0;
 function walk(x,depth){
  if(++count>8192||depth>18)unknown('bounded-plain-json-required');
  if(x===null||typeof x==='boolean'||typeof x==='number'&&Number.isFinite(x))return x;
  if(typeof x==='string'){if(Buffer.byteLength(x)>LIMIT)unknown('bounded-plain-json-required');return x;}
  if(!x||!Array.isArray(x)&&!object(x))unknown('bounded-plain-json-required');
  const ds=Object.getOwnPropertyDescriptors(x),names=Reflect.ownKeys(ds);
  if(names.some(k=>typeof k!=='string'||k!=='length'&&(!ds[k].enumerable||!owns(ds[k],'value'))))unknown('accessor-or-hidden-json-field');
  if(Array.isArray(x)){
   if(x.length>4096||names.length!==x.length+1||names.some(k=>k!=='length'&&!/^(0|[1-9][0-9]*)$/.test(k)))unknown('dense-json-array-required');
   return Object.freeze(Array.from({length:x.length},(_,i)=>walk(ds[i].value,depth+1)));
  }
  return Object.freeze(Object.fromEntries(names.map(k=>[k,walk(ds[k].value,depth+1)])));
 }
 const out=walk(value,0);if(Buffer.byteLength(canonical(out))>LIMIT)unknown('bounded-plain-json-required');return out;
}
function array(x,max=64){if(!Array.isArray(x)||x.length>max)unknown('bounded-explicit-array-required');return x;}
function strings(x,max=64){array(x,max);if(x.some(v=>!nonempty(v))||new Set(x).size!==x.length)unknown('unique-string-array-required');return x;}
function boolean(x,field){if(typeof x!=='boolean')unknown('missing-or-ambiguous-'+field);return x;}
function rate(x,field){if(typeof x!=='number'||!Number.isFinite(x)||x<0||x>1)unknown('missing-or-ambiguous-'+field);return x;}
function envelope(x){
 if(!keys(x,['success','errors','messages','result','result_info'])||x.success!==true||!Array.isArray(x.errors)||x.errors.length||!Array.isArray(x.messages))unknown('successful-api-envelope-required');
 return x.result;
}
function profile(value){
 const p=clone(value);
 if(!keys(p,['kind','accountId','workers'])||p.kind!=='rr-effective-metadata-review-profile-v1'||p.accountId!==ACCOUNT||!Array.isArray(p.workers)||p.workers.length!==5)unknown('fixed-review-profile-required');
 for(let i=0;i<5;i++){
  const w=p.workers[i],id=IDENTITIES[i];
  if(!keys(w,['role','name','workerId','deploymentId','versionId','module','compatibilityDate','compatibilityFlags','bindings','subdomain','references','effectiveSettings','versionRuntimeExtras'])||w.role!==id[0]||w.name!==id[1]||w.workerId!==id[2]||!UUID.test(w.deploymentId||'')||!UUID.test(w.versionId||''))unknown('exact-worker-identity-pins-required');
  if(!keys(w.module,['name','bytes','sha256','contentType'])||!nonempty(w.module.name)||!Number.isSafeInteger(w.module.bytes)||w.module.bytes<1||w.module.bytes>262144||!SHA.test(w.module.sha256||'')||w.module.contentType!=='application/javascript+module'||!/^\d{4}-\d{2}-\d{2}$/.test(w.compatibilityDate||''))unknown('exact-version-module-pins-required');
  strings(w.compatibilityFlags,8);array(w.bindings,32);
  if(!object(w.subdomain)||!object(w.references)||w.effectiveSettings!==null&&!object(w.effectiveSettings)||w.versionRuntimeExtras!==null&&!object(w.versionRuntimeExtras))unknown('explicit-config-review-state-required');
 }
 return p;
}
function paths(w){
 const deployments=BASE+'/workers/scripts/'+w.name+'/deployments?page=1&per_page=1';
 return Object.freeze({before:deployments,metadata:BASE+'/workers/workers/'+w.workerId,version:BASE+'/workers/workers/'+w.workerId+'/versions/'+w.versionId+'?include=modules',after:deployments});
}
function active(e,w){
 const r=envelope(e);
 if(!keys(r,['deployments'])||!Array.isArray(r.deployments)||r.deployments.length!==1)unknown('one-first-active-deployment-required');
 // Later pages are historical; they are not needed to identify the documented first active deployment.
 if(e.result_info!==undefined){const i=e.result_info;if(!keys(i,['page','per_page','count','total_count','total_pages'])||i.page!==1||i.per_page!==1||i.count!==1||!Number.isSafeInteger(i.total_count)||i.total_count<1||!Number.isSafeInteger(i.total_pages)||i.total_pages!==i.total_count)unknown('active-deployment-page-ambiguous');}
 const d=r.deployments[0];
 if(!keys(d,['id','created_on','source','strategy','versions','annotations','author_email','author_id'])||!UUID.test(d.id||'')||!Number.isFinite(Date.parse(d.created_on))||d.strategy!=='percentage'||!Array.isArray(d.versions)||d.versions.length!==1||!keys(d.versions[0],['version_id','percentage'])||!UUID.test(d.versions[0].version_id||'')||d.versions[0].percentage!==100)unknown('unreviewed-or-split-active-deployment');
 if(d.id!==w.deploymentId||d.versions[0].version_id!==w.versionId)mismatch('active-deployment-pin-mismatch');
 return {id:d.id,created_on:d.created_on,strategy:d.strategy,versions:d.versions};
}
function observability(o){
 if(!keys(o,['enabled','head_sampling_rate','issues','logs','redact_query_string','traces']))unknown('observability-field-coverage-unknown');
 const enabled=boolean(o.enabled,'observability-enabled'),head_sampling_rate=rate(o.head_sampling_rate,'observability-sampling');
 if(!keys(o.issues,['enabled'])||!keys(o.logs,['enabled','invocation_logs','destinations','head_sampling_rate','persist'])||!keys(o.traces,['enabled','destinations','head_sampling_rate','persist','propagation_policy']))unknown('observability-subfield-coverage-unknown');
 const logs={enabled:boolean(o.logs.enabled,'logs-enabled'),invocation_logs:boolean(o.logs.invocation_logs,'invocation-logs'),destinations:strings(o.logs.destinations),head_sampling_rate:rate(o.logs.head_sampling_rate,'logs-sampling'),persist:boolean(o.logs.persist,'log-persistence')};
 const traces={enabled:boolean(o.traces.enabled,'traces-enabled'),destinations:strings(o.traces.destinations),head_sampling_rate:rate(o.traces.head_sampling_rate,'traces-sampling'),persist:boolean(o.traces.persist,'trace-persistence'),propagation_policy:o.traces.propagation_policy};
 if(![null,'authenticated','accept'].includes(traces.propagation_policy))unknown('missing-or-ambiguous-trace-propagation');
 return {enabled,head_sampling_rate,issues:{enabled:boolean(o.issues.enabled,'issues-enabled')},logs,redact_query_string:boolean(o.redact_query_string,'query-redaction'),traces};
}
function metadata(e,w){
 const m=envelope(e);
 if(!keys(m,['id','name','created_on','updated_on','deployed_on','logpush','observability','references','subdomain','tags','tail_consumers','previews_base_config']))unknown('worker-metadata-schema-unknown');
 if(m.id!==w.workerId||m.name!==w.name)mismatch('immutable-worker-identity-mismatch');
 const s=m.subdomain;
 if(!keys(s,['enabled','previews_enabled','url','preview_url_suffix']))unknown('subdomain-field-coverage-unknown');
 const subdomain={enabled:boolean(s.enabled,'workers-dev-enabled'),previews_enabled:boolean(s.previews_enabled,'preview-enabled')};
 // URL strings are descriptive, not enablement evidence; absent strings are not synthesized.
 for(const k of ['url','preview_url_suffix'])if(owns(s,k)){if(!nonempty(s[k]))unknown('subdomain-descriptive-field-invalid');subdomain[k]=s[k];}
 if(!same(subdomain,w.subdomain))mismatch('subdomain-pin-mismatch');
 const r=m.references,schemas={workers:['id','name'],domains:['id','certificate_id','hostname','zone_id','zone_name'],dispatch_namespace_outbounds:['namespace_id','namespace_name','worker_id','worker_name'],durable_objects:['namespace_id','namespace_name','worker_id','worker_name'],queues:['queue_consumer_id','queue_id','queue_name']};
 if(!keys(r,Object.keys(schemas))||Object.keys(schemas).some(k=>!owns(r,k)))unknown('reference-inventory-field-coverage-unknown');
 const references={};
 for(const [k,fields]of Object.entries(schemas)){
  references[k]=array(r[k]).map(row=>{if(!keys(row,fields)||fields.some(f=>!nonempty(row[f])))unknown('reference-row-schema-unknown');return row;});
  if(new Set(references[k].map(canonical)).size!==references[k].length)unknown('duplicate-reference-row');
 }
 if(!same(references,w.references))mismatch('named-reference-inventory-mismatch');
 array(m.tail_consumers);if(m.tail_consumers.some(t=>!keys(t,['name'])||!nonempty(t.name)))unknown('tail-consumer-schema-unknown');
 // GetWorker gives only names; script-settings also has environment/namespace.
 // Empty is lossless. Nonempty requires the original settings GET and a new budget.
 if(m.tail_consumers.length)unknown('nonempty-tail-consumers-need-settings-context');
 const settings={logpush:boolean(m.logpush,'logpush'),observability:observability(m.observability),tailConsumers:[]};
 if(w.effectiveSettings===null)unknown('accepted-effective-settings-not-reviewed');
 if(!same(settings,w.effectiveSettings))mismatch('effective-settings-pin-mismatch');
 return {subdomain,references,settings};
}
const VERSION_RUNTIME=['assets','cache_options','containers','exports','limits','main_module','migration_tag','migrations','package_dependencies','placement','usage_model','urls'];
const VERSION_OTHER=['id','created_on','number','annotations','author_email','author_id','bindings','compatibility_date','compatibility_flags','exports_reconciliation','modules','source','startup_time_ms'];
function version(e,w){
 const v=envelope(e);if(!keys(v,[...VERSION_RUNTIME,...VERSION_OTHER]))unknown('version-schema-or-effective-config-unknown');
 if(v.id!==w.versionId)mismatch('active-version-id-mismatch');
 if(v.compatibility_date!==w.compatibilityDate)mismatch('compatibility-date-mismatch');
 // This one omission has an explicit documented meaning: no explicitly set flags.
 const flags=owns(v,'compatibility_flags')?strings(v.compatibility_flags,8):[];
 if(!same(flags,w.compatibilityFlags))mismatch('compatibility-flags-mismatch');
 if(v.main_module!==w.module.name)mismatch('main-module-mismatch');
 strings(v.urls);if(v.urls.length)unknown('version-routable-urls-need-separate-ingress-review');
 if(owns(v,'assets'))unknown('static-assets-effective-authority-not-in-closed-profile');
 const modules=array(v.modules,16);
 if(modules.length!==1)unknown('additional-or-missing-runtime-modules');
 const m=modules[0];
 if(!keys(m,['name','content_type','content_base64'])||m.name!==w.module.name||m.content_type!==w.module.contentType||typeof m.content_base64!=='string'||m.content_base64.length>349528)unknown('module-schema-or-size-unknown');
 const bytes=Buffer.from(m.content_base64,'base64');
 if(bytes.toString('base64')!==m.content_base64)unknown('noncanonical-base64-module');
 if(bytes.length!==w.module.bytes||hash(bytes)!==w.module.sha256)mismatch('exact-runtime-bytes-mismatch');
 const bindings=array(v.bindings,32),seen=new Set();
 for(const b of bindings){
  const schema={plain_text:['name','type','text'],r2_bucket:['name','type','bucket_name','jurisdiction'],secret_text:['name','type'],service:['name','type','service','environment','entrypoint']}[b?.type];
  if(!schema||!keys(b,schema)||!nonempty(b.name)||seen.has(b.name))unknown('binding-schema-or-duplicate-unknown');seen.add(b.name);
  if(b.type==='plain_text'&&(typeof b.text!=='string'||b.text.length>4096)||b.type==='r2_bucket'&&(!nonempty(b.bucket_name)||owns(b,'jurisdiction')&&!nonempty(b.jurisdiction))||b.type==='service'&&(!nonempty(b.service)||['environment','entrypoint'].some(k=>owns(b,k)&&!nonempty(b[k]))))unknown('binding-required-field-unknown');
 }
 const sorted=bindings.slice().sort((a,b)=>a.name.localeCompare(b.name)),expected=w.bindings.slice().sort((a,b)=>a.name.localeCompare(b.name));
 if(!same(sorted,expected))mismatch('exact-version-bindings-mismatch');
 const extras=Object.fromEntries(VERSION_RUNTIME.filter(k=>k!=='main_module'&&owns(v,k)).map(k=>[k,v[k]]));
 if(w.versionRuntimeExtras===null)unknown('accepted-version-runtime-fields-not-reviewed');
 if(!same(extras,w.versionRuntimeExtras))unknown('unreviewed-effective-version-configuration');
 return {versionId:v.id,module:w.module,bindingSha256:digest(sorted),compatibilityDate:v.compatibility_date,compatibilityFlags:flags,versionRuntimeExtrasSha256:digest(extras)};
}
function held(status,reasons,extra={}){
 return Object.freeze({kind:'rr-effective-metadata-component-review-v1',status,reasons:Object.freeze(reasons),held:true,executionAcceptance:null,executionAuthorized:false,objectSendAuthorized:false,hostedReady:false,completeAcceptedProfile:'UNKNOWN',...extra});
}
function reviewEffectiveWorkerMetadata({profile:inputProfile,workerId,before,metadata:meta,version:ver,after}={}){
 try{
  const p=profile(inputProfile),w=p.workers.find(x=>x.workerId===workerId);if(!w)unknown('fixed-worker-not-in-profile');
  const input=clone({before,metadata:meta,version:ver,after});
  const first=active(input.before,w),effective=metadata(input.metadata,w),artifact=version(input.version,w),last=active(input.after,w);
  if(!same(first,last))mismatch('deployment-changed-during-observation');
  return held('COMPONENT_KNOWN',[],{accountId:ACCOUNT,workerId:w.workerId,name:w.name,deploymentId:first.id,profileSha256:digest(p),effective,artifact,
   provenance:'UNAUTHENTICATED_PARSER_INPUT',referenceCoverage:'named-response-only-not-universal-inbound-absence',snapshotAtomicity:'NOT_PROVEN',previewTemplateUsed:false});
 }catch(e){return held(e instanceof Mismatch?'MISMATCH':'UNKNOWN',[e instanceof Unknown||e instanceof Mismatch?e.message:'malformed-bounded-input']);}
}
function buildPreferredCollectorPlan(inputProfile=null,{mode='full-metadata-42'}={}){
 let p;try{p=profile(inputProfile);if(!['full-metadata-42','lossless-field-compression-32'].includes(mode))unknown('finite-collector-plan-required');}catch{return held('UNKNOWN',['fixed-review-profile-and-finite-plan-required']);}
 const requests=p.workers.flatMap(w=>Object.entries(paths(w)).map(([step,url])=>({component:'worker-metadata',workerId:w.workerId,step,method:'GET',url})));
 const bucket=BASE+'/r2/buckets/rack-relic-private-photo-archive';
 requests.push(...[BASE,bucket,bucket+'/lock',bucket+'/domains/managed',bucket+'/domains/custom',bucket+'/cors'].map(url=>({component:'bucket-configuration',method:'GET',url})));
 requests.push(...p.workers.map(w=>({component:'schedule-inventory',workerId:w.workerId,method:'GET',url:BASE+'/workers/scripts/'+w.name+'/schedules'})));
 requests.push({component:'account-domain-inventory',method:'GET',url:BASE+'/workers/domains'});
 const compressed=mode==='lossless-field-compression-32';
 if(!compressed)for(const w of p.workers)for(const suffix of ['subdomain','script-settings'])requests.push({component:'retained-'+suffix,workerId:w.workerId,method:'GET',url:BASE+'/workers/scripts/'+w.name+'/'+suffix});
 return held('PLAN_ONLY',['bucket-schedule-domain-and-accepted-zone-coverage-still-required','authenticated-collector-owner-window-grant-and-carrier-missing'],{mode,preferredPrivacyCoveragePlan:'full-metadata-42',requests:Object.freeze(requests.map(Object.freeze)),conditionalControlGETs:compressed?32:42,unchangedSourceGETs:5,unchangedJournalPOSTs:12,aggregateExternalHTTP:compressed?49:59,aggregateHTTPIsPooledLimit:false,externalBudgetScope:'per-invocation-mapping-required',perInvocationExternalFit:'UNKNOWN',wholeRuntimeFit:'UNKNOWN',conditionalWorkerInvocations:28,conditionalNativeR2Operations:17,optionalCompressionApplicable:'UNKNOWN',automaticRetries:0,extraRequiredInventories:'UNKNOWN'});
}
function reviewCompleteDomainInventory(input){
 try{
  const e=clone(input),rows=envelope(e),i=e.result_info;
  array(rows,1000);
  if(!keys(i,['page','per_page','count','total_count','total_pages'])||i.page!==1||i.total_pages!==1||i.count!==rows.length||i.total_count!==rows.length||!Number.isSafeInteger(i.per_page)||i.per_page<Math.max(1,rows.length))unknown('complete-domain-page-coverage-unknown');
  for(const r of rows)if(!keys(r,['id','hostname','service','environment','zone_id','zone_name'])||['id','hostname','service','zone_id','zone_name'].some(k=>!nonempty(r[k]))||owns(r,'environment')&&!nonempty(r.environment))unknown('domain-row-schema-unknown');
  return held('COMPONENT_KNOWN',[],{domainCount:rows.length,domainsSha256:digest(rows),provenance:'UNAUTHENTICATED_PARSER_INPUT',scope:'one-exact-account-domain-response'});
 }catch(e){return held('UNKNOWN',[e instanceof Unknown?e.message:'malformed-domain-input']);}
}
async function readJSON(response,signal){
 const length=response.headers.get('content-length');if(length!==null&&(!/^\d+$/.test(length)||Number(length)>LIMIT))unknown('response-byte-limit');
 const reader=response.body?.getReader();if(!reader)unknown('response-body-required');
 let size=0;const chunks=[],abort=()=>{reader.cancel().catch(()=>{});};signal.addEventListener('abort',abort,{once:true});
 try{for(;;){if(signal.aborted)unknown('aborted');const next=await reader.read();if(signal.aborted)unknown('aborted');if(next.done)break;size+=next.value.byteLength;if(size>LIMIT){await reader.cancel();unknown('response-byte-limit');}chunks.push(Buffer.from(next.value));}}
 finally{signal.removeEventListener('abort',abort);reader.releaseLock();}
 if(length!==null&&Number(length)!==size)unknown('response-length-mismatch');
 const text=new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)),parsed=JSON.parse(text);
 // JSON.parse alone silently chooses the last duplicate key. Reject that ambiguity,
 // including escape-equivalent property names, before normalizing any API values.
 let at=0,nodes=0;
 const ws=()=>{while(/\s/.test(text[at]||'')&&at<text.length)at++;};
 const string=()=>{const start=at++;while(at<text.length){if(text[at]==='\\'){at+=2;continue;}if(text[at++]==='"')return JSON.parse(text.slice(start,at));}unknown('malformed-json-string');};
 function scan(depth){
  if(++nodes>8192||depth>18)unknown('bounded-plain-json-required');ws();
  if(text[at]==='{'){
   at++;ws();const seen=new Set();if(text[at]==='}'){at++;return;}
   for(;;){ws();const key=string();if(seen.has(key))unknown('duplicate-api-json-key');seen.add(key);ws();at++;scan(depth+1);ws();if(text[at++]==='}')return;}
  }
  if(text[at]==='['){at++;ws();if(text[at]===']'){at++;return;}for(;;){scan(depth+1);ws();if(text[at++]===']')return;}}
  if(text[at]==='"'){string();return;}
  while(at<text.length&&!/[\s,}\]]/.test(text[at]))at++;
 }
 scan(0);return parsed;
}
function createEffectiveMetadataReviewSlice({enabled=false,profile:inputProfile=null,fetchImpl=null,clock=Date.now,monotonicClock=Date.now}={}){
 let fixed=null;try{if(enabled===true&&typeof fetchImpl==='function'&&typeof clock==='function'&&typeof monotonicClock==='function')fixed=profile(inputProfile);}catch{}
 let busy=false;
 return Object.freeze({async inspect(options){
  if(!fixed||busy)return held('UNKNOWN',['review-slice-not-configured-or-busy']);
  busy=true;const c=new AbortController(),abort=()=>c.abort();let timer,signal,job;
  try{
   if(options!==undefined){
    if(!keys(options,['signal']))unknown('invalid-or-aborted-request');
    const d=Object.getOwnPropertyDescriptors(options);
    if(Reflect.ownKeys(d).length!==1||!d.signal?.enumerable||!owns(d.signal,'value')||!(d.signal.value instanceof AbortSignal))unknown('invalid-or-aborted-request');
    signal=d.signal.value;if(signal.aborted)unknown('invalid-or-aborted-request');signal.addEventListener('abort',abort,{once:true});
   }
   const start=clock(),mono=monotonicClock();let last=start,lastMono=mono,count=0;
   if(!Number.isSafeInteger(start)||!Number.isFinite(mono))unknown('trusted-construction-clock-required');
   const check=()=>{const now=clock(),elapsed=monotonicClock();if(c.signal.aborted||!Number.isSafeInteger(now)||now<last||!Number.isFinite(elapsed)||elapsed<lastMono||now-start>=WINDOW||elapsed-mono>=WINDOW)unknown('fixed-five-second-collection-window-expired');last=now;lastMono=elapsed;return now;};
   const run=async()=>{
    const rows=await Promise.all(fixed.workers.map(async w=>{
     const input={profile:fixed,workerId:w.workerId};
     for(const [step,url]of Object.entries(paths(w))){
      check();if(++count>20)unknown('fixed-request-count-exceeded');
      const r=await fetchImpl(url,{method:'GET',redirect:'manual',cache:'no-store',signal:c.signal,headers:{Accept:'application/json','Cache-Control':'no-store'}});const now=check();
      if(!(r instanceof Response)||r.status!==200||r.url!==url||r.redirected||r.headers.has('location')||r.headers.has('link')||!/^application\/json(?:\s*;|$)/i.test(r.headers.get('content-type')||''))unknown('exact-get-response-required');
      const date=Date.parse(r.headers.get('date')||'');if(!Number.isFinite(date)||date>now+1000||now-date>WINDOW||r.headers.has('age')&&r.headers.get('age')!=='0'||/HIT|STALE|UPDATING|REVALIDATED/i.test(r.headers.get('cf-cache-status')||''))unknown('fresh-direct-response-required');
      input[step]=await readJSON(r,c.signal);check();
     }
     return reviewEffectiveWorkerMetadata(input);
    }));check();
    return held(rows.every(r=>r.status==='COMPONENT_KNOWN')?'COMPONENT_KNOWN':'UNKNOWN',rows.flatMap(r=>r.reasons),{requestsMade:count,workers:Object.freeze(rows),observedFrom:start,checkedAt:check(),expiresAt:start+WINDOW,provenance:'CONSTRUCTION_TRANSPORT_NOT_RUNTIME_AUTHENTICATED',completeAcceptedProfile:'UNKNOWN'});
   };
   job=Promise.resolve().then(run);job.then(()=>{busy=false;},()=>{busy=false;});
   return await Promise.race([job,new Promise((_,reject)=>{timer=setTimeout(()=>{abort();reject(new Unknown('fixed-five-second-collection-window-expired'));},WINDOW);})]);
  }catch(e){return held('UNKNOWN',[e instanceof Unknown?e.message:'transport-or-schema-failure']);}
  finally{abort();clearTimeout(timer);signal?.removeEventListener('abort',abort);if(!job)busy=false;}
 }});
}
module.exports=Object.freeze({reviewEffectiveWorkerMetadata,createEffectiveMetadataReviewSlice,buildPreferredCollectorPlan,reviewCompleteDomainInventory,DEFAULT_EXECUTION_ACCEPTANCE:null});
