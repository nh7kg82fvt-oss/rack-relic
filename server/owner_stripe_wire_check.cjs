'use strict';
// A closed, read-only entry point. No I/O on construction and no seller/action grant.
const {createCommandSessionService}=require('./command_session.cjs');
const {RPC:OWNER_RPC}=require('./command_owner_session_reader.cjs');
const {ENV,API_VERSION}=require('./owner_practice_runtime.cjs');
const {budget}=require('./private-practice/practice_io.cjs');
const {createSellerGetPreflight,SellerGetPreflightHeld,LIST_PATH}=require('./seller_get_preflight.cjs');
const PATH='/api/closed-practice-seller/wire-check',LIMIT=5000;
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const SETTINGS=['VERCEL_ENV','VERCEL_GIT_COMMIT_REF','RACK_RELIC_TEST_SUPABASE_URL','RACK_RELIC_TEST_STRIPE_ACCOUNT',
 'RACK_RELIC_TEST_ADMIN_OVERVIEW_ENABLED','RACK_RELIC_TEST_MEMBER_IDS','RACK_RELIC_TEST_REFUND_OPERATOR_IDS',
 'RACK_RELIC_TEST_ADMIN_OWNER_ID','RACK_RELIC_TEST_REFUNDS_ENABLED','RACK_RELIC_TEST_REFUND_REQUESTS_ENABLED'];
class WireCheckHeld extends Error{constructor(status=503){super('Private Stripe connection check held');this.status=status;}}
const hold=status=>{throw new WireCheckHeld(status);};
function binding(raw){try{
 if(typeof raw!=='string'||Buffer.byteLength(raw)>1024)return null;
 const b=JSON.parse(raw),keys=['version','ownerId','notBefore','notAfter'];
 if(!b||Object.getPrototypeOf(b)!==Object.prototype||Object.keys(b).length!==keys.length||keys.some(k=>!Object.hasOwn(b,k))||
  b.version!=='rr-owner-stripe-wire-window-v1'||!UUID.test(b.ownerId||'')||b.ownerId==='00000000-0000-0000-0000-000000000000'||
  !Number.isSafeInteger(b.notBefore)||!Number.isSafeInteger(b.notAfter)||b.notBefore<1||b.notAfter<=b.notBefore||b.notAfter-b.notBefore>1200000)return null;
 return Object.freeze(b);
}catch{return null;}}
function headers(res){for(const [k,v] of Object.entries({'Cache-Control':'private, no-store','CDN-Cache-Control':'no-store',
 'Vercel-CDN-Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','X-Robots-Tag':'noindex, nofollow',
 'Content-Security-Policy':"default-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"}))res.setHeader(k,v);}
