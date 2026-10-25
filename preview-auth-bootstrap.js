/* LOCAL REVIEW ONLY. No permission to execute hosted auth is implied.
 * Run only on the exact Preview's static404 in the intended isolated profile.
 * Callback must be handled privately: tools may record its URL before this script.
 */
(async()=>{
'use strict';
const ORIGIN='https://rack-relic-git-preview-photo-delivery-boundary-rack-relic.vercel.app';
const CALLBACK=ORIGIN+'/404.html',STAGE='https://zvtaqzcqfdjpuwnlpzln.supabase.co';
const KEY='sb-zvtaqzcqfdjpuwnlpzln-auth-token',LEDGER='rr-preview-auth-bootstrap-v1';
const FIXTURES=Object.freeze({buyer:{emailHash:'af835472b5f3be60a5e8d5b991b9362b4addde8fb54b58e00e2ad1e4cd5ffd21',idHash:'381c3ec4f39ec351380797c01245157ff6e30d381fbc7e9b94ebc028a671ee6b'},seller:{emailHash:'247227d47b4c7a2374aa6752f7baa052a3b5fdc537ed5fc5f2cdc68c8c49082a',idHash:'00c21e427ef3019a35cf92e275de7af132d738e838cc8b9233811b60bb7c3375'}});
let blockedRequest=null;
let requestedEmail=null;
const digest=async value=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(v=>v.toString(16).padStart(2,'0')).join('');
let callback=false,halted=false,reason=null,phase='setup',marker=null,identityVerified=false,lastWritten=null,client=null,requestActive=false,ledgerTrusted=false;
const nativeFetch=window.fetch.bind(window);
function clearCallback(){if(!callback)return true;try{history.replaceState(null,'',CALLBACK);return !location.hash&&!location.search}catch{return false}}
// Diagnostic only: never forward/log a blocked URL, query, headers, body or raw stack.
function safeRequestLocation(input){
 try{
  const raw=typeof input==='string'?input:input instanceof URL?String(input):input?.url;
  if(typeof raw!=='string')return {host:'unclassified',path:'unclassified'};
  const url=new URL(raw,ORIGIN);
  const hosts=new Set([new URL(ORIGIN).hostname,new URL(STAGE).hostname,'vercel.live','vercel.com','cdn.jsdelivr.net']);
  if(!['https:','http:'].includes(url.protocol)||!hosts.has(url.hostname))return {host:'unclassified',path:'redacted'};
  const exact=new Set(['/404.html','/preview-auth-bootstrap.js','/staging-config.js','/favicon.ico','/auth/v1/otp','/auth/v1/user','/auth/v1/token','/auth/v1/signup','/auth/v1/logout','/auth/v1/verify']);
  if(exact.has(url.pathname))return {host:url.hostname,path:url.pathname};
  const parts=new Set(['api','live','state','toolbar','feedback','feedback.js','favicon.ico','_next','_next-live','_vercel','insights','speed-insights','script.js','reload','config','flags','init','notifications','activity','deployment','v1','v2','v3','auth','user','token','verify','otp','session','ping','health','register','events','stream']);
  return {host:url.hostname,path:url.pathname.split('/').map(part=>part===''?'':parts.has(part)?part:'<redacted>').join('/')};
 }catch{return {host:'unclassified',path:'redacted'}}
}
function captureBlocked(input,options){
 let method='UNKNOWN';try{const m=String(options?.method||input?.method||'GET').toUpperCase();if(['GET','HEAD','POST','PUT','PATCH','DELETE','OPTIONS'].includes(m))method=m}catch{}
 const initiators=[];
 for(const raw of (new Error('blocked request').stack||'').match(/https?:\/\/[^\s)]+/g)||[]){
  const item=safeRequestLocation(raw.replace(/:\d+:\d+$/,''));
  if(item.host!=='unclassified'&&item.path!=='/preview-auth-bootstrap.js'&&!initiators.some(x=>x.host===item.host&&x.path===item.path))initiators.push(item);
 }
 const record={time:new Date().toISOString(),method,...safeRequestLocation(input),initiators:initiators.slice(0,3),phase,nativeFetchInvoked:false};
 if(!blockedRequest)blockedRequest=record;
 return record;
}
function stop(code){halted=true;reason=reason||code;clearCallback();throw Error('PREVIEW_AUTH_STOP')}
function require(ok,code){if(!ok)stop(code)}
function save(){if(marker&&ledgerTrusted)localStorage.setItem(LEDGER,JSON.stringify(marker))}
function summary(status){const target=document.getElementById?.('preview-auth-status');if(target)target.textContent='Staging authentication: '+status+'.';return {status,reason,blockedRequest,role:typeof marker?.role==='string'&&Object.hasOwn(FIXTURES,marker.role)?marker.role:null,emailAttempts:ledgerTrusted?marker.emailAttempts:0,controlledAuthRequests:ledgerTrusted?marker.requests:0,verificationNavigationReserved:ledgerTrusted?marker.verifyReserved:0}}
function settleError(){if(marker&&ledgerTrusted){marker.state='stopped';save()}return summary('stopped')}
function existing(){return localStorage.getItem(KEY)!==null||localStorage.getItem(KEY+'-user')!==null}
async function bounded(action){let timer;try{return await Promise.race([action(),new Promise((_,reject)=>{timer=setTimeout(()=>{halted=true;reason=reason||'auth-deadline';clearCallback();reject(Error('PREVIEW_AUTH_STOP'))},12000)})])}finally{clearTimeout(timer)}}
try{
 require(location.origin===ORIGIN&&location.pathname==='/404.html','wrong-origin-or-page');
 callback=Boolean(location.hash);require(!location.search,'unexpected-callback-query');
 const scripts=[...document.querySelectorAll('script')];
 require(window===window.top&&!document.querySelector('iframe,img,form')&&scripts.every(s=>(s===document.currentScript&&s.src===ORIGIN+'/preview-auth-bootstrap.js')||s.src==='https://vercel.live/_next-live/feedback/feedback.js')&&scripts.filter(s=>s===document.currentScript).length<=1&&!navigator.serviceWorker?.controller&&!window.RRPreviewAuth,'page-not-isolated');
 require(!existing(),'existing-session-no-overwrite');
 const saved=localStorage.getItem(LEDGER);
 if(saved){try{marker=JSON.parse(saved)}catch{stop('ledger-malformed')}
  require(marker&&marker.version===1&&typeof marker.role==='string'&&Object.hasOwn(FIXTURES,marker.role)&&Number.isInteger(marker.requests)&&marker.requests>=0&&marker.requests<=4&&marker.emailAttempts===1&&Object.keys(marker).every(k=>['version','role','state','requests','emailAttempts','verifyReserved','callbackAttempted','otpSent','callbackUserSent','identityUserSent'].includes(k)),'ledger-invalid');ledgerTrusted=true;
 }
 if(callback){require(marker?.state==='email-requested'&&marker.requests===1&&marker.otpSent===true&&marker.verifyReserved===0&&!marker.callbackAttempted,'callback-not-admitted');marker.callbackAttempted=true;marker.verifyReserved=1;marker.state='callback-started';save()}
 else require(!marker,'previous-attempt-no-retry');
 // This document has no app timers/listeners. Other tabs remain an operator gate.
 window.fetch=async(input,options)=>{
  const record=captureBlocked(input,options);
  // Observed Toolbar GET remains denied; it cannot poison the controlled Auth flow.
  if(record.method==='GET'&&record.host===new URL(ORIGIN).hostname&&record.initiators.some(x=>x.host==='vercel.live'&&x.path==='/_next-live/feedback/feedback.js'))throw Error('PREVIEW_PLATFORM_REQUEST_BLOCKED');
  return stop('unexpected-background-fetch');
 };
 for(const name of ['XMLHttpRequest','WebSocket','EventSource'])window[name]=class{constructor(){stop('unexpected-network')}};
 Object.defineProperty(navigator,'sendBeacon',{configurable:true,value:()=>stop('unexpected-network')});
 async function asset(src){await new Promise((resolve,reject)=>{const script=document.createElement('script');script.src=src;script.onload=resolve;script.onerror=()=>reject(Error('ASSET_UNAVAILABLE'));document.head.append(script)})}
 await asset('/staging-config.js');
 const cfg=window.RACK_RELIC_STAGING_CONFIG;
 require(cfg?.url===STAGE&&typeof cfg.publicKey==='string'&&/^sb_publishable_[A-Za-z0-9_-]+$/.test(cfg.publicKey),'wrong-staging-config');
 await asset('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2');
 require(typeof window.supabase?.createClient==='function','sdk-unavailable');
 const storage={getItem(key){require(key===KEY||key===KEY+'-user','unexpected-storage-key');return localStorage.getItem(key)},
  setItem(key,value){require(!halted&&callback&&identityVerified&&(key===KEY||key===KEY+'-user'),'session-write-not-admitted');require(localStorage.getItem(KEY)===lastWritten,'session-changed-elsewhere');localStorage.setItem(key,value);if(key===KEY)lastWritten=value},
  removeItem(){stop('session-removal-not-admitted')}};
 async function authFetch(input,options={}){
  require(!halted&&!requestActive&&marker,'unexpected-or-concurrent-auth');
  const url=new URL(typeof input==='string'||input instanceof URL?String(input):input.url);
  const method=(options.method||'GET').toUpperCase();const userPhase=phase==='callback-init'||phase==='identity-check';
  require(url.origin===STAGE&&!url.username&&!url.password&&!url.hash,'wrong-auth-origin');
  if(phase==='email-request'){
   require(method==='POST'&&url.pathname==='/auth/v1/otp'&&url.searchParams.size===1&&url.searchParams.get('redirect_to')===CALLBACK&&!marker.otpSent,'unexpected-email-request');
   let body;try{body=JSON.parse(options.body)}catch{stop('email-body-invalid')}
   require(body.email===requestedEmail&&body.create_user===false&&!body.phone&&!body.password&&!body.code_challenge&&!body.code_challenge_method,'email-or-signup-mismatch');
   marker.otpSent=true;
  }else{
   require(userPhase&&method==='GET'&&url.pathname==='/auth/v1/user'&&!url.search,'refresh-or-auth-route-forbidden');
   const flag=phase==='callback-init'?'callbackUserSent':'identityUserSent';require(!marker[flag],'identity-retry-forbidden');marker[flag]=true;
   // SDK has captured callback parameters before requesting user validation.
   require(clearCallback(),'callback-url-clear-failed');
  }
  require(marker.requests+(marker.verifyReserved||0)<4,'auth-budget-exhausted');marker.requests++;save();
  requestActive=true;const abort=new AbortController();const timer=setTimeout(()=>abort.abort(),10000);
  try{
   const response=await nativeFetch(input,{...options,signal:abort.signal,redirect:'error',cache:'no-store'});
   if(!response.ok){reason=response.status===429?'provider-rate-limit-no-resend':'provider-auth-rejected';halted=true;clearCallback();return new Response(JSON.stringify({message:'Staging authentication stopped',code:'bootstrap_stopped'}),{status:response.status,headers:{'Content-Type':'application/json'}})}
   if(userPhase){let data;try{data=await response.clone().json()}catch{stop('identity-response-invalid')}
    const expected=FIXTURES[marker.role];require(typeof data?.id==='string'&&typeof data.email==='string'&&await digest(data.id)===expected.idHash&&await digest(data.email.toLowerCase())===expected.emailHash,'wrong-verified-identity');identityVerified=true;
   }
   return response;
  }finally{clearTimeout(timer);requestActive=false}
 }
 function makeClient(){return window.supabase.createClient(STAGE,cfg.publicKey,{global:{fetch:authFetch},auth:{persistSession:true,autoRefreshToken:false,detectSessionInUrl:callback,flowType:'implicit',storage,debug:false,logger:()=>{}}})}
 if(callback){
  phase='callback-init';client=makeClient();
  const restored=await bounded(()=>client.auth.getSession());
  require(!halted&&!restored.error&&restored.data?.session&&identityVerified,'callback-session-not-confirmed');
  phase='identity-check';const verified=await bounded(()=>client.auth.getUser());
  require(!halted&&!verified.error&&typeof verified.data?.user?.id==='string'&&typeof verified.data.user.email==='string'&&await digest(verified.data.user.id)===FIXTURES[marker.role].idHash&&await digest(verified.data.user.email.toLowerCase())===FIXTURES[marker.role].emailHash,'final-identity-not-confirmed');
  marker.state='complete';save();clearCallback();
  window.RRPreviewAuth=Object.freeze({status:()=>summary('complete')});
  return summary('complete');
 }
 window.RRPreviewAuth=Object.freeze({
  async start(role,email){
   try{
    require(!halted&&phase==='setup'&&!marker&&Object.hasOwn(FIXTURES,role)&&!existing(),'email-start-not-admitted');
    require(typeof email==='string'&&await digest(email.trim().toLowerCase())===FIXTURES[role].emailHash,'unapproved-recipient');requestedEmail=email.trim().toLowerCase();
    marker={version:1,role,state:'starting',requests:0,emailAttempts:1,verifyReserved:0,callbackAttempted:false};ledgerTrusted=true;save();
    phase='email-preflight';client=makeClient();const current=await bounded(()=>client.auth.getSession());
    require(!halted&&!current.error&&current.data&&current.data.session===null&&!existing(),'signed-out-not-confirmed');
    phase='email-request';const result=await bounded(()=>client.auth.signInWithOtp({email:requestedEmail,options:{shouldCreateUser:false,emailRedirectTo:CALLBACK}}));
    require(!halted&&!result.error&&marker.otpSent,'email-request-not-confirmed');marker.state='email-requested';save();phase='waiting';return summary('email-requested');
   }catch{return settleError()}
  },status:()=>summary(halted?'stopped':marker?.state||'ready')
 });
 return summary('ready-no-email-sent');
}catch{clearCallback();return settleError()}
finally{if(halted)clearCallback()}
})()
