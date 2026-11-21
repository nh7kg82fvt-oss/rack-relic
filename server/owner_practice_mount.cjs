'use strict';
const {createClosedOwnerFixtureRuntime,ENV,RETURN_PATH,BEGIN_PATH,MODE}=require('./owner_practice_runtime.cjs');
const {createTestMarketplaceRuntime}=require('./test_marketplace_runtime.cjs');
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const SETTINGS=Object.freeze(['VERCEL_ENV','VERCEL_GIT_COMMIT_REF','RACK_RELIC_TEST_SUPABASE_URL','RACK_RELIC_TEST_STRIPE_ACCOUNT',
 'RACK_RELIC_TEST_ADMIN_OVERVIEW_ENABLED','RACK_RELIC_TEST_MEMBER_IDS','RACK_RELIC_TEST_REFUND_OPERATOR_IDS',
 'RACK_RELIC_TEST_ADMIN_OWNER_ID','RACK_RELIC_TEST_REFUNDS_ENABLED','RACK_RELIC_TEST_REFUND_REQUESTS_ENABLED']);
const uuid=v=>typeof v==='string'&&UUID.test(v)&&v!=='00000000-0000-0000-0000-000000000000';
function selected(env){return env?.RACK_RELIC_OWNER_PRACTICE_ENABLED==='true'&&env.VERCEL_ENV==='preview'&&
 env.VERCEL_GIT_COMMIT_REF===ENV.branch&&env.RACK_RELIC_TEST_SUPABASE_URL===ENV.projectUrl&&env.RACK_RELIC_TEST_STRIPE_ACCOUNT===ENV.accountId;}
function binding(raw){
 try{
  if(typeof raw!=='string'||Buffer.byteLength(raw)>2048)return null;
  const b=JSON.parse(raw),keys=['version','mode','ownerId','fixtureId','notBefore','notAfter'];
  if(!b||Object.getPrototypeOf(b)!==Object.prototype||Object.keys(b).length!==keys.length||keys.some(k=>!Object.hasOwn(b,k))||
   b.version!=='rr-owner-practice-binding-v1'||b.mode!==MODE||!uuid(b.ownerId)||!uuid(b.fixtureId)||
   !Number.isSafeInteger(b.notBefore)||!Number.isSafeInteger(b.notAfter)||b.notAfter<=b.notBefore||b.notAfter-b.notBefore>3600000)return null;
  return Object.freeze(b);
 }catch{return null;}
}
function closed(res,status=404){
 for(const [k,v] of Object.entries({'Cache-Control':'private, no-store','CDN-Cache-Control':'no-store','Vercel-CDN-Cache-Control':'no-store',
  'Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','Content-Type':'application/json'}))res.setHeader(k,v);
 res.statusCode=status;res.end(JSON.stringify({error:status===404?'Not found':'Fictional practice request is held'}));
}
// This is local construction availability, not provider readiness or authority.
// All inputs default NULL/OFF; constructing it performs no network requests.
function createOwnerPracticeMount({env=null,fetchImpl=null,clock=Date.now,monotonicClock=()=>performance.now()}={}){
 const featureSelected=selected(env),b=featureSelected?binding(env.RACK_RELIC_OWNER_PRACTICE_BINDING):null;
 // Keep interception selected on conflicting checkout configuration: never
 // fall through into a legacy financial route while asserting payments closed.
 let runtime=createClosedOwnerFixtureRuntime();
 if(b&&env.RACK_RELIC_TEST_ADMIN_OWNER_ID===b.ownerId&&env.RACK_RELIC_TEST_CHECKOUT_ENABLED!=='true'){
  // Published Command selection currently depends on historical refund flags.
  // These private selection inputs exist only in this owner-only composition;
  // the supplied environment and actual checkout/refund globals are untouched.
  const settings=Object.fromEntries(SETTINGS.map(k=>[k,typeof env[k]==='string'?env[k]:'']));
  settings.RACK_RELIC_TEST_ADMIN_OVERVIEW_ENABLED='true';
  settings.RACK_RELIC_TEST_REFUNDS_ENABLED='true';settings.RACK_RELIC_TEST_REFUND_REQUESTS_ENABLED='true';
  runtime=createClosedOwnerFixtureRuntime({enabled:true,configuration:{ownerId:b.ownerId,fixtureId:b.fixtureId,
   notBefore:b.notBefore,notAfter:b.notAfter,branch:ENV.branch,projectUrl:ENV.projectUrl,accountId:ENV.accountId,origin:ENV.previewOrigin},
   commandSettings:settings,serverKey:env.RACK_RELIC_TEST_SUPABASE_SERVER_KEY,publishableKey:env.RACK_RELIC_TEST_SUPABASE_PUBLISHABLE_KEY,
   stripeRestrictedKey:env.RACK_RELIC_OWNER_PRACTICE_STRIPE_KEY,fetchImpl,clock,monotonicClock});
 }
 function localAvailability(){try{const now=clock();return runtime.ready===true&&Number.isSafeInteger(now)&&now>=b.notBefore&&now<b.notAfter;}catch{return false;}}
 async function beginHandler(req,res){if(!featureSelected){closed(res);return;}await runtime.handler(req,res);}
 return Object.freeze({featureSelected,localAvailability,beginHandler,returnHandler:runtime.handler});
}
function reviewedHistoricalRead(req){
 if(req.method!=='GET'||typeof req.url!=='string')return false;
 return [RETURN_PATH+'?action=config',RETURN_PATH+'?action=orders',RETURN_PATH+'?view=cancel'].includes(req.url)||
  new RegExp('^'+RETURN_PATH+'\\?view=return&session_id=cs_test_[A-Za-z0-9]+$').test(req.url)||
  new RegExp('^'+RETURN_PATH+'\\?code=[A-Za-z0-9_-]{1,2048}$').test(req.url);
}
function createOwnerPracticeMarketplaceMount({env=null,fetchImpl=null,clock=Date.now,monotonicClock=()=>performance.now()}={}){
 const mount=createOwnerPracticeMount({env,fetchImpl,clock,monotonicClock});
 // Legacy handler and its own guards remain unchanged. OFF retains its behavior.
 const legacy=createTestMarketplaceRuntime({env:env||{},fetchImpl,clock});
 async function handler(req,res){
  if(!mount.featureSelected){await legacy(req,res);return;}
  if(req.url===RETURN_PATH){await mount.returnHandler(req,res);return;}
  // Sole-code email/Command PKCE is a historical Auth exchange, not a passive
  // owner-practice callback. Checkout result URLs prove no payment completion.
  if(reviewedHistoricalRead(req)){await legacy(req,res);return;}
  closed(res,400);
 }
 return Object.freeze({handler,localAvailability:mount.localAvailability});
}
module.exports=Object.freeze({createOwnerPracticeMount,createOwnerPracticeMarketplaceMount,reviewedHistoricalRead,BEGIN_PATH,RETURN_PATH});
