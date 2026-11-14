'use strict';
// Disposable PostgreSQL-compatible engine + synthetic Auth HTTP only.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{createHmac,timingSafeEqual}=require('node:crypto');
const {PGlite}=require('@electric-sql/pglite');
const {createCommandOwnerSessionReader,PROJECT,RPC}=require('../server/command_owner_session_reader.cjs');
const {createCommandSessionService}=require('../server/command_session.cjs');
const {createTestOrderRepository}=require('../server/test_order_repository.cjs');
const {createTestAdminRuntime}=require('../server/test_admin_runtime.cjs');
const {TEST_ENVIRONMENTS}=require('../server/test_environment_registry.cjs');
const BASE=path.resolve(__dirname,'..');
const O='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222',S='33333333-3333-4333-8333-333333333333',N='44444444-4444-4444-8444-444444444444',OUT='55555555-5555-4555-8555-555555555555';
const SERVER='sb_secret_FICTIONAL_ONLY_abcdefghijklmnopqrstuvwxyz',PUBLISH='sb_publishable_FICTIONAL_ONLY',SIGN=Buffer.from('fictional-synthetic-auth-signing-key');
const env=()=>({VERCEL_ENV:'preview',VERCEL_GIT_COMMIT_REF:TEST_ENVIRONMENTS.acceptance.branch,RACK_RELIC_TEST_ADMIN_OVERVIEW_ENABLED:'true',RACK_RELIC_TEST_ADMIN_WORK_ENABLED:'true',RACK_RELIC_TEST_ADMIN_RESERVE_READ_ENABLED:'true',RACK_RELIC_TEST_ADMIN_OWNER_ID:O,RACK_RELIC_TEST_SUPABASE_URL:PROJECT,RACK_RELIC_TEST_STRIPE_ACCOUNT:TEST_ENVIRONMENTS.acceptance.accountId,RACK_RELIC_TEST_SUPABASE_PUBLISHABLE_KEY:PUBLISH,RACK_RELIC_TEST_SUPABASE_SERVER_KEY:SERVER,RACK_RELIC_TEST_MEMBER_IDS:O+','+B,RACK_RELIC_TEST_REFUND_OPERATOR_IDS:O+','+B,RACK_RELIC_TEST_REFUNDS_ENABLED:'true',RACK_RELIC_TEST_REFUND_REQUESTS_ENABLED:'true'});
function token(patch={}){const h=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url'),p=Buffer.from(JSON.stringify({iss:PROJECT+'/auth/v1',sub:O,aud:'authenticated',role:'authenticated',is_anonymous:false,session_id:S,iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+3600,...patch})).toString('base64url');return h+'.'+p+'.'+createHmac('sha256',SIGN).update(h+'.'+p).digest('base64url');}
function signed(t){const[h,p,s]=t.split('.'),expect=createHmac('sha256',SIGN).update(h+'.'+p).digest();const actual=Buffer.from(s,'base64url');assert.equal(actual.length,expect.length);assert.equal(timingSafeEqual(actual,expect),true);return JSON.parse(Buffer.from(p,'base64url'));}
function response(url,data,{status=200,headers={}}={}){const r=new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json','cache-control':'private, no-store, max-age=0',date:new Date().toUTCString(),...headers}});Object.defineProperty(r,'url',{value:url});return r;}
function res(){return{headers:{},setHeader(k,v){this.headers[k.toLowerCase()]=v;},getHeader(k){return this.headers[k.toLowerCase()];},end(v){this.body=v;try{this.data=JSON.parse(v);}catch{}}};}
const cookies=r=>(r.headers['set-cookie']||[]).filter(v=>!v.endsWith('Max-Age=0')).map(v=>v.split(';')[0]).join('; ');
function cookie(t=token(),sid=S,remember=true){return '__Host-rr-command-current='+sid+'; __Host-rr-command-access.'+sid+'='+t+'; __Host-rr-command-refresh.'+sid+'='+Buffer.from(JSON.stringify({token:'fictional_refresh',remember})).toString('base64url');}
async function create(){
 const db=new PGlite();await db.exec('CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE SCHEMA rr_sandbox;GRANT USAGE ON SCHEMA rr_sandbox TO service_role;CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,deleted_at timestamptz,banned_until timestamptz);CREATE TABLE auth.sessions(id uuid PRIMARY KEY,user_id uuid,not_after timestamptz);CREATE TABLE rr_sandbox.catalog(seller_id uuid);CREATE TABLE rr_sandbox.orders(buyer_id uuid,seller_id uuid);');
 await db.exec(fs.readFileSync(path.join(BASE,'supabase/test/20261103230114_private_admin_work.sql'),'utf8'));await db.exec(fs.readFileSync(path.join(BASE,'supabase/test/20261109_command_owner_session.sql'),'utf8'));
 await db.query('INSERT INTO rr_sandbox.catalog(seller_id)VALUES($1)',[O]);
 async function reset(){await db.exec('DELETE FROM auth.sessions;DELETE FROM auth.users;');for(const [id,email]of[[O,'owner@example.invalid'],[B,'support@example.invalid'],[OUT,'outsider@example.invalid']])await db.query('INSERT INTO auth.users(id,email)VALUES($1,$2)',[id,email]);await db.query('INSERT INTO auth.sessions(id,user_id,not_after)VALUES($1,$2,NULL),($3,$2,NULL)',[S,O,N]);}
 await reset();let hook=null,calls=[],getUserPatch=null,refreshToken=null;
 async function rpc(name,args){assert.ok([RPC,'rr_test_write_admin_work','rr_test_admin_work_list','rr_test_admin_work_receipt'].includes(name));const types={ [RPC]:['uuid','uuid','uuid','bigint','uuid'],rr_test_write_admin_work:['uuid','uuid','jsonb'],rr_test_admin_work_list:['uuid','uuid','timestamptz','uuid'],rr_test_admin_work_receipt:['uuid','uuid','uuid']}[name],keys={ [RPC]:['p_owner','p_actor','p_session','p_token_exp','p_nonce'],rr_test_write_admin_work:['p_owner','p_actor','p_command'],rr_test_admin_work_list:['p_owner','p_actor','p_before','p_after'],rr_test_admin_work_receipt:['p_owner','p_actor','p_request']}[name];assert.deepEqual(Object.keys(args).sort(),keys.slice(0,Object.keys(args).length).sort());await db.exec('SET ROLE service_role');try{return(await db.query('SELECT public.'+name+'('+Object.keys(args).map((_,i)=>'$'+(i+1)+'::'+types[i]).join(',')+') AS value',keys.slice(0,Object.keys(args).length).map(k=>args[k]))).rows[0].value;}finally{await db.exec('RESET ROLE');}}
 async function fetchImpl(url,o){const c={url,options:o};calls.push(c);let custom;if(hook)custom=await hook(c,'before');if(custom)return custom;
  let data;
  if(url===PROJECT+'/auth/v1/user'&&o.method==='GET'){assert.equal(o.headers.apikey,SERVER);const t=o.headers.Authorization?.slice(7),claims=signed(t);data={id:claims.sub,email:claims.sub===O?'owner@example.invalid':'support@example.invalid',aud:'authenticated',role:'authenticated',is_anonymous:false,deleted_at:null,banned_until:null,...getUserPatch};}
  else if(url.startsWith(PROJECT+'/rest/v1/rpc/')){assert.equal(o.headers.apikey,SERVER);assert.equal(o.headers.Authorization,undefined);if(url.endsWith('/'+RPC))assert.equal(o.headers['Accept-Encoding'],'identity');data=await rpc(url.slice(url.lastIndexOf('/')+1),JSON.parse(o.body));}
  else if(url.includes('/auth/v1/token?')){assert.equal(o.headers.apikey,PUBLISH);data={access_token:refreshToken||token(),refresh_token:'fictional_refresh'};}
  else if(url===PROJECT+'/auth/v1/logout?scope=local'){assert.equal(o.headers.apikey,PUBLISH);data={};}
  else throw Error('Unimplemented synthetic route: '+url);
  if(hook)custom=await hook({...c,data},'after');return custom||response(url,data);
 }
 const reader=opts=>createCommandOwnerSessionReader({projectUrl:PROJECT,ownerId:O,serverKey:SERVER,fetchImpl,...opts});
 const service=opts=>createCommandSessionService({env:env(),fetchImpl,...opts});
 const repo=opts=>createTestOrderRepository({projectUrl:PROJECT,serviceKey:SERVER,allowedMemberIds:[O,B],allowedRefundOperatorIds:[O,B],refundsEnabled:true,refundRequestsEnabled:true,adminWorkEnabled:true,reserveReadEnabled:true,adminOwnerId:O,fetchImpl,...opts});
 async function call(service,action,{body,method=action==='session'?'GET':'POST',cookie:cc,headers={}}={}){const r=res();await service.handle({url:'/api/command-session?action='+action,method,headers:{origin:TEST_ENVIRONMENTS.acceptance.previewOrigin,'sec-fetch-site':'same-origin','content-type':'application/json',...(cc?{cookie:cc}:{}),...headers},...(body===undefined?{}:{body})},r);return r;}
 return{db,reset,fetchImpl,reader,service,repo,call,runtime:opts=>createTestAdminRuntime({env:env(),fetchImpl,...opts}),rpc,clearCalls(){calls.length=0;},get calls(){return calls;},set hook(v){hook=v;},set userPatch(v){getUserPatch=v;},set refresh(v){refreshToken=v;}};
}
module.exports={create,token,signed,response,res,cookies,cookie,O,B,S,N,OUT,PROJECT,RPC,SERVER,PUBLISH,env};
