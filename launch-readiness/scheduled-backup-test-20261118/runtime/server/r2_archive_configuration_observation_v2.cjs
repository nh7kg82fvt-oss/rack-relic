'use strict';
// ADDITIVE SOURCE ONLY. The legacy V1 verifier is unchanged. No default fetch,
// credential, environment discovery, setting mutation, object call or authority.
const {createHash}=require('node:crypto');
const {performance}=require('node:perf_hooks');
const ACCOUNT='7a3ed4f82692abebebc6447e5f5e217c',BUCKET='rack-relic-private-photo-archive',SOURCE='tzymapahsfiyhgilsmxl';
const ROOT='https://api.cloudflare.com/client/v4/accounts/'+ACCOUNT,PATH=ROOT+'/r2/buckets/'+BUCKET;
const URLS=Object.freeze([ROOT,PATH,PATH+'/lock',PATH+'/domains/managed',PATH+'/domains/custom',PATH+'/cors']);
const MESSAGE='The CORS configuration does not exist.',LIMIT=65536;
const fail=()=>{throw Error('R2_CONFIGURATION_OBSERVATION_V2_HELD');};
const hash=x=>createHash('sha256').update(x).digest('hex');
const object=x=>x&&Object.getPrototypeOf(x)===Object.prototype;
const only=(x,allowed)=>object(x)&&Object.keys(x).every(k=>allowed.includes(k));
const exact=(x,names)=>only(x,names)&&Object.keys(x).length===names.length;
function data(x){if(!object(x)||Reflect.ownKeys(x).length!==Object.keys(x).length)fail();const p=Object.getOwnPropertyDescriptors(x);if(Object.values(p).some(d=>!Object.hasOwn(d,'value')||d.enumerable!==true))fail();return p;}
async function readJSON(r,signal){
 const n=r.headers.get('content-length');if(n!==null&&(!/^\d+$/.test(n)||Number(n)>LIMIT))fail();const reader=r.body?.getReader();if(!reader)fail();
 const chunks=[];let size=0;const abort=()=>{reader.cancel().catch(()=>{});};signal.addEventListener('abort',abort,{once:true});
 try{for(;;){if(signal.aborted)fail();const p=await reader.read();if(signal.aborted)fail();if(p.done)break;size+=p.value.byteLength;if(size>LIMIT){reader.cancel().catch(()=>{});fail();}chunks.push(Buffer.from(p.value));}}finally{signal.removeEventListener('abort',abort);reader.releaseLock();}
 if(n!==null&&Number(n)!==size)fail();const bytes=Buffer.concat(chunks),text=new TextDecoder('utf-8',{fatal:true}).decode(bytes),value=JSON.parse(text);
 let pos=0,nodes=0;const ws=()=>{while(pos<text.length&&/[ \t\r\n]/.test(text[pos]))pos++;};
 const str=()=>{const start=pos++;while(pos<text.length){if(text[pos]==='\\'){pos+=2;continue;}if(text[pos++]==='"')return JSON.parse(text.slice(start,pos));}fail();};
 function scan(depth){if(++nodes>4096||depth>14)fail();ws();if(text[pos]==='{'){pos++;ws();const seen=new Set();if(text[pos]==='}'){pos++;return;}for(;;){ws();const k=str();if(seen.has(k))fail();seen.add(k);ws();pos++;scan(depth+1);ws();if(text[pos++]==='}')return;}}if(text[pos]==='['){pos++;ws();if(text[pos]===']'){pos++;return;}for(;;){scan(depth+1);ws();if(text[pos++]===']')return;}}if(text[pos]==='"'){str();return;}while(pos<text.length&&!/[\s,}\]]/.test(text[pos]))pos++;}
 scan(0);return {value,sha256:hash(bytes)};
}
function success(e){if(!exact(e,['success','errors','messages','result'])||e.success!==true||!Array.isArray(e.errors)||e.errors.length||!Array.isArray(e.messages)||!object(e.result))fail();return e.result;}
function policy(rows){
 const [account,bucket,lock,managed,custom]=rows;
 if(!object(account)||account.id!==ACCOUNT||!object(bucket)||bucket.name!==BUCKET||bucket.storage_class!=='Standard'||!['wnam','WNAM'].includes(bucket.location)||bucket.jurisdiction!=='default')fail();
 if(!exact(lock,['rules'])||!Array.isArray(lock.rules)||lock.rules.length!==1)fail();const r=lock.rules[0];
 if(!only(r,['id','enabled','prefix','condition'])||typeof r.id!=='string'||!r.id||r.enabled!==true||Object.hasOwn(r,'prefix')&&r.prefix!==''||!exact(r.condition,['type','maxAgeSeconds'])||r.condition.type!=='Age'||r.condition.maxAgeSeconds!==604800)fail();
 if(!exact(managed,['enabled','bucketId','domain'])||managed.enabled!==false||typeof managed.bucketId!=='string'||!managed.bucketId||managed.bucketId.length>32||typeof managed.domain!=='string')fail();
 const u=new URL('https://'+managed.domain);if(u.hostname!==managed.domain||!u.hostname.endsWith('.r2.dev')||u.username||u.password||u.port||u.pathname!=='/'||u.search||u.hash)fail();
 if(!exact(custom,['domains'])||!Array.isArray(custom.domains)||custom.domains.length)fail();
 return bucket.location;
}
function cors(status,e,rawSha256){
 if(status===200){const c=success(e);if(!exact(c,['rules'])||!Array.isArray(c.rules)||c.rules.length)fail();return Object.freeze({state:'EXPLICIT_EMPTY_RULES',httpStatus:200,errorCode:null,errorMessage:null,rawResponseSha256:rawSha256,zeroRuleCountBasis:'explicit-successful-empty-rules'});}
 // This is a reviewed inference from the actual authenticated provider statement,
 // NOT a public SDK guarantee and NEVER a synthesized200/{rules:[]} response.
 if(status!==404||!exact(e,['success','errors','messages','result'])||e.success!==false||e.result!==null||!Array.isArray(e.messages)||e.messages.length||!Array.isArray(e.errors)||e.errors.length!==1||!exact(e.errors[0],['code','message'])||e.errors[0].code!==10059||e.errors[0].message!==MESSAGE)fail();
 return Object.freeze({state:'PROVIDER_EXPLICIT_ABSENT',httpStatus:404,errorCode:10059,errorMessage:MESSAGE,rawResponseSha256:rawSha256,zeroRuleCountBasis:'inference-from-explicit-provider-absence'});
}
function createR2ArchiveConfigurationObservationV2({enabled=false,readToken,fetchImpl,clock=Date.now,monotonicClock=()=>performance.now(),timeoutMs=5000}={}){
 const configured=enabled===true&&typeof window==='undefined'&&typeof fetchImpl==='function'&&typeof clock==='function'&&typeof monotonicClock==='function'&&typeof readToken==='string'&&/^[A-Za-z0-9_-]{20,256}$/.test(readToken)&&Number.isSafeInteger(timeoutMs)&&timeoutMs>=10&&timeoutMs<=5000;
 let busy=false;
 return Object.freeze({async inspect(options){
  if(!configured||busy)fail();busy=true;const c=new AbortController();let timer,signal,job;
  try{
   if(options!==undefined){const p=data(options);if(!exact(options,['signal'])||!(p.signal.value instanceof AbortSignal))fail();signal=p.signal.value;if(signal.aborted)fail();}
   const abort=()=>c.abort();signal?.addEventListener('abort',abort,{once:true});
   const start=clock(),mono=monotonicClock();let last=start,lastMono=mono,oldest=Infinity;
   if(!Number.isSafeInteger(start)||!Number.isFinite(mono))fail();
   const check=()=>{const now=clock(),m=monotonicClock();if(c.signal.aborted||!Number.isSafeInteger(now)||now<last||now-start>=5000||!Number.isFinite(m)||m<lastMono||m-mono>=5000)fail();last=now;lastMono=m;return now;};
   const run=async()=>{
    const rows=[];let locationObserved,corsWire;
    for(let i=0;i<6;i++){
     // Identity and all four privacy/retention prerequisites are already valid
     // before the final same-bucket CORS absence statement may be interpreted.
     if(i===5)locationObserved=policy(rows);
     check();const url=URLS[i],r=await fetchImpl(url,{method:'GET',redirect:'manual',cache:'no-store',signal:c.signal,headers:{Authorization:'Bearer '+readToken,Accept:'application/json','Cache-Control':'no-store',...(i?{'cf-r2-jurisdiction':'default'}:{})}}),now=check();
     if(!(r instanceof Response)||r.url!==url||r.redirected||r.headers.has('location')||r.headers.has('link')||!/^application\/json(?:\s*;|$)/i.test(r.headers.get('content-type')||'')||r.status!==200&&!(i===5&&r.status===404))fail();
     const date=Date.parse(r.headers.get('date')||'');if(!Number.isFinite(date)||date>now+1000||now-date>5000||r.headers.has('age')&&r.headers.get('age')!=='0'||/HIT|STALE|UPDATING|REVALIDATED/i.test(r.headers.get('cf-cache-status')||''))fail();oldest=Math.min(oldest,date);
     const body=await readJSON(r,c.signal);check();if(i===5)corsWire=cors(r.status,body.value,body.sha256);else rows.push(success(body.value));
    }
    const checkedAt=check(),expiresAt=Math.min(start+5000,oldest+5000);if(expiresAt<=checkedAt)fail();
    return Object.freeze({kind:'rr-r2-configuration-observation-v2',accountId:ACCOUNT,bucket:BUCKET,sourceProjectRef:SOURCE,observedFrom:start,checkedAt,expiresAt,publicDevelopmentEnabled:false,customDomainCount:0,corsRuleCount:0,wholeBucketLock:Object.freeze({type:'Age',maxAgeSeconds:604800,prefix:''}),wireObservation:Object.freeze({version:'rr-r2-configuration-wire-contract-v2',bucketLocationObserved:locationObserved,bucketLocationCanonical:'wnam',cors:corsWire}),executionAcceptance:null,executionAuthorized:false,backupConnected:false,restoreEnabled:false,financialReleaseEnabled:false});
   };
   job=Promise.resolve().then(run);job.then(()=>{busy=false;},()=>{busy=false;});
   try{return await Promise.race([job,new Promise((_,reject)=>{timer=setTimeout(()=>{c.abort();reject(Error('R2_CONFIGURATION_OBSERVATION_V2_HELD'));},timeoutMs);})]);}finally{signal?.removeEventListener('abort',abort);}
  }catch{fail();}finally{c.abort();clearTimeout(timer);if(!job)busy=false;}
 }});
}
module.exports=Object.freeze({createR2ArchiveConfigurationObservationV2,R2_CORS_ABSENCE_WIRE_CONTRACT:'rr-cf-r2-cors-absence-10059-v1'});
