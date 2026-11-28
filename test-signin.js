'use strict';
(function(root){
 const PROJECT='https://zvtaqzcqfdjpuwnlpzln.supabase.co';
 const RETURN='https://rack-relic-git-test-only-marketplace-foundation-rack-relic.vercel.app/api/test-marketplace';
 const KEY='rr-test-email-signin';
 function createTestEmailSignin({publishableKey,storage,fetchImpl=fetch,cryptoImpl=crypto,clock=Date.now}={}){
  if(!/^sb_publishable_[A-Za-z0-9_-]+$/.test(publishableKey||'')||!storage)throw Error('Test sign-in is unavailable.');
  const encode=bytes=>btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  const read=()=>{try{return JSON.parse(storage.getItem(KEY));}catch{return null;}};
  async function post(path,body){
   let r;try{r=await fetchImpl(PROJECT+'/auth/v1/'+path,{method:'POST',redirect:'error',cache:'no-store',signal:AbortSignal.timeout(20000),headers:{apikey:publishableKey,'Content-Type':'application/json'},body:JSON.stringify(body)});}catch{throw Error('Sign-in did not respond. Please try again shortly.');}
   let data;try{data=await r.json();}catch{throw Error('Sign-in is temporarily unavailable.');}
   if(!r.ok){
    if(r.status===429)throw Error('Please wait a minute before requesting another sign-in link.');
    if(data.code==='email_address_not_authorized'||data.error_code==='email_address_not_authorized')throw Error('Staging email delivery is restricted. The test email service needs to be configured.');
    throw Error('Sign-in could not be completed. Request a fresh link and open it in the same Chrome profile.');
   }
   return data;
  }
  return Object.freeze({
   async send(email){
    email=String(email||'').trim().toLowerCase();if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>254)throw Error('Enter your test account email.');
    const existing=read();if(existing&&clock()-existing.createdAt<60000)throw Error('Please wait a minute before requesting another sign-in link.');
    const verifier=encode(cryptoImpl.getRandomValues(new Uint8Array(32)));
    const challenge=encode(new Uint8Array(await cryptoImpl.subtle.digest('SHA-256',new TextEncoder().encode(verifier))));
    const pending={email,verifier,createdAt:clock()};storage.setItem(KEY,JSON.stringify(pending));
    try{await post('otp?redirect_to='+encodeURIComponent(RETURN),{email,create_user:false,code_challenge:challenge,code_challenge_method:'s256'});}catch(e){storage.removeItem(KEY);throw e;}
   },
   async complete(code){
    const pending=read();
    if(!pending||!/^[A-Za-z0-9_-]{43}$/.test(pending.verifier||'')||!Number.isFinite(pending.createdAt)||clock()-pending.createdAt>3600000||clock()<pending.createdAt||typeof code!=='string'||code.length>2048||!code){storage.removeItem(KEY);throw Error('Open the sign-in link in the same Chrome profile where you requested it, or request a fresh link.');}
    // Consume locally before exchange: a repeated callback cannot reuse it.
    storage.removeItem(KEY);
    const session=await post('token?grant_type=pkce',{auth_code:code,code_verifier:pending.verifier});
    if(!session.access_token||!session.user?.id||session.user.email?.toLowerCase()!==pending.email)throw Error('The sign-in account does not match the requested test account.');
    return session;
   }
  });
 }
 if(typeof module==='object'&&module.exports)module.exports={createTestEmailSignin};else root.createTestEmailSignin=createTestEmailSignin;
})(typeof globalThis==='object'?globalThis:this);
