'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {Readable}=require('node:stream');
const {TEST_ENVIRONMENTS,getTestEnvironmentByAccount,getTestEnvironmentByProject,getTestEnvironmentByPreviewOrigin,getTestEnvironmentByBranch,selectTestEnvironment}=require('../server/test_environment_registry.cjs');
const {createTestMarketplaceRuntime}=require('../server/test_marketplace_runtime.cjs');
const {createTestSetupStatus}=require('../server/test_setup_status.cjs');
const {createTestOrderRepository}=require('../server/test_order_repository.cjs');
const rows=Object.values(TEST_ENVIRONMENTS),buyer='22222222-2222-4222-8222-222222222222',seller='33333333-3333-4333-8333-333333333333';
const response=()=>({headers:{},setHeader(k,v){this.headers[k]=v;},end(body){this.body=JSON.parse(body);}});
const settings=row=>({VERCEL_ENV:'preview',VERCEL_GIT_COMMIT_REF:row.branch,RACK_RELIC_TEST_CHECKOUT_ENABLED:'true',RACK_RELIC_TEST_SUPABASE_URL:row.projectUrl,RACK_RELIC_TEST_MEMBER_IDS:buyer+','+seller,RACK_RELIC_TEST_SUPABASE_SERVER_KEY:'sb_secret_fixture',RACK_RELIC_TEST_SUPABASE_PUBLISHABLE_KEY:'sb_publishable_fixture',RACK_RELIC_TEST_STRIPE_KEY:'sk_test_fixture',RACK_RELIC_TEST_STRIPE_ACCOUNT:row.accountId});

test('reviewed test targets are immutable and lookups do not normalize or infer targets',()=>{
 assert.equal(Object.isFrozen(TEST_ENVIRONMENTS),true);assert.equal(rows.length,2);
 for(const row of rows){
  assert.equal(Object.isFrozen(row),true);assert.equal(row.projectUrl,'https://'+row.projectRef+'.supabase.co');assert.equal(row.returnUrl,row.previewOrigin+'/api/test-marketplace');
  assert.equal(getTestEnvironmentByAccount(row.accountId),row);assert.equal(getTestEnvironmentByProject(row.projectUrl),row);assert.equal(getTestEnvironmentByPreviewOrigin(row.previewOrigin),row);assert.equal(getTestEnvironmentByBranch(row.branch),row);assert.equal(selectTestEnvironment(row),row);
  assert.equal(getTestEnvironmentByProject(row.projectUrl+'/'),null);assert.equal(getTestEnvironmentByProject(row.projectUrl+'.foreign.example'),null);assert.equal(getTestEnvironmentByPreviewOrigin(row.previewOrigin+'/'),null);assert.equal(getTestEnvironmentByAccount(' '+row.accountId),null);
 }
 for(const value of [undefined,null,{},'main','production','https://zrfztnbyynrdzfeblkeq.supabase.co'])assert.equal(getTestEnvironmentByBranch(value),null);
 assert.throws(()=>{TEST_ENVIRONMENTS.acceptance.projectRef=TEST_ENVIRONMENTS.legacy.projectRef;},TypeError);
});

test('every mixed branch, database and Stripe tuple is rejected before any runtime provider call',async()=>{
 for(const branchRow of rows)for(const databaseRow of rows)for(const stripeRow of rows){
  const env={...settings(branchRow),RACK_RELIC_TEST_SUPABASE_URL:databaseRow.projectUrl,RACK_RELIC_TEST_STRIPE_ACCOUNT:stripeRow.accountId};
  const matched=branchRow===databaseRow&&branchRow===stripeRow;
  for(const url of ['/api/test-marketplace?action=config','/api/test-marketplace?action=orders']){
   const res=response();let calls=0;await createTestMarketplaceRuntime({env,fetchImpl:async()=>{calls++;assert.fail('Rejected tuple must never reach a provider');}})({method:'GET',url,headers:{}},res);
   assert.equal(res.statusCode,matched?(url.endsWith('config')?200:401):503);
   assert.equal(calls,0);
   if(matched&&url.endsWith('config')){assert.equal(res.body.environmentId,branchRow.id);assert.equal(res.body.projectUrl,branchRow.projectUrl);assert.equal(res.body.returnUrl,branchRow.returnUrl);}
  }
 }
});

