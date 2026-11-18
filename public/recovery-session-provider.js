'use strict';
(function(root,factory){
 const api=factory();
 if(typeof module==='object'&&module.exports)module.exports=api;
 else root.RackRecoverySessionProvider=api;
})(globalThis,function(){
 const PROJECT='xkxolhgafjadpknsfqqw',AUTH='https://'+PROJECT+'.supabase.co/auth/v1';
 const FORBIDDEN=new Set(['https://rackrelic.com','https://www.rackrelic.com','https://rack-relic-git-codex-prelaunch-seller-protections-rack-relic.vercel.app','https://rack-relic-git-test-only-marketplace-foundation-rack-relic.vercel.app']);
 const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
 const inputOwners=new WeakMap();
 const id=v=>typeof v==='string'&&UUID.test(v)&&v!=='00000000-0000-0000-0000-000000000000';
 class Held extends Error{constructor(){super('Recovered sign-in remains held');}}
 const hold=()=>{throw new Held();};
 function exact(value,keys){
  if(!value||Object.getPrototypeOf(value)!==Object.prototype||Reflect.ownKeys(value).length!==keys.length)hold();
  const result={};for(const key of keys){const d=Object.getOwnPropertyDescriptor(value,key);if(!d||!Object.hasOwn(d,'value')||!d.enumerable)hold();result[key]=d.value;}return result;
 }
 function enrollment(value,window){
  const e=exact(value,['version','projectRef','ownerId','email','origin','notBefore','expiresAt']);
  if(e.version!=='rr-recovery-session-enrollment-v1'||e.projectRef!==PROJECT||!id(e.ownerId)||typeof e.email!=='string'||e.email.length>254||!/^\S+@\S+\.\S+$/.test(e.email)||e.email!==e.email.trim().toLowerCase()||!Number.isSafeInteger(e.notBefore)||!Number.isSafeInteger(e.expiresAt)||e.notBefore<0||e.expiresAt<=e.notBefore||e.expiresAt-e.notBefore>900000)hold();
  const u=new URL(e.origin);if(typeof e.origin!=='string'||u.origin!==e.origin||u.protocol!=='https:'||u.username||u.password||u.port||!u.hostname.includes('.')||FORBIDDEN.has(e.origin)||window.location?.origin!==e.origin)hold();
  return Object.freeze(e);
 }
 function targetGrant(token){
  if(typeof token!=='string'||token.length>8192||!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token))hold();
  const part=token.split('.')[1],binary=atob(part.replace(/-/g,'+').replace(/_/g,'/'));if(binary.length>6144)hold();
  const c=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Uint8Array.from(binary,x=>x.charCodeAt(0))));
  // Claims only restrict use; fresh GetUser and the recovery server verify identity.
  if(!c||Object.getPrototypeOf(c)!==Object.prototype||c.iss!==AUTH||c.aud!=='authenticated'||c.role!=='authenticated'||c.is_anonymous!==false||!id(c.sub)||!id(c.session_id)||!Number.isSafeInteger(c.exp)||c.exp<=0||c.exp>9007199254740||!Number.isSafeInteger(c.iat)||c.iat<=0||c.iat>9007199254740)hold();
  return {accessToken:token,member:c.sub,sessionRef:c.session_id,expiresAt:c.exp*1000,issuedAt:c.iat*1000};
 }
 function uncached(headers){
  if(!headers?.get||headers.get('location')!==null)hold();const age=headers.get('age');if(age!==null&&age!=='0')hold();
  for(const n of ['x-cache','cf-cache-status','x-vercel-cache']){const v=headers.get(n);if(v!==null&&!['MISS','BYPASS','DYNAMIC'].includes(v.toUpperCase()))hold();}
  // Auth does not promise a response cache directive; outbound requests remain no-store.
  const cc=headers.get('cache-control')||'';if(/\b(?:public|immutable|stale-if-error|stale-while-revalidate)\b/i.test(cc)||cc.split(',').some(v=>/\b(?:s-maxage|max-age)\b/i.test(v)&&!/^\s*(?:s-maxage|max-age)\s*=\s*(?:0|"0")\s*$/i.test(v)))hold();
 }
 // A CORS-hidden Date supplies no timestamp proof; visible dates still restrict use.
 function fresh(response,now){if(!Number.isSafeInteger(now))hold();const raw=response?.headers?.get('date');if(raw===null)return;const date=Date.parse(raw||'');if(!Number.isFinite(date)||Math.abs(date-now)>30000)hold();}
 function responseMetadata(response,url){
  if(response?.status!==200||response.url!==url||response.redirected!==false||!response.headers?.get||!response.body?.getReader||!/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type')||''))hold();
  uncached(response.headers);
  // Browser streams are already decoded; wire length/encoding cannot prove decoded size.
  const length=response.headers.get('content-length');if(length!==null&&(!/^(0|[1-9][0-9]*)$/.test(length)||Number(length)>65536))hold();
 }
 async function raceAbort(p,signal){
  let listener;try{return await Promise.race([p,new Promise((_,reject)=>{listener=()=>reject(new Held());signal.addEventListener('abort',listener,{once:true});if(signal.aborted)listener();})]);}
  finally{signal.removeEventListener('abort',listener);}
 }
 async function json(response,url,timeoutMs){
  responseMetadata(response,url);const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs),reader=response.body.getReader(),parts=[];let size=0;
  try{
   for(;;){const n=await raceAbort(reader.read(),controller.signal);if(n.done)break;if(!(n.value instanceof Uint8Array)||(size+=n.value.length)>65536)hold();parts.push(new Uint8Array(n.value));}
   const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length;}
   try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}finally{bytes.fill(0);}
  }finally{clearTimeout(timer);parts.forEach(p=>p.fill(0));try{Promise.resolve(reader.cancel()).catch(()=>{});}catch{}}
 }
 function createRecoverySessionProvider({document,window,passwordInput,enabled=false,enrollment:trustedEnrollment=null,publishableKey=null,fetchImpl=null,clock=Date.now,monotonicClock=()=>performance.now(),timeoutMs=10000}={}){
  let config=null;
  try{if(enabled===true&&typeof fetchImpl==='function'&&typeof clock==='function'&&typeof monotonicClock==='function'&&Number.isSafeInteger(timeoutMs)&&timeoutMs>=1&&timeoutMs<=15000&&typeof publishableKey==='string'&&/^sb_publishable_[A-Za-z0-9_-]{20,200}$/.test(publishableKey)&&passwordInput?.tagName==='INPUT'&&passwordInput.type==='password'&&passwordInput.ownerDocument===document)config=enrollment(trustedEnrollment,window);}catch{}
  const configured=config!==null,instance=Object.freeze({});let used=false,destroyed=false,epoch=0,active=null,retained=null,expiryTimer=null,lifetimeSignal=null,lifetimeAbort=null,cleanup='no_session',cleanupPromise=null,cleanupStarted=false;
  if(config)inputOwners.set(passwordInput,instance);
  const ownsInput=()=>inputOwners.get(passwordInput)===instance;
  const clearInput=()=>{try{if(ownsInput())passwordInput.value='';}catch{}};
  const status=()=>Object.freeze({status:cleanup});
  function foreground(){return !destroyed&&document?.hidden!==true&&document?.visibilityState!=='hidden'&&(typeof document?.hasFocus!=='function'||document.hasFocus());}
  async function clean(candidate){
   if(cleanupStarted)return cleanupPromise??status();
   cleanupStarted=true;retained=null;cleanup='unconfirmed';
   const controller=new AbortController(),limit=Math.min(timeoutMs,5000),started=clock(),mono=monotonicClock(),timer=setTimeout(()=>controller.abort(),limit);
   cleanupPromise=(async()=>{
    try{
     const url=AUTH+'/logout?scope=local';
     const check=()=>{const now=clock(),elapsed=monotonicClock()-mono;if(controller.signal.aborted||!Number.isSafeInteger(started)||!Number.isSafeInteger(now)||now<started||now-started>=limit||!Number.isFinite(mono)||!Number.isFinite(elapsed)||elapsed<0||elapsed>=limit)hold();};
     const r=await raceAbort(Promise.resolve().then(()=>{check();return fetchImpl(url,{method:'POST',credentials:'omit',cache:'no-store',redirect:'error',signal:controller.signal,headers:{apikey:publishableKey,Authorization:'Bearer '+candidate.accessToken}});}),controller.signal);check();
     if(r?.status!==204||r.url!==url||r.redirected!==false||!r.headers?.get)hold();uncached(r.headers);fresh(r,clock());
     cleanup='confirmed';
    }catch{cleanup='unconfirmed';}
    finally{clearTimeout(timer);controller.abort();candidate=null;}
    return status();
   })();return cleanupPromise;
  }
  function dropLifetime(){lifetimeSignal?.removeEventListener('abort',lifetimeAbort);lifetimeSignal=null;lifetimeAbort=null;}
  async function release(){epoch++;active?.abort();active=null;clearTimeout(expiryTimer);expiryTimer=null;dropLifetime();clearInput();const candidate=retained;retained=null;if(candidate)return clean(candidate);return cleanupPromise??status();}
  async function acquire({signal}={}){
   if(!config||destroyed||used||!foreground()||!ownsInput())hold();
   const started=clock(),mono=monotonicClock();
   if(!Number.isSafeInteger(started)||started<config.notBefore||started>=config.expiresAt||!Number.isFinite(mono)||signal?.aborted)hold();
   used=true;const version=++epoch,controller=new AbortController();active=controller;
   const onAbort=()=>{controller.abort();if(retained){void release();}};signal?.addEventListener('abort',onAbort,{once:true});lifetimeSignal=signal;lifetimeAbort=onAbort;
   const timer=setTimeout(onAbort,Math.min(timeoutMs,config.expiresAt-started));let requestBody=null,candidate=null;
   const check=()=>{const now=clock(),elapsed=monotonicClock()-mono;const known=candidate||retained;if(version!==epoch||!foreground()||controller.signal.aborted||!Number.isSafeInteger(now)||now<started||now<config.notBefore||now>=config.expiresAt||now-started>=timeoutMs||!Number.isFinite(elapsed)||elapsed<0||elapsed>=timeoutMs||known&&(known.expiresAt<=now||known.issuedAt>now+30000))hold();return now;};
   const task=(async()=>{
    try{
     check();let password;try{password=passwordInput.value;if(typeof password!=='string'||!password||password.length>1024)hold();requestBody=JSON.stringify({email:config.email,password});}finally{password=null;clearInput();}
     check();cleanup='unconfirmed';
     const url=AUTH+'/token?grant_type=password';
     // If fetch ignores cancellation, only a bounded late response inspection
     // and one local cleanup may follow. A late token can never be handed out.
     let request;try{request=fetchImpl(url,{method:'POST',credentials:'omit',cache:'no-store',redirect:'error',signal:controller.signal,headers:{apikey:publishableKey,'Content-Type':'application/json',Accept:'application/json'},body:requestBody});}finally{requestBody=null;}
     const r=await request;
     let reply=await json(r,url,timeoutMs);
     try{candidate=targetGrant(reply?.access_token);delete reply.refresh_token;
      if(reply.token_type!=='bearer'||reply.user?.id!==candidate.member||reply.user?.email?.toLowerCase()!==config.email)hold();
      // This restricts the one new grant; fresh GetUser and server session checks remain authoritative.
      const now=check();if(candidate.issuedAt<started-30000||candidate.issuedAt>now+30000||candidate.expiresAt<=now)hold();
      if(Object.hasOwn(reply,'expires_at')&&(!Number.isSafeInteger(reply.expires_at)||reply.expires_at*1000!==candidate.expiresAt))hold();
      if(Object.hasOwn(reply,'expires_in')&&(!Number.isSafeInteger(reply.expires_in)||reply.expires_in<=0||Math.abs(reply.expires_in*1000-(candidate.expiresAt-now))>30000+timeoutMs+1000))hold();
     }finally{reply=null;}
     const now=check();fresh(r,now);if(candidate.member!==config.ownerId)hold();
     const userUrl=AUTH+'/user';
     const userResponse=await raceAbort(Promise.resolve().then(()=>{check();return fetchImpl(userUrl,{method:'GET',credentials:'omit',cache:'no-store',redirect:'error',signal:controller.signal,headers:{apikey:publishableKey,Authorization:'Bearer '+candidate.accessToken,Accept:'application/json'}});}),controller.signal);
     fresh(userResponse,check());let user=await raceAbort(json(userResponse,userUrl,timeoutMs),controller.signal);
     try{check();if(user?.id!==config.ownerId||user.email?.toLowerCase()!==config.email||user.aud!=='authenticated'||user.role!=='authenticated'||user.is_anonymous!==false||!user.email_confirmed_at||user.deleted_at!=null||user.banned_until!=null&&(!Number.isFinite(Date.parse(user.banned_until))||Date.parse(user.banned_until)>clock()))hold();}finally{user=null;}
     check();retained=candidate;candidate=null;expiryTimer=setTimeout(()=>{void release();},Math.max(1,Math.min(retained.expiresAt,config.expiresAt)-clock()));expiryTimer.unref?.();return Object.freeze({accessToken:retained.accessToken});
    }catch{if(candidate)await clean(candidate);throw new Held();}
    finally{requestBody=null;clearInput();}
   })();
   try{return await raceAbort(task,controller.signal);}catch{if(retained){const token=retained;retained=null;await clean(token);}throw new Held();}
   finally{clearTimeout(timer);controller.abort();if(!retained)dropLifetime();if(active===controller)active=null;}
  }
  const hide=()=>{void release();},visibility=()=>{if(document?.hidden===true||document?.visibilityState==='hidden')hide();};
  const listeners=[];
  if(config){
   try{if(typeof window.addEventListener!=='function'||typeof window.removeEventListener!=='function'||typeof document.addEventListener!=='function'||typeof document.removeEventListener!=='function')hold();for(const name of ['pagehide','blur']){window.addEventListener(name,hide);listeners.push([window,name,hide]);}document.addEventListener('visibilitychange',visibility);listeners.push([document,'visibilitychange',visibility]);}
   catch{config=null;if(ownsInput())inputOwners.delete(passwordInput);for(const [target,name,fn]of listeners)target.removeEventListener(name,fn);listeners.length=0;}
  }
  return Object.freeze({configured:configured&&config!==null,acquire,release,cleanupStatus:status,async destroy(){destroyed=true;for(const[target,name,fn]of listeners)target.removeEventListener(name,fn);listeners.length=0;const pending=release();if(ownsInput())inputOwners.delete(passwordInput);await pending;}});
 }
 return Object.freeze({createRecoverySessionProvider,PROJECT});
});
