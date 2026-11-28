'use strict';
// Fictional in-process HTTP/Auth/RPC only. The actual pinned JS modules run;
// no supplied response here is real authentication, a key or provider evidence.
// All identifiers and records in this test helper are fictional.
const {Readable}=require('node:stream');
const assert=require('node:assert/strict');
const {createClosedOwnerFixtureRuntime,ENV,RETURN_PATH,BEGIN_PATH,SQL_RPC,VERSION,MODE,API_VERSION}=require('../../server/owner_practice_runtime.cjs');
const FIXTURE='77777777-7777-4777-8777-777777777777';
const OWNER='11111111-1111-4111-8111-111111111111',OTHER='22222222-2222-4222-8222-222222222222',SESSION='33333333-3333-4333-8333-333333333333';
const ACCOUNT='acct_fictionalOwnerPractice';
function wire(url,value,now,{provider=false,headers={},body=null}={}){
 const bytes=Buffer.from(JSON.stringify(value));
 return {status:200,ok:true,url,redirected:false,headers:new Headers({'Content-Type':'application/json','Cache-Control':'private, no-store',
  Date:new Date(now).toUTCString(),'Content-Length':String(bytes.length),...(provider?{'stripe-version':API_VERSION}:{}),...headers}),
  body:body||new ReadableStream({start(c){c.enqueue(bytes);c.close();}}),
  async json(){throw Error('The bounded runtime must read the observed stream, not this fake convenience JSON method.');}};
}
function response(){return {statusCode:0,headers:{},headersSent:false,writableEnded:false,body:'',
 setHeader(name,value){this.headers[name.toLowerCase()]=value;},getHeader(name){return this.headers[name.toLowerCase()];},
 removeHeader(name){delete this.headers[name.toLowerCase()];},destroy(){this.destroyed=true;this.writableEnded=true;},
 end(value=''){this.body+=value;this.headersSent=true;this.writableEnded=true;}};}
function jwt(actor,session,now,exp){return ['fixture',Buffer.from(JSON.stringify({iss:ENV.projectUrl+'/auth/v1',sub:actor,aud:'authenticated',role:'authenticated',
 is_anonymous:false,session_id:session,exp,iat:Math.floor(now/1000)-1})).toString('base64url'),'fixture'].join('.');}
