'use strict';
// Policy comparisons use disposable local PostgreSQL databases only. The $300
// proposal is never applied to a provider, hosted database or approved UI policy.
const {test,before,after,beforeEach}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
const {createSellerCostDisclosure}=require('../server/seller_cost_allocation.cjs');
const {publicProtectionReview}=require('../test-protection-review.js');
const S='11111111-1111-4111-8111-111111111111',T='22222222-2222-4222-8222-222222222222',
 B='33333333-3333-4333-8333-333333333333',L='44444444-4444-4444-8444-444444444444',
 M='55555555-5555-4555-8555-555555555555',O='66666666-6666-4666-8666-666666666666',
 P='77777777-7777-4777-8777-777777777777';
const MIGRATIONS=['20261030_order_ledger','20261030_payment_recovery','20261030_checkout_attempts',
 '20261030_refund_receipts','20261030_refund_requests','20261030_checkout_quote_limits','20261030_checkout_quote_refresh',
 '20261031_cancel_preparation','20261031_refund_review','20261031_charge_fee_evidence','20261031_fulfillment_snapshots',
 '20261031_label_attempts','20261031_tracking_observations','20261102_seller_onboarding','20261102_order_issues',
 '20261102_order_issues_review','20261102_order_issues_thread','20261102_order_issues_review_refunds',
 '20261103_seller_protections','20261103_provider_risk_holds','20261103_startup_policy',
 '20261103_fee_policy_v2','20261103_seller_costs','20261103_startup_limit_200'];
let approved,proposed;
const sql=n=>fs.readFileSync(require.resolve('../supabase/test/'+n+'.sql'),'utf8');
const rpc=(db,name,args)=>db.query('select public.'+name+'('+args.map((_,i)=>'$'+(i+1)).join(',')+') x',args).then(r=>r.rows[0].x);
const reserve=(db,order=O,listing=L)=>rpc(db,'rr_test_reserve',[order,listing,B]);
async function makeDatabase(proposal=false){
 const db=new PGlite();await db.exec('create role anon;create role authenticated;create role service_role;');
 for(const name of MIGRATIONS)await db.exec(sql(name));
 if(proposal)await db.exec(fs.readFileSync(require.resolve('../supabase/proposals/startup_limit_300.sql'),'utf8'));
 return db;
}
before(async()=>{[approved,proposed]=await Promise.all([makeDatabase(),makeDatabase(true)]);});
after(async()=>{await Promise.all([approved?.close(),proposed?.close()]);});
beforeEach(async()=>{
 for(const db of [approved,proposed]){
  await db.exec('truncate rr_sandbox.catalog cascade;truncate rr_sandbox.seller_accounts cascade;');
  for(const [listing,seller]of [[L,S],[M,T]]){
   await db.query("insert into rr_sandbox.catalog(id,seller_id,title,price_cents) values($1,$2,'Synthetic limit comparison fixture',9000)",[listing,seller]);
   await rpc(db,'rr_test_claim_seller',[seller]);await rpc(db,'rr_test_save_seller',[seller,'acct_'+seller.replaceAll('-','')]);
   await rpc(db,'rr_test_record_seller_protection',[seller,'acct_'+seller.replaceAll('-',''),true,Date.now()]);
  }
 }
});
function quote({shipping=10000,tax=500,item=9000}={}){
 const fee=Math.floor((item*5+50)/100)+50,base=item+fee+shipping;
 const snapshot={test:true,feePolicyVersion:'rr-fees-v2',orderId:O,listingId:L,sellerId:S,currency:'USD',
  itemCents:item,buyerFeeCents:fee,shippingCents:shipping,taxCents:tax,baseCents:base,totalCents:base+tax};
 const input={feePolicyVersion:'rr-fees-v2',orderId:O,buyerId:B,listing:{id:L,seller_id:S,price_cents:item},
  shippingQuote:{test:true,orderId:O,amountCents:shipping,destinationHash:'a'.repeat(64),rateId:'b'.repeat(32)},
  taxQuote:{test:true,orderId:O,amountCents:tax,baseCents:base,destinationHash:'a'.repeat(64),taxCalculationId:'taxcalc_limitFixture'}};
 return {input,snapshot};
}
async function prepareAndAccept(db,q=quote()){
 await reserve(db);
 await rpc(db,'rr_test_prepare_checkout',[O,B,q.input,q.snapshot,new Date(Date.now()+600000).toISOString()]);
 const c=await rpc(db,'rr_test_seller_cost_context',[S,O]);
 const disclosure=createSellerCostDisclosure({order:c.order,maxTotalCents:500,
  costCaps:{processing:250,radar:10,connect_active_account:200,payout:40,insurance:0},selectedInsurance:false,createdAt:Date.now()});
 const {hash,...document}=disclosure;
 await rpc(db,'rr_test_prepare_seller_cost_disclosure',[S,O,JSON.stringify(document),hash]);
 await rpc(db,'rr_test_accept_seller_costs',[S,O,hash]);return q;
}
const dispatch=db=>rpc(db,'rr_test_dispatch_checkout',[O,B]);
async function attached(db,q=quote()){
 await prepareAndAccept(db,q);await dispatch(db);
 await rpc(db,'rr_test_save_checkout_session',[O,B,'cs_test_limitFixture',new Date(Date.now()+3600000).toISOString()]);
 return rpc(db,'rr_test_finish_checkout',[O,B]);
}
async function transaction(db,work){await db.exec('begin');try{await work();}finally{await db.exec('rollback');}}
async function rejectedWithin(db,work,pattern){await db.exec('savepoint expected_rejection');try{await assert.rejects(work,pattern);}finally{await db.exec('rollback to savepoint expected_rejection;release savepoint expected_rejection');}}
const order=db=>db.query('select * from rr_sandbox.orders where id=$1',[O]).then(r=>r.rows[0]);

