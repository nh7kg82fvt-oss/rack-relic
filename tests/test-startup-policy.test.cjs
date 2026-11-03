'use strict';
const {test,before,after,beforeEach}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),{PGlite}=require('@electric-sql/pglite');
const {publicProtectionReview}=require('../test-protection-review.js');
const S='11111111-1111-4111-8111-111111111111',T='22222222-2222-4222-8222-222222222222',B='33333333-3333-4333-8333-333333333333',L='44444444-4444-4444-8444-444444444444',M='55555555-5555-4555-8555-555555555555',O='66666666-6666-4666-8666-666666666666',P='77777777-7777-4777-8777-777777777777';
let db;const rpc=(name,args)=>db.query('select public.'+name+'('+args.map((_,i)=>'$'+(i+1)).join(',')+') x',args).then(r=>r.rows[0].x);
before(async()=>{db=new PGlite();await db.exec('create role anon;create role authenticated;create role service_role;');for(const n of ['20261030_order_ledger','20261030_payment_recovery','20261030_checkout_attempts','20261030_refund_receipts','20261030_refund_requests','20261030_checkout_quote_limits','20261030_checkout_quote_refresh','20261031_cancel_preparation','20261031_refund_review','20261031_charge_fee_evidence','20261031_fulfillment_snapshots','20261031_label_attempts','20261031_tracking_observations','20261102_seller_onboarding','20261102_order_issues','20261102_order_issues_review','20261102_order_issues_thread','20261102_order_issues_review_refunds','20261103_seller_protections','20261103_provider_risk_holds','20261103_startup_policy'])await db.exec(fs.readFileSync('supabase/test/'+n+'.sql','utf8'));});
after(async()=>db?.close());
beforeEach(async()=>{await db.exec('truncate rr_sandbox.catalog cascade;truncate rr_sandbox.seller_accounts cascade;');for(const [listing,seller] of [[L,S],[M,T]]){await db.query("insert into rr_sandbox.catalog(id,seller_id,title,price_cents) values($1,$2,'Synthetic startup fixture',2500)",[listing,seller]);await rpc('rr_test_claim_seller',[seller]);await rpc('rr_test_save_seller',[seller,'acct_'+seller.replaceAll('-','')]);await rpc('rr_test_record_seller_protection',[seller,'acct_'+seller.replaceAll('-',''),true,Date.now()]);}});
const reserve=(order=O,listing=L)=>rpc('rr_test_reserve',[order,listing,B]);
const snap=total=>({test:true,orderId:O,listingId:L,sellerId:S,currency:'USD',baseCents:total,itemCents:2500,buyerFeeCents:100,shippingCents:total-2600,taxCents:0,totalCents:total});
const attach=total=>rpc('rr_test_attach_checkout',[O,'cs_test_startup',snap(total),'taxcalc_fixture','a'.repeat(64),'b'.repeat(32),new Date(Date.now()+3600000).toISOString()]);
test('initial pilot permits at most one unsettled claim across different sellers, including concurrent attempts',async()=>{
 const results=await Promise.allSettled([reserve(),reserve(P,M)]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal((await db.query('select count(*)::int n from rr_sandbox.orders')).rows[0].n,1);
});
test('startup cap uses complete gross, not just the listing price, and retries preserve the existing claim',async()=>{
 await reserve();await reserve();await assert.rejects(attach(10001),/Startup order limit/);await attach(10000);await assert.rejects(reserve(P,M),/marketplace exposure/);
 assert.equal((await rpc('rr_test_checkout_attempt',[O,B])).order.id,O);
});
test('local expiry, paid or refunded status does not automatically recycle the startup risk allowance',async()=>{
 await reserve();await attach(3100);await rpc('rr_test_process_payment_event',['evt_startup','c'.repeat(64),'checkout.session.completed',O,'cs_test_startup',3100,'usd',true,'pi_startup']);
 await db.query("update rr_sandbox.orders set expires_at=now()-interval '1 day',refund_state='refunded',refunded_cents=3100 where id=$1",[O]);await assert.rejects(reserve(P,M),/marketplace exposure/);
});
test('money jobs remain held even when an operator could otherwise mark one ready',async()=>{
 await reserve();for(const kind of ['seller_transfer','seller_payout']){await db.query("insert into rr_sandbox.jobs(order_id,kind,state) values($1,$2,'held')",[O,kind]);for(const state of ['pending','leased','done'])await assert.rejects(db.query('update rr_sandbox.jobs set state=$2 where order_id=$1 and kind=$3',[O,state,kind]),/release disabled/);}
});
test('operator review reports the stricter policy without treating it as live release approval',async()=>{
 await reserve();const r=await rpc('rr_test_protection_review',[S,O]);assert.equal(r.policy.maxOrderCents,10000);assert.equal(r.policy.maxUnsettledOrders,1);assert.equal(r.policy.minBusinessDaysAfterDelivery,2);assert.equal(r.releaseEnabled,false);assert.deepEqual(publicProtectionReview(r,O),r);assert.throws(()=>publicProtectionReview({...r,policy:{...r.policy,automaticRelease:true}},O));
});
test('two-business-day clock skips weekends, observed holidays, and preserves Pacific time through DST',async()=>{
 for(const [from,to] of [['2026-11-06T14:30:00-08:00','2026-11-10T14:30:00-08:00'],['2026-11-10T14:30:00-08:00','2026-11-13T14:30:00-08:00'],['2026-11-25T14:30:00-08:00','2026-11-30T14:30:00-08:00'],['2026-10-30T14:30:00-07:00','2026-11-03T14:30:00-08:00'],['2026-12-30T14:30:00-08:00','2027-01-04T14:30:00-08:00'],['2027-12-23T14:30:00-08:00','2027-12-28T14:30:00-08:00']]){
  const r=(await db.query('select rr_sandbox.delivery_wait_end($1) as x',[from])).rows[0].x;assert.equal(new Date(r).toISOString(),new Date(to).toISOString());
 }
 for(const from of [null,'infinity','2025-01-01T12:00:00Z','2027-12-30T12:00:00-08:00'])await assert.rejects(db.query('select rr_sandbox.delivery_wait_end($1)',[from]));
});
