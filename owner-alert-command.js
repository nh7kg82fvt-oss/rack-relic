'use strict';
(function(root){
 const ENDPOINT='/api/test-owner-alert',COMMAND='/api/command-center#cases-heading',DENIAL_KEY='rr-command-denial-v1',DENIAL_EVENT='rr-command-denial';
 const FACTS=Object.freeze(['rack_team_and_domain_verified','transactional_free_and_paid_extras_off','tracking_and_receiving_off','sending_key_domain_only','exact_receiver_code_and_secrets_verified','receipt_rpc_grants_and_denials_verified']);
 const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
 class SessionChanged extends Error{}
 function createOwnerAlertCommand({document,window,fetchImpl,clock=Date.now,timeoutMs=15000}={}){
  const form=document.getElementById('review'),fields=document.getElementById('review-fields'),button=document.getElementById('reconcile'),status=document.getElementById('status'),link=document.getElementById('command-link');
  link.href=COMMAND;let destroyed=false,busy=false,version=0,sessionRef=null,active=null,listening=false,pagePresent=true,focused=typeof document.hasFocus==='function'?document.hasFocus():true;
  const visible=()=>!destroyed&&pagePresent&&focused&&document.hidden!==true&&document.visibilityState!=='hidden';
  function channelReady(){try{return listening&&typeof window.localStorage?.getItem==='function'&&(window.localStorage.getItem(DENIAL_KEY),true);}catch{return false;}}
  function clear(message){sessionRef=null;fields.disabled=true;button.disabled=true;form.reset();for(const x of form.querySelectorAll('input[type=checkbox]'))x.checked=false;document.getElementById('revision').value='';document.getElementById('reference').value='';status.textContent=message;}
  function pause(message='Private alert details cleared. Return to this page to check your current Rack Command session.'){version++;active?.abort();active=null;busy=false;clear(message);}
  function current(v){if(destroyed||v!==version)return false;if(!visible()||!channelReady()){pause();return false;}return true;}
  function hide(){clear('Sign in to Rack Command, then return to this setup check. No email was sent.');}
  async function json(url,init,signal,max=32768){
   const controller=new AbortController(),abort=()=>controller.abort();let timer,reader;
   if(signal.aborted)abort();else signal.addEventListener('abort',abort,{once:true});
   async function wait(p){let listener;try{return await Promise.race([p,new Promise((_,reject)=>{listener=()=>reject(new Error());controller.signal.addEventListener('abort',listener,{once:true});if(controller.signal.aborted)listener();})]);}finally{controller.signal.removeEventListener('abort',listener);}}
   try{
    timer=setTimeout(abort,timeoutMs);
    const r=await wait(Promise.resolve().then(()=>{if(controller.signal.aborted)throw Error();return fetchImpl(url,{...init,credentials:'same-origin',redirect:'error',cache:'no-store',signal:controller.signal});}));
    if(controller.signal.aborted)throw Error();
    if([401,403].includes(r.status))throw new SessionChanged();
    if(!r.ok||r.redirected||!/^application\/json(?:\s*;|$)/i.test(r.headers?.get('content-type')||''))throw Error();
    const age=r.headers.get('age');if(age!==null&&age!=='0'||['cf-cache-status','x-vercel-cache'].some(k=>/HIT|STALE|UPDATING/i.test(r.headers.get(k)||'')))throw Error();
    reader=r.body?.getReader();if(!reader)throw Error();const parts=[];let size=0;
    for(;;){const p=await wait(reader.read());if(controller.signal.aborted)throw Error();if(p.done)break;if(!(p.value instanceof Uint8Array)||(size+=p.value.length)>max)throw Error();parts.push(p.value);}
    const bytes=new Uint8Array(size);let offset=0;for(const p of parts){bytes.set(p,offset);offset+=p.length;}let value;try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}finally{bytes.fill(0);}
    return{value,session:r.headers.get('x-rack-command-session')};
   }finally{clearTimeout(timer);controller.abort();signal.removeEventListener('abort',abort);try{Promise.resolve(reader?.cancel()).catch(()=>{});}catch{}}
  }
  async function session(signal){const r=await json(ENDPOINT+'?action=session',{method:'GET'},signal,8192),v=r.value;if(v?.signedIn===false&&Object.keys(v).length===1)throw new SessionChanged();if(!v||Object.keys(v).sort().join(',')!=='sessionRef,signedIn'||v.signedIn!==true||!UUID.test(v.sessionRef||'')||r.session!==v.sessionRef)throw Error();return v.sessionRef;}
  async function refresh(){
   if(destroyed)return;pause('Checking your current Rack Command session. Previous review details were cleared. No email will be sent.');if(!visible())return;if(!channelReady()){clear('Private details are hidden because this page cannot listen for sign-out changes. Return to Rack Command and reopen this check.');return;}const v=version,controller=new AbortController();active=controller;busy=true;
   try{const selected=await session(controller.signal);if(!current(v))return;sessionRef=selected;fields.disabled=false;button.disabled=false;status.textContent='Your Rack Command session is active. Review the current setup, then check the original signed delivery. No email will be sent.';}
   catch(e){if(current(v)){if(e instanceof SessionChanged)hide();else clear('The current owner session could not be verified. Private details are hidden. Return to Rack Command or try this check again later.');}}
   finally{if(v===version)busy=false;if(active===controller)active=null;controller.abort();}
  }
  async function reconcile(){
   if(destroyed||busy||!sessionRef)return;if(!visible()||!channelReady()){pause();return;}if(!form.reportValidity())return;const v=++version,selected=sessionRef,controller=new AbortController();active=controller;busy=true;fields.disabled=true;button.disabled=true;status.textContent='Checking only the original signed delivery. No email is being sent.';
   try{
    if(await session(controller.signal)!==selected)throw new SessionChanged();if(!current(v))return;
    const now=clock();if(!Number.isSafeInteger(now)||now<1)throw Error();
    const facts=[...form.querySelectorAll('input[type=checkbox]')];if(facts.length!==FACTS.length||facts.some((x,i)=>!x.checked||x.name!==FACTS[i]))throw Error();
    const review={version:'rr-owner-alert-action-review-v1',team:'rackrelic',domainId:'f4adcee8-bc22-4597-9aae-6d9cd6780e6a',receiverSource:'7a23e5695a0126f88b48f31b564b1172492f7e4b114c3c85f19de15fc7e8fbf3',receiverRevision:document.getElementById('revision').value,checkedAt:now,expiresAt:now+240000,evidenceReference:document.getElementById('reference').value,facts:FACTS.slice()};
    const r=await json(ENDPOINT,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'reconcile',review})},controller.signal);if(!current(v))return;
    if(r.session!==selected||await session(controller.signal)!==selected)throw new SessionChanged();if(!current(v))return;
    const d=r.value;if(d?.test!==true||d.cloudReady!==false||d.releaseEnabled!==false||d.signedDeliveryRequired!==true||d.ownerRead!==false||d.readinessEvidence!=='authenticated_owner_review_and_live_boundary_probes'||typeof d.state!=='string')throw Error();
    status.textContent=d.state==='delivered'?'The original fictional alert has signed delivery evidence. This does not show that you read it or establish live alert coverage. No email was sent; all financial holds remain.':'Original delivery is still unverified. Keep the original record and all financial holds. This check did not send an email.';
   }catch(e){if(current(v)){if(e instanceof SessionChanged)hide();else clear('The original delivery could not be confirmed. Private details are hidden. Keep the original; do not resend. Return to Rack Command to verify your session before another check.');}}
   finally{if(current(v)){busy=false;fields.disabled=!sessionRef;button.disabled=!sessionRef;}if(active===controller)active=null;controller.abort();}
  }
  const submit=e=>{e.preventDefault();void reconcile();},blur=()=>{focused=false;pause();},focus=()=>{focused=true;void refresh();},visibility=()=>{if(document.hidden===true||document.visibilityState==='hidden')pause();else void refresh();},pagehide=()=>{pagePresent=false;pause();},pageshow=()=>{pagePresent=true;focused=typeof document.hasFocus==='function'?document.hasFocus():true;void refresh();};
  // Notifications are denial only. Malformed, delayed and unknown values cannot
  // authorize anything or change cookies; never recheck during a pending logout.
  const storage=e=>{if(e.key===DENIAL_KEY||e.key===null)pause('Your Rack Command sign-in may have changed. Private alert details cleared. Return to this page to verify the current session.');},denial=()=>pause('Your Rack Command sign-in may have changed. Private alert details cleared. Return to this page to verify the current session.');
  const handlers=[['blur',blur],['focus',focus],['pagehide',pagehide],['pageshow',pageshow],['storage',storage],[DENIAL_EVENT,denial]];
  function unlisten(){for(const [name,fn]of handlers)window?.removeEventListener?.(name,fn);document.removeEventListener?.('visibilitychange',visibility);listening=false;}
  form.addEventListener('submit',submit);
  try{if(typeof window?.addEventListener!=='function'||typeof window.removeEventListener!=='function'||typeof document.addEventListener!=='function'||typeof document.removeEventListener!=='function')throw Error();for(const [name,fn]of handlers)window.addEventListener(name,fn);document.addEventListener('visibilitychange',visibility);listening=true;}catch{unlisten();}
  void refresh();
  return Object.freeze({refresh,reconcile,destroy(){if(destroyed)return;destroyed=true;pause('Private alert details cleared.');form.removeEventListener?.('submit',submit);unlisten();}});
 }
 if(typeof module==='object'&&module.exports)module.exports={createOwnerAlertCommand,ENDPOINT,COMMAND};
 else if(root.document)root.RackOwnerAlertCommand=createOwnerAlertCommand({document:root.document,window:root,fetchImpl:root.fetch.bind(root)});
})(typeof globalThis==='object'?globalThis:this);