test('approved $200 complete-total boundary accepts current fees, shipping and tax without changing seller consent',async()=>{
 const q=quote(),saved=await attached(approved,q);assert.equal(q.snapshot.totalCents,20000);assert.equal(saved.buyer_fee_cents,500);
 assert.equal(saved.fee_policy_version,'rr-fees-v2');assert.deepEqual(saved.snapshot,q.snapshot);
 const c=await rpc(approved,'rr_test_seller_cost_context',[S,O]);assert.equal(c.order.buyerFeeCents,500);assert.equal(c.acceptance.disclosureHash,c.disclosure.hash);
 const review=await rpc(approved,'rr_test_protection_review',[S,O]);assert.deepEqual(review.policy,{version:'startup-v2',maxOrderCents:20000,maxUnsettledOrders:1,maxUnsettledGrossCents:20000,minBusinessDaysAfterDelivery:2,automaticRelease:false});
 assert.deepEqual(publicProtectionReview(review,O),review);assert.equal(review.releaseEnabled,false);
});

test('approved $200 dispatch and direct attachment reject one cent over from either shipping or tax',async()=>{
 for(const components of [{shipping:10001,tax:500},{shipping:10000,tax:501}])await transaction(approved,async()=>{
  const q=await prepareAndAccept(approved,quote(components));assert.equal(q.snapshot.totalCents,20001);
  await rejectedWithin(approved,()=>dispatch(approved),/Startup order limit/);
  await rejectedWithin(approved,()=>rpc(approved,'rr_test_attach_checkout',[O,'cs_test_overLimit',q.snapshot,'taxcalc_limitFixture','a'.repeat(64),'b'.repeat(32),new Date(Date.now()+3600000).toISOString()]),/Startup order limit/);
  assert.equal((await order(approved)).state,'reserved');
 });
});

test('new 5% plus fifty-cent fee counts toward the reservation limit before shipping or tax',async()=>{
 await transaction(approved,async()=>{
  await approved.query('update rr_sandbox.catalog set price_cents=19000 where id=$1',[L]);
  const r=await reserve(approved);assert.equal(r.item_cents,19000);assert.equal(r.buyer_fee_cents,1000);assert.equal(r.item_cents+r.buyer_fee_cents,20000);
 });
 await approved.query('update rr_sandbox.catalog set price_cents=19001 where id=$1',[L]);
 await assert.rejects(reserve(approved),/Startup order limit/);assert.equal((await approved.query('select count(*)::int n from rr_sandbox.orders')).rows[0].n,0);
});

