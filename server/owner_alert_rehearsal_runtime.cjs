'use strict';
// Private, manual, one-fixture Preview endpoint. No cron, general queue or UI.
const {randomBytes}=require('node:crypto');
const {createCommandSessionService,CommandSessionError}=require('./command_session.cjs');
const {createCommandOwnerSessionReader}=require('./command_owner_session_reader.cjs');
const fs=require('node:fs'),path=require('node:path');
const {TEST_ENVIRONMENTS,selectTestEnvironment}=require('./test_environment_registry.cjs');
const {createCaseAlertWorker}=require('./case_alert_worker.cjs');
const {createResendOwnerAlertRepository}=require('./resend_owner_alert_repository.cjs');
const {createResendCaseAlertTransport}=require('./resend_case_alert_transport.cjs');
const {createOwnerAlertRehearsalRepository,readJson,WORKER_ID}=require('./owner_alert_rehearsal_repository.cjs');
const E=TEST_ENVIRONMENTS.acceptance,T='resend_rack_owner_v1',D='rack_owner_wayne_v1';
const OWNER='wayne@rackrelic.com',SENDER='alerts@alerts.rackrelic.com';
const COMMAND='/api/command-center';
const DOMAIN_ID='f4adcee8-bc22-4597-9aae-6d9cd6780e6a';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const RECEIVER=E.projectUrl+'/functions/v1/rack-alert-receipts';
const SOURCE='7a23e5695a0126f88b48f31b564b1172492f7e4b114c3c85f19de15fc7e8fbf3';
const FACTS=['rack_team_and_domain_verified','transactional_free_and_paid_extras_off','tracking_and_receiving_off',
 'sending_key_domain_only','exact_receiver_code_and_secrets_verified','receipt_rpc_grants_and_denials_verified'];
