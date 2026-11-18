'use strict';
(function(root,factory){
 const api=typeof module==='object'&&module.exports?factory(require('./recovery-session-provider.js'),require('./recovery-bootstrap.js')):factory(root.RackRecoverySessionProvider,root.RackRecoveryHostBootstrap);
 if(typeof module==='object'&&module.exports)module.exports=api;
 else {root.RackRecoveryCoordinator=api;api.install({document:root.document,window:root});}
})(globalThis,function(providerAPI,bootstrapAPI){
 const PROJECT='xkxolhgafjadpknsfqqw',MAX_WINDOW_MS=900000;
 let current=null,generation=0;
 const hold=()=>{throw new Error('Recovery sign-in remains closed');};
 function exact(v,keys){if(!v||Object.getPrototypeOf(v)!==Object.prototype||Reflect.ownKeys(v).length!==keys.length)hold();const out={};for(const k of keys){const d=Object.getOwnPropertyDescriptor(v,k);if(!d||!Object.hasOwn(d,'value')||!d.enumerable)hold();out[k]=d.value;}return out;}
 function configure(value,window,now,mono){
  const e=exact(value,['version','projectRef','ownerId','email','origin','branch','revision','notBefore','expiresAt']);
  const u=new URL(e.origin);
  if(e.version!=='rr-recovery-coordinator-v1'||e.projectRef!==PROJECT||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(e.ownerId||'')||/^0{8}-0{4}-0{4}-0{12}$/.test(e.ownerId)||typeof e.email!=='string'||e.email.length>254||!/^\S+@\S+\.\S+$/.test(e.email)||e.email!==e.email.trim().toLowerCase()||!/^codex\/recovery-[a-z0-9][a-z0-9-]{2,60}$/.test(e.branch||'')||!/^[a-f0-9]{40}$/.test(e.revision||'')||u.origin!==e.origin||u.protocol!=='https:'||u.port||u.username||u.password||!/^rack-relic-git-codex-recovery-[a-z0-9-]+-rack-relic\.vercel\.app$/.test(u.hostname)||window.location?.origin!==e.origin||!Number.isSafeInteger(now)||now<=0||!Number.isFinite(mono)||mono<0||!Number.isSafeInteger(e.notBefore)||!Number.isSafeInteger(e.expiresAt)||e.notBefore<=0||e.expiresAt<=e.notBefore||e.expiresAt-e.notBefore>MAX_WINDOW_MS||now<e.notBefore||now>=e.expiresAt)hold();
  return Object.freeze(e);
 }
 function install({document,window,enabled=false,enrollment=null,publishableKey=null,fetchImpl=window?.fetch?.bind(window),clock=Date.now,monotonicClock=()=>performance.now()}={}){
  const installation=++generation;current?.destroy();current=null;
  const $=id=>document.getElementById(id),input=$('recovery-password'),open=$('recovery-signin'),finish=$('recovery-finish'),status=$('recovery-cleanup-status');
  let config=null,provider=null,view=null,destroyed=false,attempted=false,busy=false,epoch=0,expiryTimer=null,lastWall,lastMono,startWall,startMono;
  const listeners=[];
  const live=()=>!destroyed&&generation===installation;
  function text(value){if(live())status.textContent=value;}
  function clearInput(){try{input.value='';}catch{}}
  function disable(){clearInput();input.disabled=true;open.disabled=true;finish.disabled=true;}
  function check(){if(!live()||!config)hold();const now=clock(),mono=monotonicClock();if(!Number.isSafeInteger(now)||now<lastWall||!Number.isFinite(mono)||mono<lastMono||now<config.notBefore||now>=config.expiresAt||mono-startMono>=config.expiresAt-startWall)hold();lastWall=now;lastMono=mono;}
  async function close({show=true}={}){
   if(!live())return;
   const operation=++epoch;busy=false;attempted=true;disable();view?.clear();
   if(show)text('Private records cleared. Checking cleanup of this recovered session…');
   let result;try{result=await provider?.release();}catch{result={status:'unconfirmed'};}
   if(!live()||operation!==epoch)return;
   const state=result?.status;
   if(show)text(state==='confirmed'?'Private records cleared. Cleanup of this recovered session was confirmed.':state==='no_session'?'Private records cleared. No recovered sign-in request was sent.':'Private records cleared. Recovered-session cleanup is unconfirmed; keep this check held.');
  }
  async function read(){
   if(!live()||!config||attempted||busy||input.disabled)return;
   try{check();}catch{await close();return;}
   attempted=true;busy=true;const operation=++epoch;open.disabled=true;finish.disabled=false;
   text('Checking the separate recovered account and stored records…');
   try{await view.read();if(!live()||operation!==epoch)return;check();if($('records').hidden){await close();return;}input.disabled=true;text('Stored recovered records are open. Checking cleanup of the temporary recovered session…');let cleanup;try{cleanup=await provider.release();}catch{cleanup={status:'unconfirmed'};}if(!live()||operation!==epoch)return;check();text(cleanup?.status==='confirmed'?'Stored recovered records are open. Temporary session cleanup was confirmed. Select Finish to clear the view.':'Stored recovered records are open. Temporary session cleanup is unconfirmed; keep this check held and select Finish to clear the view.');}
   catch{if(live()&&operation===epoch)await close();}
   finally{if(live())clearInput();if(live()&&operation===epoch)busy=false;}
  }
  function destroy(){if(destroyed)return;destroyed=true;epoch++;clearTimeout(expiryTimer);for(const[target,name,fn]of listeners)target.removeEventListener(name,fn);listeners.length=0;disable();view?.destroy();void provider?.destroy();config=null;}
  disable();
  try{if(enabled===true&&typeof fetchImpl==='function'&&typeof clock==='function'&&typeof monotonicClock==='function'){
   startWall=clock();startMono=monotonicClock();config=configure(enrollment,window,startWall,startMono);lastWall=startWall;lastMono=startMono;
  }}catch{config=null;}
  if(config){
   provider=providerAPI.createRecoverySessionProvider({document,window,passwordInput:input,enabled:true,enrollment:{version:'rr-recovery-session-enrollment-v1',projectRef:PROJECT,ownerId:config.ownerId,email:config.email,origin:config.origin,notBefore:config.notBefore,expiresAt:config.expiresAt},publishableKey,fetchImpl,clock,monotonicClock});
   if(!provider.configured){void provider.destroy();provider=null;config=null;}
  }
  view=bootstrapAPI.install({document,window,enabled:config!==null,enrollment:config?{version:'rr-recovery-browser-host-v1',projectRef:PROJECT,ownerId:config.ownerId,origin:config.origin,branch:config.branch,revision:config.revision,notBefore:config.notBefore,expiresAt:config.expiresAt}:null,fetchImpl,clock,monotonicClock,sessionProvider:config?async(args)=>{check();const result=await provider.acquire(args);check();return result;}:null});
  // Preserve required frozen-view nodes but remove their alternate controls.
  $('open-records').hidden=true;$('open-records').disabled=true;
  $('clear-records').hidden=true;$('clear-records').disabled=true;
  if(config&&view.configured){
   const onOpen=()=>{void read();},onFinish=()=>{void close();},hide=()=>{if(live())void close();},visibility=()=>{if(document.hidden===true||document.visibilityState==='hidden')hide();};
   for(const[target,name,fn]of [[open,'click',onOpen],[finish,'click',onFinish],[window,'blur',hide],[window,'pagehide',hide],[document,'visibilitychange',visibility]]){target.addEventListener(name,fn);listeners.push([target,name,fn]);}
   expiryTimer=setTimeout(()=>{void close();},Math.max(1,config.expiresAt-startWall));expiryTimer.unref?.();input.disabled=false;open.disabled=false;text('Ready for one explicit recovery sign-in. No sign-in or read has started.');
  }else{config=null;text('Recovery sign-in and connection are not configured. This check is closed.');}
  current=Object.freeze({configured:config!==null,read,finish:()=>close(),destroy});return current;
 }
 return Object.freeze({install});
});
