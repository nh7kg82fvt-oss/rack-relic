'use strict';
const {randomUUID}=require('node:crypto');
const {createCommandSessionService}=require('./command_session.cjs');
const {createTestSellerOnboarding}=require('./test_seller_onboarding.cjs');
const {createClosedSellerReturnView}=require('./owner_practice_page.cjs');
const {TEST_ENVIRONMENTS,getTestEnvironmentByAccount}=require('./test_environment_registry.cjs');
const {idempotencyKey}=require('./test_stripe_environment.cjs');
const ENV=TEST_ENVIRONMENTS.acceptance;
const RETURN_PATH='/api/test-marketplace',BEGIN_PATH='/api/closed-practice-seller/begin';
const OWNER_RPC='rr_test_command_owner_session',SQL_RPC='rr_test_owner_fixture_seller_action';
const VERSION='rr-owner-fixture-seller-action-v1',MODE='owner-operated-fictional-rehearsal';
const API_VERSION='2026-10-28.endive',TTL=5000,MAX_RPC=8192,MAX_PROVIDER=65536;
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const SETTINGS=Object.freeze(['VERCEL_ENV','VERCEL_GIT_COMMIT_REF','RACK_RELIC_TEST_SUPABASE_URL',
 'RACK_RELIC_TEST_STRIPE_ACCOUNT','RACK_RELIC_TEST_ADMIN_OVERVIEW_ENABLED',
 'RACK_RELIC_TEST_MEMBER_IDS','RACK_RELIC_TEST_REFUND_OPERATOR_IDS',
 'RACK_RELIC_TEST_ADMIN_OWNER_ID','RACK_RELIC_TEST_REFUNDS_ENABLED','RACK_RELIC_TEST_REFUND_REQUESTS_ENABLED']);