test('approved $200 limit retains one shared unsettled claim across racing sellers',async()=>{
 const results=await Promise.allSettled([reserve(approved),reserve(approved,P,M)]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.match(results.find(r=>r.status==='rejected').reason.message,/marketplace exposure/);
 assert.equal((await approved.query('select count(*)::int n from rr_sandbox.orders')).rows[0].n,1);
});

test('unknown creation, paid state, refunded state and local expiry do not recycle approved risk allowance',async()=>{
 await transaction(approved,async()=>{
  await prepareAndAccept(approved);await dispatch(approved);
  const a=(await approved.query('select phase,session_id from rr_sandbox.checkout_attempts where order_id=$1',[O])).rows[0];assert.equal(a.phase,'dispatched');assert.equal(a.session_id,null);
  await assert.rejects(reserve(approved,P,M),/marketplace exposure/);
 });
 const q=quote();await attached(approved,q);
 await rpc(approved,'rr_test_process_payment_event',['evt_limitPaid','c'.repeat(64),'checkout.session.completed',O,'cs_test_limitFixture',20000,'usd',true,'pi_limitFixture']);
 assert.equal((await order(approved)).state,'paid');await assert.rejects(reserve(approved,P,M),/marketplace exposure/);
 // This local fixture changes only refund/expires state to test the exposure
 // predicate; it does not claim a provider refund occurred.
 await approved.query("update rr_sandbox.orders set refund_state='refunded',refunded_cents=20000,expires_at=now()-interval '1 day' where id=$1",[O]);
 await assert.rejects(reserve(approved,P,M),/marketplace exposure/);assert.equal((await order(approved)).snapshot.totalCents,20000);
});

test('approved limit increase cannot bypass seller restrictions, consent or normal release guards',async()=>{
 await prepareAndAccept(approved);await rpc(approved,'rr_test_hold_seller',[S,O,'verification_problem']);
 await assert.rejects(dispatch(approved),/Seller verification or review/);
 const review=await rpc(approved,'rr_test_protection_review',[S,O]);assert.equal(review.policy.maxOrderCents,20000);assert.ok(review.blockers.includes('seller_review_hold'));assert.equal(review.releaseEnabled,false);
 for(const kind of ['seller_transfer','seller_payout'])await assert.rejects(approved.query("insert into rr_sandbox.jobs(order_id,kind,state) values($1,$2,'pending')",[O,kind]),/Seller release disabled/);
 await approved.exec('set role authenticated');try{await assert.rejects(rpc(approved,'rr_test_protection_review',[S,O]),/permission denied/);await assert.rejects(approved.query('select rr_sandbox.check_startup_exposure($1,$2)',[O,20000]),/permission denied/);}finally{await approved.exec('reset role');}
});

test('isolated $300 proposal accepts $300 exactly but still rejects one cent over and preserves paid amounts',async()=>{
 await transaction(proposed,async()=>{
  const q=quote({shipping:20000,tax:501});assert.equal(q.snapshot.totalCents,30001);await prepareAndAccept(proposed,q);
  await assert.rejects(dispatch(proposed),/Startup order limit/);
 });
 const q=quote({shipping:20000,tax:500}),r=await attached(proposed,q);assert.equal(r.snapshot.totalCents,30000);assert.equal(r.snapshot.buyerFeeCents,500);
 await rpc(proposed,'rr_test_process_payment_event',['evt_proposedLimit','d'.repeat(64),'checkout.session.completed',O,'cs_test_limitFixture',30000,'usd',true,'pi_proposedLimit']);
 assert.deepEqual((await order(proposed)).snapshot,q.snapshot);assert.equal((await order(proposed)).state,'paid');
});

test('$300 comparison keeps the global one-order and money holds while its unapproved policy cannot reach the UI',async()=>{
 const results=await Promise.allSettled([reserve(proposed),reserve(proposed,P,M)]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
 const winner=(await proposed.query('select id,seller_id from rr_sandbox.orders')).rows[0];
 const review=await rpc(proposed,'rr_test_protection_review',[winner.seller_id,winner.id]);assert.equal(review.policy.version,'startup-proposed-300');assert.equal(review.policy.maxOrderCents,30000);assert.equal(review.policy.maxUnsettledOrders,1);assert.equal(review.releaseEnabled,false);
 assert.throws(()=>publicProtectionReview(review,winner.id),/Startup policy needs review/);
 assert.throws(()=>publicProtectionReview({...review,policy:{...review.policy,version:'startup-v2'}},winner.id),/Startup policy needs review/);
 for(const kind of ['seller_transfer','seller_payout'])await assert.rejects(proposed.query("insert into rr_sandbox.jobs(order_id,kind,state) values($1,$2,'pending')",[winner.id,kind]),/Seller release disabled/);
});

test('proposal comparison does not mutate the independently approved $200 database policy',async()=>{
 await reserve(approved);const current=await rpc(approved,'rr_test_protection_review',[S,O]);assert.equal(current.policy.version,'startup-v2');assert.equal(current.policy.maxOrderCents,20000);assert.deepEqual(publicProtectionReview(current,O),current);
 const q=quote({shipping:20000,tax:500});await approved.exec('begin');try{
  // Existing approved order can receive a quote, but its final dispatch remains
  // capped even while the other local database is testing a different policy.
  await rpc(approved,'rr_test_prepare_checkout',[O,B,q.input,q.snapshot,new Date(Date.now()+600000).toISOString()]);
  const c=await rpc(approved,'rr_test_seller_cost_context',[S,O]),d=createSellerCostDisclosure({order:c.order,maxTotalCents:500,costCaps:{processing:250,radar:10,connect_active_account:200,payout:40,insurance:0},selectedInsurance:false,createdAt:Date.now()});
  const {hash,...document}=d;await rpc(approved,'rr_test_prepare_seller_cost_disclosure',[S,O,JSON.stringify(document),hash]);await rpc(approved,'rr_test_accept_seller_costs',[S,O,hash]);
  await assert.rejects(dispatch(approved),/Startup order limit/);
 }finally{await approved.exec('rollback');}
});