function fixture(options={}){
 const ownerId=options.ownerId??OWNER;
 const sessionId=options.sessionId??SESSION;
 let wall=options.realtime?Date.now():Date.UTC(2026,10,13,20,0,0),mono=0,phase=options.phase||'prepared',boundAccount=phase==='known'?ACCOUNT:null;
 let active=true,currentSession=sessionId,lateRPC=null,lateBody=null;
 const clock=()=>options.realtime?Date.now():wall;
 const monotonicClock=()=>options.realtime?performance.now():mono;
 const calls=[],sqlCalls=[],providerPosts=[],writes=[],ownerReplies=[],signals=[];
 const restrictedKey=['rk','test','FictionalOnly'].join('_'),serverKey=['sb','secret','X'.repeat(25)].join('_'),publishableKey=['sb','publishable','Y'.repeat(25)].join('_');
 const initial=clock(),tokenExp=options.tokenExp??Math.floor(initial/1000)+3600;
 function seller(){return {object:'v2.core.account',id:ACCOUNT,livemode:false,identity:{country:'us'},closed:false,
  applied_configurations:['recipient'],dashboard:'express',defaults:{responsibilities:{fees_collector:'application',losses_collector:'application',requirements_collector:'stripe'}},
  configuration:{recipient:{capabilities:{stripe_balance:{stripe_transfers:{status:options.ready===false?'pending':'active'}}}}},
  requirements:{entries:options.requirement?[{id:'fictional_future_requirement'}]:[]},metadata:{rr_test_seller_id:FIXTURE,rr_test_platform:ENV.accountId,rr_test_environment:ENV.id}};}
 function cookie({actor=ownerId,session=sessionId,exp=tokenExp,duplicate=false,bearerOnly=false,refresh=true}={}){
  if(bearerOnly)return '';
  const access=jwt(actor,session,clock(),exp),name='__Host-rr-command-current';
  return name+'='+session+'; __Host-rr-command-access.'+session+'='+access+
   (refresh?'; __Host-rr-command-refresh.'+session+'='+Buffer.from(JSON.stringify({token:'FictionalRefreshOnly',remember:false})).toString('base64url'):'')+
   (duplicate?'; '+name+'='+session:'');
 }
 async function event(name,data){if(options.event)await options.event(name,data,control);}
 function envelope(b,result){return {version:VERSION,mode:MODE,ownerId:b.p_owner,sessionId:b.p_session,tokenExp:b.p_token_exp,fixtureId:FIXTURE,
  operation:b.p_operation,requestId:b.p_request,observedAt:clock(),result};}
 async function legacy(b){
  const op=b.p_operation,a=b.p_args;
  if(op==='context')return {test:true,sellerId:FIXTURE,phase,accountId:boundAccount};
  if(op==='claim'){
   if(phase!=='prepared')return {claimed:false,sellerId:FIXTURE};
   phase='dispatched';writes.push('claim');if(options.lostClaim)throw Error('Fictional lost claim acknowledgment');return {claimed:true,sellerId:FIXTURE};
  }
  if(op==='save'){
   assert.equal(phase,'dispatched');assert.equal(a.accountId,ACCOUNT);phase='known';boundAccount=ACCOUNT;writes.push('save');
   if(options.lostSave)throw Error('Fictional lost save acknowledgment');return {saved:true};
  }
  if(op==='protection'){assert.equal(a.accountId,ACCOUNT);assert.equal(a.ready,options.ready!==false&&!options.requirement);writes.push('protection');return {test:true,recorded:true};}
  assert.fail('Unexpected fake SQL operation');
 }
 async function fetchImpl(url,init){
  signals.push(init.signal);assert.equal(init.cache,'no-store');assert.equal(init.redirect,'error');
  if(url===ENV.projectUrl+'/auth/v1/user'){
   calls.push('owner:user');assert.equal(init.method,'GET');await event('owner:user');
   return wire(url,{id:ownerId,aud:'authenticated',role:'authenticated',is_anonymous:false,email:'owner@example.invalid'},clock());
  }
  if(url===ENV.projectUrl+'/rest/v1/rpc/rr_test_command_owner_session'){
   calls.push('owner:session');const b=JSON.parse(init.body);assert.equal(b.p_actor,ownerId);await event('owner:session',b);
   let value=options.ownerRpc?await options.ownerRpc(b):{version:'rr-command-owner-session-v1',ownerId:b.p_owner,sessionId:b.p_session,tokenExp:b.p_token_exp,
    accepted:active&&b.p_session===currentSession,nonce:b.p_nonce,observedAt:clock()};
   if(options.ownerNonceMismatch)value={...value,nonce:OTHER};ownerReplies.push(value);
   return wire(url,value,clock());
  }
  if(url===ENV.projectUrl+'/rest/v1/rpc/'+SQL_RPC){
   calls.push('sql:'+JSON.parse(init.body).p_operation);const b=JSON.parse(init.body);sqlCalls.push(b);
   assert.deepEqual(Object.keys(b).sort(),['p_args','p_operation','p_owner','p_request','p_session','p_token_exp']);
   assert.equal(b.p_owner,ownerId);assert.equal(b.p_session,sessionId);assert.equal(init.headers.apikey,serverKey);assert.equal(init.headers.Authorization,undefined);
   await event('sql:before',b);
   let value=options.sqlRpc?await options.sqlRpc(b):envelope(b,await legacy(b));
   if(options.hangSql===b.p_operation)return new Promise(resolve=>{lateRPC=()=>resolve(wire(url,value,clock()));});
   if(options.mutateEnvelope)value=options.mutateEnvelope(value,b);
   await event('sql:after',b);return wire(url,value,clock(),{headers:options.sqlHeaders||{}});
  }
  const u=new URL(url);assert.equal(u.origin,'https://api.stripe.com');assert.equal(init.headers.Authorization,'Bearer '+restrictedKey);
  assert.equal(init.headers['Stripe-Version'],API_VERSION);calls.push(init.method+' '+u.pathname);
  if(init.method==='POST')providerPosts.push(u.pathname);
  await event('provider:before',{path:u.pathname,method:init.method});
  let value;
  if(u.pathname==='/v1/account')value={id:options.wrongPlatform?'acct_wrongPlatform':ENV.accountId};
  else if(u.pathname==='/v1/balance')value={livemode:options.liveBalance===true};
  else if(u.pathname==='/v2/core/accounts'&&init.method==='POST'){
   if(!options.sqlRpc){assert.equal(phase,'dispatched');assert.equal(writes.filter(v=>v==='claim').length,1);}
   const b=JSON.parse(init.body);assert.equal(b.metadata.rr_test_seller_id,FIXTURE);assert.equal(b.metadata.rr_test_platform,ENV.accountId);
   assert.equal(init.headers['Idempotency-Key'],'rr_test_seller_acceptance_v1_'+FIXTURE);
   if(options.lostCreate)throw Error('Fictional lost provider ACK '+restrictedKey);
   if(options.revokeAfterCreate)active=false;value=seller();
  }else if(u.pathname==='/v2/core/accounts/'+ACCOUNT&&init.method==='GET')value=seller();
  else if(u.pathname==='/v2/core/account_links'&&init.method==='POST'){
   const b=JSON.parse(init.body);assert.equal(b.account,ACCOUNT);assert.equal(b.use_case.account_onboarding.return_url,ENV.returnUrl);assert.equal(b.use_case.account_onboarding.refresh_url,ENV.returnUrl);
   value={object:'v2.core.account_link',account:ACCOUNT,livemode:false,url:options.linkUrl??('https://accounts.stripe.com/r/'+ACCOUNT+'#alu_test_FictionalOnly'),
    created:new Date(clock()).toISOString(),expires_at:new Date(clock()+1800000).toISOString(),use_case:{type:'account_onboarding',account_onboarding:{configurations:['recipient'],refresh_url:ENV.returnUrl,return_url:ENV.returnUrl}}};
  }else assert.fail('Unexpected fake provider path');
  await event('provider:after',{path:u.pathname,method:init.method});
  const h=options.providerHeaders||{};
  if(options.hangProviderBody&&u.pathname==='/v2/core/accounts'&&init.method==='POST'){
   const bytes=Buffer.from(JSON.stringify(value));let sent=false;
   const body={getReader(){return {read(){if(sent)return Promise.resolve({done:true});return new Promise(resolve=>{lateBody=()=>{sent=true;resolve({done:false,value:bytes});};});},cancel(){return Promise.resolve();}};}};
   return wire(url,value,clock(),{provider:true,headers:h,body});
  }
  const result=wire(url,value,clock(),{provider:true,headers:h});
  if(Object.hasOwn(options,'providerStatus'))result.status=options.providerStatus;
  if(Object.hasOwn(options,'providerOk'))result.ok=options.providerOk;
  return result;
 }
 const cfg={ownerId,fixtureId:FIXTURE,notBefore:initial-1000,notAfter:initial+3599000,branch:ENV.branch,projectUrl:ENV.projectUrl,accountId:ENV.accountId,origin:ENV.previewOrigin};
 const settings={VERCEL_ENV:'preview',VERCEL_GIT_COMMIT_REF:ENV.branch,RACK_RELIC_TEST_SUPABASE_URL:ENV.projectUrl,RACK_RELIC_TEST_STRIPE_ACCOUNT:ENV.accountId,
  RACK_RELIC_TEST_ADMIN_OVERVIEW_ENABLED:'true',RACK_RELIC_TEST_MEMBER_IDS:ownerId+','+OTHER,RACK_RELIC_TEST_REFUND_OPERATOR_IDS:ownerId,
  RACK_RELIC_TEST_ADMIN_OWNER_ID:ownerId,RACK_RELIC_TEST_REFUNDS_ENABLED:'true',RACK_RELIC_TEST_REFUND_REQUESTS_ENABLED:'true'};
 const ports={enabled:true,configuration:cfg,commandSettings:settings,serverKey,publishableKey,stripeRestrictedKey:restrictedKey,fetchImpl,clock,monotonicClock};
 function build(extra={}){return createClosedOwnerFixtureRuntime({...ports,...extra});}
 const instance=build(options.override);
 async function request(method='GET',op=null,extra={}){
  let raw=method==='POST'?'action='+op:undefined;
  if(Object.hasOwn(extra,'raw'))raw=extra.raw;
  const req=extra.stream||Readable.from(raw===undefined?[]:[Buffer.from(raw)]);
  req.url=extra.url??(op==='begin'?BEGIN_PATH:RETURN_PATH);req.method=method;
  req.headers={cookie:cookie(extra.cookies),origin:ENV.previewOrigin,'sec-fetch-site':'same-origin',
   'content-type':'application/x-www-form-urlencoded',...extra.headers};
  if(Object.hasOwn(extra,'parsedBody'))req.body=extra.parsedBody;
  const res=extra.response||response();await(extra.instance||instance).handler(req,res);return res;
 }
 const control={instance,ports,cfg,settings,build,request,cookie,fetchImpl,calls,sqlCalls,providerPosts,writes,ownerReplies,signals,
  restrictedKey,serverKey,publishableKey,get phase(){return phase;},get accountId(){return boundAccount;},get now(){return clock();},
  advance(w,m=w){wall+=w;mono+=m;},revoke(){active=false;},replaceSession(v){currentSession=v;},
  releaseRpc(){lateRPC?.();},releaseProviderBody(){lateBody?.();}};
 return control;
}
module.exports={FIXTURE,fixture,wire,response,jwt,OWNER,OTHER,SESSION,ACCOUNT};
