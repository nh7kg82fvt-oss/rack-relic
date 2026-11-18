'use strict';
(function(root,factory){
 const api=factory(typeof module==='object'&&module.exports?require('./recovery-readonly-view.js'):root.RackRecoveryReadonlyView);
 if(typeof module==='object'&&module.exports)module.exports=api;
 else root.RackRecoveryHostBootstrap=api;
})(globalThis,function(view){
 const PROJECT='xkxolhgafjadpknsfqqw',PATH='/api/recovery-readonly',MAX_WINDOW_MS=15*60*1000;
 let current=null;
 const hold=()=>{throw new Error('Recovery handoff remains absent or held');};
 function exact(v,keys){if(!v||Object.getPrototypeOf(v)!==Object.prototype||Reflect.ownKeys(v).length!==keys.length)hold();const out={};for(const k of keys){const d=Object.getOwnPropertyDescriptor(v,k);if(!d||!Object.hasOwn(d,'value')||!d.enumerable)hold();out[k]=d.value;}return out;}
 function install({document,window,enabled=false,enrollment=null,sessionProvider=null,fetchImpl=window?.fetch?.bind(window),clock=Date.now,monotonicClock=()=>performance.now()}={}){
  current?.destroy();current=null;let config=null,closed=false,timer=null,lastWall,lastMono,startWall,startMono;
  try{if(enabled===true&&typeof sessionProvider==='function'&&typeof fetchImpl==='function'){
   const e=exact(enrollment,['version','projectRef','ownerId','origin','branch','revision','notBefore','expiresAt']);const u=new URL(e.origin);
   startWall=clock();startMono=monotonicClock();
   if(e.version!=='rr-recovery-browser-host-v1'||e.projectRef!==PROJECT||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(e.ownerId||'')||/^0{8}-0{4}-0{4}-0{12}$/.test(e.ownerId)||!/^codex\/recovery-[a-z0-9][a-z0-9-]{2,60}$/.test(e.branch||'')||!/^[a-f0-9]{40}$/.test(e.revision||'')||u.origin!==e.origin||u.protocol!=='https:'||u.username||u.password||u.port||!/^rack-relic-git-codex-recovery-[a-z0-9-]+-rack-relic\.vercel\.app$/.test(u.hostname)||window.location?.origin!==e.origin||!Number.isSafeInteger(startWall)||startWall<=0||!Number.isFinite(startMono)||startMono<0||!Number.isSafeInteger(e.notBefore)||!Number.isSafeInteger(e.expiresAt)||e.notBefore<=0||e.expiresAt<=e.notBefore||e.expiresAt-e.notBefore>MAX_WINDOW_MS||startWall<e.notBefore||startWall>=e.expiresAt)hold();
   config=Object.freeze(e);lastWall=startWall;lastMono=startMono;
  }}catch{config=null;}
  let mounted=null;
  function destroy(){closed=true;clearTimeout(timer);mounted?.destroy();config=null;sessionProvider=null;fetchImpl=null;}
  function check(){if(!config||closed)hold();const now=clock(),mono=monotonicClock();if(!Number.isSafeInteger(now)||now<lastWall||!Number.isFinite(mono)||mono<lastMono||now<config.notBefore||now>=config.expiresAt||mono-startMono>=config.expiresAt-startWall){destroy();hold();}lastWall=now;lastMono=mono;}
  mounted=view.mount({document,window,enabled:config!==null,enrollment:config?{version:'rr-recovery-view-enrollment-v1',projectRef:PROJECT,ownerId:config.ownerId,origin:config.origin}:null,clock,monotonicClock,
   async sessionProvider(args){check();const r=await sessionProvider(args);check();return r;},
   async fetchImpl(url,init){check();if(url!==config.origin+PATH||init.method!=='GET'||init.credentials!=='omit'||init.redirect!=='error'||init.cache!=='no-store'||init.body!==undefined)hold();const r=await fetchImpl(url,init);check();return {status:r.status,url:r.url,redirected:r.redirected,headers:r.headers,body:{getReader(){check();const reader=r.body.getReader();return {async read(){check();const next=await reader.read();check();return next;},cancel:()=>reader.cancel()};}}};}});
  // Timeout destroys the existing view even if its JWT would live longer.
  if(config){timer=setTimeout(destroy,Math.max(1,config.expiresAt-startWall));timer.unref?.();}
  current=Object.freeze({configured:config!==null,read:()=>closed?undefined:mounted.read(),clear:()=>{if(!closed)mounted.clear();},destroy});return current;
 }
 return Object.freeze({install});
});
