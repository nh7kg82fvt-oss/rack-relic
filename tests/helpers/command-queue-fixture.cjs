'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {PGlite}=require('@electric-sql/pglite');
const {TEST_ENVIRONMENTS}=require('../../server/test_environment_registry.cjs');
const {createQueueRepository}=require('../../server/command_queue_repository.cjs');
const {createTestAdminRuntime}=require('../../server/test_admin_runtime.cjs');
const E=TEST_ENVIRONMENTS.acceptance,BASE=path.resolve(__dirname,'../..');
const id=n=>'11111111-1111-4111-8111-'+String(n).padStart(12,'0'),OWNER=id(1),SESSION=id(2),OTHER=id(3),SECOND=id(4);
const key='sb_secret_FICTIONAL_abcdefghijklmnopqrstuvwxyz';
const env=()=>({VERCEL_ENV:'preview',VERCEL_GIT_COMMIT_REF:E.branch,RACK_RELIC_TEST_SUPABASE_URL:E.projectUrl,RACK_RELIC_TEST_STRIPE_ACCOUNT:E.accountId,RACK_RELIC_TEST_ADMIN_OWNER_ID:OWNER,RACK_RELIC_TEST_SUPABASE_SERVER_KEY:key,RACK_RELIC_TEST_MEMBER_IDS:OWNER+','+OTHER,RACK_RELIC_TEST_REFUND_OPERATOR_IDS:OWNER,RACK_RELIC_TEST_REFUNDS_ENABLED:'true',RACK_RELIC_TEST_REFUND_REQUESTS_ENABLED:'true',RACK_RELIC_TEST_ADMIN_OVERVIEW_ENABLED:'true',RACK_RELIC_COMMAND_QUEUE_ACK_ENABLED:'true'});
function token(session=SESSION,owner=OWNER){return 'e30.'+Buffer.from(JSON.stringify({iss:E.projectUrl+'/auth/v1',sub:owner,session_id:session,aud:'authenticated',role:'authenticated',is_anonymous:false,exp:Math.floor(Date.now()/1000)+3600,iat:Math.floor(Date.now()/1000)})).toString('base64url')+'.fictional';}
function response(url,value,status=200,headers={}){const r=new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json','cache-control':'private, no-store, max-age=0',date:new Date().toUTCString(),...headers}});Object.defineProperty(r,'url',{value:url});return r;}
const caseRef=n=>'case_'+crypto.createHash('md5').update('du_fictional'+n).digest('hex');
const files=['20261030_order_ledger','20261030_payment_recovery','20261030_checkout_attempts','20261030_refund_receipts','20261030_refund_requests','20261030_checkout_quote_limits','20261030_checkout_quote_refresh','20261031_cancel_preparation','20261031_refund_review','20261031_charge_fee_evidence','20261031_fulfillment_snapshots','20261031_label_attempts','20261031_tracking_observations','20261102_seller_onboarding','20261102_order_issues','20261102_order_issues_review','20261102_order_issues_thread','20261102_order_issues_review_refunds','20261103_seller_protections','20261103_provider_risk_holds','20261103_cloud_case_alerts','20261103_admin_overview'];
async function rig(){
 const db=new PGlite();await db.exec('CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;');
 for(const f of files){
  if(f==='20261103_seller_protections')await seedOrders();
  await db.exec(fs.readFileSync(path.join(BASE,'supabase/test/'+f+'.sql'),'utf8'));
 }
 await db.exec(`GRANT USAGE ON SCHEMA rr_sandbox TO service_role;CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid PRIMARY KEY,deleted_at timestamptz,banned_until timestamptz);CREATE TABLE auth.sessions(id uuid PRIMARY KEY,user_id uuid,not_after timestamptz);INSERT INTO auth.users VALUES('${OWNER}',NULL,NULL),('${OTHER}',NULL,NULL);INSERT INTO auth.sessions VALUES('${SESSION}','${OWNER}',NULL),('${SECOND}','${OWNER}',NULL);`);
 await db.exec(fs.readFileSync(path.join(BASE,'supabase/test/20261109_command_owner_session.sql'),'utf8'));
 const source=fs.readFileSync(path.join(BASE,'supabase/proposals/command_queue_ack.sql'),'utf8');await db.exec(source);
 async function activate(){let s=source.slice(source.indexOf('CREATE FUNCTION rr_sandbox.command_queue_action('),source.indexOf('CREATE FUNCTION public.rr_test_command_queue'));
  const replace=(a,b)=>{assert.equal(s.split(a).length,2);s=s.replace(a,b);};
  replace('CREATE FUNCTION','CREATE OR REPLACE FUNCTION');replace('authorized_owner CONSTANT uuid := NULL;',`authorized_owner CONSTANT uuid := '${OWNER}';`);
  replace('enabled_from CONSTANT timestamptz := NULL;',`enabled_from CONSTANT timestamptz := '${new Date(Date.now()-60000).toISOString()}';`);
  replace('enabled_until CONSTANT timestamptz := NULL;',`enabled_until CONSTANT timestamptz := '${new Date(Date.now()+3600000).toISOString()}';`);await db.exec(s);
 }
 async function seedOrders(n=35){for(let i=1;i<=n;i++){
  // Historical fictional rows precede the protection installation, as in the
  // existing overview fixture. No positive seller trust or guard bypass.
  await db.query("INSERT INTO rr_sandbox.catalog(id,seller_id,title,price_cents)VALUES($1,$2,'Fictional historical queue coat',1000)",[id(100+i),OWNER]);
  await db.query("INSERT INTO rr_sandbox.orders(id,listing_id,buyer_id,seller_id,listing_version,listing_updated_at,item_cents,buyer_fee_cents,state,updated_at)VALUES($1,$2,$3,$4,1,now(),1000,40,'paid',now()-($5::int||' days')::interval)",[id(200+i),id(100+i),OTHER,OWNER,i]);
 }}
 async function seed(n=35){for(let i=1;i<=n;i++){
  // Fictional saved rows only. This does not invoke the receiver or assert any
  // real signed-provider acceptance. The canonical capture trigger runs.
  await db.query("INSERT INTO rr_sandbox.provider_events(id,payload_hash,order_id,event_type)VALUES($1,$2,$3,'charge.dispute.created')",['evt_fictional'+i,'a'.repeat(64),id(200+i)]);
  await db.query("INSERT INTO rr_sandbox.provider_risk_notices(event_id,order_id,case_id,charge_id,kind,status,amount_cents,due_by,event_created)VALUES($1,$2,$3,$4,'dispute','needs_response',1000,now()+interval '1 day',1)",['evt_fictional'+i,id(200+i),'du_fictional'+i,'ch_fictional'+i]);
 }}

 async function sql(op,args,{owner=OWNER,session=SESSION,nonce=crypto.randomUUID(),exp=Math.floor(Date.now()/1000)+3600}={}){
  return (await db.query('SELECT public.rr_test_command_queue($1::uuid,$2::uuid,$3::bigint,$4::uuid,$5::text,$6::jsonb) v',[owner,session,exp,nonce,op,JSON.stringify(args)])).rows[0].v;
 }
 let hook=null,calls=[];
 async function fetchImpl(url,opts){calls.push({url,opts});if(hook){const v=await hook(url,opts,'before');if(v)return v;}
  let v,status=200;
  if(url===E.projectUrl+'/auth/v1/user') {assert.equal(opts.headers.apikey,key);const claims=JSON.parse(Buffer.from(opts.headers.Authorization.split('.')[1],'base64url'));v={id:claims.sub,email:'owner@example.invalid',role:'authenticated',aud:'authenticated',is_anonymous:false};}
  else {assert.equal(opts.headers.apikey,key);assert.equal(opts.headers.Authorization,undefined);const a=JSON.parse(opts.body);
   if(url.endsWith('/rr_test_command_owner_session'))v=(await db.query('SELECT public.rr_test_command_owner_session($1,$2,$3,$4,$5) v',[a.p_owner,a.p_actor,a.p_session,a.p_token_exp,a.p_nonce])).rows[0].v;
   else if(url.endsWith('/rr_test_command_queue')){try{v=await sql(a.p_operation,a.p_args,{owner:a.p_owner,session:a.p_session,exp:a.p_token_exp,nonce:a.p_nonce});}catch(e){v={message:e.message,code:'P0001'};status=400;}}
   else throw Error('Unimplemented synthetic route '+url);
  }
  if(hook){const x=await hook(url,opts,'after',v);if(x)return x;}return response(url,v,status);
 }
 const repository=(opts={})=>createQueueRepository({env:env(),fetchImpl,...opts});
 const run=(repo,op,fields={})=>repo.run({authorization:'Bearer '+token(),operation:op,nonce:crypto.randomUUID(),...fields});
 function http(patch={}){return createTestAdminRuntime({env:{...env(),...patch},fetchImpl,commandSession:{config:{},async resolve(){return {access:token(),sessionRef:SESSION};}}});}
 return {db,source,activate,seed,sql,fetchImpl,repository,run,http,calls,set hook(v){hook=v;},async close(){await db.close();}};
}
module.exports={rig,id,OWNER,OTHER,SESSION,SECOND,env,token,response,caseRef,E};
