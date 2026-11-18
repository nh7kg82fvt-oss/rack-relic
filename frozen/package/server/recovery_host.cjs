'use strict';
// Private SOURCE-ONLY host. Inputs describe a future reviewed deployment; they
// are not provider attestation. Default construction is OFF and makes no I/O.
const {createRecoveryReadonlyAdapter, PROJECT, PATH}=require('./recovery_readonly_adapter.cjs');
const MAX_WINDOW_MS=15*60*1000, MAX_REQUEST_MS=5000;
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const HEADERS=Object.freeze({'Cache-Control':'private, no-store, max-age=0','CDN-Cache-Control':'no-store','Vercel-CDN-Cache-Control':'no-store','Content-Type':'application/json; charset=utf-8','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','X-Robots-Tag':'noindex, nofollow'});
class Held extends Error{constructor(){super('Recovery host remains held');}}
const hold=()=>{throw new Held();};
function exact(v,keys){if(!v||Object.getPrototypeOf(v)!==Object.prototype||Reflect.ownKeys(v).length!==keys.length)hold();const out={};for(const k of keys){const d=Object.getOwnPropertyDescriptor(v,k);if(!d||!Object.hasOwn(d,'value')||!d.enumerable)hold();out[k]=d.value;}return out;}
function configure(enrollment,deployment,now){
 const e=exact(enrollment,['version','projectUrl','ownerId','origin','branch','revision','notBefore','expiresAt','reviewRef']);
 const d=exact(deployment,['kind','projectUrl','origin','branch','revision','protection']);
 if(e.version!=='rr-recovery-host-enrollment-v1'||e.projectUrl!==PROJECT||!UUID.test(e.ownerId||'')||/^0{8}-0{4}-0{4}-0{4}-0{12}$/.test(e.ownerId)||!/^codex\/recovery-[a-z0-9][a-z0-9-]{2,60}$/.test(e.branch||'')||!/^[a-f0-9]{40}$/.test(e.revision||'')||!/^rr-review-[A-Za-z0-9_-]{8,100}$/.test(e.reviewRef||''))hold();
 const u=new URL(e.origin);
 if(u.origin!==e.origin||u.protocol!=='https:'||u.port||u.username||u.password||!/^rack-relic-git-codex-recovery-[a-z0-9-]+-rack-relic\.vercel\.app$/.test(u.hostname))hold();
 if(d.kind!=='preview'||d.projectUrl!==PROJECT||d.origin!==e.origin||d.branch!==e.branch||d.revision!==e.revision||d.protection!=='vercel-authentication')hold();
 if(!Number.isSafeInteger(now)||now<=0||!Number.isSafeInteger(e.notBefore)||!Number.isSafeInteger(e.expiresAt)||e.notBefore<=0||e.expiresAt<=e.notBefore||e.expiresAt-e.notBefore>MAX_WINDOW_MS||now<e.notBefore||now>=e.expiresAt)hold();
 return Object.freeze(e);
}
function createRecoveryHost({enabled=false,enrollment=null,deployment=null,serverKey=null,fetchImpl=globalThis.fetch,clock=Date.now,monotonicClock=()=>performance.now()}={}){
 let config=null,closed=false,lastWall=null,lastMono=null,initialWall=null,initialMono=null;
 const active=new Set();
 try{if(enabled===true&&typeof window==='undefined'&&typeof fetchImpl==='function'&&typeof clock==='function'&&typeof monotonicClock==='function'&&/^sb_secret_[A-Za-z0-9_-]{20,200}$/.test(serverKey||'')){
  initialWall=clock();initialMono=monotonicClock();if(!Number.isFinite(initialMono)||initialMono<0)hold();config=configure(enrollment,deployment,initialWall);lastWall=initialWall;lastMono=initialMono;
 }}catch{config=null;}
 const configured=config!==null;
 function close(){closed=true;config=null;serverKey=null;for(const c of active)c.abort();active.clear();}
 function check(){
  if(!config||closed)hold();const now=clock(),mono=monotonicClock();
  if(!Number.isSafeInteger(now)||now<lastWall||!Number.isFinite(mono)||mono<lastMono||now<config.notBefore||now>=config.expiresAt||mono-initialMono>=config.expiresAt-initialWall){close();hold();}
  lastWall=now;lastMono=mono;return {now,mono};
 }
 function interfaces(req,res){return req&&typeof req.on==='function'&&typeof req.removeListener==='function'&&res&&typeof res.on==='function'&&typeof res.removeListener==='function'&&typeof res.setHeader==='function'&&typeof res.end==='function'&&typeof res.destroy==='function';}
 function generic(res,status){if(res.destroyed||res.writableEnded)return;try{if(res.headersSent){res.destroy();return;}for(const[k,v]of Object.entries(HEADERS))res.setHeader(k,v);res.statusCode=status;res.end(JSON.stringify({error:status===404?'Not found':'Recovered records remain held'}));}catch{try{res.destroy();}catch{}}}
 async function handle(req,res){
  if(!interfaces(req,res)){try{res?.destroy?.();}catch{}return;}
  if(!config||closed){generic(res,404);return;}
  let start;try{start=check();}catch{generic(res,404);return;}
  // Raw path is checked before URL normalization and before all Auth/DB I/O.
  if(req.url!==PATH||req.headers?.host!==new URL(config.origin).host||req.headers?.origin!==undefined&&req.headers.origin!==config.origin||req.headers?.['sec-fetch-site']!==undefined&&!['same-origin','none'].includes(req.headers['sec-fetch-site'])){generic(res,404);return;}
  if(req.method!=='GET'){res.setHeader('Allow','GET');generic(res,405);return;}
  try{if(req.headers?.['content-length']!==undefined&&req.headers['content-length']!=='0'||req.headers?.['transfer-encoding']!==undefined||req.body!==undefined){generic(res,400);return;}}catch{generic(res,400);return;}
  const controller=new AbortController();active.add(controller);let disconnected=false,adapter=null,body=null,ended=false,headers={};
  const abort=()=>controller.abort(),disconnect=()=>{disconnected=true;abort();adapter?.close();};
  const responseClose=()=>{if(!res.writableEnded)disconnect();};
  req.on('aborted',disconnect);req.on('error',disconnect);res.on('close',responseClose);
  const external=req.signal;if(req.aborted||res.destroyed||external?.aborted)disconnect();else external?.addEventListener('abort',disconnect,{once:true});
  const timer=setTimeout(abort,Math.min(MAX_REQUEST_MS,config.expiresAt-start.now));timer.unref?.();
  function requestCheck(){const t=check();if(disconnected||controller.signal.aborted||req.aborted||res.destroyed||res.writableEnded||t.now-start.now>=MAX_REQUEST_MS||t.mono-start.mono>=MAX_REQUEST_MS)hold();return t;}
  function wait(p){return Promise.race([p,new Promise((_,reject)=>{const stop=()=>reject(new Held());controller.signal.addEventListener('abort',stop,{once:true});Promise.resolve(p).then(()=>controller.signal.removeEventListener('abort',stop),()=>controller.signal.removeEventListener('abort',stop));if(controller.signal.aborted)stop();})]);}
  try{
   requestCheck();const key=serverKey;
   adapter=createRecoveryReadonlyAdapter({enabled:true,enrollment:{version:'rr-recovery-readonly-enrollment-v1',projectUrl:PROJECT,ownerId:config.ownerId,origin:config.origin,branch:config.branch,reviewRef:config.reviewRef},deployment:{kind:'preview',projectUrl:PROJECT,origin:config.origin,branch:config.branch},serverKey:key,clock,monotonicClock,
    async fetchImpl(url,init){requestCheck();const r=await wait(Promise.resolve().then(()=>{requestCheck();return fetchImpl(url,{...init,signal:controller.signal});}));requestCheck();return {status:r.status,url:r.url,redirected:r.redirected,headers:{get(name){requestCheck();return r.headers.get(name);}},body:{getReader(){requestCheck();const reader=r.body.getReader();return {async read(){requestCheck();const next=await wait(reader.read());requestCheck();return next;},cancel:()=>reader.cancel()};}}};}});
   if(!adapter.configured)hold();
   const buffered={statusCode:0,setHeader(k,v){requestCheck();if(!Object.hasOwn(HEADERS,k)||HEADERS[k]!==v)hold();headers[k]=v;},end(value){requestCheck();if(ended||typeof value!=='string'||Buffer.byteLength(value)>524288)hold();body=value;ended=true;}};
   // Forward only required headers, never Cookie/x-forwarded-* or arbitrary state.
   await wait(adapter.handle({url:PATH,method:'GET',headers:{host:req.headers.host,...(req.headers.origin!==undefined?{origin:req.headers.origin}:{}),...(req.headers['sec-fetch-site']!==undefined?{'sec-fetch-site':req.headers['sec-fetch-site']}:{}),authorization:req.headers.authorization},signal:controller.signal},buffered));
   requestCheck();if(!ended||![200,401,403,503].includes(buffered.statusCode)||Object.keys(headers).length!==Object.keys(HEADERS).length)hold();
   for(const[k,v]of Object.entries(HEADERS)){requestCheck();res.setHeader(k,v);}requestCheck();res.statusCode=buffered.statusCode;requestCheck();res.end(body);
  }catch{if(!disconnected)generic(res,503);}
  finally{clearTimeout(timer);controller.abort();adapter?.close();active.delete(controller);req.removeListener('aborted',disconnect);req.removeListener('error',disconnect);res.removeListener('close',responseClose);external?.removeEventListener('abort',disconnect);body=null;headers={};}
 }
 return Object.freeze({configured,handle,close});
}
module.exports={createRecoveryHost,MAX_WINDOW_MS,MAX_REQUEST_MS};