function send(res,status,value){res.statusCode=status;res.setHeader('Content-Type','application/json');res.end(JSON.stringify(value));}
async function form(req,scope){
 const raw=req.body;let replayParsed=false;
 if(raw!==undefined&&typeof raw!=='string'&&!Buffer.isBuffer(raw)){
  const proto=raw&&Object.getPrototypeOf(raw),d=raw&&Object.getOwnPropertyDescriptor(raw,'action');
  if(!raw||proto!==Object.prototype&&proto!==null||Reflect.ownKeys(raw).length!==1||!d||!Object.hasOwn(d,'value')||!d.enumerable||d.value!=='wire-check')hold(400);
  if(proto===Object.prototype)return;
  // A host-normalized null-prototype object is insufficient: validate its restored wire bytes too.
  replayParsed=true;
 }
 let bytes;
 if(raw!==undefined&&!replayParsed)bytes=Buffer.from(raw);
 else{
  const parts=[];let size=0;const reader=req[Symbol.asyncIterator]();
  try{for(;;){const next=await scope.wait(reader.next());if(next.done)break;const part=Buffer.from(next.value);if((size+=part.length)>64)hold(413);parts.push(part);}bytes=Buffer.concat(parts);}
  finally{parts.forEach(p=>p.fill(0));try{Promise.resolve(reader.return?.()).catch(()=>{});}catch{}}
 }
 try{if(bytes.length>64)hold(413);if(bytes.toString('utf8')!=='action=wire-check')hold(400);}finally{bytes?.fill(0);}
}
function createOwnerStripeWireCheck({env=null,fetchImpl=null,clock=Date.now,monotonicClock=()=>performance.now()}={}){
 const selected=env?.RACK_RELIC_STRIPE_WIRE_PREFLIGHT_ENABLED==='true'&&env.VERCEL_ENV==='preview'&&
  env.VERCEL_GIT_COMMIT_REF===ENV.branch&&env.RACK_RELIC_TEST_SUPABASE_URL===ENV.projectUrl&&env.RACK_RELIC_TEST_STRIPE_ACCOUNT===ENV.accountId;
 const b=selected?binding(env.RACK_RELIC_STRIPE_WIRE_PREFLIGHT_BINDING):null;
 const key=b?env.RACK_RELIC_STRIPE_WIRE_READ_KEY:null;
 const configured=!!b&&env.RACK_RELIC_TEST_ADMIN_OWNER_ID===b.ownerId&&env.RACK_RELIC_TEST_CHECKOUT_ENABLED==='false'&&
  env.RACK_RELIC_OWNER_PRACTICE_ENABLED!=='true'&&env.RACK_PRACTICE_ENABLED!=='true'&&env.RACK_PRACTICE_REFUND_ENABLED!=='true'&&
  /^rk_test_[A-Za-z0-9]{1,200}$/.test(key||'')&&typeof fetchImpl==='function'&&typeof clock==='function'&&typeof monotonicClock==='function';
 const settings=configured?Object.fromEntries(SETTINGS.map(k=>[k,typeof env[k]==='string'?env[k]:''])):null;
 if(settings){
  // Local selection compatibility only. Actual environment/payment/refund flags never change.
  settings.RACK_RELIC_TEST_ADMIN_OVERVIEW_ENABLED='true';settings.RACK_RELIC_TEST_REFUNDS_ENABLED='true';settings.RACK_RELIC_TEST_REFUND_REQUESTS_ENABLED='true';
  settings.RACK_RELIC_TEST_SUPABASE_SERVER_KEY=env.RACK_RELIC_TEST_SUPABASE_SERVER_KEY;
  settings.RACK_RELIC_TEST_SUPABASE_PUBLISHABLE_KEY=env.RACK_RELIC_TEST_SUPABASE_PUBLISHABLE_KEY;
 }
 const probe=settings?createCommandSessionService({env:settings,clock,fetchImpl:()=>hold()}):null;
 const ready=configured&&probe?.config?.owner===b.ownerId&&probe.config.projectUrl===ENV.projectUrl;
 async function handler(req,res){
  headers(res);
  if(!ready||req.url!==PATH){send(res,404,{error:'Not found'});return;}
  if(!['GET','POST'].includes(req.method)){res.setHeader('Allow','GET, POST');send(res,405,{error:'Method not allowed'});return;}
  if(req.method==='POST'&&(req.headers?.origin!==ENV.previewOrigin||req.headers?.['sec-fetch-site']!=='same-origin')){send(res,403,{error:'Owner action denied'});return;}
  if(req.method==='POST'&&!/^application\/x-www-form-urlencoded(?:\s*;\s*charset=UTF-8)?$/i.test(req.headers?.['content-type']||'')){send(res,415,{error:'Expected action form'});return;}
  let scope,observer,identity,heldStage='owner';const controller=new AbortController();
  const disconnect=()=>controller.abort();req.once?.('aborted',disconnect);res.once?.('close',disconnect);
  try{
   scope=budget(controller.signal,clock,monotonicClock,LIMIT);
   function check(){const now=scope.check();if(now<b.notBefore||now>=b.notAfter||req.aborted===true||res.destroyed===true||res.writableEnded===true||identity&&now>=identity.expiresAt)hold();return now;}
   const noCookies=Object.freeze({getHeader(){return undefined;},setHeader(){hold();}});
   const session=createCommandSessionService({env:settings,clock,fetchImpl:async(url,init)=>{
    check();if(!((url===ENV.projectUrl+'/auth/v1/user'&&init?.method==='GET')||(url===ENV.projectUrl+'/rest/v1/rpc/'+OWNER_RPC&&init?.method==='POST')))hold();
    return scope.wait(Promise.resolve().then(()=>{check();return fetchImpl(url,{...init,signal:AbortSignal.any([scope.signal,init.signal])});}));
   }});
   async function current(stage='owner'){
    heldStage=stage;
    check();const owner=await scope.wait(session.resolve(req,noCookies));
    if(owner.member!==b.ownerId||!UUID.test(owner.sessionRef||'')||!Number.isSafeInteger(owner.expiresAt)||owner.expiresAt<=check())hold(403);
    if(identity&&(owner.member!==identity.member||owner.sessionRef!==identity.sessionRef||owner.expiresAt!==identity.expiresAt))hold(403);
    if(!identity)identity=Object.freeze({member:owner.member,sessionRef:owner.sessionRef,expiresAt:owner.expiresAt});check();
   }
   await current();
   if(req.method==='GET'){
    check();res.statusCode=200;res.setHeader('Content-Type','text/html; charset=utf-8');check();
    res.setHeader('Referrer-Policy','same-origin');
    res.end('<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Stripe test connection | Rack Relic</title><main><h1>Check the Stripe test connection</h1><p>This performs up to five read-only requests in the private test account. It creates no seller, payment, refund or transfer. Payments remain closed.</p><p>This does not verify seller-creation permissions or launch readiness. There are no automatic retries. A repeated form submission can perform another read; the limit is per request, not a durable cross-restart claim.</p><form method="post" action="'+PATH+'"><button name="action" value="wire-check" type="submit">Run one read-only check</button></form><p><a href="/api/command-center">Return to Rack Command</a></p></main></html>');return;
   }
   heldStage='form';await form(req,scope);await current();
   const paths=['/v1/account','/v1/balance',LIST_PATH,'/v1/account','/v1/balance'];let dispatched=0;
   heldStage='provider';
   observer=createSellerGetPreflight({enabled:true,secretKey:key,clock,monotonicClock,fetchImpl:async(url,init)=>{
    heldStage='provider';check();
    if(dispatched>=paths.length||url!=='https://api.stripe.com'+paths[dispatched]||init?.method!=='GET'||Object.hasOwn(init,'body')||
     init.headers?.Authorization!=='Bearer '+key||init.headers['Stripe-Version']!==API_VERSION||init.headers['Accept-Encoding']!=='identity'||
     ['Stripe-Account','Stripe-Context','Idempotency-Key'].some(k=>Object.hasOwn(init.headers,k)))hold();
    await current();heldStage='provider';check();dispatched++;
    const response=await scope.wait(Promise.resolve().then(()=>{check();return fetchImpl(url,{...init,signal:AbortSignal.any([scope.signal,init.signal])});}));
    await current();heldStage='provider';check();return response;
   }});
   let observation,state='observed';
   try{observation=await scope.wait(observer.run(scope.signal));}
   catch(error){if(!(error instanceof SellerGetPreflightHeld))throw error;state='held';observation={code:error.code,observations:error.evidence};}
   await current('final-owner');check();res.statusCode=state==='observed'?200:503;res.setHeader('Content-Type','application/json');check();
   res.end(JSON.stringify({version:'rr-owner-stripe-wire-report-v1',state,diagnosticOnly:true,providerWrites:false,
    sellerReadinessVerified:false,writePermissionsVerified:false,launchClearance:false,durableCrossRestartOneShot:false,observation}));
  }catch(error){
   if(!res.headersSent&&req.aborted!==true&&!res.destroyed&&!res.writableEnded)send(res,[401,403,400,413].includes(error?.status)?error.status:503,{error:'The private Stripe test check is held. No seller or payment action is authorized.',heldStage});
  }finally{observer?.close();scope?.close();controller.abort();req.off?.('aborted',disconnect);res.off?.('close',disconnect);}
 }
 return Object.freeze({ready,handler});
}
module.exports=Object.freeze({createOwnerStripeWireCheck,WireCheckHeld,PATH,LIMIT,binding});
