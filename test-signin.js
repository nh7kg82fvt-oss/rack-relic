'use strict';
(function(root){
 const environments=typeof module==='object'&&module.exports?require('./test-environments.js'):root.RackRelicTestEnvironments;
 function createTestEmailSignin({publishableKey,projectUrl,returnUrl,environmentId,storage,fetchImpl=fetch,cryptoImpl=crypto,clock=Date.now}={}){
  const legacy=environments?.find(row=>row.id==='legacy');
  projectUrl=projectUrl===undefined?legacy?.projectUrl:projectUrl;
  returnUrl=returnUrl===undefined?legacy?.returnUrl:returnUrl;
  const environment=environments?.find(row=>row.projectUrl===projectUrl&&row.returnUrl===returnUrl&&(environmentId===undefined||row.id===environmentId));
  if(!environment||typeof root.location?.origin==='string'&&root.location.origin!==environment.previewOrigin||!/^sb_publishable_[A-Za-z0-9_-]+$/.test(publishableKey||'')||!storage)throw Error('Test sign-in is unavailable.');
  const PROJECT=environment.projectUrl,RETURN=environment.returnUrl,KEY='rr-test-email-signin'+(environment.id==='legacy'?'':':'+environment.id);
  const encode=bytes=>btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  const read=()=>{try{return JSON.parse(storage.getItem(KEY));}catch{return null;}};
  async function post(path,body){
   let r;try{r=await fetchImpl(PROJECT+'/auth/v1/'+path,{method:'POST',redirect:'error',cache:'no-store',signal:AbortSignal.timeout(20000),headers:{apikey:publishableKey,'Content-Type':'application/json'},body:JSON.stringify(body)});}catch{throw Error('Sign-in did not respond. Please try again shortly.');}
   let data;try{data=await r.json();}catch{throw Error('Sign-in is temporarily unavailable.');}
   if(!r.ok){
    if(r.status===429){
     const code=data.code||data.error_code;
     if(code==='over_email_send_rate_limit')throw Error('Rack sign-in email has reached its delivery limit. A new email was not sent. Repeated requests will not fix this; the Rack email sender needs checking.');
     const value=r.headers?.get('retry-after'),seconds=/^[1-9][0-9]{0,5}$/.test(value||'')?Number(value):null;
     throw Error(seconds?'Sign-in requests are limited. Wait '+Math.ceil(seconds/60)+' minute(s) before trying once more.':'Sign-in requests are limited. A new email was not confirmed. Please wait before trying again.');
    }
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
    const pending={email,verifier,createdAt:clock(),...(environment.id==='legacy'?{}:{environmentId:environment.id,projectUrl:PROJECT,returnUrl:RETURN})};storage.setItem(KEY,JSON.stringify(pending));
    try{await post('otp?redirect_to='+encodeURIComponent(RETURN),{email,create_user:false,code_challenge:challenge,code_challenge_method:'s256'});}catch(e){storage.removeItem(KEY);throw e;}
   },
   async complete(code){
    const pending=read();
    const bound=environment.id==='legacy'?pending?.environmentId===undefined:pending?.environmentId===environment.id&&pending.projectUrl===PROJECT&&pending.returnUrl===RETURN;
    if(!pending||!bound||!/^[A-Za-z0-9_-]{43}$/.test(pending.verifier||'')||!Number.isFinite(pending.createdAt)||clock()-pending.createdAt>3600000||clock()<pending.createdAt||typeof code!=='string'||code.length>2048||!code){storage.removeItem(KEY);throw Error('Open the sign-in link in the same Chrome profile where you requested it, or request a fresh link.');}
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
