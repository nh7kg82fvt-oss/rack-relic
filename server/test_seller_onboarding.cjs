'use strict';
const {getTestEnvironmentByAccount}=require('./test_environment_registry.cjs');
const {stripeEnvironment,environmentMetadata,matchesEnvironmentMetadata,idempotencyKey}=require('./test_stripe_environment.cjs');
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const INCLUDE=['configuration.recipient','defaults','identity','requirements'];
const CAPABILITY_STATES=['active','pending','restricted','unsupported','rejected'];
function publicSeller(a){
 const status=a?.configuration?.recipient?.capabilities?.stripe_balance?.stripe_transfers?.status;
 if(!a||a.object!=='v2.core.account'||!/^acct_[A-Za-z0-9]+$/.test(a.id||'')||a.livemode!==false||!/^us$/i.test(a.identity?.country||'')||a.closed!=null&&typeof a.closed!=='boolean'||!Array.isArray(a.applied_configurations)||!a.applied_configurations.includes('recipient')||a.dashboard!=='express'||a.defaults?.responsibilities?.fees_collector!=='application'||a.defaults?.responsibilities?.losses_collector!=='application'||a.defaults?.responsibilities?.requirements_collector!=='stripe'||!CAPABILITY_STATES.includes(status)||!a.requirements||!Array.isArray(a.requirements.entries)||a.requirements.entries.length>1000)throw Error('Invalid seller account');
 // Until active-requirement lifecycle handling is installed, every outstanding
 // requirement entry (including a future one) keeps this rehearsal closed.
 // No raw identity data, requirement description or provider object is exposed.
 const due=a.requirements.entries.length,pending=status==='pending'&&!due?1:0;
 const ready=a.closed!==true&&status==='active'&&!due;
 return {test:true,state:ready?'provider_ready':pending?'verification_pending':'onboarding_required',requirementsDue:due,pendingVerification:pending,transfersEnabled:false,payoutsEnabled:false};
}
function accountPath(id){return '/v2/core/accounts/'+id+'?'+new URLSearchParams(INCLUDE.map((x,i)=>['include['+i+']',x]));}
function linkExpiry(link,accountId,clock,returnUrl){
 const flow=link?.use_case?.account_onboarding;
 let u;try{u=new URL(link.url);}catch{throw Error('Invalid onboarding link');}
 const stamp=x=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(x)?Date.parse(x):NaN;
 const now=clock(),created=stamp(link.created),expires=stamp(link.expires_at);
 if(link.object!=='v2.core.account_link'||link.account!==accountId||link.livemode!==false||u.protocol!=='https:'||u.hostname!=='accounts.stripe.com'||u.port||u.username||u.password||u.pathname!=='/r/'+accountId||u.search||!/^#alu_test_[A-Za-z0-9]+$/.test(u.hash)||!Number.isFinite(created)||!Number.isFinite(expires)||created>now+60000||created<now-60000||expires<=now||expires<=created||expires>now+3600000||link.use_case?.type!=='account_onboarding'||!flow||!Array.isArray(flow.configurations)||flow.configurations.length!==1||flow.configurations[0]!=='recipient'||flow.refresh_url!==returnUrl||flow.return_url!==returnUrl)throw Error('Invalid onboarding link');
 return {url:u.href,expiresAt:Math.floor(expires/1000)};
}
function createTestSellerOnboarding({repository,secretKey,accountId,fetchImpl=globalThis.fetch,clock=Date.now,protectionsEnabled=false}={}){
 const environment=stripeEnvironment(accountId),ACCOUNT=environment.accountId,RETURN=environment.returnUrl;
 if(!/^(sk|rk)_test_[A-Za-z0-9]+$/.test(secretKey||'')||!repository)throw Error('Rack Relic test configuration required');
 if(protectionsEnabled===true&&typeof repository.recordSellerProtection!=='function')throw Error('Seller protection storage required');
 async function call(path,{body,connected,idempotency}={}){
  const json=path.startsWith('/v2/');
  let r;try{r=await fetchImpl('https://api.stripe.com'+path,{method:body?'POST':'GET',cache:'no-store',redirect:'error',signal:AbortSignal.timeout(10000),headers:{Authorization:'Bearer '+secretKey,'Stripe-Version':'2026-10-28.endive',...(body?{'Content-Type':json?'application/json':'application/x-www-form-urlencoded'}:{}),...(connected?{'Stripe-Account':connected}:{}),...(idempotency?{'Idempotency-Key':idempotency}:{})},...(body?{body:json?JSON.stringify(body):new URLSearchParams(body).toString()}:{})});}catch{throw Error('Seller onboarding needs reconciliation');}
  const age=r.headers?.get('age');if(!r.ok||age!=null&&(!/^\d+$/.test(age)||Number(age)>0)||['HIT','STALE','UPDATING'].includes((r.headers?.get('cf-cache-status')||'').toUpperCase())||['HIT','STALE'].includes((r.headers?.get('x-vercel-cache')||'').toUpperCase()))throw Error('Fresh seller evidence unavailable');
  try{return await r.json();}catch{throw Error('Invalid seller evidence');}
 }
 async function platform(){const [a,b]=await Promise.all([call('/v1/account'),call('/v1/balance')]);if(a.id!==ACCOUNT||b.livemode!==false)throw Error('Wrong Stripe sandbox');}
 async function bound(a,seller){if(!a||!/^acct_[A-Za-z0-9]+$/.test(a.id||'')||getTestEnvironmentByAccount(a.id)||a.metadata?.rr_test_seller_id!==seller||a.metadata?.rr_test_platform!==ACCOUNT||!matchesEnvironmentMetadata(a.metadata,environment))throw Error('Seller account mismatch');publicSeller(a);const b=await call('/v1/balance',{connected:a.id});if(b.livemode!==false)throw Error('Test seller required');return a;}
 async function context(authorization){const c=await repository.sellerContext({authorization});if(c?.test!==true||!UUID.test(c.sellerId||'')||!['prepared','dispatched','known'].includes(c.phase)||c.accountId!==null&&!/^acct_[A-Za-z0-9]+$/.test(c.accountId||'')||c.phase==='known'&&!c.accountId||c.phase!=='known'&&c.accountId!==null)throw Error('Invalid seller binding');return Object.freeze({...c});}
 return Object.freeze({async status({authorization}){const c=await context(authorization);if(c.phase!=='known')return {test:true,state:c.phase==='dispatched'?'needs_reconciliation':'not_started',transfersEnabled:false,payoutsEnabled:false};const checkedAt=clock();await platform();const a=await bound(await call(accountPath(c.accountId)),c.sellerId);const fresh=await context(authorization);if(fresh.sellerId!==c.sellerId||fresh.accountId!==a.id)throw Error('Seller access changed');if(protectionsEnabled===true)await repository.recordSellerProtection({authorization,accountId:a.id,ready:publicSeller(a).state==='provider_ready',checkedAt});return publicSeller(a);},
 async start({authorization}){
  let c=await context(authorization);await platform();
  if(c.phase==='dispatched')throw Error('Unknown account creation must be reconciled; do not create another account');
  if(c.phase==='prepared'){
   const claim=await repository.claimSeller({authorization});if(claim?.claimed!==true||claim.sellerId!==c.sellerId)throw Error('Account creation already claimed; reload status');
   // The durable claim remains dispatched on timeouts or failed saves. No POST retry.
   const a=await bound(await call('/v2/core/accounts',{body:{identity:{country:'us'},dashboard:'express',defaults:{responsibilities:{fees_collector:'application',losses_collector:'application'}},configuration:{recipient:{capabilities:{stripe_balance:{stripe_transfers:{requested:true}}}}},metadata:{rr_test_seller_id:c.sellerId,rr_test_platform:ACCOUNT,...environmentMetadata(environment)},include:INCLUDE},idempotency:idempotencyKey(environment,'rr_test_seller_',c.sellerId)}),c.sellerId);
   await repository.saveSeller({authorization,accountId:a.id});c=await context(authorization);if(c.accountId!==a.id||c.phase!=='known')throw Error('Seller binding not confirmed');
  }
  const a=await bound(await call(accountPath(c.accountId)),c.sellerId);
  const link=await call('/v2/core/account_links',{body:{account:a.id,use_case:{type:'account_onboarding',account_onboarding:{configurations:['recipient'],refresh_url:RETURN,return_url:RETURN,collection_options:{fields:'eventually_due'}}}}});
  const checkedLink=linkExpiry(link,a.id,clock,RETURN);
  const fresh=await context(authorization);if(fresh.sellerId!==c.sellerId||fresh.accountId!==a.id)throw Error('Seller access changed');
  return {...publicSeller(a),onboardingUrl:checkedLink.url,expiresAt:checkedLink.expiresAt};
 }});
}
module.exports={createTestSellerOnboarding,publicSeller};
