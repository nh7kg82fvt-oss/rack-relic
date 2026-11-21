'use strict';
const {test,before,after,beforeEach}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
const {sanitizeAdminSnapshot}=require('../test-admin.js');
// Real dependency chain before the later global startup cap. Historical orders
// can predate that cap; this read-only overview must still bound their output.
const migrations=['20261030_order_ledger','20261030_payment_recovery','20261030_checkout_attempts','20261030_refund_receipts','20261030_refund_requests','20261030_checkout_quote_limits','20261030_checkout_quote_refresh','20261031_cancel_preparation','20261031_refund_review','20261031_charge_fee_evidence','20261031_fulfillment_snapshots','20261031_label_attempts','20261031_tracking_observations','20261102_seller_onboarding','20261102_order_issues','20261102_order_issues_review','20261102_order_issues_thread','20261102_order_issues_review_refunds','20261103_seller_protections','20261103_provider_risk_holds','20261103_cloud_case_alerts','20261103_admin_overview'];
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const S=id(1),B=id(2),O=id(3),L=id(4);let db;
const rpc=(name,args=[])=>db.query('select public.'+name+'('+args.map((_,i)=>'$'+(i+1)).join(',')+') x',args).then(r=>r.rows[0].x);
async function paid(n=0,paidFlag=true){const seller=n?id(1000+n):S,order=n?id(2000+n):O,listing=n?id(3000+n):L;
 await db.query("insert into rr_sandbox.catalog(id,seller_id,title,price_cents) values($1,$2,'Synthetic admin jacket',2500)",[listing,seller]);
 await rpc('rr_test_claim_seller',[seller]);await rpc('rr_test_save_seller',[seller,'acct_adminSeller'+n]);await rpc('rr_test_record_seller_protection',[seller,'acct_adminSeller'+n,true,Date.now()]);await rpc('rr_test_reserve',[order,listing,B]);
 const snapshot={test:true,orderId:order,listingId:listing,sellerId:seller,currency:'USD',itemCents:2500,buyerFeeCents:100,shippingCents:500,taxCents:0,totalCents:3100};
 await rpc('rr_test_attach_checkout',[order,'cs_test_admin'+n,snapshot,'taxcalc_admin'+n,'a'.repeat(64),'b'.repeat(32),new Date(Date.now()+3600000).toISOString()]);await rpc('rr_test_process_payment_event',['evt_adminPaid'+n,'a'.repeat(64),'checkout.session.completed',order,'cs_test_admin'+n,3100,'usd',paidFlag,'pi_admin'+n]);
}
async function notice(n=0){const now=Math.floor(Date.now()/1000)-5;return rpc('rr_test_process_risk_notice',['evt_adminCase'+n,'b'.repeat(64),'charge.dispute.created','du_admin'+n,'ch_admin','pi_admin0',3100,'usd','needs_response',now+86400,now]);}
before(async()=>{db=new PGlite();await db.exec('create role anon;create role authenticated;create role service_role;');for(const name of migrations)await db.exec(fs.readFileSync('supabase/test/'+name+'.sql','utf8'));});after(async()=>db?.close());
beforeEach(async()=>{await db.exec('truncate rr_sandbox.catalog cascade;truncate rr_sandbox.seller_accounts cascade;');await paid();});
test('admin RPC returns minimal actual counts, saved observations and opaque references without private provider objects',async()=>{
 await notice();const result=await rpc('rr_test_admin_overview',[S,S]);assert.equal(result.counts.orders,1);assert.equal(result.counts.paidOrders,1);assert.equal(result.counts.heldOrders,1);assert.equal(result.counts.sellers,1);assert.equal(result.counts.openCases,1);assert.equal(result.counts.alertDeliveryGaps,1);assert.equal(result.orders[0].orderRef,O);assert.match(result.cases[0].caseRef,/^case_[a-f0-9]{32}$/);assert.equal(result.sources.shippingObservedAt,null);assert.ok(Date.parse(result.sources.stripeObservedAt)<=Date.parse(result.observedAt)+30);assert.equal(sanitizeAdminSnapshot(result).cases.length,1);
 const json=JSON.stringify(result);for(const hidden of ['pi_admin','ch_admin','du_admin','cs_test_admin','acct_admin','seller_id','buyer_id','email','address','payload_hash','secret','lease_token'])assert.equal(json.includes(hidden),false);assert.equal(result.live,false);assert.equal(result.releaseEnabled,false);
});
test('overview reads do not refresh cases, claim outbox deliveries, update orders or release money',async()=>{
 await notice();const before=await db.query('select (select jsonb_agg(o) from rr_sandbox.orders o) orders,(select jsonb_agg(a) from rr_sandbox.case_alert_outbox a) alerts,(select jsonb_agg(j) from rr_sandbox.jobs j) jobs');await rpc('rr_test_admin_overview',[S,S]);await rpc('rr_test_admin_overview',[S,S]);const after=await db.query('select (select jsonb_agg(o) from rr_sandbox.orders o) orders,(select jsonb_agg(a) from rr_sandbox.case_alert_outbox a) alerts,(select jsonb_agg(j) from rr_sandbox.jobs j) jobs');assert.deepEqual(after.rows,before.rows);
});
test('large historical inventories remain bounded to 15 orders and 10 cases with explicit truncation',async()=>{
 for(let n=1;n<=16;n++)await paid(n);for(let n=0;n<12;n++)await notice(n);const result=await rpc('rr_test_admin_overview',[S,S]);assert.equal(result.counts.orders,17);assert.equal(result.orders.length,15);assert.equal(result.cases.length,10);assert.equal(result.orders.length+result.cases.length,25);assert.equal(result.hasMoreOrders,true);assert.equal(result.hasMoreCases,true);assert.equal(result.counts.openCases,12);assert.equal(sanitizeAdminSnapshot(result).orders.length,15);
});
test('browser roles cannot call the overview or read its private source tables; service role gets only the RPC',async()=>{
 for(const role of ['anon','authenticated']){await db.exec('set role '+role);try{await assert.rejects(rpc('rr_test_admin_overview',[S,S]));for(const table of ['orders','case_alert_heads','tracking_current','seller_accounts'])await assert.rejects(db.query('select * from rr_sandbox.'+table));}finally{await db.exec('reset role');}}
 await db.exec('set role service_role');try{assert.equal((await rpc('rr_test_admin_overview',[S,S])).test,true);await assert.rejects(db.query('select * from rr_sandbox.case_alert_heads'));}finally{await db.exec('reset role');}
 const rows=(await db.query("select relrowsecurity from pg_class where oid in ('rr_sandbox.orders'::regclass,'rr_sandbox.case_alert_heads'::regclass,'rr_sandbox.case_alert_outbox'::regclass,'rr_sandbox.tracking_current'::regclass,'rr_sandbox.seller_accounts'::regclass)")).rows;assert.equal(rows.length,5);assert.ok(rows.every(r=>r.relrowsecurity));
});
test('missing and non-participating actors fail without changing state',async()=>{for(const actor of [null,id(999999)])await assert.rejects(rpc('rr_test_admin_overview',[S,actor]),/participating test owner/);assert.equal((await rpc('rr_test_admin_overview',[S,S])).counts.orders,1);});

