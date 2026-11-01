const {test,before,after,beforeEach}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),{Readable}=require('node:stream');
const {PGlite}=require('@electric-sql/pglite');
const {createShippoTestLabelClient}=require('../server/shippo_test_labels.cjs');
const {publicTrackingStatus,createTestTrackingService}=require('../server/test_tracking_service.cjs');
const {createTestTrackingHandler}=require('../server/test_tracking_handler.cjs');
const {createTestOrderRepository}=require('../server/test_order_repository.cjs');
const {createTestMarketplaceRuntime}=require('../server/test_marketplace_runtime.cjs');
const order='11111111-1111-4111-8111-111111111111',buyer='22222222-2222-4222-8222-222222222222',seller='33333333-3333-4333-8333-333333333333',listing='44444444-4444-4444-8444-444444444444',requestId='55555555-5555-4555-8555-555555555555',other='66666666-6666-4666-8666-666666666666',transaction='c'.repeat(32),rate='b'.repeat(32);
let db,now,quote,result;
before(async()=>{db=new PGlite();await db.exec('create role anon;create role authenticated;create role service_role;');for(const n of ['20261030_order_ledger','20261030_payment_recovery','20261030_checkout_attempts','20261030_refund_receipts','20261030_refund_requests','20261030_checkout_quote_limits','20261030_checkout_quote_refresh','20261031_cancel_preparation','20261031_refund_review','20261031_charge_fee_evidence','20261031_fulfillment_snapshots','20261031_label_attempts','20261031_tracking_observations'])await db.exec(fs.readFileSync(require.resolve('../supabase/test/'+n+'.sql'),'utf8'));});
after(async()=>db?.close());
beforeEach(async()=>{
 now=Date.now();await db.exec('truncate rr_sandbox.catalog cascade');await db.query("insert into rr_sandbox.catalog(id,seller_id,title,price_cents) values($1,$2,'Synthetic jacket',2500)",[listing,seller]);await db.query('select public.rr_test_reserve($1,$2,$3)',[order,listing,buyer]);
 await db.query("update rr_sandbox.orders set state='paid',payment_intent_id='pi_fixture',risk_status='review',snapshot=$2,refund_state='refunded',refunded_cents=3559 where id=$1",[order,JSON.stringify({totalCents:3559,shippingCents:619})]);await db.query("update rr_sandbox.catalog set status='sold',sold_order_id=$1",[order]);
 await db.query("insert into rr_sandbox.ledger_entries(order_id,kind,amount_cents) values($1,'test_a',3559),($1,'test_b',-3559)",[order]);
 await db.query("insert into rr_sandbox.jobs(order_id,kind,state,attempts,provider_reference) values($1,'prepare_test_label','done',1,$2)",[order,transaction]);
 quote={test:true,shipmentId:'d'.repeat(32),sourceRateId:'a'.repeat(32),rateId:rate,currency:'USD',amountCents:619,carrier:'USPS',service:'Ground Advantage',expiresAt:now-10000};
 result={test:true,orderId:order,requestId,transactionId:transaction,rateId:rate,status:'SUCCESS',labelUrl:'https://deliver.goshippo.com/sample.pdf',trackingNumber:'TEST123',checkedAt:now};
 await db.query('insert into rr_sandbox.label_attempts(request_id,order_id,actor_id,quote,transaction_id,result) values($1,$2,$3,$4,$5,$6)',[requestId,order,buyer,JSON.stringify(quote),transaction,JSON.stringify(result)]);
});
const ev=(status='UNKNOWN',eventAt=null,checkedAt=now)=>({test:true,orderId:order,requestId,transactionId:transaction,trackingNumber:'TEST123',carrier:'USPS',status,eventAt,checkedAt,source:'shippo_transaction'});
const save=(e=ev(),actor=buyer)=>db.query('select public.rr_test_record_tracking($1,$2,$3) as t',[order,actor,JSON.stringify(e)]).then(r=>r.rows[0].t);
const status=(actor=buyer)=>db.query('select public.rr_test_tracking_status($1,$2) as t',[order,actor]).then(r=>r.rows[0].t);
const count=()=>db.query('select count(*)::int as n from rr_sandbox.tracking_observations').then(r=>r.rows[0].n);
const finances=()=>db.query("select jsonb_build_object('orders',(select jsonb_agg(o) from rr_sandbox.orders o),'ledger',(select jsonb_agg(l order by kind) from rr_sandbox.ledger_entries l),'jobs',(select jsonb_agg(j) from rr_sandbox.jobs j),'inventory',(select jsonb_agg(c) from rr_sandbox.catalog c),'labels',(select jsonb_agg(a) from rr_sandbox.label_attempts a)) as s").then(r=>r.rows[0].s);
test('fresh repeated observations deduplicate, retain checked time and expose no private identifiers or addresses',async()=>{
 assert.equal((await status()).state,'not_recorded');const a=await save();assert.equal(a.status,'UNKNOWN');await save(ev('UNKNOWN',null,now+100));assert.equal(await count(),1);const b=await status();assert.equal(b.checkedAt,now+100);assert.equal(b.payoutAvailable,false);assert.equal(b.labelPurchaseEnabled,false);assert.equal(b.trackingNumber,undefined);assert.equal(b.transactionId,undefined);assert.equal(b.destination,undefined);assert.equal(publicTrackingStatus(b,order).status,'UNKNOWN');
});
test('foreign actors, mismatched sample identities, untrusted status payloads and stale checks cannot write tracking',async()=>{
 await assert.rejects(save(ev(),other));
 for(const patch of [{test:false},{orderId:other},{requestId:other},{transactionId:'e'.repeat(32)},{trackingNumber:'FOREIGN'},{carrier:'UPS'},{source:'browser'},{status:'INVENTED'},{checkedAt:now-600000},{checkedAt:now+60000},{checkedAt:'now'},{eventAt:now+60000},{eventAt:'2026-10-31'},{destination:{private:'address'}}])await assert.rejects(save({...ev(),...patch}));
 assert.equal(await count(),0);await db.exec("update rr_sandbox.label_attempts set result=jsonb_set(result,'{status}','\"ERROR\"')");await assert.rejects(save(),/Successful saved sample/);
});
test('older checks and older carrier events cannot regress accepted delivery evidence',async()=>{
 await save(ev('PRE_TRANSIT',now-10000));await save(ev('TRANSIT',now-5000,now+10));await save(ev('DELIVERED',now-1000,now+20));
 const old=await save(ev('TRANSIT',now-5000,now+30));assert.equal(old.status,'DELIVERED');assert.equal(old.needsReview,false);assert.equal(old.checkedAt,now+20);
 const oldCheck=await save(ev('RETURNED',now,now-1));assert.equal(oldCheck.status,'DELIVERED');assert.equal(oldCheck.checkedAt,now+20);
 const conflict=await save(ev('TRANSIT',now,now+40));assert.equal(conflict.status,'DELIVERED');assert.equal(conflict.providerStatus,'TRANSIT');assert.equal(conflict.needsReview,true);
 const sticky=await save(ev('DELIVERED',now+1,now+50));assert.equal(sticky.needsReview,true);assert.equal(sticky.payoutAvailable,false);
});
test('same-time conflicts and missing timestamps preserve accepted status and require review',async()=>{
 await save(ev('PRE_TRANSIT',now-1000));let r=await save(ev('TRANSIT',now-1000,now+10));assert.equal(r.status,'PRE_TRANSIT');assert.equal(r.providerStatus,'TRANSIT');assert.equal(r.needsReview,true);
 await db.exec('truncate rr_sandbox.tracking_current,rr_sandbox.tracking_observations');await save(ev('TRANSIT',now-1000));r=await save(ev('DELIVERED',null,now+20));assert.equal(r.status,'TRANSIT');assert.equal(r.needsReview,true);
});
test('tracking observations never alter refunded accounting, inventory, risk, labels or fulfillment jobs',async()=>{
 const before=await finances();for(const s of ['UNKNOWN','PRE_TRANSIT','TRANSIT','DELIVERED','RETURNED','FAILURE'])await save(ev(s,null,now+100));assert.deepEqual(await finances(),before);assert.equal((await status()).payoutAvailable,false);
});
test('tracking tables and RPCs deny browser roles and retain RLS on both tables',async()=>{
 for(const t of ['tracking_observations','tracking_current'])assert.equal((await db.query("select relrowsecurity from pg_class where oid=$1::regclass",['rr_sandbox.'+t])).rows[0].relrowsecurity,true);
 await db.exec('set role authenticated');try{await assert.rejects(status(),/permission denied/);await assert.rejects(save(),/permission denied/);await assert.rejects(db.query('select * from rr_sandbox.tracking_current'),/permission denied/);}finally{await db.exec('reset role');}
});
test('provider tracking reads bind the saved successful transaction, rate, marker, mode and tracking number',async()=>{
 const payload={test:true,object_id:transaction,rate,metadata:'rr_test_label_'+order+'_'+requestId,status:'SUCCESS',label_url:result.labelUrl,tracking_number:'TEST123',tracking_status:'UNKNOWN'};
 const read=async(p=payload,headers={})=>{const c=createShippoTestLabelClient({token:'shippo_test_fixture',fetchImpl:async(u,o)=>{assert.equal(u,'https://api.goshippo.com/transactions/'+transaction+'/');assert.equal(o.method,'GET');assert.equal(o.cache,'no-store');assert.equal(o.redirect,'error');return Response.json(p,{headers});}});return c.tracking({orderId:order,requestId,quote,transactionId:transaction,trackingNumber:'TEST123'});};
 assert.equal((await read()).eventAt,null);const date=new Date(now-1000).toISOString(),r=await read({...payload,tracking_status:{status:'TRANSIT',status_date:date}});assert.equal(r.eventAt,now-1000);assert.equal(r.status,'TRANSIT');
 for(const patch of [{test:false},{object_id:'e'.repeat(32)},{metadata:'foreign'},{tracking_number:'OTHER'},{status:'ERROR'},{tracking_status:'SENT'},{tracking_status:{status:'TRANSIT',status_date:'2026-10-31T12:00:00'}}])await assert.rejects(read({...payload,...patch}));await assert.rejects(read(payload,{age:'1'}));
});
test('tracking refresh cannot reach Shippo without current operator and successful participant sample access',async()=>{
 let providers=0,writes=0;const denied=createTestTrackingService({repository:{trackingStatus:async()=>status(),trackingContext:async()=>{throw Error('denied');},recordTracking:async()=>{writes++;}},shipping:{tracking:async()=>{providers++;}}});await assert.rejects(denied.refresh({orderId:order}));assert.equal(providers+writes,0);await denied.status({orderId:order});assert.equal(providers,0);
 let auths=0;const repo=createTestOrderRepository({projectUrl:'https://zvtaqzcqfdjpuwnlpzln.supabase.co',serviceKey:'sb_secret_fixture',allowedMemberIds:[buyer,seller],allowedRefundOperatorIds:[buyer],refundsEnabled:true,refundRequestsEnabled:true,fetchImpl:async(u)=>{if(u.endsWith('/auth/v1/user'))return Response.json({id:++auths===1?buyer:seller});if(u.endsWith('/rr_test_label_attempt'))return Response.json({test:true,orderId:order,requestId,quote,transactionId:transaction,result});assert.fail('No tracking write after operator access is revoked');}});
 const service=createTestTrackingService({repository:repo,shipping:{tracking:async()=>ev()}});await assert.rejects(service.refresh({authorization:'Bearer fixture',orderId:order}),/operator/);assert.equal(auths,2);
});
const response=()=>({headers:{},setHeader(k,v){this.headers[k]=v;},end(s){this.body=JSON.parse(s);}});
const req=(method='POST',body=JSON.stringify({orderId:order}),url='/api/test-marketplace?action=tracking')=>Object.assign(Readable.from([body]),{method,url,headers:{authorization:'Bearer operator','content-type':'application/json'}});
test('tracking HTTP shape is bounded and browser tracking numbers, status and provider identities are rejected',async()=>{
 let calls=0;const tracking={status:async()=>{calls++;return status();},refresh:async()=>{calls++;return status();}},h=createTestTrackingHandler({tracking,enabled:true});
 for(const [method,body,url,code] of [['PUT','{}','/api/test-marketplace?action=tracking',405],['POST',JSON.stringify({orderId:order,trackingNumber:'FOREIGN'}),'/api/test-marketplace?action=tracking',400],['POST','x'.repeat(1025),'/api/test-marketplace?action=tracking',413],['GET','{}','/api/test-marketplace?action=tracking&orderId='+order+'&status=DELIVERED',400]]){const r=response();await h(req(method,body,url),r);assert.equal(r.statusCode,code);}assert.equal(calls,0);
 const r=response();await h(req('GET','','/api/test-marketplace?action=tracking&orderId='+order),r);assert.equal(r.statusCode,200);assert.equal(calls,1);assert.match(r.headers['Cache-Control'],/no-store/);const off=response();await createTestTrackingHandler({tracking})(req(),off);assert.equal(off.statusCode,404);
});
test('tracking defaults closed and ordinary members are denied before any provider request',async()=>{
 const env={VERCEL_ENV:'preview',VERCEL_GIT_COMMIT_REF:'test-only-marketplace-foundation',RACK_RELIC_TEST_CHECKOUT_ENABLED:'true',RACK_RELIC_TEST_SUPABASE_URL:'https://zvtaqzcqfdjpuwnlpzln.supabase.co',RACK_RELIC_TEST_MEMBER_IDS:buyer+','+seller,RACK_RELIC_TEST_SUPABASE_SERVER_KEY:'sb_secret_fixture',RACK_RELIC_TEST_STRIPE_KEY:'rk_test_fixture',RACK_RELIC_TEST_STRIPE_ACCOUNT:'acct_1UWJZuGVbz9Pnhxd',RACK_RELIC_TEST_REFUNDS_ENABLED:'true',RACK_RELIC_TEST_REFUND_REQUESTS_ENABLED:'true',RACK_RELIC_TEST_REFUND_OPERATOR_IDS:buyer,RACK_RELIC_TEST_SHIPPING_MODE:'shippo_test',RACK_RELIC_TEST_SHIPPO_KEY:'shippo_test_fixture',RACK_RELIC_TEST_QUOTE_LIMITS_ENABLED:'true',RACK_RELIC_TEST_TRACKING_ENABLED:'true'};
 for(const [patch,expected] of [[{VERCEL_ENV:'production'},404],[{VERCEL_GIT_COMMIT_REF:'main'},404],[{RACK_RELIC_TEST_TRACKING_ENABLED:''},404],[{},403]]){const calls=[],r=response();await createTestMarketplaceRuntime({env:{...env,...patch},fetchImpl:async u=>{calls.push(u);assert.ok(u.endsWith('/auth/v1/user'));return Response.json({id:seller});}})(req(),r);assert.equal(r.statusCode,expected);assert.equal(calls.length,expected===403?1:0);}
});
