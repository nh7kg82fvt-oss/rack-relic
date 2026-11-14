'use strict';
(function(root,factory){
 const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;
 else{root.RackCommandSignin=api;if(root.document)api.mount({document:root.document,window:root,fetchImpl:root.fetch.bind(root),admin:root.RackRelicAdminOverview,environments:root.RackRelicTestEnvironments,storage:root.sessionStorage});}
})(globalThis,function(){
 const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
 function session(value){
  if(value?.signedIn!==true||!UUID.test(value.member||'')||!UUID.test(value.sessionRef||'')||typeof value.email!=='string'||value.email.length>254||!Number.isSafeInteger(value.expiresAt))throw Error('Owner session unavailable');
  // Only noncredential identity is retained in memory. Cookies are HttpOnly.
  return Object.freeze({member:value.member,sessionRef:value.sessionRef,email:value.email});
 }
 function mount({document,window,fetchImpl,admin,environments,storage}={}){
  const $=id=>document.getElementById(id);let owner=null,client=null,busy=false,version=0,destroyed=false;
  const note=value=>{$('signin-status').textContent=value;};
  const controls=['owner-email','owner-password','remember-device','password-submit','email-submit','new-password','confirm-password','change-password'];
  function lock(value){busy=value;for(const id of controls)$(id).disabled=value;}
  function clearPasswords(){for(const id of ['owner-password','new-password','confirm-password'])$(id).value='';}
  function show(signed){$('command-signin').hidden=signed;$('account-settings').hidden=!signed;$('workspace-intro').hidden=!signed;$('practice-context').hidden=!signed;$('workspace-footer').hidden=!signed;$('notice').hidden=!signed;$('as-of').hidden=!signed;$('refresh').hidden=!signed;$('signed-account').textContent=signed?owner.email:'';$('signin-link').hidden=signed;}
  function lost(){version++;owner=null;clearPasswords();show(false);note('Sign in to open Rack Command. Your saved follow-ups stay in Rack.');}
  async function request(action,body){
   const response=await fetchImpl('/api/command-session?action='+action,{method:body===undefined?'GET':'POST',cache:'no-store',redirect:'error',credentials:'same-origin',signal:AbortSignal.timeout(25000),headers:body===undefined?{}:{'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
   const age=response.headers?.get('age');if(age!=null&&(!/^\d+$/.test(age)||Number(age)>0)||['cf-cache-status','x-vercel-cache'].some(k=>['HIT','STALE','UPDATING'].includes((response.headers?.get(k)||'').toUpperCase())))throw Error('The latest sign-in could not be checked. Reload this page.');
   const value=await response.json();if(!response.ok){const error=Error(typeof value?.error==='string'?value.error:'Sign-in could not be confirmed. Try again.');error.status=response.status;error.code=value?.code;throw error;}return value;
  }
  function open(value){owner=session(value);show(true);note('');clearPasswords();if(!client){client=admin.mount({document,window,fetchImpl,storage,environments,endpoint:'/api/command-center',sessionProvider:()=>owner,onSessionLost:lost,onSignOut:signOut});}else void client.refresh();}
  async function login(event){
   event?.preventDefault?.();if(busy||destroyed)return;const current=++version,body={email:$('owner-email').value.trim(),password:$('owner-password').value,remember:$('remember-device').checked===true};
   lock(true);note('Signing in…');
   try{const pending=request('login',body);$('owner-password').value='';const value=await pending;if(!destroyed&&current===version)open(value);}
   catch(error){if(!destroyed&&current===version)note(error.message);}
   finally{if(!destroyed)lock(false);}
  }
  async function email(){
   if(busy||destroyed)return;const current=++version;lock(true);note('Requesting a one-time sign-in link…');
   try{await request('email',{email:$('owner-email').value.trim(),remember:$('remember-device').checked===true});if(!destroyed&&current===version)note('Open the newest Rack email link once in this browser profile. It will bring you straight back to Rack Command. Password sign-in is available whenever you return.');}
   catch(error){if(!destroyed&&current===version)note(error.message);}
   finally{if(!destroyed)lock(false);}
  }
  async function signOut(){
   if(busy||destroyed)return;lost();lock(true);note('Signing out of this device…');let retry=false;
   try{const value=await request('logout',{});if(!destroyed)note(value.providerSignOutConfirmed?'Signed out of Rack Command on this device.':'This browser session was cleared. The provider did not confirm remote sign-out; close Rack tabs if this is a shared device.');}
   catch{retry=true;if(!destroyed)note('Sign-out could not be confirmed. Keep this page open and try Sign out again, or close the browser on a shared device.');}
   finally{if(!destroyed){lock(false);$('logout').hidden=!retry;}}
  }
  async function password(event){
   event?.preventDefault?.();if(busy||destroyed||!owner)return;
   const value=$('new-password').value;if(value.length<12||value!==$('confirm-password').value){$('password-status').textContent='Enter the same new password twice, with at least 12 characters.';return;}
   const current=++version;lock(true);$('password-status').textContent='Saving your new password…';
   try{const pending=request('password',{password:value});clearPasswords();const result=await pending;if(!destroyed&&current===version){open(result);$('password-status').textContent='Password changed. Use it the next time you sign in.';}}
   catch(error){if(!destroyed&&current===version){if(error.code==='password_change_unconfirmed'||[401,403].includes(error.status)){lost();client?.refresh();note(error.message);}else $('password-status').textContent=error.message;}}
   finally{if(!destroyed)lock(false);}
  }
  $('password-form').addEventListener('submit',login);$('email-submit').addEventListener('click',()=>void email());$('password-change-form').addEventListener('submit',password);
  $('show-password').addEventListener('change',()=>{$('owner-password').type=$('show-password').checked?'text':'password';});
  const hide=()=>clearPasswords();window.addEventListener('pagehide',hide);
  show(false);lock(true);note('Checking this device’s sign-in…');
  const started=version;
  const ready=(async()=>{try{const value=await request('session');if(!destroyed&&started===version){if(value.signedIn)open(value);else note('Use your Rack owner email and password.');}}catch(error){if(!destroyed&&started===version)note(error.message);}finally{if(!destroyed)lock(false);}})();
  return Object.freeze({ready,destroy(){destroyed=true;version++;owner=null;client?.destroy();clearPasswords();window.removeEventListener?.('pagehide',hide);},signOut});
 }
 return Object.freeze({mount,session});
});
