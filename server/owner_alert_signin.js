'use strict';
(function(root){
 const PROJECT='https://tzymapahsfiyhgilsmxl.supabase.co',ORIGIN='https://rack-relic-git-codex-prelaunch-seller-protections-rack-relic.vercel.app';
 const RETURN=ORIGIN+'/api/test-owner-alert',OWNER='wayne@rackrelic.com',KEY='rr-owner-alert-pkce-v1';
 function createOwnerAlertSignin({publishableKey,storage,fetchImpl,cryptoImpl,clock=Date.now,origin}={}){
  if(origin!==ORIGIN||!/^sb_publishable_[A-Za-z0-9_-]{16,}$/.test(publishableKey||'')||!storage||typeof fetchImpl!=='function'||!cryptoImpl?.subtle)throw Error('Owner sign-in unavailable');
  const b64=b=>btoa(String.fromCharCode(...b)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  const read=()=>{try{return JSON.parse(storage.getItem(KEY));}catch{return null;}};
  async function post(path,body){
   const url=PROJECT+'/auth/v1/'+path,r=await fetchImpl(url,{method:'POST',redirect:'error',cache:'no-store',signal:AbortSignal.timeout(20000),
    headers:{apikey:publishableKey,'Content-Type':'application/json'},body:JSON.stringify(body)});
   if(!(r instanceof Response)||r.url!==url||r.redirected||!r.ok||!/^application\/json(?:\s*;|$)/i.test(r.headers.get('content-type')||''))throw Error('Owner sign-in could not be confirmed. Use a fresh link in this Chrome profile.');
   const reader=r.body?.getReader();if(!reader)throw Error('Owner sign-in unavailable');let size=0;const chunks=[];
   try{for(;;){const x=await reader.read();if(x.done)break;size+=x.value.byteLength;if(size>65536){await reader.cancel();throw Error('Owner sign-in unavailable');}chunks.push(x.value);}}
   finally{reader.releaseLock();}
   const raw=new Uint8Array(size);let offset=0;for(const b of chunks){raw.set(b,offset);offset+=b.length;}return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));
  }
  return Object.freeze({async send(){
   const pending=read();if(pending&&clock()-pending.createdAt<60000)throw Error('Wait a minute before requesting another owner link.');
   const verifier=b64(cryptoImpl.getRandomValues(new Uint8Array(32))),challenge=b64(new Uint8Array(await cryptoImpl.subtle.digest('SHA-256',new TextEncoder().encode(verifier))));
   storage.setItem(KEY,JSON.stringify({verifier,createdAt:clock(),returnUrl:RETURN,projectUrl:PROJECT}));
   try{await post('otp?redirect_to='+encodeURIComponent(RETURN),{email:OWNER,create_user:false,code_challenge:challenge,code_challenge_method:'s256'});}
   catch{storage.removeItem(KEY);throw Error('Owner link could not be confirmed. Check Auth delivery and the exact redirect allowlist.');}
  },async complete(code){
   const pending=read();storage.removeItem(KEY);
   if(!pending||pending.returnUrl!==RETURN||pending.projectUrl!==PROJECT||!/^[A-Za-z0-9_-]{43}$/.test(pending.verifier||'')||
    !Number.isSafeInteger(pending.createdAt)||clock()<pending.createdAt||clock()-pending.createdAt>3600000||typeof code!=='string'||code.length<1||code.length>2048)throw Error('Request a fresh owner link and open it in the same Chrome profile.');
   const s=await post('token?grant_type=pkce',{auth_code:code,code_verifier:pending.verifier});
   if(typeof s.access_token!=='string'||s.access_token.length>8192||!s.user?.id||s.user.email?.toLowerCase()!==OWNER||s.user.role!=='authenticated'||s.user.is_anonymous!==false)throw Error('Only the existing Rack owner may sign in here.');
   return {token:s.access_token,member:s.user.id,email:OWNER};
  }});
 }
 if(typeof module==='object'&&module.exports)module.exports={createOwnerAlertSignin};else root.RackOwnerAlertSignin={createOwnerAlertSignin};
})(typeof globalThis==='object'?globalThis:this);