class OwnerFixtureHeld extends Error {
 constructor(code='practice_held',status=503){super('Fictional seller setup is held');this.code=code;this.status=status;}
}
const hold=(code,status)=>{throw new OwnerFixtureHeld(code,status);};
const uuid=v=>typeof v==='string'&&UUID.test(v)&&v!=='00000000-0000-0000-0000-000000000000';
const account=v=>typeof v==='string'&&/^acct_[A-Za-z0-9]+$/.test(v)&&!getTestEnvironmentByAccount(v);
function exact(value,keys,status=503){
 if(!value||Object.getPrototypeOf(value)!==Object.prototype||Reflect.ownKeys(value).length!==keys.length)hold('invalid_data',status);
 const out={};
 for(const key of keys){const d=Object.getOwnPropertyDescriptor(value,key);if(!d||!Object.hasOwn(d,'value')||!d.enumerable)hold('invalid_data',status);out[key]=d.value;}
 return out;
}
function plain(value,depth=0){
 if(depth>16)hold('invalid_json');
 if(value===null||['string','boolean','number'].includes(typeof value)){
  if(typeof value==='number'&&!Number.isFinite(value))hold('invalid_json');return value;
 }
 if(!value||typeof value!=='object'||Object.getPrototypeOf(value)!==(Array.isArray(value)?Array.prototype:Object.prototype))hold('invalid_json');
 const result=Array.isArray(value)?[]:{};
 for(const key of Reflect.ownKeys(value)){
  if(Array.isArray(value)&&key==='length')continue;
  const d=Object.getOwnPropertyDescriptor(value,key);
  if(typeof key!=='string'||['__proto__','constructor','prototype'].includes(key)||!d||!Object.hasOwn(d,'value')||!d.enumerable)hold('invalid_json');
  result[key]=plain(d.value,depth+1);
 }
 return result;
}
function configuration(value){
 try{
  const c=exact(value,['ownerId','fixtureId','notBefore','notAfter','branch','projectUrl','accountId','origin']);
  if(!uuid(c.ownerId)||!uuid(c.fixtureId)||!Number.isSafeInteger(c.notBefore)||!Number.isSafeInteger(c.notAfter)||
   c.notAfter<=c.notBefore||c.notAfter-c.notBefore>3600000||c.branch!==ENV.branch||
   c.projectUrl!==ENV.projectUrl||c.accountId!==ENV.accountId||c.origin!==ENV.previewOrigin)return null;
  return Object.freeze(c);
 }catch{return null;}
}
function commandSettings(value,ownerId){
 try{
  const settings=exact(value,SETTINGS);
  if(Object.values(settings).some(v=>typeof v!=='string')||settings.VERCEL_ENV!=='preview'||
   settings.VERCEL_GIT_COMMIT_REF!==ENV.branch||settings.RACK_RELIC_TEST_SUPABASE_URL!==ENV.projectUrl||
   settings.RACK_RELIC_TEST_STRIPE_ACCOUNT!==ENV.accountId||settings.RACK_RELIC_TEST_ADMIN_OWNER_ID!==ownerId)return null;
  return Object.freeze(settings);
 }catch{return null;}
}
function uncached(headers){
 const age=headers.get('age'),encoding=headers.get('content-encoding'),cc=headers.get('cache-control')||'';
 if(headers.get('location')!==null||age!==null&&age!=='0'||encoding!==null&&encoding.toLowerCase()!=='identity'||
  /\b(?:public|immutable|stale-if-error|stale-while-revalidate)\b/i.test(cc)||
  cc.split(',').some(v=>/\b(?:s-maxage|max-age)\b/i.test(v)&&!/^\s*(?:s-maxage|max-age)\s*=\s*(?:0|"0")\s*$/i.test(v)))hold('cached_wire');
 for(const key of ['x-cache','cf-cache-status','x-vercel-cache']){const value=headers.get(key);if(value!==null&&!['MISS','BYPASS','DYNAMIC'].includes(value.toUpperCase()))hold('cached_wire');}
}
function safeContext(value,fixtureId){
 const c=exact(value,['test','sellerId','phase','accountId']);
 if(c.test!==true||c.sellerId!==fixtureId||!['prepared','dispatched','known'].includes(c.phase)||
  (c.phase==='known'?!account(c.accountId):c.accountId!==null))hold('invalid_fixture_context');
 return Object.freeze(c);
}
function safeStatus(value){
 const known=['provider_ready','verification_pending','onboarding_required'];
 if(value?.test!==true||!known.includes(value.state)||value.transfersEnabled!==false||value.payoutsEnabled!==false||
  !Number.isSafeInteger(value.requirementsDue)||value.requirementsDue<0||value.requirementsDue>1000||
  !Number.isSafeInteger(value.pendingVerification)||value.pendingVerification<0||value.pendingVerification>1)hold('invalid_status');
 return Object.freeze({test:true,state:value.state,requirementsDue:value.requirementsDue,pendingVerification:value.pendingVerification,transfersEnabled:false,payoutsEnabled:false});
}
function headers(res){
 for(const [name,value] of Object.entries({'Cache-Control':'private, no-store','CDN-Cache-Control':'no-store',
  'Vercel-CDN-Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff',
  'X-Robots-Tag':'noindex, nofollow','Content-Security-Policy':"default-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self' https://accounts.stripe.com"}))res.setHeader(name,value);
}
function send(res,status,value){res.statusCode=status;res.setHeader('Content-Type','application/json');res.end(JSON.stringify(value));}
function observationPage(value){
 const label={provider_ready:'The fictional setup currently meets the provider checks.',verification_pending:'The provider is still checking this fictional account.',onboarding_required:'Provider setup still needs attention.'}[value.state];
 return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Fictional setup review | Rack Relic</title></head><body><main><p>Rack Relic · owner practice</p><h1>Fictional setup review</h1><p>'+label+'</p><p>Outstanding provider requirements: '+value.requirementsDue+'.</p><p>Payments remain closed. This owner-operated rehearsal does not prove a real seller’s identity, eligibility or acceptance of terms.</p><p><a href="'+RETURN_PATH+'">Return to setup review</a></p><p><a href="/api/command-center">Return to Rack Command</a></p></main></body></html>';
}
function confirmationPage(){
 return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Open fictional practice | Rack Relic</title></head><body><main><p>Rack Relic · owner practice</p><h1>Open fictional seller practice</h1><p>This is an owner-operated fictional TEST rehearsal. It does not verify a real seller, accept seller terms or open payments.</p><p>Provider readiness is unverified. Continuing can create the single fictional account only when its original durable claim is available, then open its confidential Stripe setup page. If an outcome is unknown, hold and review the original account; do not create a replacement.</p><form method="post" action="'+BEGIN_PATH+'"><input type="hidden" name="action" value="begin"><button type="submit">Continue fictional practice</button></form><p><a href="/api/command-center">Return to Rack Command</a></p></main></body></html>';
}
// All authority/configuration/transport inputs default NULL/OFF. Constructing
// this module performs no I/O and discovers no process environment or cookies.
function createClosedOwnerFixtureRuntime({enabled=false,configuration:rawConfiguration=null,commandSettings:rawSettings=null,
 serverKey=null,publishableKey=null,stripeRestrictedKey=null,fetchImpl=null,clock=Date.now,monotonicClock=()=>performance.now()}={}){
 const cfg=configuration(rawConfiguration),settings=cfg?commandSettings(rawSettings,cfg.ownerId):null;
 const configured=enabled===true&&cfg!==null&&settings!==null&&/^sb_secret_[A-Za-z0-9_-]{20,200}$/.test(serverKey||'')&&
  /^sb_publishable_[A-Za-z0-9_-]{20,200}$/.test(publishableKey||'')&&/^rk_test_[A-Za-z0-9]+$/.test(stripeRestrictedKey||'')&&
  typeof fetchImpl==='function'&&typeof clock==='function'&&typeof monotonicClock==='function';
 const scopes=new WeakMap(),activeRequests=new WeakMap(),permits=new WeakMap();
 const noCookies=Object.freeze({getHeader(){return undefined;},setHeader(){hold('cookie_mutation_blocked');}});
 const commandEnv=configured?Object.freeze({...settings,RACK_RELIC_TEST_SUPABASE_SERVER_KEY:serverKey,
  RACK_RELIC_TEST_SUPABASE_PUBLISHABLE_KEY:publishableKey}):null;
 // Construction checks the actual published selection rules, but readiness is
 // only local construction readiness. It proves no installed SQL or access.
 const probe=configured?createCommandSessionService({env:commandEnv,fetchImpl:()=>hold('construction_io'),clock}):null;
 const ready=configured&&probe?.config?.owner===cfg.ownerId&&probe.config.projectUrl===ENV.projectUrl;
 function state(scope){const s=scopes.get(scope);if(!s||!s.open)hold('operation_closed');return s;}
 function check(scope){
  const s=state(scope),wall=clock(),mono=monotonicClock();
  if(s.signal.aborted||!Number.isSafeInteger(wall)||!Number.isFinite(mono)||wall<s.lastWall||mono<s.lastMono||
   wall<cfg.notBefore||wall>=cfg.notAfter||wall-s.startedAt>=s.duration||mono-s.monotonicStart>=s.duration||
   s.identity&&wall>=s.identity.expiresAt)hold('operation_expired');
  s.lastWall=wall;s.lastMono=mono;return wall;
 }
 async function wait(scope,run){
  const s=state(scope);check(scope);let abort;
  try{
   const result=await Promise.race([Promise.resolve().then(()=>{check(scope);return run();}),new Promise((_,reject)=>{
    abort=()=>reject(new OwnerFixtureHeld('operation_expired'));s.signal.addEventListener('abort',abort,{once:true});if(s.signal.aborted)abort();
   })]);check(scope);return result;
  }finally{s.signal.removeEventListener('abort',abort);}
 }
 function openScope(req,res){
  const wall=clock(),mono=monotonicClock();
  if(!Number.isSafeInteger(wall)||!Number.isFinite(mono)||mono<0||wall<cfg.notBefore||wall>=cfg.notAfter||activeRequests.has(req))hold('invalid_operation');
  const scope=Object.freeze({}),controller=new AbortController(),duration=Math.min(TTL,cfg.notAfter-wall);
  const s={open:true,req,res,controller,signal:controller.signal,duration,startedAt:wall,monotonicStart:mono,lastWall:wall,lastMono:mono,
   identity:null,action:null,consumed:false,initialPhase:null,originalAccount:null,provisionalAccount:null,claimAttempted:false,
   createPermit:null,accountPostAttempted:false,saveAttempted:false,bindingSaved:false,linkPostAttempted:false,protectionAttempted:false,
   sensitive:null,redirectAttempted:false,requestId:randomUUID(),rpcRequests:new Set()};
  scopes.set(scope,s);activeRequests.set(req,scope);
  s.timer=setTimeout(()=>controller.abort(),duration);
  s.command=createCommandSessionService({env:commandEnv,clock,fetchImpl:async(url,init)=>{
   check(scope);
   if(!((url===ENV.projectUrl+'/auth/v1/user'&&init?.method==='GET')||
    (url===ENV.projectUrl+'/rest/v1/rpc/'+OWNER_RPC&&init?.method==='POST')))hold('auth_mutation_blocked');
   return wait(scope,()=>fetchImpl(url,{...init,signal:AbortSignal.any([s.signal,init.signal])}));
  }});
  return scope;
 }
 function closeScope(scope){
  const s=scopes.get(scope);if(!s)return;
  s.open=false;s.sensitive=null;if(s.createPermit)permits.delete(s.createPermit);
  clearTimeout(s.timer);s.controller.abort();activeRequests.delete(s.req);scopes.delete(scope);
 }
 async function current(scope){
  const s=state(scope),owner=await wait(scope,()=>s.command.resolve(s.req,noCookies));
  if(owner.member!==cfg.ownerId||!uuid(owner.sessionRef)||!Number.isSafeInteger(owner.expiresAt)||owner.expiresAt<=check(scope))hold('owner_required',403);
  if(s.identity&&(owner.member!==s.identity.member||owner.sessionRef!==s.identity.sessionRef||owner.expiresAt!==s.identity.expiresAt))hold('owner_session_changed',403);
  if(!s.identity)s.identity=Object.freeze({member:owner.member,sessionRef:owner.sessionRef,expiresAt:owner.expiresAt});
  return s.identity;
 }
 function responseGate(scope){
  const s=state(scope);
  return Object.freeze({
   get statusCode(){return s.res.statusCode;},set statusCode(value){check(scope);s.res.statusCode=value;},
   get headersSent(){return s.res.headersSent;},get writableEnded(){return s.res.writableEnded;},
   setHeader(name,value){check(scope);s.res.setHeader(name,value);},
   end(value){check(scope);s.res.end(value);}
  });
 }
 async function readWire(scope,response,url,max,{provider=false}={}){
  if(!Number.isInteger(response?.status)||response.status<200||response.status>299||response.ok!==true||!provider&&response.status!==200||response?.url!==url||response?.redirected!==false||
   !response?.headers?.get||!response?.body?.getReader)hold('invalid_wire');
  const h=response.headers;uncached(h);
  const stamp=Date.parse(h.get('date')||''),length=h.get('content-length');
  if(!Number.isFinite(stamp)||Math.abs(stamp-check(scope))>30000||!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(h.get('content-type')||'')||
   length!==null&&(!/^(0|[1-9][0-9]*)$/.test(length)||Number(length)>max)||provider&&h.get('stripe-version')!==API_VERSION)hold('invalid_wire');
  const reader=response.body.getReader(),parts=[];let size=0;
  try{
   for(;;){const next=await wait(scope,()=>reader.read());if(next.done)break;if(!(next.value instanceof Uint8Array)||(size+=next.value.length)>max)hold('invalid_wire');parts.push(Buffer.from(next.value));}
   if(length!==null&&Number(length)!==size)hold('invalid_wire');
   const bytes=Buffer.concat(parts);try{return plain(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)));}catch(error){if(error instanceof OwnerFixtureHeld)throw error;hold('invalid_json');}finally{bytes.fill(0);}
  }finally{parts.forEach(p=>p.fill(0));try{Promise.resolve(reader.cancel()).catch(()=>{});}catch{}}
 }
 function operationArgs(op,value){
  if(op==='context'||op==='claim')return exact(value,[]);
  if(op==='save'){const a=exact(value,['accountId']);if(!account(a.accountId))hold('invalid_account');return a;}
  if(op==='protection'){
   const a=exact(value,['accountId','ready','checkedAt']);
   if(!account(a.accountId)||typeof a.ready!=='boolean'||!Number.isSafeInteger(a.checkedAt)||a.checkedAt<1)hold('invalid_observation');return a;
  }
  hold('operation_not_allowed');
 }
 async function sql(scope,op,raw){
  const s=state(scope),args=operationArgs(op,raw);await current(scope);
  const nonce=s.rpcRequests.size===0?s.requestId:randomUUID(),started=check(scope),identity=s.identity,url=ENV.projectUrl+'/rest/v1/rpc/'+SQL_RPC;
  if(s.rpcRequests.has(nonce))hold('request_id_reused');s.rpcRequests.add(nonce);
  const tokenExp=identity.expiresAt/1000;if(!Number.isSafeInteger(tokenExp))hold('invalid_owner_expiry');
  const response=await wait(scope,()=>fetchImpl(url,{method:'POST',cache:'no-store',redirect:'error',credentials:'omit',referrerPolicy:'no-referrer',signal:s.signal,
   headers:{apikey:serverKey,Accept:'application/json','Accept-Encoding':'identity','Content-Type':'application/json','Cache-Control':'no-store',Pragma:'no-cache'},
   body:JSON.stringify({p_owner:cfg.ownerId,p_session:identity.sessionRef,p_token_exp:tokenExp,p_request:nonce,p_operation:op,p_args:args})}));
  const envelope=exact(await readWire(scope,response,url,MAX_RPC),['version','mode','ownerId','sessionId','tokenExp','fixtureId','operation','requestId','observedAt','result']);
  const now=check(scope);
  if(envelope.version!==VERSION||envelope.mode!==MODE||envelope.ownerId!==cfg.ownerId||envelope.sessionId!==identity.sessionRef||envelope.tokenExp!==tokenExp||
   envelope.fixtureId!==cfg.fixtureId||envelope.operation!==op||envelope.requestId!==nonce||!Number.isSafeInteger(envelope.observedAt)||
   envelope.observedAt<started||envelope.observedAt>now+1000)hold('unbound_sql_reply');
  await current(scope);return envelope.result;
 }
 function repository(scope){
  const s=state(scope);
  return Object.freeze({
   async sellerContext(){
    const c=safeContext(await sql(scope,'context',{}),cfg.fixtureId);
    if(s.initialPhase!==null){
     if(s.action==='begin'){
      if(!s.claimAttempted&&c.phase!=='prepared'||s.bindingSaved&&(c.phase!=='known'||c.accountId!==s.provisionalAccount))hold('fixture_binding_changed');
     }else if(c.phase!=='known'||c.accountId!==s.originalAccount)hold('fixture_binding_changed');
    }
    return c;
   },
   async claimSeller(){
    if(s.action!=='begin'||s.initialPhase!=='prepared'||s.claimAttempted)hold('claim_not_allowed');s.claimAttempted=true;
    const result=exact(await sql(scope,'claim',{}),['claimed','sellerId']);
    if(typeof result.claimed!=='boolean'||result.sellerId!==cfg.fixtureId||result.claimed!==true)hold('creation_already_claimed');
    const permit=Object.freeze({});permits.set(permit,scope);s.createPermit=permit;
    return Object.freeze({claimed:true,sellerId:cfg.fixtureId});
   },
   async saveSeller({accountId}){
    if(s.action!=='begin'||!s.accountPostAttempted||s.saveAttempted||!account(accountId)||accountId!==s.provisionalAccount)hold('save_not_allowed');s.saveAttempted=true;
    const result=exact(await sql(scope,'save',{accountId}),['saved']);if(result.saved!==true)hold('binding_not_saved');
    s.bindingSaved=true;s.originalAccount=accountId;return Object.freeze({saved:true});
   },
   async recordSellerProtection({accountId,ready,checkedAt}){
    if(s.action!=='observe'||s.protectionAttempted||accountId!==s.originalAccount||checkedAt<s.startedAt||checkedAt>check(scope))hold('observation_not_allowed');s.protectionAttempted=true;
    const result=exact(await sql(scope,'protection',{accountId,ready,checkedAt}),['test','recorded']);
    if(result.test!==true||result.recorded!==true)hold('observation_not_recorded');return Object.freeze(result);
   }
  });
 }
 async function providerFetch(scope,url,init){
  const s=state(scope);await current(scope);let u;
  try{u=new URL(url);}catch{hold('provider_path_not_allowed');}
  if(u.origin!=='https://api.stripe.com'||u.hash||u.username||u.password||init?.headers?.Authorization!=='Bearer '+stripeRestrictedKey||
   init.headers['Stripe-Version']!==API_VERSION)hold('provider_path_not_allowed');
  const method=init.method,connected=init.headers['Stripe-Account'];
  if(method==='POST'&&u.pathname==='/v2/core/accounts'&&!u.search){
   if(s.action!=='begin'||s.accountPostAttempted||!s.createPermit||permits.get(s.createPermit)!==scope||connected!==undefined||
    init.headers['Idempotency-Key']!==idempotencyKey(ENV,'rr_test_seller_',cfg.fixtureId))hold('account_dispatch_not_allowed');
   permits.delete(s.createPermit);s.createPermit=null;s.accountPostAttempted=true;
  }else if(method==='POST'&&u.pathname==='/v2/core/account_links'&&!u.search){
   if(!['begin','refresh'].includes(s.action)||s.linkPostAttempted||!account(s.originalAccount)||s.action==='begin'&&!s.bindingSaved||connected!==undefined)hold('link_dispatch_not_allowed');
   s.linkPostAttempted=true;
  }else if(method==='GET'&&u.pathname==='/v1/account'&&!u.search){if(connected!==undefined)hold('provider_path_not_allowed');}
  else if(method==='GET'&&u.pathname==='/v1/balance'&&!u.search){
   if(connected!==undefined&&(!account(connected)||connected!==(s.originalAccount||s.provisionalAccount)))hold('provider_path_not_allowed');
  }else if(method==='GET'&&/^\/v2\/core\/accounts\/acct_[A-Za-z0-9]+$/.test(u.pathname)){
   if(u.pathname.slice('/v2/core/accounts/'.length)!==(s.originalAccount||s.provisionalAccount)||connected!==undefined)hold('provider_path_not_allowed');
  }else hold('provider_path_not_allowed');
  const response=await wait(scope,()=>fetchImpl(url,{...init,headers:{...init.headers,'Accept-Encoding':'identity'},signal:AbortSignal.any([s.signal,init.signal])}));
  await current(scope);let used=false;
  return Object.freeze({ok:response?.ok,status:response?.status,headers:response?.headers,
   async json(){
    if(used)hold('provider_body_already_read');used=true;
    const value=await readWire(scope,response,url,MAX_PROVIDER,{provider:true});
    if(method==='POST'&&u.pathname==='/v2/core/accounts'){
     if(value?.object!=='v2.core.account'||value.livemode!==false||!account(value.id))hold('invalid_created_account');
     s.provisionalAccount=value.id;
    }
    await current(scope);return value;
   }});
 }
 async function action(scope,op){
  const s=state(scope);if(s.consumed||!['begin','refresh','observe'].includes(op))hold('action_already_consumed');s.consumed=true;s.action=op;
  if(op!=='observe'&&['getHeader','removeHeader','destroy'].some(name=>typeof s.res[name]!=='function'))hold('private_response_sink_required');
  await current(scope);const repo=repository(scope),initial=await repo.sellerContext();
  if(initial.phase==='dispatched'||op==='begin'&&initial.phase!=='prepared'||op!=='begin'&&initial.phase!=='known')hold('original_fixture_required');
  s.initialPhase=initial.phase;s.originalAccount=initial.accountId;
  const options={repository:repo,secretKey:stripeRestrictedKey,accountId:ENV.accountId,clock,fetchImpl:(url,init)=>providerFetch(scope,url,init)};
  const readOnly=createTestSellerOnboarding({...options,protectionsEnabled:false});
  if(op==='observe'){
   const observer=createTestSellerOnboarding({...options,protectionsEnabled:true});
   const observed=safeStatus(await wait(scope,()=>observer.status({})));await current(scope);check(scope);
   s.res.statusCode=200;s.res.setHeader('Content-Type','text/html; charset=utf-8');check(scope);s.res.end(observationPage(observed));return;
  }
  s.sensitive=await wait(scope,()=>readOnly.start({}));
  safeStatus(await wait(scope,()=>readOnly.status({})));await current(scope);
  if(!Number.isSafeInteger(s.sensitive.expiresAt)||s.sensitive.expiresAt*1000<=check(scope)||typeof s.sensitive.onboardingUrl!=='string'||
   s.res.headersSent||s.res.writableEnded)hold('redirect_not_available');
  // The pinned service validated the URL. It is never application JSON, a persisted value or
  // a port argument. Only this current authenticated response can receive it.
  s.redirectAttempted=true;s.res.statusCode=303;check(scope);s.res.setHeader('Location',s.sensitive.onboardingUrl);check(scope);s.res.end();
 }
 async function body(scope,kind){
  const s=state(scope),req=s.req;let value=req.body;
  if(value!==undefined&&typeof value!=='string'&&!Buffer.isBuffer(value)){
   const object=exact(value,['action'],400),allowed=kind==='begin'?['begin']:['observe','refresh'];
   if(!allowed.includes(object.action))hold('invalid_action',400);return object.action;
  }
  let bytes;
  if(value!==undefined)bytes=Buffer.isBuffer(value)?Buffer.from(value):Buffer.from(value,'utf8');
  else{
   const reader=req[Symbol.asyncIterator](),parts=[];let size=0;
   try{for(;;){const next=await wait(scope,()=>reader.next());if(next.done)break;const part=Buffer.from(next.value);if((size+=part.length)>64)hold('body_too_large',413);parts.push(part);}bytes=Buffer.concat(parts);}
   finally{parts.forEach(p=>p.fill(0));try{Promise.resolve(reader.return?.()).catch(()=>{});}catch{}}
  }
  try{
   if(bytes.length>64)hold('body_too_large',413);let text;
   try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{hold('invalid_body',400);}
   if(kind==='begin'){if(text!=='action=begin')hold('invalid_action',400);return 'begin';}
   if(!['action=observe','action=refresh'].includes(text))hold('invalid_action',400);return text.slice(7);
  }finally{bytes?.fill(0);}
 }
 const formActions=Object.freeze(Object.fromEntries(['observe','refresh'].map(op=>[op,async({request,response,action:requested})=>{
  const scope=activeRequests.get(request),s=state(scope);if(response!==s.res||requested!==op||s.expectedAction!==op)hold('response_scope_mismatch');return action(scope,op);
 }])));
 const passive=createClosedSellerReturnView({enabled:ready,postActions:ready?formActions:null});
 async function handler(req,res){
  headers(res);if(!ready){send(res,404,{error:'Not found'});return;}
  if(![RETURN_PATH,BEGIN_PATH].includes(req.url)){send(res,404,{error:'Not found'});return;}
  if(req.method!=='POST'&&req.method!=='GET'){
   res.setHeader('Allow','GET, POST');send(res,405,{error:'Method not allowed'});return;
  }
  if(req.method==='POST'&&(req.headers?.origin!==ENV.previewOrigin||req.headers?.['sec-fetch-site']!=='same-origin')){send(res,403,{error:'Owner action denied'});return;}
  if(req.method==='POST'){
   const type=req.headers?.['content-type']||'';
   if(!/^application\/x-www-form-urlencoded(?:\s*;\s*charset=UTF-8)?$/i.test(type)){send(res,415,{error:'Expected action form'});return;}
  }
  let scope;
  try{
   scope=openScope(req,res);const s=state(scope);
   if(req.method==='GET'){
    await current(scope);check(scope);
    if(req.url===BEGIN_PATH){const sink=responseGate(scope);sink.statusCode=200;sink.setHeader('Content-Type','text/html; charset=utf-8');sink.end(confirmationPage());}
    else await wait(scope,()=>passive.handler(req,responseGate(scope)));return;
   }
   const op=await body(scope,req.url===BEGIN_PATH?'begin':'form');await current(scope);s.expectedAction=op;
   if(op==='begin')await wait(scope,()=>action(scope,op));
   else await wait(scope,()=>formActions[op]({request:req,response:res,action:op}));
  }catch(error){
   const s=scope?scopes.get(scope):null;
   if(!res.headersSent&&!res.writableEnded){
    // A failed local pre-send check is not a delivered redirect. Remove its
    // sensitive header before any generic held response. If cleanup itself
    // fails, close the connection rather than risk sending that header.
    if(s?.redirectAttempted){
     let cleared=false;
     try{res.removeHeader('Location');cleared=res.getHeader('Location')===undefined;}catch{}
     if(!cleared){try{res.destroy();}catch{}return;}
    }
    send(res,error instanceof OwnerFixtureHeld?error.status:503,{error:'Fictional seller setup is held. Review the original account; do not create a replacement.'});
   }
  }finally{if(scope)closeScope(scope);}
 }
 return Object.freeze({ready,handler});
}
module.exports=Object.freeze({createClosedOwnerFixtureRuntime,OwnerFixtureHeld,ENV,RETURN_PATH,BEGIN_PATH,SQL_RPC,VERSION,MODE,API_VERSION});
