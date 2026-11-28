'use strict';
// Entire API/grant/root context and every module/deployment/version are
// fictional in-memory data. No saved provider readback or deployed bytes.
const {createHash,generateKeyPairSync}=require('node:crypto');
const {createV5Fixture}=require('./scoped-execution-v5-fixture.cjs');
const {digestV5,canonicalV5}=require('../../runtime/server/backup_scoped_execution_v5.cjs');
const {COLLECTOR_RESIDUAL_POWERS}=require('../../runtime/server/backup_authenticated_collector_v5.cjs');
const synthetic=require('./synthetic-provider-fixture.cjs'),BASE='https://api.cloudflare.com/client/v4/accounts/'+synthetic.accountId,BUCKET=BASE+'/r2/buckets/rack-relic-private-photo-archive';
const clone=x=>JSON.parse(JSON.stringify(x)),hash=x=>createHash('sha256').update(x).digest('hex');
const env=result=>({success:true,errors:[],messages:[],result});
function settings(){return {logpush:false,observability:{enabled:false,head_sampling_rate:1,issues:{enabled:false},logs:{enabled:false,invocation_logs:false,destinations:[],head_sampling_rate:1,persist:false},redact_query_string:true,traces:{enabled:false,destinations:[],head_sampling_rate:1,persist:false,propagation_policy:null}},tailConsumers:[]};}
function createCollectorFixtureV5(){
 const f=createV5Fixture(),oldToNew=new Map(),ids={};
 for(const p of f.participants){const w=synthetic.workers.find(x=>x.name===p.name);oldToNew.set(p.workerId,w.workerId);ids[p.role]=w.workerId;}
 Object.assign(f.ids,ids);
 for(let i=0;i<5;i++){
  const p=f.participants[i],w=synthetic.workers.find(x=>x.name===p.name);p.workerId=w.workerId;p.module={name:w.module.name,bytes:w.module.bytes,sha256:w.module.sha256,contentType:'application/javascript+module'};p.compatibilityDate=w.compatibilityDate;p.compatibilityFlags=w.compatibilityFlags;
  for(const s of p.bindings.services)s.targetWorkerId=oldToNew.get(s.targetWorkerId);
  f.runtimeVersions[i]={role:p.role,workerId:w.workerId,deploymentId:w.deploymentId,versionId:w.versionId,moduleSha256:w.module.sha256,runtimeReadbackEvidenceSha256:'8'.repeat(64)};
 }
 for(const p of f.participants)p.ingress.knownInboundBindings=f.participants.flatMap(from=>from.bindings.services.filter(s=>s.targetWorkerId===p.workerId).map(s=>({fromWorkerId:from.workerId,binding:s.binding,entrypoint:s.entrypoint}))).sort((a,b)=>canonicalV5(a).localeCompare(canonicalV5(b)));
 // A fictional future dedicated RLS session mode, not a created source principal.
 const source=f.participants[2];source.bindings.secretNames=source.bindings.secretNames.filter(x=>!['SOURCE_S3_ACCESS_KEY_ID','SOURCE_S3_SECRET_ACCESS_KEY'].includes(x));source.bindings.secretNames.push('SOURCE_RLS_ACCESS_TOKEN');
 f.executionAcceptance.sourcePrincipalReview.mode='rls-scoped-session';f.executionAcceptance.sourcePrincipalReview.credentialScope='reviewed-RLS-bound-source-scope';
 f.executionAcceptance.coverageProfile.workerIds=f.participants.map(p=>p.workerId);
 const pair=generateKeyPairSync('ed25519'),der=pair.publicKey.export({format:'der',type:'spki'});
 f.testOnlyKeys.collector=pair.privateKey;f.root.collectorKey={keyId:hash(der),spkiBase64:der.toString('base64')};
 Object.assign(f.executionAcceptance.collectorProvenance,{hostWorkerId:ids.verifier,artifactSha256:f.participants[1].module.sha256,collectorKeyId:f.root.collectorKey.keyId});
 const workerToken='synthetic_worker_read_token_for_local42fixtures',configToken='synthetic_configuration_read_token_for_local42fixtures';
 const grantReview={version:'rr-cf-collector-custody-review-v1',accountId:synthetic.accountId,collectorWorkerId:ids.verifier,artifactSha256:f.participants[1].module.sha256,reviewerIdentity:f.executionAcceptance.collectorProvenance.reviewerIdentity,reviewedAt:f.now-2000,expiresAt:f.now+60000,coverageProfileSha256:digestV5(f.executionAcceptance.coverageProfile),credentials:[{binding:'RACK_RELIC_R2_WORKER_READ_TOKEN',tokenId:'synthetic_worker_token_id',tokenSha256:hash(workerToken),tokenMetadataEvidenceSha256:'9'.repeat(64),permissions:['Individual Workers Content Read-Only'],resourceScope:'five-exact-workers',workerIds:f.participants.map(p=>p.workerId)},{binding:'RACK_RELIC_R2_CONFIG_READ_TOKEN',tokenId:'synthetic_account_read_token_id',tokenSha256:hash(configToken),tokenMetadataEvidenceSha256:'a'.repeat(64),permissions:['Workers R2 Storage Read','Workers Scripts Read'],resourceScope:'entire-fixed-account',workerIds:[]}],effectivePolicies:f.participants.map(p=>({workerId:p.workerId,settings:settings(),versionRuntimeExtras:{urls:[]}})),residualPowers:[...COLLECTOR_RESIDUAL_POWERS]};
 function repin(){grantReview.coverageProfileSha256=digestV5(f.executionAcceptance.coverageProfile);f.executionAcceptance.collectorProvenance.custodyReviewSha256=digestV5(grantReview);f.repin();}
 repin();
 const data=new Map();
 for(let i=0;i<5;i++){
  const p=f.participants[i],w=synthetic.workers.find(x=>x.name===p.name),r=f.runtimeVersions[i],prefix=BASE+'/workers/scripts/'+p.name;
  const bindings=[];for(const [name,text]of Object.entries(p.bindings.plainText))bindings.push({name,type:'plain_text',text});for(const name of p.bindings.secretNames)bindings.push({name,type:'secret_text'});for(const s of p.bindings.services)bindings.push({name:s.binding,type:'service',service:f.participants.find(x=>x.workerId===s.targetWorkerId).name,entrypoint:s.entrypoint});for(const b of p.bindings.otherBindings)bindings.push({name:b.binding,type:'r2_bucket',bucket_name:b.bucket});
  const seen=new Set(),refs=[];for(const s of p.ingress.knownInboundBindings)if(!seen.has(s.fromWorkerId)){seen.add(s.fromWorkerId);refs.push({id:s.fromWorkerId,name:f.participants.find(x=>x.workerId===s.fromWorkerId).name});}
  data.set(prefix+'/deployments?page=1&per_page=1',{...env({deployments:[{id:r.deploymentId,created_on:new Date(f.now-10000).toISOString(),source:'api',strategy:'percentage',versions:[{version_id:r.versionId,percentage:100}]}]}),result_info:{page:1,per_page:1,count:1,total_count:4,total_pages:4}});
  // Optional GetWorker logging values are deliberately absent: full settings GET
  // supplies explicit effective values, rather than treating omission as false.
  data.set(BASE+'/workers/workers/'+p.workerId,env({id:p.workerId,name:p.name,subdomain:w.subdomain,references:{workers:refs,domains:[],dispatch_namespace_outbounds:[],durable_objects:[],queues:[]},tail_consumers:[],tags:[]}));
  data.set(BASE+'/workers/workers/'+p.workerId+'/versions/'+r.versionId+'?include=modules',env({id:r.versionId,urls:[],compatibility_date:p.compatibilityDate,compatibility_flags:p.compatibilityFlags,main_module:p.module.name,bindings,modules:[{name:p.module.name,content_type:p.module.contentType,content_base64:Buffer.from(w.module.content,'utf8').toString('base64')}]}));
  data.set(prefix+'/subdomain',env({enabled:false,previews_enabled:false}));data.set(prefix+'/script-settings',env({logpush:false,observability:settings().observability,tail_consumers:[],tags:[]}));data.set(prefix+'/schedules',env({schedules:[]}));
 }
 const configs=[{id:synthetic.accountId,name:'synthetic account fixture'}, {name:'rack-relic-private-photo-archive',storage_class:'Standard',location:'wnam',jurisdiction:'default'},{rules:[{id:'synthetic-lock',enabled:true,prefix:'',condition:{type:'Age',maxAgeSeconds:604800}}]},{bucketId:'a'.repeat(32),domain:'pub-synthetic.r2.dev',enabled:false},{domains:[]},{rules:[]}];
 [BASE,BUCKET,BUCKET+'/lock',BUCKET+'/domains/managed',BUCKET+'/domains/custom',BUCKET+'/cors'].forEach((u,i)=>data.set(u,env(configs[i])));
 data.set(BASE+'/workers/domains',{...env([]),result_info:{page:1,per_page:100,count:0,total_count:0,total_pages:1}});
 let transform=null;const calls=[];
 async function fetchImpl(url,init){
  calls.push({url,init});if(!data.has(url))throw Error('synthetic unlisted URL');
  let body=clone(data.get(url));if(transform)body=await transform(body,url,init,calls.length);
  if(body instanceof Response)return body;
  const r=new Response(typeof body==='string'?body:JSON.stringify(body),{status:200,headers:{'content-type':'application/json',date:new Date(f.now).toUTCString()}});Object.defineProperty(r,'url',{value:url,configurable:true});return r;
 }
 return {f,data,calls,grantReview,workerToken,configToken,repin,settings,transform(fn){transform=fn;},options(purpose='archive-original-read'){const {clock,...construction}=f.options(purpose);return {enabled:true,...construction,grantReview,workerReadToken:workerToken,configurationReadToken:configToken,signingKey:pair.privateKey,fetchImpl,clockProfileSha256:require('../../runtime/server/cloudflare_window_lifecycle_proposal_v1.cjs').CF_PLATFORM_CLOCK_PROFILE_SHA256,purpose};},input(){return {requestedAt:f.now,deadline:f.now+5000};}};
}
module.exports={createCollectorFixtureV5};
