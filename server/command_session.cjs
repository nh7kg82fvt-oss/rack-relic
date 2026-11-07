'use strict';

const {randomBytes,createHash} = require('node:crypto');
const {selectTestEnvironment} = require('./test_environment_registry.cjs');
const {readBody} = require('./admin_work_data.cjs');
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const CURRENT='__Host-rr-command-current', ACCESS='__Host-rr-command-access.', REFRESH='__Host-rr-command-refresh.', PKCE='__Host-rr-command-pkce';
const COOKIE_AGE=7*24*60*60;
class CommandSessionError extends Error {
  constructor(status,message,code='session_unavailable'){super(message);this.status=status;this.code=code;}
}
const fail=(status=503,message='Rack sign-in is temporarily unavailable.',code)=>{throw new CommandSessionError(status,message,code);};
function exact(value,keys){if(!value||Object.getPrototypeOf(value)!==Object.prototype||Reflect.ownKeys(value).length!==keys.length||keys.some(k=>!Object.hasOwn(Object.getOwnPropertyDescriptor(value,k)||{},'value')))fail(400,'Check the sign-in form.');return value;}
function noStore(res){for(const [name,value]of Object.entries({'Cache-Control':'private, no-store, max-age=0','CDN-Cache-Control':'no-store','Vercel-CDN-Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','X-Robots-Tag':'noindex, nofollow'}))res.setHeader(name,value);}
function setting(env){
  const environment=selectTestEnvironment({branch:env.VERCEL_GIT_COMMIT_REF,projectUrl:env.RACK_RELIC_TEST_SUPABASE_URL,accountId:env.RACK_RELIC_TEST_STRIPE_ACCOUNT});
  const members=(env.RACK_RELIC_TEST_MEMBER_IDS||'').split(',').map(v=>v.trim()).filter(Boolean),operators=(env.RACK_RELIC_TEST_REFUND_OPERATOR_IDS||'').split(',').map(v=>v.trim()).filter(Boolean),owner=env.RACK_RELIC_TEST_ADMIN_OWNER_ID;
  if(env.VERCEL_ENV!=='preview'||env.RACK_RELIC_TEST_ADMIN_OVERVIEW_ENABLED!=='true'||environment?.id!=='acceptance-v1'||!UUID.test(owner||'')||members.length!==2||new Set(members).size!==2||!members.every(v=>UUID.test(v))||!members.includes(owner)||!operators.includes(owner)||operators.length<1||operators.length>2||new Set(operators).size!==operators.length||operators.some(v=>!members.includes(v))||env.RACK_RELIC_TEST_REFUNDS_ENABLED!=='true'||env.RACK_RELIC_TEST_REFUND_REQUESTS_ENABLED!=='true'||!/^sb_publishable_[A-Za-z0-9_-]+$/.test(env.RACK_RELIC_TEST_SUPABASE_PUBLISHABLE_KEY||''))return null;
  return {...environment,owner,publishableKey:env.RACK_RELIC_TEST_SUPABASE_PUBLISHABLE_KEY};
}
function cookieValue(req,name){
  const raw=req.headers?.cookie;
  if(raw===undefined)return null;
  if(typeof raw!=='string'||raw.length>24576)fail(401,'Please sign in to Rack Command.','signed_out');
  const values=raw.split(';').map(v=>v.trim()).filter(v=>v.slice(0,v.indexOf('='))===name);
  if(values.length>1)fail(401,'Please sign in to Rack Command.','signed_out');
  const value=values[0]?.slice(name.length+1)??null;
  if(value!==null&&!/^[A-Za-z0-9_.-]{1,12288}$/.test(value))fail(401,'Please sign in to Rack Command.','signed_out');
  return value;
}
function decodeCookie(value){if(value===null)return null;try{const bytes=Buffer.from(value,'base64url');if(bytes.toString('base64url')!==value||bytes.length>8192)throw Error();return JSON.parse(bytes.toString('utf8'));}catch{fail(401,'Please sign in to Rack Command.','signed_out');}}
function putCookie(res,name,value,maxAge=null){
  if(!(name===CURRENT||name===PKCE||name.startsWith(ACCESS)&&UUID.test(name.slice(ACCESS.length))||name.startsWith(REFRESH)&&UUID.test(name.slice(REFRESH.length)))||typeof value!=='string'||value.length>3800||!/^[A-Za-z0-9_.-]*$/.test(value)||maxAge!==null&&(!Number.isSafeInteger(maxAge)||maxAge<0||maxAge>COOKIE_AGE))fail();
  const cookie=name+'='+value+'; Path=/; Secure; HttpOnly; SameSite=Lax'+(maxAge===null?'':'; Max-Age='+maxAge);
  const old=res.getHeader?.('Set-Cookie');res.setHeader('Set-Cookie',[...(Array.isArray(old)?old:old?[old]:[]),cookie]);
}
function clearSession(res,sessionRef){if(UUID.test(sessionRef||'')){putCookie(res,ACCESS+sessionRef,'',0);putCookie(res,REFRESH+sessionRef,'',0);}}
function credentials(req){
  const sessionRef=cookieValue(req,CURRENT);
  if(sessionRef!==null&&!UUID.test(sessionRef))fail(401,'Please sign in to Rack Command.','signed_out');
  const access=sessionRef?cookieValue(req,ACCESS+sessionRef):null,refresh=decodeCookie(sessionRef?cookieValue(req,REFRESH+sessionRef):null);
  if(refresh!==null){exact(refresh,['token','remember']);if(typeof refresh.token!=='string'||!/^[A-Za-z0-9_-]{1,1024}$/.test(refresh.token)||typeof refresh.remember!=='boolean')fail(401,'Please sign in to Rack Command.','signed_out');}
  return {sessionRef,access,refresh:refresh?.token??null,remember:refresh?.remember===true};
}
function claims(token,config,now){
  try{if(typeof token!=='string'||token.length>3800||!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token))throw Error();const data=JSON.parse(Buffer.from(token.split('.')[1],'base64url').toString('utf8'));
    if(data.iss!==config.projectUrl+'/auth/v1'||data.sub!==config.owner||data.aud!=='authenticated'||data.role!=='authenticated'||!UUID.test(data.session_id||'')||!Number.isSafeInteger(data.exp)||!Number.isSafeInteger(data.iat)||data.iat*1000>now+30000||data.exp*1000<=now)throw Error();return data;
  }catch{fail(401,'Please sign in to Rack Command.','signed_out');}
}
async function boundedJson(response){
  const reader=response.body?.getReader();if(!reader)fail();const parts=[];let size=0;
  try{for(;;){const next=await reader.read();if(next.done)break;size+=next.value.byteLength;if(size>65536){await reader.cancel();fail();}parts.push(next.value);}const bytes=Buffer.concat(parts.map(v=>Buffer.from(v)));return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}
  catch(error){if(error instanceof CommandSessionError)throw error;fail();}finally{reader.releaseLock();}
}
function createCommandSessionService({env=process.env,fetchImpl=globalThis.fetch,clock=Date.now}={}){
  const config=setting(env);
  async function auth(path,{method='GET',body,access}={}){
    if(!config)fail(404,'Not found');let response;
    try{response=await fetchImpl(config.projectUrl+'/auth/v1/'+path,{method,cache:'no-store',redirect:'error',signal:AbortSignal.timeout(20000),headers:{apikey:config.publishableKey,...(access?{Authorization:'Bearer '+access}:{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});}catch{fail();}
    const age=response.headers?.get('age');
    if(response.redirected||age!=null&&(!/^\d+$/.test(age)||Number(age)>0)||['cf-cache-status','x-vercel-cache'].some(k=>['HIT','STALE','UPDATING'].includes((response.headers?.get(k)||'').toUpperCase())))fail();
    if(response.status===204)return {ok:true,status:204,data:null};
    const data=await boundedJson(response);return {ok:response.ok,status:response.status,data};
  }
  async function verified(access){
    const decoded=claims(access,config,clock()); // Untrusted claims may only deny; GET /user verifies the signed token.
    const user=await auth('user',{access});
    if(!user.ok){if([400,401,403].includes(user.status))fail(401,'Please sign in to Rack Command.','signed_out');fail();}
    if(user.data?.id!==config.owner||typeof user.data.email!=='string'||user.data.email.length>254||user.data.deleted_at||user.data.banned_until&&Date.parse(user.data.banned_until)>clock())fail(403,'This account does not have Rack Command access.','owner_required');
    return {access,member:user.data.id,email:user.data.email,sessionRef:decoded.session_id,expiresAt:decoded.exp*1000};
  }
  function store(res,session,remember,{select=false,sessionRef}={}){
    if(typeof session?.refresh_token!=='string'||!/^[A-Za-z0-9_-]{1,1024}$/.test(session.refresh_token))fail();
    const decoded=claims(session.access_token,config,clock());if(sessionRef&&decoded.session_id!==sessionRef)fail(401,'Please sign in to Rack Command.','signed_out');
    putCookie(res,ACCESS+decoded.session_id,session.access_token,remember?Math.min(COOKIE_AGE,Math.max(1,Math.floor((claims(session.access_token,config,clock()).exp*1000-clock())/1000))):null);
    putCookie(res,REFRESH+decoded.session_id,Buffer.from(JSON.stringify({token:session.refresh_token,remember})).toString('base64url'),remember?COOKIE_AGE:null);
    if(select)putCookie(res,CURRENT,decoded.session_id,remember?COOKIE_AGE:null);
  }
  function view(session){return {signedIn:true,member:session.member,email:session.email,sessionRef:session.sessionRef,expiresAt:session.expiresAt};}
  async function fromProvider(res,result,remember,options={select:true}){
    if(!result.ok){if(result.status===429)fail(429,'Too many sign-in attempts. Wait before trying again.','rate_limited');if([400,401,403].includes(result.status))fail(401,'Check your email and password, or use a one-time sign-in link.','sign_in_failed');fail();}
    let session;try{session=await verified(result.data?.access_token);}catch(error){if(result.data?.access_token)try{await auth('logout?scope=local',{method:'POST',access:result.data.access_token});}catch{}throw error;}
    store(res,result.data,remember,options);return session;
  }
  async function resolve(req,res){
    if(!config)fail(404,'Not found');let c;
    c=credentials(req);
    if(c.access){try{const value=await verified(c.access);if(value.sessionRef!==c.sessionRef)fail(401,'Please sign in to Rack Command.','signed_out');return value;}catch(error){if(error.status!==401)throw error;}}
    if(!c.refresh){fail(401,'Please sign in to Rack Command.','signed_out');}
    try{return await fromProvider(res,await auth('token?grant_type=refresh_token',{method:'POST',body:{refresh_token:c.refresh}}),c.remember,{select:false,sessionRef:c.sessionRef});}
    catch(error){throw error;}
  }
  async function body(req,keys){
    if(req.headers?.origin!==config.previewOrigin||req.headers?.['sec-fetch-site']!==undefined&&req.headers['sec-fetch-site']!=='same-origin')fail(403,'Open this form from Rack Command.');
    if(typeof req.headers?.['content-type']!=='string'||req.headers['content-type'].split(';')[0].trim().toLowerCase()!=='application/json')fail(415,'JSON required');
    try{
      // Vercel may supply already-parsed JSON. This is a separate bounded Auth
      // form reader; the eight-field financial/work command reader stays intact.
      const parsed=req.body;
      if(parsed!==undefined&&typeof parsed!=='string'&&!Buffer.isBuffer(parsed)){
        exact(parsed,keys);const copy={};
        for(const key of keys){const value=Object.getOwnPropertyDescriptor(parsed,key).value;if(!['string','boolean'].includes(typeof value))fail(400,'Check the sign-in form.');copy[key]=value;}
        if(Buffer.byteLength(JSON.stringify(copy))>16384)fail(400,'Check the sign-in form.');return copy;
      }
      return exact(await readBody(req),keys);
    }catch(error){if(error instanceof CommandSessionError)throw error;fail(400,'Check the sign-in form.');}
  }
  async function handle(req,res){
    noStore(res);const send=(status,value)=>{res.statusCode=status;res.setHeader('Content-Type','application/json');res.end(JSON.stringify(value));};
    if(!config){send(404,{error:'Not found'});return;}
    try{
      const query=new URL(req.url,'https://example.invalid').searchParams,action=query.get('action');
      if([...query.keys()].some(k=>k!=='action')||query.getAll('action').length!==1||!['session','login','email','callback','logout','password'].includes(action))fail(400,'Invalid sign-in request');
      if((action==='session'?'GET':'POST')!==req.method){res.setHeader('Allow',action==='session'?'GET':'POST');fail(405,'Method not allowed');}
      if(action==='session'){
        try{send(200,view(await resolve(req,res)));}catch(error){if(error.status===401)send(200,{signedIn:false});else throw error;}return;
      }
      if(action==='login'){
        const value=await body(req,['email','password','remember']);
        if(typeof value.email!=='string'||!/^\S+@\S+\.\S+$/.test(value.email.trim())||value.email.length>254||typeof value.password!=='string'||!value.password||value.password.length>1024||typeof value.remember!=='boolean')fail(400,'Enter your email and password.');
        const session=await fromProvider(res,await auth('token?grant_type=password',{method:'POST',body:{email:value.email.trim().toLowerCase(),password:value.password}}),value.remember);send(200,view(session));return;
      }
      if(action==='email'){
        const value=await body(req,['email','remember']);
        if(typeof value.email!=='string'||!/^\S+@\S+\.\S+$/.test(value.email.trim())||value.email.length>254||typeof value.remember!=='boolean')fail(400,'Enter your Rack email address.');
        const verifier=randomBytes(32).toString('base64url'),challenge=createHash('sha256').update(verifier).digest('base64url');
        const result=await auth('otp?redirect_to='+encodeURIComponent(config.returnUrl),{method:'POST',body:{email:value.email.trim().toLowerCase(),create_user:false,code_challenge:challenge,code_challenge_method:'s256'}});
        if(!result.ok){if(result.status===429)fail(429,'Email sign-in is limited. Wait before requesting another link.','rate_limited');fail(503,'A sign-in email was not confirmed. Try password sign-in.');}
        putCookie(res,PKCE,Buffer.from(JSON.stringify({verifier,createdAt:clock(),remember:value.remember})).toString('base64url'),600);send(200,{sent:true});return;
      }
      if(action==='callback'){
        const value=await body(req,['code']);const pending=decodeCookie(cookieValue(req,PKCE));
        if(pending===null){send(409,{code:'not_command_callback'});return;}
        putCookie(res,PKCE,'',0);exact(pending,['verifier','createdAt','remember']);
        if(typeof value.code!=='string'||!value.code||value.code.length>2048||!/^[A-Za-z0-9_-]{43}$/.test(pending.verifier)||!Number.isSafeInteger(pending.createdAt)||clock()<pending.createdAt||clock()-pending.createdAt>600000||typeof pending.remember!=='boolean')fail(401,'Request a fresh link from Rack Command.','invalid_callback');
        const session=await fromProvider(res,await auth('token?grant_type=pkce',{method:'POST',body:{auth_code:value.code,code_verifier:pending.verifier}}),pending.remember);send(200,view(session));return;
      }
      if(action==='logout'){
        await body(req,[]);let confirmed=false,sessionRef=null;try{sessionRef=credentials(req).sessionRef;}catch{}
        try{const session=await resolve(req,res);const result=await auth('logout?scope=local',{method:'POST',access:session.access});confirmed=result.ok;}catch{}
        clearSession(res,sessionRef);send(200,{signedIn:false,providerSignOutConfirmed:confirmed});return;
      }
      const value=await body(req,['password']);
      if(typeof value.password!=='string'||value.password.length<12||value.password.length>128)fail(400,'Choose a password with at least 12 characters.');
      const current=await resolve(req,res),remember=credentials(req).remember;
      let changed;
      try{changed=await auth('user',{method:'PUT',access:current.access,body:{password:value.password}});}
      catch{clearSession(res,current.sessionRef);fail(409,'Your password may have changed. Try signing in with the new password before requesting another change.','password_change_unconfirmed');}
      if(!changed.ok)fail(400,'The password change was not confirmed. Choose a stronger password or try again later.');
      try{const session=await fromProvider(res,await auth('token?grant_type=password',{method:'POST',body:{email:current.email,password:value.password}}),remember);send(200,{...view(session),passwordChanged:true});}
      catch{clearSession(res,current.sessionRef);fail(409,'Your password may have changed. Sign in with the new password before trying another change.','password_change_unconfirmed');}
    }catch(error){send(error instanceof CommandSessionError?error.status:503,{error:error instanceof CommandSessionError?error.message:'Rack sign-in is temporarily unavailable.',code:error instanceof CommandSessionError?error.code:'session_unavailable'});}
  }
  return Object.freeze({config,resolve,handle});
}
module.exports={createCommandSessionService,CommandSessionError,noStore};
