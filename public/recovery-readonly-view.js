'use strict';
(function(root,factory){
 const api=factory(typeof module==='object'&&module.exports?require('./recovery-snapshot.js'):root.RackRecoverySnapshot);
 if(typeof module==='object'&&module.exports)module.exports=api;
 else {root.RackRecoveryReadonlyView=api;}
})(globalThis,function(projection){
 const PROJECT='xkxolhgafjadpknsfqqw',ISSUER='https://'+PROJECT+'.supabase.co/auth/v1',PATH='/api/recovery-readonly';
 const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
 const SOURCE_ORIGINS=new Set(['https://rack-relic-git-codex-prelaunch-seller-protections-rack-relic.vercel.app','https://rack-relic-git-test-only-marketplace-foundation-rack-relic.vercel.app','https://rackrelic.com','https://www.rackrelic.com']);
 const COUNT_IDS={orders:'stored-orders',paidOrders:'stored-paid',heldOrders:'stored-held',sellers:'stored-sellers',openCases:'stored-open-cases',alertDeliveryGaps:'stored-delivery-gaps'};
 const id=v=>typeof v==='string'&&UUID.test(v)&&v!=='00000000-0000-0000-0000-000000000000';
 class Held extends Error{}
 const hold=()=>{throw new Held();};
 function exact(value,keys){if(!value||Object.getPrototypeOf(value)!==Object.prototype||Reflect.ownKeys(value).length!==keys.length)hold();const out={};for(const key of keys){const d=Object.getOwnPropertyDescriptor(value,key);if(!d||!Object.hasOwn(d,'value')||!d.enumerable)hold();out[key]=d.value;}return out;}
 function configured(value,window){
  const e=exact(value,['version','projectRef','ownerId','origin']);if(e.version!=='rr-recovery-view-enrollment-v1'||e.projectRef!==PROJECT||!id(e.ownerId)||typeof e.origin!=='string'||SOURCE_ORIGINS.has(e.origin))hold();
  const u=new URL(e.origin);if(u.origin!==e.origin||u.protocol!=='https:'||u.username||u.password||u.port||!u.hostname.includes('.')||window.location?.origin!==e.origin)hold();return Object.freeze(e);
 }
 function grant(value,enrollment,now){
  const handed=exact(value,['accessToken']),token=handed.accessToken;if(typeof token!=='string'||token.length>8192||!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token))hold();
  const encoded=token.split('.')[1],binary=atob(encoded.replace(/-/g,'+').replace(/_/g,'/'));if(binary.length>6144)hold();
  const claims=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Uint8Array.from(binary,c=>c.charCodeAt(0))));
  if(!claims||Object.getPrototypeOf(claims)!==Object.prototype||claims.iss!==ISSUER||claims.sub!==enrollment.ownerId||claims.aud!=='authenticated'||claims.role!=='authenticated'||claims.is_anonymous!==false||!id(claims.session_id)||!Number.isSafeInteger(claims.exp)||claims.exp>9007199254740||claims.exp*1000<=now||!Number.isSafeInteger(claims.iat)||claims.iat*1000>now+30000)hold();
  // Parsing can only deny. The fixed server remains the authentication authority.
  return {accessToken:token,sessionRef:claims.session_id,expiresAt:claims.exp*1000};
 }
 function uncached(headers){
  if(!headers?.get||headers.get('location')!==null)hold();const age=headers.get('age');if(age!==null&&age!=='0')hold();
  for(const name of ['x-cache','cf-cache-status','x-vercel-cache']){const value=headers.get(name);if(value!==null&&!['MISS','BYPASS','DYNAMIC'].includes(value.toUpperCase()))hold();}
  const cc=headers.get('cache-control')||'';if(!/(?:^|,)\s*no-store\s*(?:,|$)/i.test(cc)||/\b(?:public|immutable|stale-if-error|stale-while-revalidate)\b/i.test(cc)||cc.split(',').some(v=>/\b(?:s-maxage|max-age)\b/i.test(v)&&!/^\s*(?:s-maxage|max-age)\s*=\s*(?:0|"0")\s*$/i.test(v)))hold();
 }
 function mount({document,window,fetchImpl,enabled=false,enrollment=null,sessionProvider=null,clock=Date.now,monotonicClock=()=>performance.now(),timeoutMs=15000}={}){
  const $=id=>document.getElementById(id);let config=null,destroyed=false,epoch=0,active=null,busy=false,pagePresent=true,expiryTimer=null,listening=false;
  const ready=typeof sessionProvider==='function'&&typeof fetchImpl==='function'&&typeof clock==='function'&&typeof monotonicClock==='function'&&Number.isSafeInteger(timeoutMs)&&timeoutMs>=1&&timeoutMs<=30000&&typeof projection?.sanitizeAdminSnapshot==='function';
  try{if(enabled===true&&ready)config=configured(enrollment,window);}catch{}
  let focused=typeof document.hasFocus==='function'?document.hasFocus():true;
  const foreground=()=>!destroyed&&pagePresent&&focused&&document.hidden!==true&&document.visibilityState!=='hidden';
  function empty(){ $('records').hidden=true;$('observed-at').textContent='';for(const key of Object.values(COUNT_IDS))$(key).textContent='';$('orders').replaceChildren();$('cases').replaceChildren();$('record-limit').textContent=''; }
  function clear(message='Private recovery records cleared. Open them again only when you are ready.'){
   epoch++;active?.abort();active=null;busy=false;clearTimeout(expiryTimer);expiryTimer=null;empty();$('open-records').disabled=!config||!foreground();$('status').textContent=message;
  }
  function current(version){return version===epoch&&foreground()&&config!==null;}
  const row=(list,text)=>{const node=document.createElement('li');node.textContent=text;list.appendChild(node);};
  function show(snapshot){
   $('observed-at').textContent=snapshot.observedAt;
   for(const [key,target]of Object.entries(COUNT_IDS))$(target).textContent=String(snapshot.counts[key]);
   for(const order of snapshot.orders)row($('orders'),'Order '+order.orderRef+' · '+order.state.replace(/_/g,' ')+' · Recorded total $'+(order.totalCents/100).toFixed(2)+' · Hold required');
   if(!snapshot.orders.length)row($('orders'),'No orders appear in this stored view.');
   for(const item of snapshot.cases)row($('cases'),'Case '+item.caseRef+' · '+item.kind.replace(/_/g,' ')+' · '+item.status.replace(/_/g,' ')+' · Hold required');
   if(!snapshot.cases.length)row($('cases'),'No cases appear in this stored view.');
   $('record-limit').textContent=snapshot.hasMoreOrders||snapshot.hasMoreCases?'This is a limited view. More stored records exist.':'This limited view has no additional pages reported.';
   $('records').hidden=false;
  }
  async function read(){
   if(!config||destroyed||busy||!foreground())return;
   clear('Checking the separate recovered records…');const version=epoch,controller=new AbortController();active=controller;busy=true;$('open-records').disabled=true;
   let handed=null,selected=null,reader=null,timer;const parts=[];const started=clock(),mono=monotonicClock();
   const abort=()=>controller.abort();
   function check(){const now=clock(),elapsed=monotonicClock()-mono;if(!current(version)||controller.signal.aborted||!Number.isSafeInteger(started)||!Number.isSafeInteger(now)||now<started||now-started>=timeoutMs||!Number.isFinite(mono)||!Number.isFinite(elapsed)||elapsed<0||elapsed>=timeoutMs||selected&&selected.expiresAt<=now)hold();return now;}
   async function wait(p){check();let onAbort;try{return await Promise.race([p,new Promise((_,reject)=>{onAbort=()=>reject(new Held());controller.signal.addEventListener('abort',onAbort,{once:true});if(controller.signal.aborted)onAbort();})]);}finally{controller.signal.removeEventListener('abort',onAbort);}}
   try{
    timer=setTimeout(abort,timeoutMs);
    handed=await wait(Promise.resolve().then(()=>{check();return sessionProvider({signal:controller.signal});}));check();selected=grant(handed,config,clock());handed=null;
    const readStarted=check(),url=config.origin+PATH;
    const response=await wait(Promise.resolve().then(()=>{check();return fetchImpl(url,{method:'GET',credentials:'omit',redirect:'error',cache:'no-store',signal:controller.signal,headers:{Accept:'application/json',Authorization:'Bearer '+selected.accessToken}});}));
    check();if(response?.status!==200||response.url!==url||response.redirected!==false||!/^application\/json(?:\s*;|$)/i.test(response.headers?.get('content-type')||''))hold();uncached(response.headers);
    const date=Date.parse(response.headers.get('date')||''),length=response.headers.get('content-length');if(!Number.isFinite(date)||Math.abs(date-check())>30000||length!==null&&(!/^(0|[1-9][0-9]*)$/.test(length)||Number(length)>262144)||!response.body?.getReader)hold();
    reader=response.body.getReader();let size=0;
    for(;;){const next=await wait(reader.read());check();if(next.done)break;if(!(next.value instanceof Uint8Array)||(size+=next.value.length)>262144)hold();parts.push(new Uint8Array(next.value));}
    const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length;}let raw;
    try{raw=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}finally{bytes.fill(0);}
    const value=exact(raw,['version','projectRef','recoveryOnly','applicationWritesEnabled','providerWritesEnabled','liveClearance','providerFreshness','sessionRef','snapshot']);
    if(value.version!=='rr-recovery-readonly-observation-v1'||value.projectRef!==PROJECT||value.recoveryOnly!==true||value.applicationWritesEnabled!==false||value.providerWritesEnabled!==false||value.liveClearance!==false||value.providerFreshness!=='unverified_stored_records_only'||value.sessionRef!==selected.sessionRef)hold();
    const observed=Date.parse(value.snapshot?.observedAt||'');if(!Number.isFinite(observed)||observed<readStarted||observed>check()+1000)hold();const snapshot=projection.sanitizeAdminSnapshot(value.snapshot,{now:check()});check();show(snapshot);
    $('status').textContent='Stored recovery records opened. Provider connections and live readiness are unverified.';
    expiryTimer=setTimeout(()=>clear('The temporary owner access expired. Private recovery records cleared.'),Math.max(1,selected.expiresAt-clock()));expiryTimer.unref?.();
   }catch{if(current(version))clear('The recovered records could not be verified. Keep the recovery test on hold.');}
   finally{clearTimeout(timer);controller.abort();parts.forEach(part=>part.fill(0));try{Promise.resolve(reader?.cancel()).catch(()=>{});}catch{}handed=null;selected=null;if(active===controller)active=null;if(current(version)){busy=false;$('open-records').disabled=false;}}
  }
  const open=()=>void read(),finish=()=>clear('Private recovery records cleared. This view did not sign out or change any account.'),blur=()=>{focused=false;clear();},focus=()=>{focused=true;clear();},pagehide=()=>{pagePresent=false;clear();},pageshow=()=>{pagePresent=true;focused=typeof document.hasFocus==='function'?document.hasFocus():true;clear();},visibility=()=>clear();
  const handlers=[['blur',blur],['focus',focus],['pagehide',pagehide],['pageshow',pageshow]];
  $('open-records').addEventListener('click',open);$('clear-records').addEventListener('click',finish);
  try{if(typeof window?.addEventListener!=='function'||typeof window.removeEventListener!=='function'||typeof document.addEventListener!=='function'||typeof document.removeEventListener!=='function')hold();for(const[name,fn]of handlers)window.addEventListener(name,fn);document.addEventListener('visibilitychange',visibility);listening=true;}catch{config=null;}
  clear(config?'Ready for an explicit recovery check. No sign-in or connection has been started.':'Recovery sign-in and connection are not configured. This check is closed.');
  return Object.freeze({read,clear:finish,destroy(){if(destroyed)return;destroyed=true;clear('Private recovery records cleared.');$('open-records').removeEventListener('click',open);$('clear-records').removeEventListener('click',finish);if(listening){for(const[name,fn]of handlers)window.removeEventListener(name,fn);document.removeEventListener('visibilitychange',visibility);}config=null;}});
 }
 return Object.freeze({mount,PROJECT,PATH});
});
