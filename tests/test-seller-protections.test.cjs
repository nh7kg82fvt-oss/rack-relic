'use strict';
const {test,before,after,beforeEach}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),{randomUUID}=require('node:crypto'),{Readable}=require('node:stream');
const {PGlite}=require('@electric-sql/pglite');
const {publicProtectionReview}=require('../test-protection-review.js');
const {createTestProtectionHandler}=require('../server/test_protection_handler.cjs');
const {createTestOrderRepository}=require('../server/test_order_repository.cjs');
const {createTestMarketplaceRuntime}=require('../server/test_marketplace_runtime.cjs');
const {createTestSellerOnboarding}=require('../server/test_seller_onboarding.cjs');
const S='22222222-2222-4222-8222-222222222222',B='11111111-1111-4111-8111-111111111111',O='33333333-3333-4333-8333-333333333333',L='44444444-4444-4444-8444-444444444444',X='55555555-5555-4555-8555-555555555555';
let db;
const rpc=(name,args)=>db.query('select public.'+name+'('+args.map((_,i)=>'$'+(i+1)).join(',')+') x',args).then(r=>r.rows[0].x);
before(async()=>{
 db=new PGlite();await db.exec('create role anon;create role authenticated;create role service_role;');
 for(const name of ['20261030_order_ledger','20261030_payment_recovery','20261030_checkout_attempts','20261030_refund_receipts','20261030_refund_requests','20261030_checkout_quote_limits','20261030_checkout_quote_refresh','20261031_cancel_preparation','20261031_refund_review','20261031_charge_fee_evidence','20261031_fulfillment_snapshots','20261031_label_attempts','20261031_tracking_observations','20261102_seller_onboarding','20261102_order_issues','20261102_order_issues_review','20261102_order_issues_thread','20261102_order_issues_review_refunds','20261103_seller_protections','20261103_provider_risk_holds'])await db.exec(fs.readFileSync('supabase/test/'+name+'.sql','utf8'));
});
after(async()=>db?.close());
beforeEach(async()=>{
 await db.exec('truncate rr_sandbox.catalog cascade;truncate rr_sandbox.seller_accounts cascade;');
 await db.query("insert into rr_sandbox.catalog(id,seller_id,title,price_cents) values($1,$2,'Synthetic protection fixture',2500)",[L,S]);
 await rpc('rr_test_claim_seller',[S]);await rpc('rr_test_save_seller',[S,'acct_fixtureSeller']);
 await rpc('rr_test_record_seller_protection',[S,'acct_fixtureSeller',true,Date.now()]);
});
const reserve=(order=O,listing=L)=>rpc('rr_test_reserve',[order,listing,B]);
async function additional(price=2500){const listing=randomUUID(),order=randomUUID();await db.query("insert into rr_sandbox.catalog(id,seller_id,title,price_cents) values($1,$2,'Synthetic limit fixture',$3)",[listing,S,price]);return {order,listing};}
const snapshot=(total=3100)=>({test:true,orderId:O,listingId:L,sellerId:S,currency:'USD',baseCents:total,itemCents:2500,buyerFeeCents:100,shippingCents:total-2600,taxCents:0,totalCents:total});
async function prepare(total=3100){const snap=snapshot(total);const input={orderId:O,buyerId:B,listing:{id:L,seller_id:S,price_cents:2500},shippingQuote:{test:true,orderId:O,rateId:'b'.repeat(32),amountCents:snap.shippingCents,destinationHash:'a'.repeat(64)},taxQuote:{test:true,orderId:O,taxCalculationId:'taxcalc_fixture',amountCents:0,baseCents:total,destinationHash:'a'.repeat(64)}};return rpc('rr_test_prepare_checkout',[O,B,input,snap,new Date(Date.now()+600000).toISOString()]);}
async function paid(){await reserve();await rpc('rr_test_attach_checkout',[O,'cs_test_protection',snapshot(),'taxcalc_fixture','a'.repeat(64),'b'.repeat(32),new Date(Date.now()+3600000).toISOString()]);await rpc('rr_test_process_payment_event',['evt_protection','a'.repeat(64),'checkout.session.completed',O,'cs_test_protection',3100,'usd',true,'pi_fixture']);}
const review=()=>rpc('rr_test_protection_review',[S,O]);
test('missing, stale, wrong-account and restricted seller evidence blocks reservation without creating an order',async()=>{
 await db.exec('delete from rr_sandbox.seller_protection_status');await assert.rejects(reserve(),/verification/);
 await assert.rejects(rpc('rr_test_record_seller_protection',[S,'acct_other',true,Date.now()]));
 await assert.rejects(rpc('rr_test_record_seller_protection',[S,'acct_fixtureSeller',true,Date.now()-300001]));
 await rpc('rr_test_record_seller_protection',[S,'acct_fixtureSeller',false,Date.now()]);await assert.rejects(reserve());
 await db.exec("update rr_sandbox.seller_protection_status set provider_ready=true,checked_at=now()-interval '6 minutes'");await assert.rejects(reserve());
 assert.equal((await db.query('select count(*)::int n from rr_sandbox.orders')).rows[0].n,0);
});
test('older provider responses and equal-time ready responses cannot overwrite restrictions',async()=>{
 const t=Date.now()+10;await rpc('rr_test_record_seller_protection',[S,'acct_fixtureSeller',false,t]);await rpc('rr_test_record_seller_protection',[S,'acct_fixtureSeller',true,t-1]);await rpc('rr_test_record_seller_protection',[S,'acct_fixtureSeller',true,t]);await assert.rejects(reserve());
 await rpc('rr_test_record_seller_protection',[S,'acct_fixtureSeller',true,t+1]);await reserve();
});
test('new-seller order count is durable, retries are idempotent, and parallel reservations cannot exceed it',async()=>{
 await reserve();await reserve();const refs=await Promise.all(Array.from({length:5},()=>additional()));const results=await Promise.allSettled(refs.map(r=>reserve(r.order,r.listing)));
 assert.equal(results.filter(r=>r.status==='fulfilled').length,4);assert.equal((await db.query('select count(*)::int n from rr_sandbox.orders')).rows[0].n,5);
});
test('per-order and cumulative exposure caps include fee, shipping and tax rather than item price alone',async()=>{
 const expensive=await additional(30000);await assert.rejects(reserve(expensive.order,expensive.listing),/order limit/);
 for(let i=0;i<3;i++){const r=await additional(28000);await reserve(r.order,r.listing);}
 const fourth=await additional(20000);await assert.rejects(reserve(fourth.order,fourth.listing),/exposure/);
 await reserve();await assert.rejects(rpc('rr_test_attach_checkout',[O,'cs_test_tooLarge',snapshot(30001),'taxcalc_fixture','a'.repeat(64),'b'.repeat(32),new Date(Date.now()+3600000).toISOString()]),/order limit/);
 assert.equal((await db.query('select state from rr_sandbox.orders where id=$1',[O])).rows[0].state,'reserved');
});
test('uncertain checkout sessions remain counted after local expiry; confirmed cancellation frees only unused preparation',async()=>{
 await reserve();await db.query("update rr_sandbox.orders set expires_at=now()-interval '1 day' where id=$1",[O]);
 for(let i=0;i<4;i++){const r=await additional();await reserve(r.order,r.listing);}const sixth=await additional();await assert.rejects(reserve(sixth.order,sixth.listing));
 await prepare();await rpc('rr_test_cancel_preparation',[O,B]);await reserve(sixth.order,sixth.listing);
});
test('dispatched checkout guard checks complete total and fresh verification immediately before Stripe POST',async()=>{
 await reserve();await prepare(30001);
 await assert.rejects(rpc('rr_test_dispatch_checkout',[O,B]),/order limit/);
 assert.equal((await db.query('select phase from rr_sandbox.checkout_attempts where order_id=$1',[O])).rows[0].phase,'prepared');
 await db.query('update rr_sandbox.checkout_attempts set snapshot=$2 where order_id=$1',[O,snapshot()]);
 await rpc('rr_test_record_seller_protection',[S,'acct_fixtureSeller',false,Date.now()+20]);await assert.rejects(rpc('rr_test_dispatch_checkout',[O,B]),/verification/);
});
test('buyer report freezes further sales and operator acknowledgment cannot clear it',async()=>{
 await paid();await rpc('rr_test_order_issue',[B,O,'damaged']);await rpc('rr_test_acknowledge_issue',[S,O]);const r=await additional();await assert.rejects(reserve(r.order,r.listing),/issue review/);
 const v=await review();assert.ok(v.blockers.includes('buyer_issue_open'));assert.ok(v.blockers.includes('risk_review_required'));assert.equal(v.releaseEnabled,false);
});
test('manual seller hold is one-way, first audit is immutable and fresh verification cannot clear it',async()=>{
 await reserve();await rpc('rr_test_hold_seller',[S,O,'suspicious_activity']);const first=(await db.query('select * from rr_sandbox.seller_protection_status')).rows[0];
 await rpc('rr_test_hold_seller',[B,O,'delivery_problem']);await rpc('rr_test_record_seller_protection',[S,'acct_fixtureSeller',true,Date.now()+20]);const last=(await db.query('select * from rr_sandbox.seller_protection_status')).rows[0];
 for(const key of ['held','held_at','held_by','hold_reason'])assert.deepEqual(last[key],first[key]);const r=await additional();await assert.rejects(reserve(r.order,r.listing));await assert.rejects(rpc('rr_test_hold_seller',[X,O,'suspicious_activity']));
});
test('a saved Checkout URL cannot be resumed through the app after a seller hold',async()=>{
 await reserve();await prepare();await rpc('rr_test_dispatch_checkout',[O,B]);
 await rpc('rr_test_save_checkout_session',[O,B,'cs_test_savedProtection',new Date(Date.now()+3600000).toISOString()]);
 await rpc('rr_test_finish_checkout',[O,B]);assert.equal((await rpc('rr_test_checkout_attempt',[O,B])).attempt.session_id,'cs_test_savedProtection');
 await rpc('rr_test_hold_seller',[S,O,'suspicious_activity']);await assert.rejects(rpc('rr_test_checkout_attempt',[O,B]),/verification or review/);
 assert.equal((await db.query('select session_id from rr_sandbox.checkout_attempts where order_id=$1',[O])).rows[0].session_id,'cs_test_savedProtection');
 await db.exec('set role service_role');await assert.rejects(db.query('select rr_sandbox.rr_test_checkout_attempt($1,$2)',[O,B]),/permission denied/);await db.exec('reset role');
});
test('protection review cannot release a paid order, is read-only, and exposes no provider identities',async()=>{
 await paid();const before=(await db.query('select (select jsonb_agg(o) from rr_sandbox.orders o) orders,(select jsonb_agg(l order by kind) from rr_sandbox.ledger_entries l) ledger,(select jsonb_agg(j order by kind) from rr_sandbox.jobs j) jobs')).rows[0];
 const v=await review();assert.deepEqual(publicProtectionReview(v,O),v);assert.equal(v.releaseEnabled,false);assert.equal(v.payoutCreated,false);assert.ok(v.blockers.includes('real_delivery_unverified'));assert.ok(v.blockers.includes('platform_reserve_unconfigured'));assert.ok(v.blockers.includes('seller_terms_pending'));assert.equal(v.accountId,undefined);
 assert.deepEqual((await db.query('select (select jsonb_agg(o) from rr_sandbox.orders o) orders,(select jsonb_agg(l order by kind) from rr_sandbox.ledger_entries l) ledger,(select jsonb_agg(j order by kind) from rr_sandbox.jobs j) jobs')).rows[0],before);
});
test('sample DELIVERED, prepared refunds, unbalanced ledger and stale risk each preserve money holds',async()=>{
 await paid();await db.query("insert into rr_sandbox.tracking_current(order_id,snapshot,provider_status,last_checked) values($1,$2,'DELIVERED',now())",[O,{test:true,status:'DELIVERED'}]);
 await db.query("insert into rr_sandbox.risk_assessments(order_id,charge_id,evidence_hash,decision,reason_codes,checked_at) values($1,'ch_fixture',$2,'clear','[]',now()-interval '6 minutes')",[O,'b'.repeat(64)]);
 await db.query("update rr_sandbox.orders set risk_status='clear' where id=$1",[O]);let r=await review();assert.ok(r.blockers.includes('sample_tracking_only'));assert.ok(r.blockers.includes('real_delivery_unverified'));assert.ok(r.blockers.includes('risk_review_required'));
 await rpc('rr_test_prepare_refund',[X,O,S,100]);await db.query("insert into rr_sandbox.ledger_entries(order_id,kind,amount_cents) values($1,'unreconciled',1)",[O]);r=await review();assert.ok(r.blockers.includes('refund_review_required'));assert.ok(r.blockers.includes('ledger_needs_reconciliation'));assert.equal(r.transferCreated,false);
});
test('browser roles and unrelated actors cannot read or modify seller protection evidence',async()=>{
 await reserve();await assert.rejects(rpc('rr_test_protection_review',[X,O]));
 for(const role of ['anon','authenticated']){await db.exec('set role '+role);await assert.rejects(review());await assert.rejects(rpc('rr_test_record_seller_protection',[S,'acct_fixtureSeller',true,Date.now()]));await assert.rejects(rpc('rr_test_hold_seller',[S,O,'suspicious_activity']));await assert.rejects(db.query('select * from rr_sandbox.seller_protection_status'));await db.exec('reset role');}
 assert.equal((await db.query("select relrowsecurity from pg_class where oid='rr_sandbox.seller_protection_status'::regclass")).rows[0].relrowsecurity,true);
});
const response=()=>({headers:{},setHeader(k,v){this.headers[k]=v;},end(s){this.data=JSON.parse(s);}});
const request=(action='protection-review',method='GET',body='')=>Object.assign(Readable.from([body]),{url:'/api/test-marketplace?action='+action+(action==='protection-review'?'&orderId='+O:''),method,headers:{authorization:'Bearer fixture','content-type':'application/json'}});
test('protection HTTP refuses browser authority, duplicates, oversized bodies and release requests',async()=>{
 const handler=createTestProtectionHandler({enabled:true,repository:{protectionReview:()=>assert.fail('RPC'),holdSeller:()=>assert.fail('RPC')}});
 for(const [req,code] of [[request('protection-review','POST'),405],[{...request(),url:request().url+'&orderId='+X},400],[{...request(),url:request().url+'&ready=true'},400],[request('protection-hold','POST','{"orderId":"'+O+'","reason":"suspicious_activity","actor":"'+S+'"}'),400],[request('protection-hold','POST','x'.repeat(1025)),413],[request('protection-hold','POST','null'),400],[request('protection-hold','GET'),405]]){const r=response();await handler(req,r);assert.equal(r.statusCode,code);assert.match(r.headers['Cache-Control'],/no-store/);}
});
const env={VERCEL_ENV:'preview',VERCEL_GIT_COMMIT_REF:'test-only-marketplace-foundation',RACK_RELIC_TEST_CHECKOUT_ENABLED:'true',RACK_RELIC_TEST_SUPABASE_URL:'https://zvtaqzcqfdjpuwnlpzln.supabase.co',RACK_RELIC_TEST_MEMBER_IDS:B+','+S,RACK_RELIC_TEST_SUPABASE_SERVER_KEY:'sb_secret_fixture',RACK_RELIC_TEST_STRIPE_KEY:'sk_test_fixture',RACK_RELIC_TEST_STRIPE_ACCOUNT:'acct_1UWJZuGVbz9Pnhxd',RACK_RELIC_TEST_REFUNDS_ENABLED:'true',RACK_RELIC_TEST_REFUND_REQUESTS_ENABLED:'true',RACK_RELIC_TEST_REFUND_OPERATOR_IDS:S,RACK_RELIC_TEST_SELLER_PROTECTIONS_ENABLED:'true'};
test('production, other branches and missing flags never reach provider or database; ordinary members cannot operate',async()=>{
 for(const patch of [{VERCEL_ENV:'production'},{VERCEL_GIT_COMMIT_REF:'main'},{RACK_RELIC_TEST_SELLER_PROTECTIONS_ENABLED:''},{RACK_RELIC_TEST_REFUNDS_ENABLED:''}]){const r=response();await createTestMarketplaceRuntime({env:{...env,...patch},fetchImpl:()=>assert.fail('network')})(request(),r);assert.equal(r.statusCode,404);}
 const calls=[],r=response();await createTestMarketplaceRuntime({env,fetchImpl:async u=>{calls.push(u);return Response.json({id:B});}})(request(),r);assert.equal(r.statusCode,403);assert.equal(calls.length,1);assert.ok(calls[0].endsWith('/auth/v1/user'));
});
test('fresh operator identity reaches only the read-only review RPC and sanitized projection',async()=>{
 await paid();const value=await review(),calls=[],r=response();await createTestMarketplaceRuntime({env,fetchImpl:async(u,o)=>{calls.push([u,o]);if(u.endsWith('/auth/v1/user'))return Response.json({id:S});assert.ok(u.endsWith('/rr_test_protection_review'));assert.deepEqual(JSON.parse(o.body),{p_actor:S,p_order:O});return Response.json({...value,accountId:'private'});}})(request(),r);assert.equal(r.statusCode,200);assert.equal(r.data.accountId,undefined);assert.equal(calls.length,2);
});
test('seller protection writes come from authenticated seller plus bound fresh provider reads',async()=>{
 const recorded=[];const repo={sellerContext:async()=>({test:true,sellerId:S,phase:'known',accountId:'acct_fixtureSeller'}),recordSellerProtection:async e=>recorded.push(e)};
 const client=createTestSellerOnboarding({repository:repo,protectionsEnabled:true,secretKey:'rk_test_fixture',accountId:'acct_1UWJZuGVbz9Pnhxd',fetchImpl:async u=>{if(u.endsWith('/v1/account'))return Response.json({id:'acct_1UWJZuGVbz9Pnhxd'});if(u.endsWith('/balance'))return Response.json({livemode:false});return Response.json({object:'account',id:'acct_fixtureSeller',country:'US',details_submitted:true,payouts_enabled:true,capabilities:{transfers:'active'},metadata:{rr_test_seller_id:S,rr_test_platform:'acct_1UWJZuGVbz9Pnhxd'},requirements:{currently_due:[],past_due:[],pending_verification:[],disabled_reason:null}});}});
 await client.status({authorization:'Bearer seller'});assert.equal(recorded.length,1);assert.equal(recorded[0].authorization,'Bearer seller');assert.equal(recorded[0].ready,true);assert.equal(recorded[0].accountId,'acct_fixtureSeller');assert.ok(Number.isSafeInteger(recorded[0].checkedAt));
});
test('projection rejects fabricated release permission, unknown/missing blockers and strips private fields',async()=>{
 await paid();const value=await review();for(const patch of [{releaseEnabled:true},{payoutCreated:true},{state:'ready'},{test:false},{blockers:[]},{blockers:[...value.blockers,'injected']},{blockers:[...value.blockers,value.blockers[0]]}])assert.throws(()=>publicProtectionReview({...value,...patch},O));assert.equal(publicProtectionReview({...value,secret:'private'},O).secret,undefined);
});
const riskNotice=(event='evt_dispute',hash='c'.repeat(64),type='charge.dispute.created',status='needs_response',pi='pi_fixture')=>rpc('rr_test_process_risk_notice',[event,hash,type,type.startsWith('radar.')?'issfr_fixture':'du_fixture','ch_fixture',pi,type.startsWith('radar.')?null:3100,type.startsWith('radar.')?null:'usd',type.startsWith('radar.')?'warning_received':status,type.startsWith('radar.')?null:Math.floor(Date.now()/1000)+86400,Math.floor(Date.now()/1000)]);
test('provider disputes hold paid orders and further seller claims without inventing ledger debits',async()=>{
 await paid();const ledger=(await db.query('select jsonb_agg(l order by kind) x from rr_sandbox.ledger_entries l')).rows[0].x;
 assert.equal((await riskNotice()).state,'held');assert.equal((await riskNotice()).duplicate,true);
 await assert.rejects(riskNotice('evt_dispute','d'.repeat(64)),/collision/);
 assert.equal((await db.query('select risk_status from rr_sandbox.orders where id=$1',[O])).rows[0].risk_status,'blocked');
 assert.deepEqual((await db.query('select jsonb_agg(l order by kind) x from rr_sandbox.ledger_entries l')).rows[0].x,ledger);
 const r=await additional();await assert.rejects(reserve(r.order,r.listing),/issue review/);
 assert.equal((await db.query('select count(*)::int n from rr_sandbox.provider_risk_notices')).rows[0].n,1);
});
test('closed/won notices and out-of-order fraud alerts never automatically clear a hold',async()=>{
 await paid();await riskNotice();await riskNotice('evt_won','d'.repeat(64),'charge.dispute.closed','won');
 await riskNotice('evt_warning','e'.repeat(64),'radar.early_fraud_warning.created');
 assert.equal((await db.query('select risk_status from rr_sandbox.orders where id=$1',[O])).rows[0].risk_status,'blocked');assert.equal((await review()).releaseEnabled,false);
 assert.equal((await db.query('select count(*)::int n from rr_sandbox.provider_risk_notices')).rows[0].n,3);
});
test('unbound or conflicting provider notices roll back and browser roles cannot forge risk holds',async()=>{
 await paid();await assert.rejects(riskNotice('evt_unknown','c'.repeat(64),'charge.dispute.created','needs_response','pi_unbound'),/binding required/);
 await assert.rejects(riskNotice('evt_noPI','c'.repeat(64),'charge.dispute.created','needs_response',null),/binding required/);
 assert.equal((await db.query('select count(*)::int n from rr_sandbox.provider_risk_notices')).rows[0].n,0);
 for(const role of ['anon','authenticated']){await db.exec('set role '+role);await assert.rejects(riskNotice(),/permission denied/);await assert.rejects(db.query('select * from rr_sandbox.provider_risk_notices'),/permission denied/);await db.exec('reset role');}
});
