const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),{Readable}=require('node:stream');
const {PGlite}=require('@electric-sql/pglite');
const {publicIssueThread}=require('../server/test_issue_thread.cjs');
const {createTestIssueThreadHandler}=require('../server/test_issue_thread_handler.cjs');
const {createTestOrderRepository}=require('../server/test_order_repository.cjs');
const B='11111111-1111-4111-8111-111111111111',S='22222222-2222-4222-8222-222222222222',O='33333333-3333-4333-8333-333333333333',L='44444444-4444-4444-8444-444444444444',OTHER='55555555-5555-4555-8555-555555555555';
test('only the seller responds, retries preserve the first response and everyone retains financial holds',async()=>{
 const db=new PGlite();try{
 await db.exec('create role anon;create role authenticated;create role service_role;');for(const n of ['20261030_order_ledger','20261102_order_issues','20261102_order_issues_review','20261102_order_issues_thread'])await db.exec(fs.readFileSync('supabase/test/'+n+'.sql','utf8'));
 await db.query("insert into rr_sandbox.catalog(id,seller_id,title,price_cents) values($1,$2,'Synthetic response jacket',2500)",[L,S]);await db.query('select public.rr_test_reserve($1,$2,$3)',[O,L,B]);
 const rpc=(name,args)=>db.query('select public.'+name+'('+args.map((_,i)=>'$'+(i+1)).join(',')+') x',args).then(r=>r.rows[0].x),thread=(actor,response=null)=>rpc('rr_test_issue_thread',[actor,O,response]);
 assert.equal((await thread(S)).state,'not_reported');await assert.rejects(thread(OTHER));await assert.rejects(thread(S,'investigating'));
 await db.query("update rr_sandbox.orders set state='paid',risk_status='blocked' where id=$1",[O]);await db.query("insert into rr_sandbox.ledger_entries(order_id,kind,amount_cents) values($1,'gross_receivable',3427)",[O]);await rpc('rr_test_order_issue',[B,O,'damaged']);await rpc('rr_test_acknowledge_issue',[S,O]);
 const snapshot=async()=>({orders:(await db.query('select * from rr_sandbox.orders')).rows,ledger:(await db.query('select * from rr_sandbox.ledger_entries')).rows,jobs:(await db.query('select * from rr_sandbox.jobs')).rows,issues:(await db.query('select * from rr_sandbox.order_issues')).rows});const before=await snapshot();
 await assert.rejects(thread(B,'investigating'));await assert.rejects(thread(S,'refund_approved'));assert.equal((await thread(B)).sellerResponse,null);
 const first=await thread(S,'propose_return');assert.equal(first.sellerResponse.kind,'propose_return');assert.equal(first.state,'review_required');assert.deepEqual(await thread(S,'propose_return'),first);await assert.rejects(thread(S,'request_review'));assert.deepEqual(await thread(B),first);assert.ok(first.acknowledgedAt);assert.deepEqual(await snapshot(),before);
 const queue=await rpc('rr_test_issue_review',[S]);assert.equal(queue[0].seller_response,'propose_return');assert.equal((await db.query('select count(*)::int n from rr_sandbox.issue_seller_responses')).rows[0].n,1);
 for(const role of ['anon','authenticated']){await db.exec('set role '+role);await assert.rejects(thread(B));await assert.rejects(thread(S,'propose_return'));await assert.rejects(db.query('select * from rr_sandbox.issue_seller_responses'));await db.exec('reset role');}
 }finally{await db.close();}
});
const receipt={test:true,orderId:O,state:'review_required',reason:'damaged',reportedAt:'2026-11-02T20:00:00Z',acknowledgedAt:null,sellerResponse:{kind:'investigating',submittedAt:'2026-11-02T21:00:00Z'}};
test('thread projection rejects incomplete evidence and strips identities and extra data',()=>{
 assert.deepEqual(publicIssueThread({...receipt,buyerId:B,sellerResponse:{...receipt.sellerResponse,sellerId:S}},O),receipt);
 for(const patch of [{test:false},{orderId:L},{reason:'fake'},{acknowledgedAt:'bad'},{sellerResponse:undefined},{sellerResponse:{kind:'refunded',submittedAt:'2026-11-02T21:00:00Z'}}])assert.throws(()=>publicIssueThread({...receipt,...patch},O));
});
test('repository derives thread actor from sign-in and rejects unknown response categories',async()=>{
 const calls=[],repo=createTestOrderRepository({projectUrl:'https://zvtaqzcqfdjpuwnlpzln.supabase.co',serviceKey:'sb_secret_fixture',allowedMemberIds:[B,S],fetchImpl:async(url,req)=>{calls.push({url,body:req.body});return Response.json(url.endsWith('/auth/v1/user')?{id:S}:receipt);}});
 await repo.issueThread({authorization:'Bearer fixture',orderId:O,response:'investigating'});assert.deepEqual(JSON.parse(calls[1].body),{p_actor:S,p_order:O,p_response:'investigating'});await assert.rejects(repo.issueThread({authorization:'Bearer fixture',orderId:O,response:'refund_approved'}));
});
const req=(body='{}',method='POST',query='')=>Object.assign(Readable.from([body]),{method,url:'/api/test-marketplace?action=issue-thread&orderId='+O+query,headers:{'content-type':'application/json',authorization:'Bearer fixture'}});
const res=()=>({headers:{},setHeader(k,v){this.headers[k]=v;},end(body){this.body=JSON.parse(body);}});
test('thread HTTP rejects malformed requests and never presents an unmatched response as saved',async()=>{
 const handler=createTestIssueThreadHandler({enabled:true,repository:{issueThread(){assert.fail('RPC');}}});for(const [request,status] of [[req('{'),400],[req(JSON.stringify({response:'investigating',sellerId:S})),400],[req('x'.repeat(257)),413],[req('{}','GET','&orderId='+L),400],[req('{}','DELETE'),405]]){const r=res();await handler(request,r);assert.equal(r.statusCode,status);assert.match(r.headers['Cache-Control'],/no-store/);}
 const r=res();await createTestIssueThreadHandler({enabled:true,repository:{async issueThread(){return receipt;}}})(req('{"response":"request_review"}'),r);assert.equal(r.statusCode,503);
 const off=res();await createTestIssueThreadHandler({enabled:false})(req('','GET'),off);assert.equal(off.statusCode,404);
});
test('thread route requires both flags and exact preview branch; no provider requests are made',async()=>{
 const {createTestMarketplaceRuntime}=require('../server/test_marketplace_runtime.cjs');const env={VERCEL_ENV:'preview',VERCEL_GIT_COMMIT_REF:'test-only-marketplace-foundation',RACK_RELIC_TEST_CHECKOUT_ENABLED:'true',RACK_RELIC_TEST_SUPABASE_URL:'https://zvtaqzcqfdjpuwnlpzln.supabase.co',RACK_RELIC_TEST_MEMBER_IDS:B+','+S,RACK_RELIC_TEST_SUPABASE_SERVER_KEY:'sb_secret_fixture',RACK_RELIC_TEST_STRIPE_KEY:'sk_test_fixture',RACK_RELIC_TEST_STRIPE_ACCOUNT:'acct_1UWJZuGVbz9Pnhxd',RACK_RELIC_TEST_ORDER_ISSUES_ENABLED:'true',RACK_RELIC_TEST_ISSUE_RESPONSES_ENABLED:'true'};
 for(const patch of [{VERCEL_ENV:'production'},{VERCEL_GIT_COMMIT_REF:'main'},{RACK_RELIC_TEST_ORDER_ISSUES_ENABLED:''},{RACK_RELIC_TEST_ISSUE_RESPONSES_ENABLED:''}]){const r=res();await createTestMarketplaceRuntime({env:{...env,...patch},fetchImpl:()=>assert.fail('network')})(req('','GET'),r);assert.equal(r.statusCode,404);}
 const calls=[],r=res();await createTestMarketplaceRuntime({env,fetchImpl:async(url,options)=>{calls.push(url);if(url.endsWith('/auth/v1/user'))return Response.json({id:S});assert.ok(url.endsWith('/rpc/rr_test_issue_thread'));assert.equal(JSON.parse(options.body).p_actor,S);return Response.json(receipt);}})(req('','GET'),r);assert.equal(r.statusCode,200);assert.deepEqual(r.body,receipt);assert.equal(calls.length,2);
});
