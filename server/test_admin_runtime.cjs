'use strict';
const fs=require('node:fs'),path=require('node:path');
const {selectTestEnvironment}=require('./test_environment_registry.cjs');
const {createTestOrderRepository,OrderAccessDenied}=require('./test_order_repository.cjs');
const {projectAdminOverview}=require('../test-admin.js');
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
function createTestAdminRuntime({env=process.env,fetchImpl=globalThis.fetch,clock=Date.now}={}){
 return async(req,res)=>{
  for(const [k,v]of Object.entries({'Cache-Control':'private, no-store, max-age=0','CDN-Cache-Control':'no-store','Vercel-CDN-Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Robots-Tag':'noindex, nofollow'}))res.setHeader(k,v);
  const send=(status,body)=>{res.statusCode=status;res.setHeader('Content-Type','application/json');res.end(JSON.stringify(body));};
  const environment=selectTestEnvironment({branch:env.VERCEL_GIT_COMMIT_REF,projectUrl:env.RACK_RELIC_TEST_SUPABASE_URL,accountId:env.RACK_RELIC_TEST_STRIPE_ACCOUNT});
  if(env.VERCEL_ENV!=='preview'||env.RACK_RELIC_TEST_ADMIN_OVERVIEW_ENABLED!=='true'||!environment){send(404,{error:'Not found'});return;}
  if(req.method!=='GET'){res.setHeader('Allow','GET');send(405,{error:'Method not allowed'});return;}
  let query;try{query=new URL(req.url,'https://example.invalid').searchParams;}catch{send(400,{error:'Invalid overview request'});return;}
  const action=query.get('action');
  if([...query.keys()].some(k=>k!=='action')||query.getAll('action').length>1||action!==null&&!['config','access','overview'].includes(action)){send(400,{error:'Invalid overview request'});return;}
  if(action===null){res.statusCode=200;res.setHeader('Content-Type','text/html; charset=utf-8');res.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'");res.end(fs.readFileSync(path.join(__dirname,'test-admin.html'),'utf8'));return;}
  if(action==='config'){send(200,{test:true,live:false,environmentId:environment.id,projectUrl:environment.projectUrl,returnUrl:environment.returnUrl});return;}
  const members=(env.RACK_RELIC_TEST_MEMBER_IDS||'').split(',').map(x=>x.trim()).filter(Boolean),operators=(env.RACK_RELIC_TEST_REFUND_OPERATOR_IDS||'').split(',').map(x=>x.trim()).filter(Boolean);
  const ownerId=env.RACK_RELIC_TEST_ADMIN_OWNER_ID;
  if(!UUID.test(ownerId||'')||!members.includes(ownerId)||!operators.includes(ownerId)||members.length!==2||new Set(members).size!==2||!members.every(x=>UUID.test(x))||operators.length<1||operators.length>2||new Set(operators).size!==operators.length||!operators.every(x=>members.includes(x))||env.RACK_RELIC_TEST_REFUNDS_ENABLED!=='true'||env.RACK_RELIC_TEST_REFUND_REQUESTS_ENABLED!=='true'){send(503,{error:'Private overview is being prepared'});return;}
  try{
   const repository=createTestOrderRepository({projectUrl:environment.projectUrl,serviceKey:env.RACK_RELIC_TEST_SUPABASE_SERVER_KEY,allowedMemberIds:members,allowedRefundOperatorIds:operators,refundsEnabled:true,refundRequestsEnabled:true,fetchImpl});
   const authorization=req.headers?.authorization;
   if(action==='access'){send(200,await repository.adminAccess({authorization,ownerId}));return;}
   const raw=await repository.adminOverview({authorization,ownerId});
   send(200,projectAdminOverview(raw,{environmentId:environment.id,revision:env.VERCEL_GIT_COMMIT_SHA,now:clock()}));
  }catch(e){send(e instanceof OrderAccessDenied?403:503,{error:e instanceof OrderAccessDenied?'Owner sign-in required':'Private overview unavailable. Provider health is unverified.'});}
 };
}
module.exports={createTestAdminRuntime};