test('unregistered or production runtime targets fail closed and cannot select arbitrary origins',async()=>{
 for(const row of rows)for(const patch of [{VERCEL_ENV:'production'},{VERCEL_ENV:'development'},{VERCEL_GIT_COMMIT_REF:'main'},{VERCEL_GIT_COMMIT_REF:'unreviewed-branch'}]){
  const res=response();await createTestMarketplaceRuntime({env:{...settings(row),...patch},fetchImpl:()=>assert.fail('network')})({method:'GET',url:'/api/test-marketplace?action=config'},res);assert.equal(res.statusCode,404);
 }
 for(const row of rows){
  const res=response();await createTestMarketplaceRuntime({env:{...settings(row),VERCEL_URL:'foreign.example',RACK_RELIC_TEST_RETURN_ORIGIN:'https://foreign.example'},fetchImpl:()=>assert.fail('network')})({method:'GET',url:'/api/test-marketplace?action=config',headers:{host:'foreign.example'}},res);
  assert.equal(res.statusCode,200);assert.equal(res.body.returnUrl,row.returnUrl);assert.equal(JSON.stringify(res.body).includes('foreign.example'),false);
 }
});

test('private HTML binds its CSP to the approved branch database without requiring credentials',async()=>{
 for(const row of rows){
  const res={headers:{},setHeader(k,v){this.headers[k]=v;},end(body){this.body=body;}};
  await createTestMarketplaceRuntime({env:{VERCEL_ENV:'preview',VERCEL_GIT_COMMIT_REF:row.branch},fetchImpl:()=>assert.fail('network')})({method:'GET',url:'/api/test-marketplace'},res);
  assert.equal(res.statusCode,200);assert.ok(res.headers['Content-Security-Policy'].includes("connect-src 'self' "+row.projectUrl+';'));
  assert.equal(res.headers['Content-Security-Policy'].includes(rows.find(other=>other!==row).projectUrl),false);
 }
});

test('setup status verifies only its complete tuple and never reveals the selected account',async()=>{
 for(const branchRow of rows)for(const databaseRow of rows)for(const stripeRow of rows){
  const env={...settings(branchRow),RACK_RELIC_TEST_SUPABASE_URL:databaseRow.projectUrl,RACK_RELIC_TEST_STRIPE_ACCOUNT:stripeRow.accountId},res=response(),calls=[];
  await createTestSetupStatus({env,fetchImpl:async(url,options)=>{
   calls.push(url);if(url.includes('supabase.co')){assert.equal(url,branchRow.projectUrl+'/rest/v1/rpc/rr_test_member_orders');assert.equal(options.method,'POST');return Response.json([]);}
   assert.equal(options.method,'GET');return Response.json(url.endsWith('/account')?{object:'account',id:branchRow.accountId}:{object:'balance',livemode:false});
  }})({method:'GET'},res);
  const matched=branchRow===databaseRow&&branchRow===stripeRow;assert.equal(res.statusCode,matched?200:503);assert.equal(calls.length,matched?3:0);
  if(matched){assert.equal(res.body.checkout,'disabled');assert.equal(JSON.stringify(res.body).includes(branchRow.accountId),false);}
 }
});

test('a valid configured tuple with foreign actual Stripe identity is never reported ready',async()=>{
 for(const row of rows){
  const res=response();await createTestSetupStatus({env:settings(row),fetchImpl:async url=>Response.json(url.includes('supabase.co')?[]:url.endsWith('/account')?{object:'account',id:rows.find(other=>other!==row).accountId}:{object:'balance',livemode:false})})({method:'GET'},res);
  assert.equal(res.statusCode,503);assert.equal(res.body.stripe,'unavailable');assert.equal(res.body.checkout,'disabled');
 }
});

