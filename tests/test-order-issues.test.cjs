const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
const {Readable}=require('node:stream');
const {createTestIssueHandler}=require('../server/test_issue_handler.cjs');
const {createTestOrderRepository}=require('../server/test_order_repository.cjs');
const BUYER='11111111-1111-4111-8111-111111111111',SELLER='22222222-2222-4222-8222-222222222222',ORDER='33333333-3333-4333-8333-333333333333',LISTING='44444444-4444-4444-8444-444444444444';
test('buyer issue persists once, restricts ownership and holds fulfillment without changing money',async()=>{
 const db=new PGlite();try{
 await db.exec('create role anon;create role authenticated;create role service_role;');
 for(const n of ['20261030_order_ledger','20261102_order_issues'])await db.exec(fs.readFileSync('supabase/test/'+n+'.sql','utf8'));
 await db.query("insert into rr_sandbox.catalog(id,seller_id,title,price_cents) values($1,$2,'Synthetic jacket',2500)",[LISTING,SELLER]);
 await db.query('select public.rr_test_reserve($1,$2,$3)',[ORDER,LISTING,BUYER]);
 const issue=(actor=BUYER,reason=null)=>db.query('select public.rr_test_order_issue($1,$2,$3) x',[actor,ORDER,reason]).then(r=>r.rows[0].x);
 assert.equal((await issue()).state,'not_reported');
 await assert.rejects(issue(SELLER));await assert.rejects(issue(BUYER,'damaged'));await assert.rejects(issue(BUYER,'other'));
 await db.query("update rr_sandbox.orders set state='paid',risk_status='clear' where id=$1",[ORDER]);
 await db.query("insert into rr_sandbox.ledger_entries(order_id,kind,amount_cents) values($1,'gross_receivable',3427)",[ORDER]);
 await db.query("insert into rr_sandbox.jobs(order_id,kind,state) values($1,'prepare_test_label','pending'),($1,'seller_sale_notice','pending')",[ORDER]);
 const before=(await db.query('select * from rr_sandbox.ledger_entries')).rows;
 const first=await issue(BUYER,'damaged');assert.equal(first.state,'review_required');assert.deepEqual(await issue(BUYER,'damaged'),first);await assert.rejects(issue(BUYER,'not_received'));assert.deepEqual(await issue(),first);
 assert.equal((await db.query('select count(*)::int n from rr_sandbox.order_issues')).rows[0].n,1);
 assert.equal((await db.query('select risk_status from rr_sandbox.orders')).rows[0].risk_status,'review');
 assert.ok((await db.query('select state from rr_sandbox.jobs')).rows.every(r=>r.state==='held'));assert.deepEqual((await db.query('select * from rr_sandbox.ledger_entries')).rows,before);
 await db.exec("update rr_sandbox.orders set risk_status='blocked'");await issue(BUYER,'damaged');assert.equal((await db.query('select risk_status from rr_sandbox.orders')).rows[0].risk_status,'blocked');
 assert.equal((await db.query("select relrowsecurity from pg_class where oid='rr_sandbox.order_issues'::regclass")).rows[0].relrowsecurity,true);
 for(const role of ['anon','authenticated']){await db.exec('set role '+role);await assert.rejects(issue());await assert.rejects(db.query('select * from rr_sandbox.order_issues'));await db.exec('reset role');}
 }finally{await db.close();}
});
const req=(body,method='POST',query='')=>Object.assign(Readable.from([body]),{method,url:'/api/test-marketplace?action=order-issue&orderId='+ORDER+query,headers:{'content-type':'application/json',authorization:'Bearer test'}});
const res=()=>({headers:{},setHeader(k,v){this.headers[k]=v;},end(body){this.body=JSON.parse(body);}});
test('issue endpoint rejects malformed, oversized and identity-injected requests before repository access',async()=>{
 const handler=createTestIssueHandler({enabled:true,repository:{orderIssue(){assert.fail('no access');}}});
 for(const [request,status] of [[req('{'),400],[req('{"reason":"damaged","buyerId":"spoof"}'),400],[req('x'.repeat(257)),413],[req('{}','POST','&orderId='+ORDER),400],[req('{}','DELETE'),405]]){const r=res();await handler(request,r);assert.equal(r.statusCode,status);assert.match(r.headers['Cache-Control'],/no-store/);}
 const r=res();await createTestIssueHandler({enabled:false})(req('{}'),r);assert.equal(r.statusCode,404);
});
test('repository derives buyer identity from fresh authentication and hides sensitive provider data',async()=>{
 const calls=[],repo=createTestOrderRepository({projectUrl:'https://zvtaqzcqfdjpuwnlpzln.supabase.co',serviceKey:'sb_secret_fixture',allowedMemberIds:[BUYER],fetchImpl:async(url,options)=>{calls.push({url,body:options.body});return Response.json(url.endsWith('/auth/v1/user')?{id:BUYER}:{test:true,orderId:ORDER,state:'not_reported'});}});
 await repo.orderIssue({authorization:'Bearer fixture',orderId:ORDER});assert.equal(calls.length,2);assert.deepEqual(JSON.parse(calls[1].body),{p_actor:BUYER,p_order:ORDER,p_reason:null});
 await assert.rejects(repo.orderIssue({authorization:'Bearer fixture',orderId:ORDER,reason:'arbitrary text'}));
});
test('issue route requires explicit activation and is inaccessible on production or main',async()=>{
 const {createTestMarketplaceRuntime}=require('../server/test_marketplace_runtime.cjs');
 const env={VERCEL_ENV:'preview',VERCEL_GIT_COMMIT_REF:'test-only-marketplace-foundation',RACK_RELIC_TEST_CHECKOUT_ENABLED:'true',RACK_RELIC_TEST_SUPABASE_URL:'https://zvtaqzcqfdjpuwnlpzln.supabase.co',RACK_RELIC_TEST_MEMBER_IDS:BUYER+','+SELLER,RACK_RELIC_TEST_SUPABASE_SERVER_KEY:'sb_secret_fixture',RACK_RELIC_TEST_STRIPE_KEY:'sk_test_fixture',RACK_RELIC_TEST_STRIPE_ACCOUNT:'acct_1UWJZuGVbz9Pnhxd'};
 for(const patch of [{},{RACK_RELIC_TEST_ORDER_ISSUES_ENABLED:'true',VERCEL_ENV:'production'},{RACK_RELIC_TEST_ORDER_ISSUES_ENABLED:'true',VERCEL_GIT_COMMIT_REF:'main'}]){const r=res();await createTestMarketplaceRuntime({env:{...env,...patch},fetchImpl:()=>assert.fail('no network')})(req('','GET'),r);assert.equal(r.statusCode,404);}
 const r=res(),calls=[];await createTestMarketplaceRuntime({env:{...env,RACK_RELIC_TEST_ORDER_ISSUES_ENABLED:'true'},fetchImpl:async(url,options)=>{calls.push(url);if(url.endsWith('/auth/v1/user'))return Response.json({id:BUYER});assert.ok(url.endsWith('/rpc/rr_test_order_issue'));assert.equal(JSON.parse(options.body).p_actor,BUYER);return Response.json({test:true,orderId:ORDER,state:'not_reported',secret:'must not leak'});}})(req('','GET'),r);assert.equal(r.statusCode,200);assert.equal(calls.length,2);assert.deepEqual(r.body,{test:true,orderId:ORDER,state:'not_reported'});
});
