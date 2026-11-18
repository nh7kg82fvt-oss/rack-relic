'use strict';
// SOURCE ONLY, default OFF/unimported. Fixed EXISTING recovered database only.
// The supplied server key retains its actual provider powers; this adapter's
// finite read transport does not make that credential globally read-only.
const {createCommandOwnerSessionReader,OwnerSessionError,PROJECT,RPC:SESSION_RPC}=require('./recovery_owner_session_reader.cjs');
const {sanitizeAdminSnapshot}=require('../vendor/pinned_admin_snapshot.cjs');
const PATH='/api/recovery-readonly',READ_RPC='rr_test_admin_overview';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const SOURCE_ORIGINS=new Set(['https://rack-relic-git-codex-prelaunch-seller-protections-rack-relic.vercel.app','https://rack-relic-git-test-only-marketplace-foundation-rack-relic.vercel.app','https://rackrelic.com','https://www.rackrelic.com']);
const id=v=>typeof v==='string'&&UUID.test(v)&&v!=='00000000-0000-0000-0000-000000000000';
class RecoveryHeld extends Error{constructor(){super('Recovered records remain held');}}
const hold=()=>{throw new RecoveryHeld();};
function exact(v,keys){if(!v||Object.getPrototypeOf(v)!==Object.prototype||Reflect.ownKeys(v).length!==keys.length)hold();const out={};for(const k of keys){const d=Object.getOwnPropertyDescriptor(v,k);if(!d||!Object.hasOwn(d,'value')||!d.enumerable)hold();out[k]=d.value;}return out;}
function enrollment(value){const e=exact(value,['version','projectUrl','ownerId','origin','branch','reviewRef']);if(e.version!=='rr-recovery-readonly-enrollment-v1'||e.projectUrl!==PROJECT||!id(e.ownerId)||typeof e.branch!=='string'||!/^codex\/[a-z0-9-]{3,80}$/.test(e.branch)||e.branch==='codex/prelaunch-seller-protections'||typeof e.reviewRef!=='string'||!/^rr-review-[A-Za-z0-9_-]{8,100}$/.test(e.reviewRef))hold();let u;try{u=new URL(e.origin);}catch{hold();}if(typeof e.origin!=='string'||u.origin!==e.origin||u.protocol!=='https:'||u.username||u.password||u.port||!u.hostname.includes('.')||SOURCE_ORIGINS.has(e.origin))hold();return Object.freeze(e);}
function uncached(h){if(!h?.get||h.get('location')!==null)hold();const age=h.get('age');if(age!==null&&age!=='0')hold();for(const n of ['x-cache','cf-cache-status','x-vercel-cache']){const x=h.get(n);if(x!==null&&!['MISS','BYPASS','DYNAMIC'].includes(x.toUpperCase()))hold();}const cc=h.get('cache-control')||'';if(/\b(?:public|immutable|stale-if-error|stale-while-revalidate)\b/i.test(cc)||cc.split(',').some(v=>/\b(?:s-maxage|max-age)\b/i.test(v)&&!/^\s*(?:s-maxage|max-age)\s*=\s*(?:0|"0")\s*$/i.test(v)))hold();}
function createRecoveryReadonlyAdapter({enabled=false,enrollment:trustedEnrollment=null,deployment=null,serverKey=null,fetchImpl=globalThis.fetch,clock=Date.now,monotonicClock=()=>performance.now()}={}){
 let config=null,closed=false;const active=new Set();
 try{if(enabled===true&&typeof window==='undefined'&&typeof fetchImpl==='function'&&typeof clock==='function'&&typeof monotonicClock==='function'&&/^sb_secret_[A-Za-z0-9_-]{20,200}$/.test(serverKey||'')){const e=enrollment(trustedEnrollment),d=exact(deployment,['kind','projectUrl','branch','origin']);if(d.kind!=='preview'||d.projectUrl!==PROJECT||d.branch!==e.branch||d.origin!==e.origin)hold();config=e;}}catch{}
 const configured=config!==null;
 async function handle(req,res){
  for(const[k,v]of Object.entries({'Cache-Control':'private, no-store, max-age=0','CDN-Cache-Control':'no-store','Vercel-CDN-Cache-Control':'no-store','Content-Type':'application/json; charset=utf-8','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','X-Robots-Tag':'noindex, nofollow'}))res.setHeader(k,v);
  const send=(status,value)=>{res.statusCode=status;res.end(JSON.stringify(value));};
  if(!config||closed){send(404,{error:'Not found'});return;}
  let u;try{u=new URL(req.url,config.origin);}catch{send(404,{error:'Not found'});return;}
  if(u.origin!==config.origin||u.pathname!==PATH||u.search||u.hash||u.username||u.password||req.headers?.host!==new URL(config.origin).host||req.headers?.origin!==undefined&&req.headers.origin!==config.origin||req.headers?.['sec-fetch-site']!==undefined&&!['same-origin','none'].includes(req.headers['sec-fetch-site'])){send(404,{error:'Not found'});return;}
  if(req.method!=='GET'){res.setHeader('Allow','GET');send(405,{error:'Method not allowed'});return;}
  // Cookies (including original Command cookies) are never read or forwarded.
  // Only a freshly verified target-issued Authorization bearer can authorize.
  if(req.headers?.['content-length']!==undefined&&req.headers['content-length']!=='0'||req.headers?.['transfer-encoding']!==undefined){send(400,{error:'Invalid recovery read'});return;}
  const controller=new AbortController(),abort=()=>controller.abort();active.add(controller);const timer=setTimeout(abort,5000);const started=clock(),mono=monotonicClock(),external=req.signal;
  if(external?.aborted)abort();else external?.addEventListener('abort',abort,{once:true});
  try{
   function check(){const now=clock(),elapsed=monotonicClock()-mono;if(controller.signal.aborted||!Number.isSafeInteger(started)||!Number.isSafeInteger(now)||now<started||now-started>=5000||!Number.isFinite(mono)||!Number.isFinite(elapsed)||elapsed<0||elapsed>=5000)hold();return now;}
   async function wait(p){check();let onAbort;try{return await Promise.race([p,new Promise((_,reject)=>{onAbort=()=>reject(new RecoveryHeld());controller.signal.addEventListener('abort',onAbort,{once:true});if(controller.signal.aborted)onAbort();})]);}finally{controller.signal.removeEventListener('abort',onAbort);}}
   async function finiteFetch(url,init){check();if(url===PROJECT+'/auth/v1/user'){if(init.method!=='GET')hold();}else if(url===PROJECT+'/rest/v1/rpc/'+SESSION_RPC){if(init.method!=='POST')hold();const b=exact(JSON.parse(init.body),['p_owner','p_actor','p_session','p_token_exp','p_nonce']);if(b.p_owner!==config.ownerId||b.p_actor!==config.ownerId||!id(b.p_session)||!id(b.p_nonce)||!Number.isSafeInteger(b.p_token_exp))hold();}else if(url===PROJECT+'/rest/v1/rpc/'+READ_RPC){if(init.method!=='POST')hold();const b=exact(JSON.parse(init.body),['p_owner','p_actor']);if(b.p_owner!==config.ownerId||b.p_actor!==config.ownerId)hold();}else hold();return wait(Promise.resolve().then(()=>{check();return fetchImpl(url,init);}));}
   const auth=createCommandOwnerSessionReader({projectUrl:PROJECT,ownerId:config.ownerId,serverKey,fetchImpl:finiteFetch,clock,monotonicClock});
   const before=await wait(auth.verify(req.headers?.authorization,{signal:controller.signal}));check();
   // Existing STABLE overview RPC has no nonce field. Session authority is
   // nonce-bound before/after; snapshot freshness uses request-start time plus
   // strict uncached transport, not an invented projection nonce guarantee.
   const readStarted=check(),url=PROJECT+'/rest/v1/rpc/'+READ_RPC;
   const response=await finiteFetch(url,{method:'POST',cache:'no-store',redirect:'error',signal:controller.signal,headers:{apikey:serverKey,'Content-Type':'application/json',Accept:'application/json','Accept-Encoding':'identity','Cache-Control':'no-store',Pragma:'no-cache'},body:JSON.stringify({p_owner:config.ownerId,p_actor:before.member})});check();
   if(response?.status!==200||response.url!==url||response.redirected!==false||!response.headers?.get||!response.body?.getReader||!/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type')||''))hold();uncached(response.headers);
   const date=Date.parse(response.headers.get('date')||''),encoding=response.headers.get('content-encoding'),length=response.headers.get('content-length');if(!Number.isFinite(date)||Math.abs(date-check())>30000||encoding!==null&&encoding.toLowerCase()!=='identity'||length!==null&&(!/^(0|[1-9][0-9]*)$/.test(length)||Number(length)>262144))hold();
   const reader=response.body.getReader(),parts=[];let size=0,raw;
   try{for(;;){const n=await wait(reader.read());check();if(n.done)break;if(!(n.value instanceof Uint8Array)||(size+=n.value.length)>262144)hold();parts.push(Buffer.from(n.value));}if(length!==null&&Number(length)!==size)hold();const bytes=Buffer.concat(parts);try{raw=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}finally{bytes.fill(0);}}finally{parts.forEach(b=>b.fill(0));try{Promise.resolve(reader.cancel()).catch(()=>{});}catch{}}
   const observed=Date.parse(raw?.observedAt||'');if(!Number.isFinite(observed)||observed<readStarted||observed>check()+1000)hold();const snapshot=sanitizeAdminSnapshot(raw,{now:check()});
   const after=await wait(auth.verify(req.headers?.authorization,{signal:controller.signal}));check();if(after.member!==before.member||after.sessionRef!==before.sessionRef||after.expiresAt!==before.expiresAt)hold();
   send(200,{version:'rr-recovery-readonly-observation-v1',projectRef:'xkxolhgafjadpknsfqqw',recoveryOnly:true,applicationWritesEnabled:false,providerWritesEnabled:false,liveClearance:false,providerFreshness:'unverified_stored_records_only',sessionRef:after.sessionRef,snapshot});
  }catch(e){send(e instanceof OwnerSessionError&&[401,403].includes(e.status)?e.status:503,{error:'Recovered records remain held'});}
  finally{clearTimeout(timer);controller.abort();active.delete(controller);external?.removeEventListener('abort',abort);}
 }
 return Object.freeze({configured,handle,close(){closed=true;config=null;serverKey=null;for(const c of active)c.abort();active.clear();}});
}
module.exports={createRecoveryReadonlyAdapter,PATH,PROJECT,READ_RPC};
