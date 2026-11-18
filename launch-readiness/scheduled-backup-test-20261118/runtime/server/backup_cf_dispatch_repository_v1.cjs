'use strict';
// SOURCE ONLY private journal/gateway ports. No endpoint, actual server key,
// dispatch key, provider object or accepted native role profile is installed.
const {createHash,createHmac,randomBytes,randomUUID,timingSafeEqual}=require('node:crypto');
const {copyV5ConstructionData:copy}=require('./backup_runtime_enrollment_v5.cjs');
const {canonicalV5:canonicalV4,digestV5:digestV4}=require('./backup_scoped_execution_v5.cjs');
// Repository-only extraction; no independent Node-clock policy is imported.
const IDENTITY='r2:7a3ed4f82692abebebc6447e5f5e217c:rack-relic-private-photo-archive',REF='tzymapahsfiyhgilsmxl',RPC='https://'+REF+'.supabase.co/rest/v1/rpc/rr_test_archive_dispatch_consume_v2';
const SHA=/^[a-f0-9]{64}$/,UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const fail=()=>{throw Error('WINDOW_ORIGINAL_DISPATCH_V2_HELD');};
const exact=(x,ks)=>x&&Object.getPrototypeOf(x)===Object.prototype&&Object.keys(x).sort().join('|')===ks.slice().sort().join('|');
const hash=x=>createHash('sha256').update(x).digest('hex');
const mac=(key,domain,body)=>createHmac('sha256',key).update(domain+'\n'+canonicalV4(body)).digest('hex');
const equal=(a,b)=>typeof a==='string'&&SHA.test(a)&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
function tuple(x){x=copy(x);if(!exact(x,['kind','key','sha256','contentType','size','attemptId'])||!['photo','manifest'].includes(x.kind)||!SHA.test(x.sha256)||!Number.isSafeInteger(x.size)||x.size<1||x.size>2097152||!UUID.test(x.attemptId)||x.attemptId==='00000000-0000-0000-0000-000000000000')fail();return x;}
function context(x){x=copy(x);if(!exact(x,['requestSha256','leaseSha256','sourcePathSha256','snapshotId','gatewayNonce'])||['requestSha256','leaseSha256','sourcePathSha256'].some(k=>!SHA.test(x[k])||x[k]==='0'.repeat(64))||!UUID.test(x.snapshotId)||!UUID.test(x.gatewayNonce))fail();return x;}
function operation(x){x=copy(x);if(!exact(x,['kind','key','sha256','contentType','size'])||!['photo','manifest'].includes(x.kind)||typeof x.key!=='string'||x.key.length>512||!SHA.test(x.sha256)||!['image/png','image/jpeg','image/webp','application/json'].includes(x.contentType)||!Number.isSafeInteger(x.size)||x.size<1||x.size>2097152)fail();return x;}
const responseKeys=['version','test','sourceProjectRef','identity','key','sha256','contentType','size','attemptId','requestSha256','leaseSha256','sourcePathSha256','snapshotId','gatewayNonce','sendAllowed','releaseEnabled'];
function projection(v,t,c){v=copy(v);if(!exact(v,responseKeys)||v.version!=='rr-window-original-dispatch-v2'||v.test!==true||v.sourceProjectRef!==REF||v.identity!==IDENTITY||['key','sha256','contentType','size','attemptId'].some(k=>v[k]!==t[k])||Object.entries(c).some(([k,x])=>v[k]!==x)||typeof v.sendAllowed!=='boolean'||v.releaseEnabled!==false)fail();return v;}
async function boundedBody(response,limit,signal){
 const length=response.headers.get('content-length');if(length!==null&&(!/^\d+$/.test(length)||Number(length)>limit)||!response.body)fail();const reader=response.body.getReader(),parts=[];let size=0;const abort=()=>{reader.cancel().catch(()=>{});};signal.addEventListener('abort',abort,{once:true});
 try{for(;;){if(signal.aborted)fail();const p=await reader.read();if(signal.aborted)fail();if(p.done)break;size+=p.value.byteLength;if(size>limit){await reader.cancel();fail();}parts.push(Buffer.from(p.value));}}finally{signal.removeEventListener('abort',abort);reader.releaseLock();}if(length!==null&&Number(length)!==size)fail();return Buffer.concat(parts,size);
}
function createWindowDispatchRepositoryV2({enabled=false,serviceKey=null,transport=null}={}){
 const ready=enabled===true&&typeof serviceKey==='string'&&/^sb_secret_[A-Za-z0-9_-]{16,}$/.test(serviceKey)&&typeof transport==='function';
 return Object.freeze({async claimOriginalForDispatch(value,ctx,{signal}={}){
  if(!ready||!(signal instanceof AbortSignal)||signal.aborted)fail();const t=operation(value),c=copy(ctx);if(!exact(c,['requestSha256','leaseSha256','sourcePathSha256','snapshotId'])||['requestSha256','leaseSha256','sourcePathSha256'].some(k=>!SHA.test(c[k])||c[k]==='0'.repeat(64))||!UUID.test(c.snapshotId)||c.snapshotId==='00000000-0000-0000-0000-000000000000')fail();const url=RPC.replace('dispatch_consume','claim_for_dispatch'),args={p_identity:IDENTITY,p_key:t.key,p_sha256:t.sha256,p_type:t.contentType,p_size:t.size,p_request_sha256:c.requestSha256,p_lease_sha256:c.leaseSha256,p_source_path_sha256:c.sourcePathSha256,p_snapshot:c.snapshotId};
  const r=await transport(url,{method:'POST',redirect:'manual',cache:'no-store',signal,headers:{apikey:serviceKey,'content-type':'application/json','cache-control':'no-store'},body:JSON.stringify(args)});if(signal.aborted||!(r instanceof Response)||r.status!==200||r.redirected||r.headers.has('location')||r.url&&r.url!==url||!/^application\/json(?:\s*;|$)/i.test(r.headers.get('content-type')||'')||r.headers.has('age')&&r.headers.get('age')!=='0'||['cf-cache-status','x-vercel-cache'].some(k=>/^(HIT|STALE|UPDATING)$/i.test(r.headers.get(k)||'')))fail();const result=copy(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await boundedBody(r,2048,signal))));
  if(!exact(result,['version','original','dispatchReservationState','releaseEnabled'])||result.version!=='rr-window-original-claim-v2'||result.releaseEnabled!==false||!['reserved','consumed','unreserved'].includes(result.dispatchReservationState))fail();const q=result.original;if(!exact(q,['test','sourceProjectRef','identity','key','sha256','contentType','size','attemptId','outcome','sendAllowed','releaseEnabled'])||q.test!==true||q.sourceProjectRef!==REF||q.identity!==IDENTITY||['key','sha256','contentType','size'].some(k=>q[k]!==t[k])||!UUID.test(q.attemptId)||!['unknown','verified'].includes(q.outcome)||typeof q.sendAllowed!=='boolean'||q.releaseEnabled!==false)fail();return result;
 },async consumeOriginalDispatch(value,ctx,{signal}={}){
  if(!ready||!(signal instanceof AbortSignal)||signal.aborted)fail();const t=tuple(value),c=context(ctx),args={p_identity:IDENTITY,p_key:t.key,p_sha256:t.sha256,p_type:t.contentType,p_size:t.size,p_attempt:t.attemptId,p_request_sha256:c.requestSha256,p_lease_sha256:c.leaseSha256,p_source_path_sha256:c.sourcePathSha256,p_snapshot:c.snapshotId,p_gateway_nonce:c.gatewayNonce};
  const r=await transport(RPC,{method:'POST',redirect:'manual',cache:'no-store',signal,headers:{apikey:serviceKey,'content-type':'application/json','cache-control':'no-store'},body:JSON.stringify(args)});
  if(signal.aborted||!(r instanceof Response)||r.status!==200||r.redirected||r.headers.has('location')||r.url&&r.url!==RPC||!/^application\/json(?:\s*;|$)/i.test(r.headers.get('content-type')||'')||r.headers.has('age')&&r.headers.get('age')!=='0'||['cf-cache-status','x-vercel-cache'].some(k=>/^(HIT|STALE|UPDATING)$/i.test(r.headers.get(k)||'')))fail();
  const body=await boundedBody(r,2048,signal);if(signal.aborted)fail();return projection(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(body)),t,c);
 }});
}
module.exports=Object.freeze({createWindowDispatchRepositoryV2});