test('repository restricts all operations to approved databases and checks each JWT project binding',async()=>{
 const key=ref=>['e30',Buffer.from(JSON.stringify({role:'service_role',ref})).toString('base64url'),'fixture'].join('.');
 for(const projectUrl of ['https://abcdefghijklmnopqrst.supabase.co','https://zrfztnbyynrdzfeblkeq.supabase.co',TEST_ENVIRONMENTS.acceptance.projectUrl+'/',TEST_ENVIRONMENTS.acceptance.projectUrl+'?database=legacy'])assert.throws(()=>createTestOrderRepository({projectUrl,serviceKey:'sb_secret_fixture',fetchImpl:()=>assert.fail('network')}),/Separate test database/);
 for(const row of rows){
  assert.throws(()=>createTestOrderRepository({projectUrl:row.projectUrl,serviceKey:key(rows.find(other=>other!==row).projectRef)}),/Server-only/);
  let calls=0;const repository=createTestOrderRepository({projectUrl:row.projectUrl,serviceKey:key(row.projectRef),allowedMemberIds:[buyer,seller],allowedRefundOperatorIds:[seller],refundsEnabled:true,refundRequestsEnabled:true,fetchImpl:async(url,options)=>{calls++;assert.equal(url,row.projectUrl+'/auth/v1/user');assert.equal(options.headers.Authorization,'Bearer operator');return Response.json({id:seller});}});
  assert.deepEqual(await repository.refundAccess({authorization:'Bearer operator'}),{test:true,allowed:true});assert.equal(calls,1);
 }
});

test('checkout rejects foreign, live or cached sandbox identity before sending a tax address or calculation',async()=>{
 const orderId='11111111-1111-4111-8111-111111111111',listing='73737373-7373-4373-8373-737373737373';
 for(const row of rows)for(const identity of [{foreign:true},{live:true},{headers:{age:'1'}},{headers:{'cf-cache-status':'HIT'}},{headers:{'x-vercel-cache':'STALE'}},{headers:{'x-vercel-cache':'UPDATING'}}]){
  const env=settings(row),calls=[],res=response(),order={id:orderId,listing_id:listing,buyer_id:buyer,seller_id:seller,state:'reserved',item_cents:2500,buyer_fee_cents:100,listing_updated_at:'2026-10-31T12:00:00Z'};
  await createTestMarketplaceRuntime({env,fetchImpl:async(url,options)=>{
   calls.push({url,method:options.method});
   if(url.endsWith('/auth/v1/user'))return Response.json({id:buyer});
   if(url.endsWith('/rr_test_reserve'))return Response.json(order);
   if(url.endsWith('/rr_test_checkout_attempt'))return Response.json({order,attempt:null});
   if(url.endsWith('/v1/account'))return Response.json({object:'account',id:identity.foreign?rows.find(other=>other!==row).accountId:row.accountId},{headers:identity.headers??{}});
   if(url.endsWith('/v1/balance'))return Response.json({object:'balance',livemode:identity.live===true},{headers:identity.headers??{}});
   assert.fail('No tax or Checkout request may follow an identity mismatch: '+url);
  }})(Object.assign(Readable.from([JSON.stringify({orderId,listingId:listing,to:{line1:'400 Broad St',city:'Seattle',state:'WA',postal_code:'98109',country:'US'}})]),{method:'POST',url:'/api/test-marketplace?action=checkout',headers:{authorization:'Bearer buyer','content-type':'application/json'}}),res);
  assert.equal(res.statusCode,503);assert.equal(calls.some(c=>c.url.endsWith('/v1/account')),true);assert.equal(calls.some(c=>c.url.endsWith('/v1/balance')),true);assert.equal(calls.some(c=>c.url.includes('/tax/')||c.url.includes('/checkout/sessions')),false);assert.equal(calls.some(c=>c.url.startsWith('https://api.stripe.com')&&c.method==='POST'),false);
 }
});
