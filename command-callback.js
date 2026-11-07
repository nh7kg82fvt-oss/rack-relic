'use strict';
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.RackCommandCallback=api;})(globalThis,function(){
 async function complete(code,{fetchImpl,location}={}){
  if(typeof code!=='string'||!code||code.length>2048)throw Error('Open the newest sign-in link, or use password sign-in in Rack Command.');
  const response=await fetchImpl('/api/command-session?action=callback',{method:'POST',cache:'no-store',redirect:'error',credentials:'same-origin',signal:AbortSignal.timeout(25000),headers:{'Content-Type':'application/json'},body:JSON.stringify({code})});
  const value=await response.json();
  const age=response.headers?.get('age'),cached=age!=null&&(!/^\d+$/.test(age)||Number(age)>0)||['cf-cache-status','x-vercel-cache'].some(k=>['HIT','STALE','UPDATING'].includes((response.headers?.get(k)||'').toUpperCase()));
  if(!cached&&(response.status===409&&value?.code==='not_command_callback'||response.status===404&&value?.error==='Not found'))return false;
  if(!response.ok||cached||value?.signedIn!==true)throw Error('This Rack Command link could not be confirmed. Open Rack Command to sign in with your password or request a fresh link.');
  location.replace('/api/command-center');return true;
 }
 return Object.freeze({complete});
});