test('urgent older cases stay visible ahead of newer closed cases in a truncated overview',async()=>{
 await notice(0);const created=Math.floor(Date.now()/1000)-4;for(let n=1;n<=12;n++)await rpc('rr_test_process_risk_notice',['evt_closed'+n,'c'.repeat(64),'charge.dispute.closed','du_closed'+n,'ch_admin','pi_admin0',3100,'usd','won',null,created]);
 const result=await rpc('rr_test_admin_overview',[S,S]),reference='case_'+require('node:crypto').createHash('md5').update('du_admin0').digest('hex');assert.equal(result.hasMoreCases,true);assert.equal(result.cases[0].caseRef,reference);assert.equal(result.cases[0].requiresResponse,true);
});

test('service-role overview requires the configured owner and authenticated actor to agree',async()=>{for(const args of [[S,B],[null,S],[S,null]])await assert.rejects(rpc('rr_test_admin_overview',args),/test owner/);assert.equal((await rpc('rr_test_admin_overview',[S,S])).counts.orders,1);});

test('an actual unpaid Checkout completion stays pending and held in the read-only owner snapshot',async()=>{await paid(1,false);const pending=id(2001);assert.equal((await db.query('select state from rr_sandbox.orders where id=$1',[pending])).rows[0].state,'payment_pending');const result=await rpc('rr_test_admin_overview',[S,S]),view=sanitizeAdminSnapshot(result);assert.equal(view.counts.orders,2);assert.equal(view.counts.paidOrders,1);assert.equal(view.counts.heldOrders,2);assert.equal(view.orders.find(o=>o.orderRef===pending).state,'payment_pending');assert.equal(view.orders.find(o=>o.orderRef===pending).holdRequired,true);assert.equal((await db.query('select count(*)::int n from rr_sandbox.ledger_entries where order_id=$1',[pending])).rows[0].n,0);assert.equal((await db.query('select count(*)::int n from rr_sandbox.jobs where order_id=$1',[pending])).rows[0].n,0);});
