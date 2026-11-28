'use strict';
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else api.install({window:root.window,document:root.document,fetchImpl:root.fetch.bind(root)});})(globalThis,function(){
 const ORIGIN='https://rack-relic-git-codex-recovery-readiness-20261117-rack-relic.vercel.app',PROJECT='https://xkxolhgafjadpknsfqqw.supabase.co',OWNER='68f2c873-2d5d-4069-9afb-81b2896cd94b',EMAIL='wayne@rackrelic.com';
 const fail=()=>{throw Error('Recovery link unavailable');};
 function fragment(hash,now,decode){
  if(typeof hash!=='string'||hash.length>16000||!hash.startsWith('#'))fail();
  const p=new URLSearchParams(hash.slice(1)), allowed=['access_token','refresh_token','expires_in','expires_at','token_type','type'];
  for(const k of p.keys())if(!allowed.includes(k)||p.getAll(k).length!==1)fail();
  if(p.get('type')!=='recovery'||p.get('token_type')!=='bearer')fail();
  const token=p.get('access_token');if(!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token||''))fail();
  const claims=JSON.parse(decode(token.split('.')[1]));
  if(claims.iss!==PROJECT+'/auth/v1'||claims.sub!==OWNER||claims.role!=='authenticated'||claims.aud!=='authenticated'||!Number.isSafeInteger(claims.exp)||claims.exp*1000<=now)fail();
  return {token,deadline:Math.min(now+900000,claims.exp*1000)};
 }
 const owner=u=>u?.id===OWNER&&u.email===EMAIL&&typeof u.email_confirmed_at==='string'&&!u.is_anonymous;
 async function install({window:win,document:doc,fetchImpl,clock=Date.now}={}){
  if(!win||!doc||typeof fetchImpl!=='function')return;
  const status=doc.getElementById('reset-status'),form=doc.getElementById('reset-form'),pw=doc.getElementById('new-password'),confirm=doc.getElementById('confirm-password');
  if(!status||!form||!pw||!confirm)return;
  let session=null,config=null,used=false,timer;
  const clear=()=>{session=null;config=null;pw.value='';confirm.value='';form.hidden=true;};
  const say=t=>{status.textContent=t;};
  async function call(url,init){
   if(!session||clock()>=session.deadline)fail();
   const response=await fetchImpl(url,{...init,cache:'no-store',redirect:'error',credentials:url.startsWith(ORIGIN)?'same-origin':'omit',signal:AbortSignal.timeout(Math.min(5000,session.deadline-clock()))});
   if(clock()>=session.deadline||response.redirected||response.url!==url)fail();
   return response;
  }
  async function json(response){if(response.status!==200||!/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type')||''))fail();const text=await response.text();if(text.length>16384)fail();return JSON.parse(text);}
  try{
   const hash=win.location.hash;
   // Remove emailed credentials before any network activity; never use storage.
   win.history.replaceState(null,'','/reset-password.html');
   if(win.location.origin!==ORIGIN)fail();
   session=fragment(hash,clock(),s=>win.atob(s.replace(/-/g,'+').replace(/_/g,'/')));
   const c=await json(await call(ORIGIN+'/api/recovery-reset-config',{method:'GET'}));
   if(c.project!==PROJECT||c.ownerId!==OWNER||c.email!==EMAIL||typeof c.publicKey!=='string'||c.publicKey.length>4096)fail();config=c;
   const headers={apikey:config.publicKey,Authorization:'Bearer '+session.token};
   if(!owner(await json(await call(PROJECT+'/auth/v1/user',{method:'GET',headers}))))fail();
   form.hidden=false;say('Verified recovery link for Wayne’s restored test account. Enter your new password privately.');
   timer=win.setTimeout(()=>{clear();say('This recovery session expired. Request a fresh recovery email.');},session.deadline-clock());
   win.addEventListener('pagehide',clear,{once:true});
   form.addEventListener('submit',async event=>{
    event.preventDefault();if(event.isTrusted!==true||used||!session)return;
    if(pw.value.length<12||pw.value.length>128||pw.value!==confirm.value){say('Enter matching passwords of 12 to 128 characters.');return;}
    used=true;form.hidden=true;const body=JSON.stringify({password:pw.value});pw.value='';confirm.value='';
    try{
     const changed=await json(await call(PROJECT+'/auth/v1/user',{method:'PUT',headers:{...headers,'Content-Type':'application/json'},body}));
     if(!owner(changed))fail();
     const logout=await call(PROJECT+'/auth/v1/logout?scope=local',{method:'POST',headers});
     if(logout.status!==204){say('Password changed. Sign-out could not be confirmed; close this tab before continuing.');return;}
     say('Restored test account password updated. Signed out of this recovery session.');
    }catch{say('The result could not be confirmed. Do not submit again; verify the password with a normal sign-in.');}
    finally{win.clearTimeout(timer);clear();}
   });
  }catch{clear();say('Open the newest recovery email for Wayne’s restored test account. An expired or incorrect link cannot be used.');}
 }
 return {fragment,owner,install};
});
