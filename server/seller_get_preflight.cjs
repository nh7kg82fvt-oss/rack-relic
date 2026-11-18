'use strict';
// PRIVATE SOURCE PREPARATION ONLY. No I/O on import or construction. No app mount.
// An injected transport and a future separately approved restricted TEST key are required.
// This observer cannot grant a seller action, bind an account, or prove future POST behavior.
const {budget,request,sha}=require('./private-practice/practice_io.cjs');
const ACCOUNT='acct_1UXdWBGppSOhWnq8',API_VERSION='2026-10-28.endive',ORIGIN='https://api.stripe.com';
const LIST_PATH='/v2/core/accounts?limit=1&applied_configurations%5B0%5D=recipient';
const PATHS=Object.freeze(['/v1/account','/v1/balance',LIST_PATH,'/v1/account','/v1/balance']);
const LIMIT_MS=5000,MAX_BYTES=65536;
class SellerGetPreflightHeld extends Error{
 constructor(code,evidence=[]){super('Seller GET-only response preflight is held');this.name='SellerGetPreflightHeld';this.code=code;this.evidence=Object.freeze([...evidence]);}
}
function options(raw){
 if(!raw||Object.getPrototypeOf(raw)!==Object.prototype)return null;
 const out={};for(const k of Reflect.ownKeys(raw)){
  const d=Object.getOwnPropertyDescriptor(raw,k);
  if(typeof k!=='string'||!['enabled','secretKey','fetchImpl','clock','monotonicClock'].includes(k)||!d||!Object.hasOwn(d,'value')||!d.enumerable)return null;
  out[k]=d.value;
 }return out;
}
function createSellerGetPreflight(raw={}){
 const cfg=options(raw),clock=cfg?.clock??Date.now,mono=cfg?.monotonicClock??(()=>performance.now());
 let key=cfg?.secretKey??null,transport=cfg?.fetchImpl??null,closed=false,used=false,active=null;
 const ready=cfg?.enabled===true&&typeof key==='string'&&/^rk_test_[A-Za-z0-9]{1,200}$/.test(key)&&
  typeof transport==='function'&&typeof clock==='function'&&typeof mono==='function'&&typeof window==='undefined';
 // Drop the copied option references; this does not erase caller-owned JS strings.
 if(cfg){cfg.secretKey=null;cfg.fetchImpl=null;}raw=null;
 return Object.freeze({ready,async run(signal){
  if(!ready||closed||used||!(signal instanceof AbortSignal)||signal.aborted)throw new SellerGetPreflightHeld('not_available');
  // One local execution only, including failed/unknown reads. Never retries or creates.
  used=true;const evidence=[],requestIds=new Set();let scope,index=0;
  const hold=code=>{throw new SellerGetPreflightHeld(code,evidence);};
  try{
   scope=budget(signal,clock,mono,LIMIT_MS);active=scope;
   const guardedFetch=async(url,init)=>{
    const expected=ORIGIN+PATHS[index];
    if(index>=PATHS.length||url!==expected||init?.method!=='GET'||Object.hasOwn(init,'body')||
     init.headers?.Authorization!=='Bearer '+key||init.headers['Stripe-Version']!==API_VERSION||
     init.headers['Accept-Encoding']!=='identity'||['Stripe-Account','Stripe-Context','Idempotency-Key'].some(k=>Object.hasOwn(init.headers,k)))hold('request_boundary');
    index++;scope.check();const response=await scope.wait(Promise.resolve().then(()=>transport(url,init)));const observedAt=scope.check();
    if(response?.status!==200||response.ok!==true||response.url!==url||response.redirected!==false||typeof response.headers?.get!=='function')hold('response_boundary');
    // Read the ACTUAL response object. Never add a version/header or rebuild a Response.
    const h=response.headers,stamp=Date.parse(h.get('date')||''),version=h.get('stripe-version'),requestId=h.get('request-id');
    const validRequestId=typeof requestId==='string'&&/^req_[A-Za-z0-9]{1,200}$/.test(requestId),dateWithin30s=Number.isFinite(stamp)&&Math.abs(stamp-observedAt)<=30000;
    const observation={method:'GET',path:PATHS[index-1],observedAt,
     stripeVersion:version===API_VERSION?API_VERSION:version===null?null:'UNEXPECTED',
     requestId:validRequestId?requestId:null,dateWithin30s};
    evidence.push(observation);
    if(version!==API_VERSION)hold('returned_version');
    if(!dateWithin30s)hold('returned_date');
    if(!validRequestId||requestIds.has(requestId))hold('request_id');requestIds.add(requestId);
    return response;
   };
   const read=async path=>{
    let out;try{
     out=await request(guardedFetch,ORIGIN+path,{method:'GET',headers:{Authorization:'Bearer '+key,'Stripe-Version':API_VERSION}},scope,MAX_BYTES);
     scope.check();const observation=evidence.at(-1);observation.responseBytes=out.bytes.length;observation.responseSha256=sha(out.bytes);
     return out.value;
    }finally{out?.bytes.fill(0);}
   };
   const identity=async()=>{
    const a=await read('/v1/account');
    if(a.object!=='account'||a.id!==ACCOUNT||Object.hasOwn(a,'livemode')&&a.livemode!==false)hold('platform_identity');
    const b=await read('/v1/balance');if(b.object!=='balance'||b.livemode!==false)hold('platform_mode');
   };
   await identity();const list=await read(LIST_PATH);
   if(!list||typeof list!=='object'||Array.isArray(list)||Object.keys(list).some(k=>!['data','next_page_url','previous_page_url'].includes(k))||!Array.isArray(list.data)||list.data.length>1)hold('list_shape');
   for(const k of ['next_page_url','previous_page_url'])if(Object.hasOwn(list,k)&&list[k]!==null&&(typeof list[k]!=='string'||list[k].length>2048||!list[k].startsWith('/v2/core/accounts?')))hold('list_shape');
   for(const a of list.data)if(!a||a.object!=='v2.core.account'||typeof a.id!=='string'||!/^acct_[A-Za-z0-9]{1,200}$/.test(a.id)||a.id===ACCOUNT||a.livemode!==false||!Array.isArray(a.applied_configurations)||!a.applied_configurations.includes('recipient'))hold('list_mode');
   const returnedItemCount=list.data.length,nextPagePresent=typeof list.next_page_url==='string';
   await identity();scope.check();if(index!==PATHS.length)hold('incomplete');
   return Object.freeze({kind:'seller-get-response-preflight-v1',sourceOnly:true,accountId:ACCOUNT,mode:'test',
    returnedItemCount,nextPagePresent,pagesRead:1,inventoryComplete:false,nativeExecutionVerified:false,
    sellerReadinessVerified:false,actionGrant:false,futurePostHeaderOrTimingGuaranteed:false,rawBodiesPersisted:false,
    observations:Object.freeze(evidence.map(v=>Object.freeze({...v})))});
  }catch(error){
   if(error instanceof SellerGetPreflightHeld)throw new SellerGetPreflightHeld(error.code,evidence.map(v=>Object.freeze({...v})));
   throw new SellerGetPreflightHeld('wire_held',evidence.map(v=>Object.freeze({...v})));
  }finally{scope?.close();active=null;key=null;transport=null;closed=true;}
 },close(){closed=true;active?.close();key=null;transport=null;}});
}
module.exports=Object.freeze({createSellerGetPreflight,SellerGetPreflightHeld,ACCOUNT,API_VERSION,LIST_PATH,
 PROFILE:Object.freeze({sourceOnly:true,defaultEnabled:false,appImported:false,providerWrites:false,sqlOrAuthCalls:false,
  getMaximum:5,pagesMaximum:1,totalTimeoutMs:LIMIT_MS,maximumResponseBytes:MAX_BYTES,
  automaticRetries:false,approvalOrCredentialSupplied:false,nativeProviderExecutionVerified:false})});
