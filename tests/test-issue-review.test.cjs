const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
const {Readable}=require('node:stream');
const {createTestOrderRepository}=require('../server/test_order_repository.cjs');
const {createTestIssueReviewHandler}=require('../server/test_issue_review_handler.cjs');
const B='11111111-1111-4111-8111-111111111111',S='22222222-2222-4222-8222-222222222222',O='33333333-3333-4333-8333-333333333333',L='44444444-4444-4444-8444-444444444444',OTHER='55555555-5555-4555-8555-555555555555';
test('report acknowledgment is private, immutable and preserves every financial and fulfillment hold',async()=>{
 const db=new PGlite();try{
 await db.exec('create role anon;create role authenticated;create role service_role;');for(const n of ['20261030_order_ledger','20261102_order_issues','20261102_order_issues_review'])await db.exec(fs.readFileSync('supabase/test/'+n+'.sql','utf8'));
 await db.query("insert into rr_sandbox.catalog(id,seller_id,title,price_cents) values($1,$2,'Synthetic report jacket',2500)",[L,S]);await db.query('select public.rr_test_reserve($1,$2,$3)',[O,L,B]);
 const rpc=(name,args)=>db.query('select public.'+name+'('+args.map((_,i)=>'$'+(i+1)).join(',')+') x',args).then(r=>r.rows[0].x);
 await assert.rejects(rpc('rr_test_acknowledge_issue',[S,O]));
 await db.query("update rr_sandbox.orders set state='paid',risk_status='blocked' where id=$1",[O]);await db.query("insert into rr_sandbox.ledger_entries(order_id,kind,amount_cents) values($1,'gross_receivable',3427)",[O]);await rpc('rr_test_order_issue',[B,O,'not_received']);
 const before=(await db.query('select * from rr_sandbox.orders')).rows,ledger=(await db.query('select * from rr_sandbox.ledger_entries')).rows,jobs=(await db.query('select * from rr_sandbox.jobs')).rows;
 assert.deepEqual(await rpc('rr_test_issue_review',[OTHER]),[]);await assert.rejects(rpc('rr_test_acknowledge_issue',[OTHER,O]));
 const queue=await rpc('rr_test_issue_review',[S]);assert.equal(queue.length,1);assert.equal(queue[0].acknowledged_at,null);
 const ack=await rpc('rr_test_acknowledge_issue',[S,O]);assert.equal(ack.acknowledged,true);assert.deepEqual(await rpc('rr_test_acknowledge_issue',[B,O]),ack);
 const audit=(await db.query('select * from rr_sandbox.issue_acknowledgments')).rows;assert.equal(audit.length,1);assert.equal(audit[0].actor_id,S);
 assert.ok((await rpc('rr_test_issue_review',[S]))[0].acknowledged_at);assert.deepEqual((await db.query('select * from rr_sandbox.orders')).rows,before);assert.deepEqual((await db.query('select * from rr_sandbox.ledger_entries')).rows,ledger);assert.deepEqual((await db.query('select * from rr_sandbox.jobs')).rows,jobs);assert.equal((await rpc('rr_test_order_issue',[B,O,null])).state,'review_required');
 for(const role of ['anon','authenticated']){await db.exec('set role '+role);await assert.rejects(rpc('rr_test_issue_review',[S]));await assert.rejects(rpc('rr_test_acknowledge_issue',[S,O]));await assert.rejects(db.query('select * from rr_sandbox.issue_acknowledgments'));await db.exec('reset role');}
 }finally{await db.close();}
});
const options={projectUrl:'https://zvtaqzcqfdjpuwnlpzln.supabase.co',serviceKey:'sb_secret_fixture',allowedMemberIds:[B,S],allowedRefundOperatorIds:[S],refundsEnabled:true,refundRequestsEnabled:true};
test('review requires fresh allowlisted operator authority before database RPCs and strips audit identities',async()=>{
 let actor=B;const calls=[],repository=createTestOrderRepository({...options,fetchImpl:async(url,req)=>{calls.push(url);if(url.endsWith('/auth/v1/user'))return Response.json({id:actor});assert.equal(JSON.parse(req.body).p_actor,S);return Response.json(url.endsWith('rr_test_issue_review')?[{participant:true,order_id:O,reason:'damaged',reported_at:'2026-11-02T20:00:00Z',acknowledged_at:null,actor_id:'private'}]:{test:true,orderId:O,acknowledged:true,acknowledgedAt:'2026-11-02T21:00:00Z',actorId:'private'});}});
 await assert.rejects(repository.reviewOrderIssues({authorization:'Bearer fixture'}));await assert.rejects(repository.acknowledgeOrderIssue({authorization:'Bearer fixture',orderId:O}));assert.ok(calls.every(u=>u.endsWith('/auth/v1/user')));
 actor=S;const queue=await repository.reviewOrderIssues({authorization:'Bearer fixture'});assert.deepEqual(queue,{test:true,hasMore:false,issues:[{orderId:O,reason:'damaged',reportedAt:'2026-11-02T20:00:00Z',acknowledgedAt:null}]});const ack=await repository.acknowledgeOrderIssue({authorization:'Bearer fixture',orderId:O});assert.equal(ack.actorId,undefined);
});
test('invalid queue evidence fails closed and disabled operators never reach network',async()=>{
 const repo=createTestOrderRepository({...options,refundsEnabled:false,fetchImpl:()=>assert.fail('network')});await assert.rejects(repo.reviewOrderIssues({authorization:'Bearer fixture'}));
 for(const row of [{participant:false},{order_id:'invalid'},{reason:'arbitrary'},{reported_at:'bad'},{acknowledged_at:'bad'}]){const r=createTestOrderRepository({...options,fetchImpl:async u=>Response.json(u.endsWith('/auth/v1/user')?{id:S}:[{participant:true,order_id:O,reason:'damaged',reported_at:'2026-11-02T20:00:00Z',acknowledged_at:null,...row}])});await assert.rejects(r.reviewOrderIssues({authorization:'Bearer fixture'}));}
});
const req=(body='{}',method='POST',query='')=>Object.assign(Readable.from([body]),{method,url:'/api/test-marketplace?action=issue-review'+query,headers:{'content-type':'application/json',authorization:'Bearer fixture'}});
const res=()=>({headers:{},setHeader(k,v){this.headers[k]=v;},end(body){this.body=JSON.parse(body);}});
test('review HTTP shape rejects spoofed identities, malformed and oversized bodies without side effects',async()=>{
 const handler=createTestIssueReviewHandler({enabled:true,repository:{reviewOrderIssues(){assert.fail('RPC');},acknowledgeOrderIssue(){assert.fail('RPC');}}});
 for(const [request,status] of [[req('{'),400],[req(JSON.stringify({orderId:O,actorId:S})),400],[req('x'.repeat(257)),413],[req('{}','GET','&orderId='+O),400],[req('{}','GET','&action=issue-review'),400],[req('{}','DELETE'),405]]){const r=res();await handler(request,r);assert.equal(r.statusCode,status);assert.match(r.headers['Cache-Control'],/no-store/);}
 const r=res();await createTestIssueReviewHandler({enabled:false})(req('','GET'),r);assert.equal(r.statusCode,404);
});
test('runtime review is gated by explicit flags, branch and fresh operator identity',async()=>{
 const {createTestMarketplaceRuntime}=require('../server/test_marketplace_runtime.cjs');
 const env={VERCEL_ENV:'preview',VERCEL_GIT_COMMIT_REF:'test-only-marketplace-foundation',RACK_RELIC_TEST_CHECKOUT_ENABLED:'true',RACK_RELIC_TEST_SUPABASE_URL:options.projectUrl,RACK_RELIC_TEST_MEMBER_IDS:B+','+S,RACK_RELIC_TEST_SUPABASE_SERVER_KEY:options.serviceKey,RACK_RELIC_TEST_STRIPE_KEY:'sk_test_fixture',RACK_RELIC_TEST_STRIPE_ACCOUNT:'acct_1UWJZuGVbz9Pnhxd',RACK_RELIC_TEST_REFUNDS_ENABLED:'true',RACK_RELIC_TEST_REFUND_REQUESTS_ENABLED:'true',RACK_RELIC_TEST_REFUND_OPERATOR_IDS:S,RACK_RELIC_TEST_ORDER_ISSUES_ENABLED:'true',RACK_RELIC_TEST_ISSUE_REVIEW_ENABLED:'true'};
 for(const patch of [{VERCEL_ENV:'production'},{VERCEL_GIT_COMMIT_REF:'main'},{RACK_RELIC_TEST_ISSUE_REVIEW_ENABLED:''},{RACK_RELIC_TEST_ORDER_ISSUES_ENABLED:''},{RACK_RELIC_TEST_REFUNDS_ENABLED:''},{RACK_RELIC_TEST_REFUND_OPERATOR_IDS:''}]){const r=res();await createTestMarketplaceRuntime({env:{...env,...patch},fetchImpl:()=>assert.fail('network')})(req('','GET'),r);assert.equal(r.statusCode,404);}
 const calls=[],r=res();await createTestMarketplaceRuntime({env,fetchImpl:async u=>{calls.push(u);return Response.json({id:B});}})(req('','GET'),r);assert.equal(r.statusCode,403);assert.ok(calls.every(u=>u.endsWith('/auth/v1/user')));
});
