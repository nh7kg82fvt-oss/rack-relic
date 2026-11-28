const {test,before,after,beforeEach}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
const {publicIssueRefundReview}=require('../test-issue-refund-review.js');
const {createTestOrderRepository}=require('../server/test_order_repository.cjs');
const {createTestIssueRefundReviewHandler}=require('../server/test_issue_refund_review_handler.cjs');
const B='11111111-1111-4111-8111-111111111111',S='22222222-2222-4222-8222-222222222222',O='33333333-3333-4333-8333-333333333333',L='44444444-4444-4444-8444-444444444444',Q='55555555-5555-4555-8555-555555555555';
let db;const rpc=(name,args)=>db.query('select public.'+name+'('+args.map((_,i)=>'$'+(i+1)).join(',')+') x',args).then(r=>r.rows[0].x);
before(async()=>{db=new PGlite();await db.exec('create role anon;create role authenticated;create role service_role;');for(const n of ['20261030_order_ledger','20261030_payment_recovery','20261030_checkout_attempts','20261030_refund_receipts','20261030_refund_requests','20261102_order_issues','20261102_order_issues_review','20261102_order_issues_review_refunds'])await db.exec(fs.readFileSync('supabase/test/'+n+'.sql','utf8'));});
after(async()=>db?.close());
beforeEach(async()=>{
 await db.exec('truncate rr_sandbox.catalog cascade');await db.query("insert into rr_sandbox.catalog(id,seller_id,title,price_cents) values($1,$2,'Synthetic issue refund jacket',2500)",[L,S]);await rpc('rr_test_reserve',[O,L,B]);const snapshot={test:true,orderId:O,listingId:L,sellerId:S,currency:'USD',itemCents:2500,buyerFeeCents:100,shippingCents:500,taxCents:327,totalCents:3427};await rpc('rr_test_attach_checkout',[O,'cs_test_issueRefund',snapshot,'taxcalc_fixture','a'.repeat(64),'b'.repeat(32),new Date(Date.now()+3600000).toISOString()]);await rpc('rr_test_process_payment_event',['evt_paid','a'.repeat(64),'checkout.session.completed',O,'cs_test_issueRefund',3427,'usd',true,'pi_fixture']);
});
const review=()=>rpc('rr_test_issue_refund_review',[S,O]);
const issue=()=>rpc('rr_test_order_issue',[B,O,'damaged']);
const ack=()=>rpc('rr_test_acknowledge_issue',[S,O]);
const refund=(id,amount,status='succeeded')=>rpc('rr_test_process_refund',['evt_'+id,id==='one'?'b'.repeat(64):'c'.repeat(64),'refund.created','re_'+id,'pi_fixture','ch_fixture',amount,'usd',status,Math.floor(Date.now()/1000)]);
const snapshot=async()=>(await db.query('select (select jsonb_agg(o) from rr_sandbox.orders o) orders,(select jsonb_agg(l order by kind) from rr_sandbox.ledger_entries l) ledger,(select jsonb_agg(j order by kind) from rr_sandbox.jobs j) jobs,(select jsonb_agg(q) from rr_sandbox.refund_requests q) requests')).rows[0];
test('issue readiness is read-only, requires acknowledgment and counts actual signed partial/full refunds',async()=>{
 assert.equal((await review()).state,'not_reported');await issue();assert.equal((await review()).state,'awaiting_acknowledgment');await ack();const before=await snapshot();const ready=await review();assert.equal(ready.state,'available_for_review');assert.equal(ready.remainingCents,3427);assert.deepEqual(await snapshot(),before);assert.deepEqual(publicIssueRefundReview(ready,O),ready);
 await refund('one',1000);const partial=await review();assert.equal(partial.state,'available_for_review');assert.equal(partial.confirmedCents,1000);assert.equal(partial.remainingCents,2427);await refund('two',2427);const full=await review();assert.equal(full.state,'refunded');assert.equal(full.canPrepare,false);assert.equal(full.remainingCents,0);assert.equal((await rpc('rr_test_order_issue',[B,O,null])).state,'review_required');assert.equal(full.fulfillmentReleased,false);
});
test('prepared or dispatched requests and pending receipts prohibit another staged refund',async()=>{
 await issue();await ack();await rpc('rr_test_prepare_refund',[Q,O,S,1000]);let r=await review();assert.equal(r.state,'pending');assert.equal(r.unconfirmedRequestCount,1);await rpc('rr_test_dispatch_refund',[Q,S]);r=await review();assert.equal(r.canPrepare,false);assert.equal(r.unconfirmedRequestCount,1);
});
test('pending, failed, mismatched and conflicting financial evidence never permits preparation',async()=>{
 await issue();await ack();await refund('one',1000,'pending');let r=await review();assert.equal(r.state,'pending');assert.equal(r.pendingCents,1000);assert.equal(r.canPrepare,false);
 await db.exec("update rr_sandbox.refunds set needs_review=true");assert.equal((await review()).state,'needs_reconciliation');
});
test('refund totals inconsistent with signed receipts and missing gross evidence fail closed',async()=>{
 await issue();await ack();await db.exec('update rr_sandbox.orders set refunded_cents=1');assert.equal((await review()).state,'needs_reconciliation');await db.exec("delete from rr_sandbox.ledger_entries where kind='gross_receivable'");await assert.rejects(review());
});
test('browser roles and nonparticipants cannot access refund review',async()=>{
 await issue();await ack();await assert.rejects(rpc('rr_test_issue_refund_review',[Q,O]));for(const role of ['anon','authenticated']){await db.exec('set role '+role);await assert.rejects(review());await db.exec('reset role');}
});
const ready={test:true,orderId:O,state:'available_for_review',totalCents:3427,confirmedCents:1000,pendingCents:0,unconfirmedRequestCount:0,remainingCents:2427,canPrepare:true,fulfillmentReleased:false};
test('shared projection rejects contradictory authority and strips financial provider identities',()=>{
 assert.deepEqual(publicIssueRefundReview({...ready,paymentIntentId:'private'},O),ready);for(const patch of [{test:false},{orderId:L},{canPrepare:false},{pendingCents:1},{unconfirmedRequestCount:1},{remainingCents:2426},{fulfillmentReleased:true},{state:'refunded'},{remainingCents:0}])assert.throws(()=>publicIssueRefundReview({...ready,...patch},O));
});
test('fresh configured operator is required before RPC; ordinary members never reach money evidence',async()=>{
 let actor=B;const calls=[],repo=createTestOrderRepository({projectUrl:'https://zvtaqzcqfdjpuwnlpzln.supabase.co',serviceKey:'sb_secret_fixture',allowedMemberIds:[B,S],allowedRefundOperatorIds:[S],refundsEnabled:true,refundRequestsEnabled:true,fetchImpl:async(url,options)=>{calls.push(url);if(url.endsWith('/auth/v1/user'))return Response.json({id:actor});assert.equal(JSON.parse(options.body).p_actor,S);return Response.json(ready);}});await assert.rejects(repo.issueRefundReview({authorization:'Bearer fixture',orderId:O}));assert.equal(calls.length,1);actor=S;assert.deepEqual(await repo.issueRefundReview({authorization:'Bearer fixture',orderId:O}),ready);
});
const req=(method='GET',extra='')=>({method,url:'/api/test-marketplace?action=issue-refund-review&orderId='+O+extra,headers:{authorization:'Bearer fixture'}});
const res=()=>({headers:{},setHeader(k,v){this.headers[k]=v;},end(body){this.body=JSON.parse(body);}});
test('HTTP review is strictly GET-only with no refund dispatch path',async()=>{
 const handler=createTestIssueRefundReviewHandler({enabled:true,repository:{issueRefundReview(){assert.fail('RPC');}}});for(const [request,status] of [[req('POST'),405],[req('GET','&orderId='+L),400],[req('GET','&actorId='+S),400]]){const r=res();await handler(request,r);assert.equal(r.statusCode,status);assert.match(r.headers['Cache-Control'],/no-store/);}const r=res();await createTestIssueRefundReviewHandler({enabled:false})(req(),r);assert.equal(r.statusCode,404);
});
test('failed signed refund receipts require reconciliation instead of automatic retry preparation',async()=>{await issue();await ack();await refund('one',1000,'failed');const r=await review();assert.equal(r.state,'needs_reconciliation');assert.equal(r.canPrepare,false);});
test('runtime requires exact preview, explicit review flags and fresh operator authority',async()=>{
 const {createTestMarketplaceRuntime}=require('../server/test_marketplace_runtime.cjs');const env={VERCEL_ENV:'preview',VERCEL_GIT_COMMIT_REF:'test-only-marketplace-foundation',RACK_RELIC_TEST_CHECKOUT_ENABLED:'true',RACK_RELIC_TEST_SUPABASE_URL:'https://zvtaqzcqfdjpuwnlpzln.supabase.co',RACK_RELIC_TEST_MEMBER_IDS:B+','+S,RACK_RELIC_TEST_SUPABASE_SERVER_KEY:'sb_secret_fixture',RACK_RELIC_TEST_STRIPE_KEY:'sk_test_fixture',RACK_RELIC_TEST_STRIPE_ACCOUNT:'acct_1UWJZuGVbz9Pnhxd',RACK_RELIC_TEST_ORDER_ISSUES_ENABLED:'true',RACK_RELIC_TEST_ISSUE_REFUND_REVIEW_ENABLED:'true',RACK_RELIC_TEST_REFUNDS_ENABLED:'true',RACK_RELIC_TEST_REFUND_REQUESTS_ENABLED:'true',RACK_RELIC_TEST_REFUND_OPERATOR_IDS:S};
 for(const patch of [{VERCEL_ENV:'production'},{VERCEL_GIT_COMMIT_REF:'main'},{RACK_RELIC_TEST_ORDER_ISSUES_ENABLED:''},{RACK_RELIC_TEST_ISSUE_REFUND_REVIEW_ENABLED:''},{RACK_RELIC_TEST_REFUNDS_ENABLED:''}]){const r=res();await createTestMarketplaceRuntime({env:{...env,...patch},fetchImpl:()=>assert.fail('network')})(req(),r);assert.equal(r.statusCode,404);}
 const calls=[],r=res();await createTestMarketplaceRuntime({env,fetchImpl:async u=>{calls.push(u);return Response.json({id:B});}})(req(),r);assert.equal(r.statusCode,403);assert.ok(calls.every(u=>u.endsWith('/auth/v1/user')));
});

test('a refund state inconsistent with its confirmed receipt remains held for reconciliation',async()=>{await issue();await ack();await refund('one',1000);await db.exec("update rr_sandbox.orders set refund_state='none'");assert.equal((await review()).state,'needs_reconciliation');});
