'use strict';
const STAGING_ORIGIN='https://zvtaqzcqfdjpuwnlpzln.supabase.co';
const BRANCH='test-only-marketplace-foundation';
const EMPTY_MEMBER='00000000-0000-4000-8000-000000000000';
function send(res,status,body){
 for(const [k,v] of Object.entries({'Content-Type':'application/json; charset=utf-8','Cache-Control':'private, no-store, max-age=0','CDN-Cache-Control':'no-store','Vercel-CDN-Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}))res.setHeader(k,v);
 res.statusCode=status;res.end(JSON.stringify(body));
}
// Read-only setup verification. No order creation, payment, webhook, or release
// operation is exposed. Keep Vercel Standard Protection enabled on previews.
function createTestSetupStatus({env=process.env,fetchImpl=globalThis.fetch}={}){
 return async(req,res)=>{
  if(env.VERCEL_ENV!=='preview'||env.VERCEL_GIT_COMMIT_REF!==BRANCH){send(res,404,{error:'Not found'});return;}
  if(req.method!=='GET'){res.setHeader('Allow','GET');send(res,405,{error:'Method not allowed'});return;}
  const dbKey=env.RACK_RELIC_TEST_SUPABASE_SERVER_KEY;
  const stripeKey=env.RACK_RELIC_TEST_STRIPE_KEY;
  const expectedAccount=env.RACK_RELIC_TEST_STRIPE_ACCOUNT;
  if(env.RACK_RELIC_TEST_SUPABASE_URL!==STAGING_ORIGIN||
   typeof dbKey!=='string'||!/^sb_secret_[A-Za-z0-9_-]+$/.test(dbKey)||
   typeof stripeKey!=='string'||! /^(sk|rk)_test_[A-Za-z0-9]+$/.test(stripeKey)||
   typeof expectedAccount!=='string'||!/^acct_[A-Za-z0-9]+$/.test(expectedAccount)){
   send(res,503,{test:true,ready:false,error:'Test configuration incomplete',checkout:'disabled'});return;
  }
  async function json(url,options){
   const r=await fetchImpl(url,{...options,redirect:'error',cache:'no-store',signal:AbortSignal.timeout(10000)});
   if(!r.ok)throw Error('Connection check failed');
   if(['HIT','STALE','UPDATING'].includes((r.headers?.get('x-vercel-cache')||'').toUpperCase()))throw Error('Cached check rejected');
   const age=r.headers?.get('age');if(age!=null&&(!/^\d+$/.test(age)||Number(age)>0))throw Error('Cached check rejected');
   return r.json();
  }
  const checks={database:'unavailable',stripe:'unavailable'};
  await Promise.all([
   (async()=>{try{
    const rows=await json(STAGING_ORIGIN+'/rest/v1/rpc/rr_test_member_orders',{method:'POST',headers:{apikey:dbKey,Authorization:'Bearer '+dbKey,'Content-Type':'application/json'},body:JSON.stringify({p_member:EMPTY_MEMBER})});
    if(!Array.isArray(rows)||rows.length!==0)throw Error('Unexpected verification result');
    checks.database='connected';
   }catch{}})(),
   (async()=>{try{
    const headers={Authorization:'Bearer '+stripeKey,'Stripe-Version':'2026-09-30.endive'};
    const [account,balance]=await Promise.all([
     json('https://api.stripe.com/v1/account',{method:'GET',headers}),
     json('https://api.stripe.com/v1/balance',{method:'GET',headers})
    ]);
    if(account.id!==expectedAccount||account.object!=='account'||balance.object!=='balance'||balance.livemode!==false)throw Error('Sandbox mismatch');
    checks.stripe='connected';
   }catch{}})()
  ]);
  const ready=Object.values(checks).every(v=>v==='connected');
  send(res,ready?200:503,{test:true,ready,...checks,checkout:'disabled'});
 };
}
module.exports={createTestSetupStatus};