const fail=()=>{throw Error('OWNER_ALERT_REHEARSAL_UNVERIFIED');};
async function body(req){
 function plain(v,depth=0){
  if(depth>5)fail();if(v===null||['string','number','boolean'].includes(typeof v))return v;
  if(!v||Object.getPrototypeOf(v)!==(Array.isArray(v)?Array.prototype:Object.prototype))fail();const out=Array.isArray(v)?[]:{};
  for(const k of Reflect.ownKeys(v)){if(Array.isArray(v)&&k==='length')continue;const d=Object.getOwnPropertyDescriptor(v,k);
   if(typeof k!=='string'||['__proto__','constructor','prototype'].includes(k)||!d||!Object.hasOwn(d,'value')||!d.enumerable)fail();out[k]=plain(d.value,depth+1);}
  return out;
 }
 const provided=req.body;
 if(provided!==undefined&&typeof provided!=='string'&&!Buffer.isBuffer(provided)){const copied=plain(provided);if(Buffer.byteLength(JSON.stringify(copied))>8192)fail();return copied;}
 const chunks=[];let n=0;try{
  if(provided!==undefined){const b=Buffer.from(provided);n=b.length;if(n>8192)fail();chunks.push(b);}
  else for await(const x of req){const b=Buffer.from(x);n+=b.length;if(n>8192)fail();chunks.push(b);}
  return plain(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks))));
 }finally{chunks.forEach(b=>b.fill(0));}
}
function review(value,now){
 if(!value||Object.keys(value).sort().join(',')!=='checkedAt,domainId,evidenceReference,expiresAt,facts,receiverRevision,receiverSource,team,version'||
  value.version!=='rr-owner-alert-action-review-v1'||value.team!=='rackrelic'||value.domainId!==DOMAIN_ID||value.receiverSource!==SOURCE||
  typeof value.receiverRevision!=='string'||!/^v[1-9][0-9]{0,5}$/.test(value.receiverRevision)||
  typeof value.evidenceReference!=='string'||!/^owner_review_[A-Za-z0-9_-]{8,80}$/.test(value.evidenceReference)||
  !Array.isArray(value.facts)||JSON.stringify(value.facts)!==JSON.stringify(FACTS)||
  !Number.isSafeInteger(value.checkedAt)||value.checkedAt>now+1000||value.checkedAt<now-300000||
  !Number.isSafeInteger(value.expiresAt)||value.expiresAt<=now||value.expiresAt>value.checkedAt+300000)fail();
 return value;
}
async function timed(fn,ms=3000){
 const c=new AbortController();let timer;
 try{return await Promise.race([Promise.resolve().then(()=>fn(c.signal)),new Promise((_,reject)=>{timer=setTimeout(()=>{c.abort();reject(Error('OWNER_ALERT_REHEARSAL_UNVERIFIED'));},ms);})]);}
 finally{clearTimeout(timer);c.abort();}
}
// Actual bounded HTTP rejection tests. They establish boundary readiness ONLY,
// never signed provider delivery. The owner review covers non-public UI facts.
async function boundary(fetchImpl,signal){
 const probes=[['GET',RECEIVER,null,null,405],['POST',RECEIVER,{},'{}',400],
  ['POST',RECEIVER,{'svix-id':'msg_boundary_'+randomBytes(8).toString('hex'),'svix-timestamp':String(Math.floor(Date.now()/1000)),
   'svix-signature':'v1,'+randomBytes(32).toString('base64')},'{}',503],['POST',RECEIVER+'?not_a_receipt=1',{},'{}',404]];
 for(const [method,url,headers,data,status]of probes){
  const r=await fetchImpl(url,{method,redirect:'error',cache:'no-store',signal,headers:{'content-type':'application/json',...headers},...(data===null?{}:{body:data})});
  if(signal.aborted||!(r instanceof Response)||r.url!==url||r.redirected||r.status!==status||r.headers.has('location')||
   r.headers.has('access-control-allow-origin')||!/(?:^|,)\s*no-store(?:,|$)/i.test(r.headers.get('cache-control')||'')||
   r.headers.has('age')&&r.headers.get('age')!=='0'||['cf-cache-status','x-vercel-cache'].some(k=>/HIT|STALE|UPDATING/i.test(r.headers.get(k)||'')))fail();
  const reader=r.body?.getReader();if(reader){try{const p=await reader.read();if(signal.aborted||!p.done){await reader.cancel();fail();}}finally{reader.releaseLock();}}
 }
}
function createOwnerAlertRehearsalRuntime({env=process.env,fetchImpl=globalThis.fetch,clock=Date.now}={}){
 const commandSession=createCommandSessionService({env,fetchImpl,clock});
 const ownerReader=createCommandOwnerSessionReader({projectUrl:E.projectUrl,ownerId:env.RACK_RELIC_TEST_ADMIN_OWNER_ID,serverKey:env.RACK_RELIC_TEST_SUPABASE_SERVER_KEY,fetchImpl,clock});
 return async(req,res)=>{
  for(const[k,v]of Object.entries({'Cache-Control':'private, no-store','CDN-Cache-Control':'no-store','Vercel-CDN-Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Robots-Tag':'noindex, nofollow'}))res.setHeader(k,v);
  const send=(status,data)=>{res.statusCode=status;res.setHeader('Content-Type','application/json');res.end(JSON.stringify(data));};
  const tuple={branch:env.VERCEL_GIT_COMMIT_REF,projectUrl:env.RACK_RELIC_TEST_SUPABASE_URL,accountId:env.RACK_RELIC_TEST_STRIPE_ACCOUNT};
  if(env.VERCEL_ENV!=='preview'||env.RACK_RELIC_TEST_OWNER_ALERT_REHEARSAL_ENABLED!=='true'||selectTestEnvironment(tuple)!==E||
   env.RACK_RELIC_TEST_CHECKOUT_ENABLED!=='false'){send(404,{error:'Not found'});return;}
  let parsed;try{parsed=new URL(req.url,E.previewOrigin);}catch{send(404,{error:'Not found'});return;}
  const sessionRequest=req.method==='GET'&&parsed.search==='?action=session';
  if(parsed.origin!==E.previewOrigin||parsed.pathname!=='/api/test-owner-alert'||parsed.hash||
   req.headers?.host!==new URL(E.previewOrigin).host||parsed.search&&!sessionRequest){send(404,{error:'Not found'});return;}
  const owner=env.RACK_RELIC_TEST_ADMIN_OWNER_ID,members=(env.RACK_RELIC_TEST_MEMBER_IDS||'').split(',').map(x=>x.trim());
  const key=env.RACK_RELIC_TEST_SUPABASE_SERVER_KEY;
  if(!UUID.test(owner||'')||members.length!==2||new Set(members).size!==2||!members.every(x=>UUID.test(x))||!members.includes(owner)||
   !/^sb_secret_[A-Za-z0-9_-]{16,}$/.test(key||'')||!commandSession.config||!ownerReader.ready){send(503,{error:'Owner configuration unavailable'});return;}
  let selectedSession=null,selectedAuthorization=null;
  async function currentOwner(){
   // Only the canonical HttpOnly Command cookies select an owner session.
   // Browser bearer headers and the former PKCE/localStorage flow are not read.
   // Refresh an expired remembered cookie at most once per request. Further
   // checks revalidate the private returned JWT and current DB session, rather
   // than reusing an old refresh token still present in the request headers.
   const session=selectedSession===null?await commandSession.resolve(req,res):await ownerReader.verify(selectedAuthorization);
   if(session.member!==owner||session.email!==OWNER||selectedSession!==null&&session.sessionRef!==selectedSession)fail();
   const authorization=selectedAuthorization??'Bearer '+session.access;
   // Preserve the alert endpoint's existing exact confirmed-email predicate.
   await timed(async signal=>{
    const url=E.projectUrl+'/auth/v1/user';
    const r=await fetchImpl(url,{method:'GET',redirect:'error',cache:'no-store',signal,headers:{apikey:key,Authorization:authorization,'Cache-Control':'no-store'}});
    const u=await readJson(r,url,signal);
    if(u?.id!==owner||u.email!==OWNER||u.role!=='authenticated'||u.is_anonymous!==false||!u.email_confirmed_at||u.deleted_at!=null||u.banned_until&&(!Number.isFinite(Date.parse(u.banned_until))||Date.parse(u.banned_until)>clock()))fail();
   });
   selectedSession=session.sessionRef;selectedAuthorization=authorization;res.setHeader('X-Rack-Command-Session',selectedSession);return session;
  }
  if(req.method==='GET'){
   try{await currentOwner();}catch(error){
    if(error instanceof CommandSessionError&&[401,403].includes(error.status)){
     if(sessionRequest){send(200,{signedIn:false});return;}
     res.statusCode=303;res.setHeader('Location',COMMAND);res.end();return;
    }
    send(503,{error:'Current owner session unavailable'});return;
   }
   if(sessionRequest){send(200,{signedIn:true,sessionRef:selectedSession});return;}
   res.statusCode=200;res.setHeader('Content-Type','text/html; charset=utf-8');
   res.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'");
   res.end(fs.readFileSync(path.join(__dirname,'owner-alert-rehearsal.html'),'utf8'));return;
  }
  if(req.method!=='POST'){res.setHeader('Allow','GET, POST');send(405,{error:'Method not allowed'});return;}
  if(req.headers?.origin!==E.previewOrigin||req.headers?.['sec-fetch-site']!==undefined&&req.headers['sec-fetch-site']!=='same-origin'){send(403,{error:'Owner action required'});return;}
  if(!/^application\/json(?:\s*;|$)/i.test(req.headers?.['content-type']||'')){send(415,{error:'JSON required'});return;}
  if(req.headers['content-length']!==undefined&&(!/^\d+$/.test(req.headers['content-length'])||Number(req.headers['content-length'])>8192)){send(413,{error:'Request too large'});return;}
  try{await currentOwner();}
  catch(error){send(error instanceof CommandSessionError&&[401,403].includes(error.status)?error.status:503,{error:'Current Rack Command owner sign-in required'});return;}
  let command;
  try{command=await timed(()=>body(req));if(!command||Object.keys(command).sort().join(',')!=='action,review'||!['send-one','reconcile'].includes(command.action))fail();review(command.review,clock());}
  catch{send(400,{error:'Fresh owner setup review required'});return;}
  try{
   await timed(signal=>boundary(fetchImpl,signal));
   await currentOwner();
   const workerRepo=createOwnerAlertRehearsalRepository({enabled:true,...tuple,serviceKey:key,fetchImpl});
   const journal=createResendOwnerAlertRepository({enabled:true,...tuple,serviceKey:key,fetchImpl});
   const verifySetup=async()=>{
    await currentOwner();
    review(command.review,clock());const now=clock();
    // Source of UI facts is explicitly the authenticated owner's action-time
    // review, NOT a provider API/config-to-delivery inference. HTTP probes above
    // are real. No signed-delivery/read assertion is constructed here.
    return {verified:true,transportId:T,destinationId:D,sender:SENDER,recipient:OWNER,domainId:DOMAIN_ID,
     domainVerified:true,freePlan:true,paidOverages:false,tracking:false,sendingKeyDomain:'alerts.rackrelic.com',
     webhookBoundaryVerified:true,checkedAt:now,expiresAt:Math.min(now+20000,command.review.expiresAt)};
   };
   const transportFetch=async(url,init)=>{
    // The existing immutable transport/journal remains unchanged. Re-check
    // the same current owner after its durable claim and before any email POST.
    if(url==='https://api.resend.com/emails'&&init?.method==='POST'){
     await currentOwner();if(init.signal?.aborted)fail();
    }
    return fetchImpl(url,init);
   };
   const transport=createResendCaseAlertTransport({enabled:true,...tuple,sender:SENDER,apiKey:env.RACK_RELIC_TEST_RESEND_API_KEY,
    repository:journal,verifySetup,fetchImpl:transportFetch,clock});
   const worker=createCaseAlertWorker({enabled:true,...tuple,repository:workerRepo,transport,transportId:T,destinationId:D,clock});
   let result;
   if(command.action==='send-one')result=await worker.runOnce({workerId:WORKER_ID,limit:1});
   else{const context=await timed(signal=>workerRepo.fixtureContext({workerId:WORKER_ID,signal}));result=await worker.reconcile({workerId:WORKER_ID,alertId:context.alert.alertId});}
   await currentOwner();
   send(200,{...result,readinessEvidence:'authenticated_owner_review_and_live_boundary_probes',signedDeliveryRequired:true,ownerRead:false});
  }catch{send(503,{error:'Outcome unverified. Retain the original; reconcile only. Do not resend.',releaseEnabled:false});}
 };
}
module.exports={createOwnerAlertRehearsalRuntime,review,boundary,FACTS,RECEIVER_SOURCE_SHA256:SOURCE};
