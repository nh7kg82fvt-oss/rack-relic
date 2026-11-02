'use strict';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ACCOUNT='acct_1UWJZuGVbz9Pnhxd';
const RETURN='https://rack-relic-git-test-only-marketplace-foundation-rack-relic.vercel.app/api/test-marketplace';
function publicSeller(a){
 if(!a||a.object!=='account'||!/^acct_[A-Za-z0-9]+$/.test(a.id||'')||a.country!=='US'||typeof a.details_submitted!=='boolean'||typeof a.payouts_enabled!=='boolean'||!a.requirements||!Array.isArray(a.requirements.currently_due)||!Array.isArray(a.requirements.past_due)||!Array.isArray(a.requirements.pending_verification)||a.capabilities?.transfers&&!['active','pending','inactive'].includes(a.capabilities.transfers))throw Error('Invalid seller account');
 const due=a.requirements.currently_due.length+a.requirements.past_due.length, pending=a.requirements.pending_verification.length;
 const ready=a.details_submitted&&a.payouts_enabled&&a.capabilities?.transfers==='active'&&!due&&!pending&&!a.requirements.disabled_reason;
 return {test:true,state:ready?'provider_ready':pending?'verification_pending':'onboarding_required',requirementsDue:due,pendingVerification:pending,transfersEnabled:false,payoutsEnabled:false};
}
function createTestSellerOnboarding({repository,secretKey,accountId,fetchImpl=globalThis.fetch,clock=Date.now}={}){
 if(accountId!==ACCOUNT||!/^(sk|rk)_test_[A-Za-z0-9]+$/.test(secretKey||'')||!repository)throw Error('Rack Relic test configuration required');
 async function call(path,{body,connected,idempotency}={}){
  let r;try{r=await fetchImpl('https://api.stripe.com'+path,{method:body?'POST':'GET',cache:'no-store',redirect:'error',signal:AbortSignal.timeout(10000),headers:{Authorization:'Bearer '+secretKey,'Stripe-Version':'2026-10-28.endive',...(body?{'Content-Type':'application/x-www-form-urlencoded'}:{}),...(connected?{'Stripe-Account':connected}:{}),...(idempotency?{'Idempotency-Key':idempotency}:{})},...(body?{body:new URLSearchParams(body).toString()}:{})});}catch{throw Error('Seller onboarding needs reconciliation');}
  const age=r.headers?.get('age');if(!r.ok||age!=null&&(!/^\d+$/.test(age)||Number(age)>0)||['HIT','STALE','UPDATING'].includes((r.headers?.get('cf-cache-status')||'').toUpperCase())||['HIT','STALE'].includes((r.headers?.get('x-vercel-cache')||'').toUpperCase()))throw Error('Fresh seller evidence unavailable');
  try{return await r.json();}catch{throw Error('Invalid seller evidence');}
 }
 async function platform(){const [a,b]=await Promise.all([call('/v1/account'),call('/v1/balance')]);if(a.id!==ACCOUNT||b.livemode!==false)throw Error('Wrong Stripe sandbox');}
 async function bound(a,seller){if(!a||!/^acct_[A-Za-z0-9]+$/.test(a.id||'')||a.id===ACCOUNT||a.metadata?.rr_test_seller_id!==seller||a.metadata?.rr_test_platform!==ACCOUNT)throw Error('Seller account mismatch');publicSeller(a);const b=await call('/v1/balance',{connected:a.id});if(b.livemode!==false)throw Error('Test seller required');return a;}
 async function context(authorization){const c=await repository.sellerContext({authorization});if(c?.test!==true||!UUID.test(c.sellerId||'')||!['prepared','dispatched','known'].includes(c.phase)||c.accountId!==null&&!/^acct_[A-Za-z0-9]+$/.test(c.accountId||'')||c.phase==='known'&&!c.accountId||c.phase!=='known'&&c.accountId!==null)throw Error('Invalid seller binding');return Object.freeze({...c});}
 return Object.freeze({async status({authorization}){const c=await context(authorization);if(c.phase!=='known')return {test:true,state:c.phase==='dispatched'?'needs_reconciliation':'not_started',transfersEnabled:false,payoutsEnabled:false};await platform();const a=await bound(await call('/v1/accounts/'+c.accountId),c.sellerId);await context(authorization);return publicSeller(a);},
 async start({authorization}){
  let c=await context(authorization);await platform();
  if(c.phase==='dispatched')throw Error('Unknown account creation must be reconciled; do not create another account');
  if(c.phase==='prepared'){
   const claim=await repository.claimSeller({authorization});if(claim?.claimed!==true||claim.sellerId!==c.sellerId)throw Error('Account creation already claimed; reload status');
   // The durable claim remains dispatched on timeouts or failed saves. No POST retry.
   const a=await bound(await call('/v1/accounts',{body:{type:'express',country:'US','capabilities[transfers][requested]':'true','metadata[rr_test_seller_id]':c.sellerId,'metadata[rr_test_platform]':ACCOUNT},idempotency:'rr_test_seller_'+c.sellerId}),c.sellerId);
   await repository.saveSeller({authorization,accountId:a.id});c=await context(authorization);if(c.accountId!==a.id||c.phase!=='known')throw Error('Seller binding not confirmed');
  }
  const a=await bound(await call('/v1/accounts/'+c.accountId),c.sellerId);
  const link=await call('/v1/account_links',{body:{account:a.id,type:'account_onboarding',refresh_url:RETURN,return_url:RETURN,'collection_options[fields]':'eventually_due'}});
  let u;try{u=new URL(link.url);}catch{throw Error('Invalid onboarding link');}
  const now=Math.floor(clock()/1000);if(link.object!=='account_link'||u.protocol!=='https:'||u.hostname!=='connect.stripe.com'||u.port||u.username||u.password||!u.pathname.startsWith('/setup/')||u.hash||!Number.isSafeInteger(link.expires_at)||link.expires_at<=now||link.expires_at>now+3600)throw Error('Invalid onboarding link');
  const fresh=await context(authorization);if(fresh.sellerId!==c.sellerId||fresh.accountId!==a.id)throw Error('Seller access changed');
  return {...publicSeller(a),onboardingUrl:u.href,expiresAt:link.expires_at};
 }});
}
module.exports={createTestSellerOnboarding,publicSeller};
