'use strict';
const fs=require('node:fs'),path=require('node:path');
const {selectTestEnvironment}=require('./test_environment_registry.cjs');
const {createTestOrderRepository,OrderAccessDenied}=require('./test_order_repository.cjs');
const {projectAdminOverview}=require('../test-admin.js');
const adminWork=require('./admin_work_data.cjs');
const reserveRead=require('../test-reserve-read.js');
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
function createTestAdminRuntime({env=process.env,fetchImpl=globalThis.fetch,clock=Date.now,commandSession=null,ownerFixtureSetupAvailable=null}={}){
 return async(req,res)=>{
  for(const [k,v]of Object.entries({'Cache-Control':'private, no-store, max-age=0','CDN-Cache-Control':'no-store','Vercel-CDN-Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Robots-Tag':'noindex, nofollow'}))res.setHeader(k,v);
  const send=(status,body)=>{res.statusCode=status;res.setHeader('Content-Type','application/json');res.end(JSON.stringify(body));};
  const environment=selectTestEnvironment({branch:env.VERCEL_GIT_COMMIT_REF,projectUrl:env.RACK_RELIC_TEST_SUPABASE_URL,accountId:env.RACK_RELIC_TEST_STRIPE_ACCOUNT});
  if(env.VERCEL_ENV!=='preview'||env.RACK_RELIC_TEST_ADMIN_OVERVIEW_ENABLED!=='true'||!environment||commandSession&&(!commandSession.config||environment.id!=='acceptance-v1')){send(404,{error:'Not found'});return;}
  let query;try{query=new URL(req.url,'https://example.invalid').searchParams;}catch{send(400,{error:'Invalid overview request'});return;}
  const action=query.get('action');
  if(req.method!=='GET'&&!(req.method==='POST'&&action==='work')){res.setHeader('Allow',action==='work'&&environment.id==='acceptance-v1'&&env.RACK_RELIC_TEST_ADMIN_WORK_ENABLED==='true'?'GET, POST':'GET');send(405,{error:'Method not allowed'});return;}
  if([...query.keys()].some(k=>k!=='action'&&!(action==='work'&&req.method==='GET'&&['requestId','cursor'].includes(k)))||query.getAll('action').length>1||query.getAll('requestId').length>1||query.getAll('cursor').length>1||query.has('requestId')&&query.has('cursor')||action!==null&&!['config','access','overview','work'].includes(action)){send(400,{error:'Invalid overview request'});return;}
  const workEnabled=environment.id==='acceptance-v1'&&env.RACK_RELIC_TEST_ADMIN_WORK_ENABLED==='true';
  const reserveReadEnabled=environment.id==='acceptance-v1'&&env.RACK_RELIC_TEST_ADMIN_RESERVE_READ_ENABLED==='true';
  if(action==='work'&&!workEnabled){send(404,{error:'Not found'});return;}
  if(action===null){res.statusCode=200;res.setHeader('Content-Type','text/html; charset=utf-8');res.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self'; img-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'");res.end(fs.readFileSync(path.join(__dirname,commandSession?'command-center.html':'test-admin.html'),'utf8'));return;}
  if(action==='config'){send(200,{test:true,live:false,environmentId:environment.id,projectUrl:environment.projectUrl,returnUrl:environment.returnUrl,workEnabled,reserveReadEnabled,reserveReadVersion:reserveRead.VERSION,...(commandSession?{cookieSession:true}:{})});return;}
  const members=(env.RACK_RELIC_TEST_MEMBER_IDS||'').split(',').map(x=>x.trim()).filter(Boolean),operators=(env.RACK_RELIC_TEST_REFUND_OPERATOR_IDS||'').split(',').map(x=>x.trim()).filter(Boolean);
  const ownerId=env.RACK_RELIC_TEST_ADMIN_OWNER_ID;
  if(!UUID.test(ownerId||'')||!members.includes(ownerId)||!operators.includes(ownerId)||members.length!==2||new Set(members).size!==2||!members.every(x=>UUID.test(x))||operators.length<1||operators.length>2||new Set(operators).size!==operators.length||!operators.every(x=>members.includes(x))||env.RACK_RELIC_TEST_REFUNDS_ENABLED!=='true'||env.RACK_RELIC_TEST_REFUND_REQUESTS_ENABLED!=='true'){send(503,{error:'Private overview is being prepared'});return;}
  try{
   const repository=createTestOrderRepository({projectUrl:environment.projectUrl,serviceKey:env.RACK_RELIC_TEST_SUPABASE_SERVER_KEY,allowedMemberIds:members,allowedRefundOperatorIds:operators,refundsEnabled:true,refundRequestsEnabled:true,adminWorkEnabled:workEnabled,reserveReadEnabled,adminOwnerId:ownerId,fetchImpl,clock});
   let authorization=req.headers?.authorization;
   if(commandSession){const session=await commandSession.resolve(req,res);authorization='Bearer '+session.access;res.setHeader('X-Rack-Command-Session',session.sessionRef);}
   if(action==='access'){send(200,await repository.adminAccess({authorization,ownerId}));return;}
   if(action==='work'){
    if(req.method==='GET'){
     const requestId=query.has('requestId')?query.get('requestId'):null;
     if(requestId!==null&&!UUID.test(requestId||'')){send(400,{error:'Invalid private work request'});return;}
     const cursor=query.has('cursor')?query.get('cursor'):null;
     try{adminWork.cursor(cursor,{now:clock()});}catch{send(400,{error:'Invalid private work page'});return;}
     send(200,await repository.adminWorkList({authorization,ownerId,requestId,cursor}));return;
    }
    if(req.headers?.origin!==environment.previewOrigin||req.headers?.['sec-fetch-site']!==undefined&&req.headers['sec-fetch-site']!=='same-origin'){send(403,{error:'Open this form from your private control center'});return;}
    if(typeof req.headers?.['content-type']!=='string'||req.headers['content-type'].split(';')[0].trim().toLowerCase()!=='application/json'){send(415,{error:'JSON required'});return;}
    const length=req.headers['content-length'];if(length!==undefined&&(typeof length!=='string'||!/^\d+$/.test(length)||Number(length)>16384)){send(413,{error:'Request too large'});return;}
    let command;try{command=adminWork.command(await adminWork.readBody(req));}catch(e){send(e instanceof adminWork.AdminWorkInvalid?e.status||400:400,{error:'Check the work item details before saving'});return;}
    send(200,await repository.saveAdminWork({authorization,ownerId,command}));return;
   }
   const raw=await repository.adminOverview({authorization,ownerId});
   const reserve=reserveReadEnabled?await repository.adminReserveOverview({authorization,ownerId}):reserveRead.coverage('disabled',{now:clock(),environmentId:environment.id});
   const practiceAvailable=commandSession&&environment.id==='acceptance-v1'&&typeof ownerFixtureSetupAvailable==='function'&&ownerFixtureSetupAvailable()===true;
   send(200,{...projectAdminOverview(raw,{environmentId:environment.id,revision:env.VERCEL_GIT_COMMIT_SHA,now:clock()}),reserve,...(practiceAvailable?{ownerFixtureSetupAvailable:true}:{})});
  }catch(e){
   if(commandSession&&[401,403].includes(e.status)){send(e.status,{error:'Owner sign-in required'});return;}
   if(e instanceof adminWork.AdminWorkConflict){send(409,{error:e.reason==='version_conflict'?'This work item changed. Refresh before editing.':'The original save needs review. Check its request before trying again.',code:e.reason});return;}
   send(e instanceof OrderAccessDenied?403:503,{error:e instanceof OrderAccessDenied?'Owner sign-in required':action==='work'?(req.method==='POST'||query.has('requestId')?'Save could not be confirmed. Check the original request before trying again.':'Private work records are unavailable. Try refreshing. Do not create replacement saves for an uncertain request.'):'Private overview unavailable. Provider health is unverified.'});
  }
 };
}
module.exports={createTestAdminRuntime};
