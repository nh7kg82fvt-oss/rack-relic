'use strict';
const {test,before,after,beforeEach}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
const {createSellerCostDisclosure,sellerCostObligationKeys}=require('../server/seller_cost_allocation.cjs');
const S='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222',X='33333333-3333-4333-8333-333333333333',
 L='44444444-4444-4444-8444-444444444444',O='55555555-5555-4555-8555-555555555555',T='66666666-6666-4666-8666-666666666666',
 P='77777777-7777-4777-8777-777777777777',R='88888888-8888-4888-8888-888888888888',Z='99999999-9999-4999-8999-999999999999';
const MIGRATIONS=['20261030_order_ledger','20261030_payment_recovery','20261030_checkout_attempts','20261030_refund_receipts','20261030_refund_requests',
 '20261030_checkout_quote_limits','20261030_checkout_quote_refresh','20261031_cancel_preparation','20261031_refund_review','20261031_charge_fee_evidence',
 '20261031_fulfillment_snapshots','20261031_label_attempts','20261031_tracking_observations','20261102_seller_onboarding','20261102_order_issues',
 '20261102_order_issues_review','20261102_order_issues_thread','20261102_order_issues_review_refunds','20261103_seller_protections',
 '20261103_provider_risk_holds','20261103_startup_policy','20261103_startup_limit_200','20261103_fee_policy_v2','20261103_seller_costs','20261103_settlement_simulation'];
let db;const rpc=(name,args)=>db.query('select public.'+name+'('+args.map((_,i)=>'$'+(i+1)).join(',')+') x',args).then(r=>r.rows[0].x);
const context=()=>rpc('rr_test_settlement_context',[S,O]);
before(async()=>{db=new PGlite();await db.exec('create role anon;create role authenticated;create role service_role;');for(const n of MIGRATIONS)await db.exec(fs.readFileSync('supabase/test/'+n+'.sql','utf8'));});
after(async()=>db?.close());
beforeEach(async t=>{
 await db.exec('truncate rr_sandbox.catalog cascade;truncate rr_sandbox.seller_accounts cascade;');
 await db.query("insert into rr_sandbox.catalog(id,seller_id,title,price_cents) values($1,$2,'Synthetic settlement jacket',2500)",[L,S]);
 await rpc('rr_test_claim_seller',[S]);await rpc('rr_test_save_seller',[S,'acct_simSeller']);await rpc('rr_test_record_seller_protection',[S,'acct_simSeller',true,Date.now()]);
 await rpc('rr_test_reserve',[O,L,B]);
 const snapshot={test:true,feePolicyVersion:'rr-fees-v2',orderId:O,listingId:L,sellerId:S,currency:'USD',itemCents:2500,buyerFeeCents:175,shippingCents:500,taxCents:0,baseCents:3175,totalCents:3175};
 const input={orderId:O,buyerId:B,feePolicyVersion:'rr-fees-v2',listing:{id:L,seller_id:S,price_cents:2500},shippingQuote:{test:true,orderId:O,amountCents:500,destinationHash:'a'.repeat(64),rateId:'b'.repeat(32)},taxQuote:{test:true,orderId:O,amountCents:0,baseCents:3175,destinationHash:'a'.repeat(64),taxCalculationId:'taxcalc_sim'}};
 await rpc('rr_test_prepare_checkout',[O,B,input,snapshot,new Date(Date.now()+600000).toISOString()]);
 const order=(await rpc('rr_test_seller_cost_context',[S,O])).order,d=createSellerCostDisclosure({order,maxTotalCents:600,costCaps:{processing:200,radar:10,connect_active_account:200,payout:190,insurance:0},selectedInsurance:false,createdAt:Date.now()});
 const {hash,...document}=d;await rpc('rr_test_prepare_seller_cost_disclosure',[S,O,JSON.stringify(document),hash]);await rpc('rr_test_accept_seller_costs',[S,O,hash]);
 await rpc('rr_test_dispatch_checkout',[O,B]);await rpc('rr_test_attach_checkout',[O,'cs_test_sim',snapshot,'taxcalc_sim','a'.repeat(64),'b'.repeat(32),new Date(Date.now()+3600000).toISOString()]);
 await rpc('rr_test_process_payment_event',['evt_sim','a'.repeat(64),'checkout.session.completed',O,'cs_test_sim',3175,'usd',true,'pi_sim']);
 await rpc('rr_test_record_charge_fee',[O,S,{test:true,orderId:O,paymentIntentId:'pi_sim',chargeId:'ch_sim',balanceTransactionId:'txn_sim',grossCents:3175,feeCents:100,netCents:3075,currency:'USD',feeDetails:[{type:'stripe_fee',amountCents:100,currency:'USD'}],checkedAt:Date.now()}]);
 const keys=sellerCostObligationKeys(order);
 for(const [kind,amount]of [['processing',100],['radar',7],['connect_active_account',200],['payout',90]])await rpc('rr_test_record_seller_cost',[S,O,{test:true,verified:true,source:kind==='processing'?'provider_receipt':'disclosed_reserve',obligationKey:keys[kind],orderId:O,sellerId:S,kind,phase:kind==='processing'?'confirmed':'reserved',amountCents:amount,sourceTotalCents:amount,sourceReference:kind==='processing'?'txn_sim:fee':null,currency:'USD',observedAt:Date.now(),scope:kind==='connect_active_account'?'seller_month':kind==='payout'?'payout':'order',...(kind==='connect_active_account'?{period:order.settlementPeriod}:{}),...(kind==='payout'?{payoutBatchId:order.payoutBatchId}:{})}]);
 await rpc('rr_test_record_risk',[O,{test:true,orderId:O,chargeId:'ch_sim',decision:'clear',reasonCodes:[],checkedAt:Date.now()},'c'.repeat(64)]);
 const transaction='d'.repeat(32);await db.query('insert into rr_sandbox.label_attempts(request_id,order_id,actor_id,quote,transaction_id,result) values($1,$2,$3,$4,$5,$6)',[Z,O,S,{test:true,rateId:'b'.repeat(32),carrier:'USPS'},transaction,{test:true,status:'SUCCESS',trackingNumber:'SIMULATEDONLY',transactionId:transaction}]);
 await rpc('rr_test_record_tracking',[O,S,{test:true,orderId:O,requestId:Z,transactionId:transaction,trackingNumber:'SIMULATEDONLY',carrier:'USPS',status:'DELIVERED',eventAt:Date.now()-7*86400000,checkedAt:Date.now(),source:'shippo_transaction'}]);
 // An already-expired binding is fixture state for the freshness scenario,
 // equivalent to time passing. No guard is disabled or weakened for a test.
 if(t.name==='payout requires fresh server-bound default test bank and rejects bank replacement')
  await db.query("insert into rr_sandbox.settlement_sim_bindings(order_id,account_id,bank_account_id,checked_at,recorded_by) values($1,'acct_simSeller','ba_simBank',clock_timestamp()-interval '6 minutes',$2)",[O,S]);
 else await rpc('rr_test_record_settlement_binding',[S,O,{test:true,simulationOnly:true,source:'stripe_sandbox',accountId:'acct_simSeller',bankAccountId:'ba_simBank',checkedAt:Date.now()}]);
});
const prepare=(kind='transfer',amount=1900,id=T,parent=null)=>rpc('rr_test_prepare_settlement',[S,O,id,kind,amount,parent]);
const receipt=(q,patch={})=>({test:true,simulationOnly:true,source:'stripe_sandbox',requestId:q.requestId,orderId:O,kind:q.kind,providerId:q.providerId,accountId:q.accountId,currency:'USD',amountCents:q.amountCents,parentProviderId:q.parentProviderId,status:q.kind==='payout'?'pending':'succeeded',checkedAt:Date.now(),balanceTransactionId:'txn_'+q.kind,failureBalanceTransactionId:null,failureCode:null,...patch});
async function known(kind='transfer',amount=1900,id=T,parent=null){await prepare(kind,amount,id,parent);await rpc('rr_test_dispatch_settlement',[S,id]);return rpc('rr_test_save_settlement',[S,id,(kind==='transfer'?'tr_':kind==='payout'?'po_':'trr_')+id.replaceAll('-','')]);}
async function transfer(){const q=await known();return rpc('rr_test_record_settlement',[S,q.requestId,receipt(q)]);}
const ledger=()=>db.query('select request_id,kind,amount_cents from rr_sandbox.settlement_sim_ledger order by request_id,kind').then(r=>r.rows);

test('simulation context binds item-only proceeds, full cost reserves, account and test bank without granting live release',async()=>{
 const c=await context();assert.deepEqual(c.blockers,[]);assert.equal(c.maxTransferCents,1900);assert.equal(c.order.buyerFeeCents,175);assert.equal(c.order.totalCents,3175);assert.equal(c.bankAccountId,'ba_simBank');assert.equal(c.simulationOnly,true);assert.equal(c.releaseEnabled,false);assert.equal(c.liveReady,false);
 await assert.rejects(prepare('transfer',1901,P),/proceeds exceeded/);
 const q=await prepare();assert.equal(q.maxTransferCents,1900);assert.equal(q.totalCents,3175);assert.equal(q.itemCents,2500);assert.equal(q.platformReserveCents,0);assert.equal(q.parentAmountCents,null);assert.equal(q.bankAccountId,null);assert.equal(q.transferGroup,'rr_test_'+O);assert.equal(q.availableCents,1900);
 await assert.rejects(prepare('transfer',1900,P),/unique/);
 assert.equal((await rpc('rr_test_protection_review',[S,O])).releaseEnabled,false);
});
test('unknown/stale payment, seller, risk, cost, issue or delivery evidence blocks new simulation dispatch',async()=>{
 for(const [change,blocker]of [
  ["update rr_sandbox.seller_protection_status set checked_at=clock_timestamp()-interval '6 minutes'",'seller_verification_required'],
  ["update rr_sandbox.risk_assessments set checked_at=clock_timestamp()-interval '6 minutes'",'risk_review_required'],
  ["update rr_sandbox.tracking_current set last_checked=clock_timestamp()-interval '6 minutes'",'test_delivery_simulation_required']]){
  await db.exec('begin');try{await db.exec(change);assert.ok((await context()).blockers.includes(blocker));await assert.rejects(prepare(),/evidence incomplete/);}finally{await db.exec('rollback');}
 }
 await prepare();await rpc('rr_test_order_issue',[B,O,'damaged']);await assert.rejects(rpc('rr_test_dispatch_settlement',[S,T]),/evidence changed/);assert.equal((await context()).attempts[0].phase,'prepared');
});
test('one durable dispatch claim and immutable provider identity prevent duplicate creation after a lost response',async()=>{
 await prepare();const replies=await Promise.all([rpc('rr_test_dispatch_settlement',[S,T]),rpc('rr_test_dispatch_settlement',[S,T])]);assert.equal(replies.filter(r=>r.dispatch).length,1);
 await assert.rejects(prepare('transfer',1899),/immutable/);assert.equal((await rpc('rr_test_dispatch_settlement',[S,T])).dispatch,false);assert.equal((await context()).attempts[0].phase,'dispatched');
 await rpc('rr_test_save_settlement',[S,T,'tr_saved']);await assert.rejects(rpc('rr_test_save_settlement',[S,T,'tr_substitute']),/Matching/);assert.equal((await context()).attempts[0].providerId,'tr_saved');
});
test('bound confirmed transfer receipt appends one balanced simulation pair and leaves ordinary money records unchanged',async()=>{
 const original=(await db.query('select * from rr_sandbox.ledger_entries order by kind')).rows,q=await known();const e=receipt(q);await rpc('rr_test_record_settlement',[S,T,e]);const first=await ledger();await rpc('rr_test_record_settlement',[S,T,{...e,checkedAt:Date.now()}]);assert.deepEqual(await ledger(),first);assert.equal(first.length,2);assert.equal(first.reduce((n,r)=>n+Number(r.amount_cents),0),0);
 assert.deepEqual((await db.query('select * from rr_sandbox.ledger_entries order by kind')).rows,original);assert.equal((await db.query("select count(*)::int n from rr_sandbox.jobs where kind in ('seller_transfer','seller_payout') and state<>'held'")).rows[0].n,0);
 for(const kind of ['seller_transfer','seller_payout'])await assert.rejects(db.query("insert into rr_sandbox.jobs(order_id,kind,state) values($1,$2,'pending')",[O,kind]),/release disabled/);
});
test('payout and reversal reservations share one parent budget under concurrent claims',async()=>{
 await transfer();const r=await Promise.allSettled([prepare('payout',1500,P,T),prepare('reversal',1000,R,T)]);assert.equal(r.filter(x=>x.status==='fulfilled').length,1);assert.match(r.find(x=>x.status==='rejected').reason.message,/Parent funds allocated/);
 const existing=(await context()).attempts.find(q=>q.kind!=='transfer');assert.equal(existing.parentProviderId,'tr_'+T.replaceAll('-',''));assert.equal(existing.parentAmountCents,1900);assert.equal(existing.bankAccountId,existing.kind==='payout'?'ba_simBank':null);
});
test('payout requires fresh server-bound default test bank and rejects bank replacement',async()=>{
 await transfer();await assert.rejects(prepare('payout',1000,P,T),/bank binding/);
 await rpc('rr_test_record_settlement_binding',[S,O,{test:true,simulationOnly:true,source:'stripe_sandbox',accountId:'acct_simSeller',bankAccountId:'ba_simBank',checkedAt:Date.now()}]);await prepare('payout',1000,P,T);
 await assert.rejects(rpc('rr_test_record_settlement_binding',[S,O,{test:true,simulationOnly:true,source:'stripe_sandbox',accountId:'acct_simSeller',bankAccountId:'ba_changedBank',checkedAt:Date.now()}]),/Changed bank/);
});
test('pending then paid payout is recorded once, cannot consume the same parent funds twice and never enables ordinary release',async()=>{
 await transfer();const q=await known('payout',1900,P,T),pending=receipt(q);await rpc('rr_test_record_settlement',[S,P,pending]);await rpc('rr_test_record_settlement',[S,P,{...pending,status:'in_transit',checkedAt:Date.now()}]);const paid={...pending,status:'paid',checkedAt:Date.now()};await rpc('rr_test_record_settlement',[S,P,paid]);const rows=await ledger();await rpc('rr_test_record_settlement',[S,P,{...paid,checkedAt:Date.now()}]);assert.deepEqual(await ledger(),rows);assert.equal(rows.length,6);assert.equal(rows.reduce((n,r)=>n+Number(r.amount_cents),0),0);
 await assert.rejects(prepare('payout',1,R,T),/Parent funds allocated/);await assert.rejects(prepare('reversal',1,R,T),/Parent funds allocated/);assert.equal((await context()).releaseEnabled,false);
});
test('failed payout without verified return holds recovery and does not invent funds or automatically retry',async()=>{
 await transfer();const q=await known('payout',1900,P,T),failed=receipt(q,{status:'failed',failureCode:'account_closed'});await rpc('rr_test_record_settlement',[S,P,failed]);let c=await context();assert.equal(c.attempts.find(q=>q.requestId===P).needsReview,true);assert.ok(c.blockers.includes('settlement_recovery_review_required'));assert.equal((await ledger()).some(r=>r.kind==='connected_payout_return'),false);
 await assert.rejects(prepare('payout',1900,R,T),/evidence incomplete/);await assert.rejects(prepare('reversal',1900,R,T),/Parent funds allocated/);assert.equal((await rpc('rr_test_dispatch_settlement',[S,P])).dispatch,false);
 const verified={...failed,failureBalanceTransactionId:'txn_payoutReturn',checkedAt:Date.now()};await rpc('rr_test_record_settlement',[S,P,verified]);assert.equal((await ledger()).filter(r=>r.kind==='connected_payout_return').length,1);await prepare('reversal',1900,R,T);await assert.rejects(prepare('payout',1,Z,T),/evidence incomplete/);
});
test('a legitimate bank-return transition paid to failed records a verified return and keeps review sticky',async()=>{
 await transfer();const q=await known('payout',1900,P,T),e=receipt(q,{status:'paid'});await rpc('rr_test_record_settlement',[S,P,e]);const returned={...e,status:'failed',failureCode:'no_account',failureBalanceTransactionId:'txn_bankReturn',checkedAt:Date.now()};await rpc('rr_test_record_settlement',[S,P,returned]);const first=await ledger();await rpc('rr_test_record_settlement',[S,P,{...returned,checkedAt:Date.now()}]);assert.deepEqual(await ledger(),first);const c=await context(),p=c.attempts.find(q=>q.requestId===P);assert.equal(p.status,'failed');assert.equal(p.needsReview,true);assert.equal((await ledger()).filter(r=>r.kind==='seller_bank_return').length,1);assert.equal((await ledger()).reduce((n,r)=>n+Number(r.amount_cents),0),0);await prepare('reversal',1900,R,T);
});
test('refund and seller restrictions block new payout but cannot prevent a bound transfer reversal for recovery',async()=>{
 await transfer();await rpc('rr_test_order_issue',[B,O,'not_received']);await rpc('rr_test_hold_seller',[S,O,'verification_problem']);await rpc('rr_test_prepare_refund',[Z,O,S,3175]);await assert.rejects(prepare('payout',1000,P,T),/evidence incomplete/);
 const q=await known('reversal',1900,R,T);await rpc('rr_test_record_settlement',[S,R,receipt(q)]);assert.equal((await ledger()).filter(r=>r.kind==='seller_transfer_recovery').length,1);await assert.rejects(prepare('reversal',1,P,T),/Parent funds allocated/);
});
test('insufficient connected funds and unknown outcomes are one-way review holds, never a bank debit or another dispatch',async()=>{
 await transfer();await prepare('reversal',1900,R,T);await rpc('rr_test_dispatch_settlement',[S,R]);await rpc('rr_test_hold_settlement',[S,R,'provider_balance_insufficient']);const held=await rpc('rr_test_hold_settlement',[S,R,'provider_outcome_unknown']);assert.equal(held.holdReason,'provider_balance_insufficient');assert.equal(held.phase,'dispatched');assert.equal(held.needsReview,true);assert.equal((await rpc('rr_test_dispatch_settlement',[S,R])).dispatch,false);assert.equal((await ledger()).length,2);
 await assert.rejects(rpc('rr_test_hold_settlement',[S,R,'debit_bank']),/Known simulation hold/);
});
test('receipt binding, mode, fresh time and exact allowlist reject substituted or private payloads without bookkeeping',async()=>{
 const q=await known(),e=receipt(q);for(const patch of [{test:false},{simulationOnly:false},{source:'browser'},{requestId:P},{orderId:P},{accountId:'acct_other'},{providerId:'tr_other'},{currency:'EUR'},{amountCents:1899},{amountCents:'1900'},{checkedAt:Date.now()-360000},{bankDetails:'private'},{parentProviderId:'tr_other'},{balanceTransactionId:null},{failureCode:'raw private error'}])await assert.rejects(rpc('rr_test_record_settlement',[S,T,{...e,...patch}]));assert.deepEqual(await ledger(),[]);
});
test('contradictory terminal or balance evidence cannot overwrite accepted receipt and instead requires review',async()=>{
 await transfer();const q=await known('payout',1000,P,T),paid=receipt(q,{status:'paid'});await rpc('rr_test_record_settlement',[S,P,paid]);const before=await ledger();const conflict=await rpc('rr_test_record_settlement',[S,P,{...paid,status:'pending',checkedAt:Date.now()}]);assert.equal(conflict.status,'paid');assert.equal(conflict.needsReview,true);assert.deepEqual(await ledger(),before);
});
test('browser roles cannot read or invoke settlement authority, and foreign participants cannot create or inspect requests',async()=>{
 for(const table of ['settlement_sim_bindings','settlement_sim_requests','settlement_sim_receipts','settlement_sim_ledger'])assert.equal((await db.query("select relrowsecurity from pg_class where oid=('rr_sandbox.'||$1)::regclass",[table])).rows[0].relrowsecurity,true);
 await assert.rejects(rpc('rr_test_settlement_context',[X,O]),/participant/);await assert.rejects(rpc('rr_test_prepare_settlement',[X,O,T,'transfer',1900,null]),/participant/);
 await db.exec('set role authenticated');try{await assert.rejects(db.query('select * from rr_sandbox.settlement_sim_requests'),/permission denied/);await assert.rejects(rpc('rr_test_settlement_context',[S,O]),/permission denied/);}finally{await db.exec('reset role');}
 const grants=(await db.query("select grantee from information_schema.routine_privileges where routine_name like 'rr_test_%settlement%'")).rows;assert.ok(!grants.some(r=>['PUBLIC','anon','authenticated'].includes(r.grantee)));
});
test('simulation request bindings, audit and confirmed receipts cannot be rewritten or removed',async()=>{
 await transfer();await assert.rejects(db.query('update rr_sandbox.settlement_sim_requests set amount_cents=1899 where id=$1',[T]),/immutable/);
 await assert.rejects(db.query("update rr_sandbox.settlement_sim_requests set phase='prepared',provider_id=null,dispatched_at=null where id=$1",[T]),/immutable/);
 for(const table of ['settlement_sim_requests','settlement_sim_receipts','settlement_sim_ledger'])await assert.rejects(db.query('delete from rr_sandbox.'+table),/immutable/);
 await rpc('rr_test_hold_settlement',[S,T,'provider_outcome_unknown']);const audit=(await db.query('select held_by,held_at,hold_reason from rr_sandbox.settlement_sim_requests where id=$1',[T])).rows[0];await rpc('rr_test_hold_settlement',[B,T,'provider_rejected']);assert.deepEqual((await db.query('select held_by,held_at,hold_reason from rr_sandbox.settlement_sim_requests where id=$1',[T])).rows[0],audit);
 await assert.rejects(db.query('update rr_sandbox.settlement_sim_requests set needs_review=false where id=$1',[T]),/immutable/);
 await assert.rejects(db.query('update rr_sandbox.settlement_sim_requests set simulation_only=false where id=$1',[T]),/check constraint/);
});
test('older payout observations cannot regress a newer paid receipt or double book a return',async()=>{
 await transfer();const q=await known('payout',1000,P,T),now=Date.now(),paid=receipt(q,{status:'paid',checkedAt:now});await rpc('rr_test_record_settlement',[S,P,paid]);const first=await ledger();const old=await rpc('rr_test_record_settlement',[S,P,{...paid,status:'pending',checkedAt:now-1000}]);assert.equal(old.status,'paid');assert.equal(old.needsReview,false);assert.deepEqual(await ledger(),first);
 await assert.rejects(rpc('rr_test_record_settlement',[S,P,{...paid,status:'failed',balanceTransactionId:null,failureBalanceTransactionId:'txn_return',failureCode:'account_closed',checkedAt:Date.now()}]),/Invalid sandbox/);
});
test('missing sample status cannot satisfy the explicit simulated delivery gate',async()=>{
 await db.query("update rr_sandbox.tracking_current set snapshot=snapshot-'status' where order_id=$1",[O]);assert.ok((await context()).blockers.includes('test_delivery_simulation_required'));await assert.rejects(prepare(),/evidence incomplete/);
});
test('racing app transfer dispatch and refund preparation/dispatch permit only one financial dispatch',async()=>{
 await prepare();const replies=await Promise.allSettled([
  rpc('rr_test_dispatch_settlement',[S,T]),
  (async()=>{await rpc('rr_test_prepare_refund',[R,O,S,3175]);return rpc('rr_test_dispatch_refund',[R,S]);})()
 ]);assert.equal(replies.filter(r=>r.status==='fulfilled'&&r.value.dispatch===true).length,1);assert.equal(replies.filter(r=>r.status==='rejected').length,1);
 const q=(await context()).attempts[0];if(q.phase==='dispatched')assert.ok((await context()).blockers.includes('settlement_reconciliation_required'));
 assert.equal((await db.query('select phase from rr_sandbox.refund_requests where id=$1',[R])).rows[0].phase,q.phase==='dispatched'?'prepared':'dispatched');
});
test('a refund prepared first blocks the prepared transfer while allowing the app refund dispatch',async()=>{
 await prepare();await rpc('rr_test_prepare_refund',[R,O,S,3175]);const result=await Promise.allSettled([rpc('rr_test_dispatch_settlement',[S,T]),rpc('rr_test_dispatch_refund',[R,S])]);assert.equal(result[0].status,'rejected');assert.equal(result[1].status,'fulfilled');assert.equal(result[1].value.dispatch,true);assert.equal((await context()).attempts[0].phase,'prepared');
});
test('app refund dispatch waits for a full confirmed reversal without blocking the approved recovery path',async()=>{
 await transfer();await rpc('rr_test_prepare_refund',[R,O,S,3175]);await assert.rejects(rpc('rr_test_dispatch_refund',[R,S]),/recovery or explicit funding review/);
 const q=await known('reversal',1900,Z,T);await rpc('rr_test_record_settlement',[S,Z,receipt(q)]);assert.equal((await rpc('rr_test_dispatch_refund',[R,S])).dispatch,true);
 await rpc('rr_test_process_refund_receipt',['evt_recoveredRefund','e'.repeat(64),'refund.created','re_recovered','pi_sim','ch_sim',3175,'usd','succeeded',Math.floor(Date.now()/1000),R]);assert.equal((await db.query('select refunded_cents from rr_sandbox.orders where id=$1',[O])).rows[0].refunded_cents,3175);assert.equal((await context()).attempts.every(q=>q.needsReview),true);
});
test('an external signed refund notice records truth during an unknown transfer and preserves a sticky source audit',async()=>{
 await prepare();await rpc('rr_test_dispatch_settlement',[S,T]);const args=['evt_externalRefund','f'.repeat(64),'refund.created','re_external','pi_sim','ch_sim',3175,'usd','succeeded',Math.floor(Date.now()/1000),null];await rpc('rr_test_process_refund_receipt',args);const c=await context(),q=c.attempts[0];assert.equal(q.phase,'dispatched');assert.equal(q.providerId,null);assert.equal(q.needsReview,true);assert.equal(q.holdReason,'provider_refund_notice');const original=(await db.query('select held_at,held_by from rr_sandbox.settlement_sim_requests where id=$1',[T])).rows[0];assert.equal(original.held_by,null);
 await rpc('rr_test_process_refund_receipt',args);await rpc('rr_test_hold_settlement',[S,T,'provider_outcome_unknown']);assert.deepEqual((await db.query('select held_at,held_by from rr_sandbox.settlement_sim_requests where id=$1',[T])).rows[0],original);assert.equal((await db.query('select refunded_cents from rr_sandbox.orders where id=$1',[O])).rows[0].refunded_cents,3175);assert.deepEqual(await ledger(),[]);
});
test('the original operator may explicitly dispatch the same prepared reversal after a signed refund notice while preserving all review holds',async()=>{
 await transfer();await prepare('reversal',1900,R,T);
 await rpc('rr_test_process_refund_receipt',['evt_preparedRecoveryRefund','9'.repeat(64),'refund.created','re_preparedRecovery','pi_sim','ch_sim',3175,'usd','succeeded',Math.floor(Date.now()/1000),null]);
 const audit=(await db.query('select held_at,held_by,hold_reason from rr_sandbox.settlement_sim_requests where id=$1',[R])).rows[0];assert.equal(audit.hold_reason,'provider_refund_notice');assert.equal(audit.held_by,null);
 await assert.rejects(prepare('reversal',1900,Z,T),/Parent funds allocated/);await assert.rejects(rpc('rr_test_dispatch_settlement',[B,R]),/Original simulation operator/);
 const claimed=await rpc('rr_test_dispatch_settlement',[S,R]);assert.equal(claimed.dispatch,true);assert.equal(claimed.request.requestId,R);assert.equal(claimed.request.needsReview,true);assert.equal((await rpc('rr_test_dispatch_settlement',[S,R])).dispatch,false);
 const q=await rpc('rr_test_save_settlement',[S,R,'trr_preparedRecovery']);await rpc('rr_test_record_settlement',[S,R,receipt(q)]);assert.equal((await rpc('rr_test_dispatch_settlement',[S,R])).dispatch,false);
 const c=await context();assert.equal(c.attempts.every(q=>q.needsReview),true);assert.equal(c.attempts.find(q=>q.requestId===R).status,'succeeded');assert.equal(c.releaseEnabled,false);assert.ok(c.blockers.includes('settlement_recovery_review_required'));assert.equal((await rpc('rr_test_protection_review',[S,O])).releaseEnabled,false);
 assert.deepEqual((await db.query('select held_at,held_by,hold_reason from rr_sandbox.settlement_sim_requests where id=$1',[R])).rows[0],audit);assert.equal((await db.query('select refunded_cents from rr_sandbox.orders where id=$1',[O])).rows[0].refunded_cents,3175);assert.equal((await ledger()).filter(r=>r.kind==='seller_transfer_recovery').length,1);
});
test('installing settlement simulation preserves historical 4% paid orders and their ordinary refund path',async()=>{
 const legacy=new PGlite(),call=(name,args)=>legacy.query('select public.'+name+'('+args.map((_,i)=>'$'+(i+1)).join(',')+') x',args).then(r=>r.rows[0].x);
 try{
  await legacy.exec('create role anon;create role authenticated;create role service_role;');const split=MIGRATIONS.indexOf('20261103_fee_policy_v2');for(const n of MIGRATIONS.slice(0,split))await legacy.exec(fs.readFileSync('supabase/test/'+n+'.sql','utf8'));
  await legacy.query("insert into rr_sandbox.catalog(id,seller_id,title,price_cents) values($1,$2,'Historical settlement fixture',2500)",[L,S]);await call('rr_test_claim_seller',[S]);await call('rr_test_save_seller',[S,'acct_legacySeller']);await call('rr_test_record_seller_protection',[S,'acct_legacySeller',true,Date.now()]);await call('rr_test_reserve',[O,L,B]);
  const snapshot={test:true,orderId:O,listingId:L,sellerId:S,currency:'USD',itemCents:2500,buyerFeeCents:100,shippingCents:500,taxCents:0,baseCents:3100,totalCents:3100};await call('rr_test_attach_checkout',[O,'cs_test_legacySettlement',snapshot,'taxcalc_legacy','a'.repeat(64),'b'.repeat(32),new Date(Date.now()+3600000).toISOString()]);await call('rr_test_process_payment_event',['evt_legacySettlement','a'.repeat(64),'checkout.session.completed',O,'cs_test_legacySettlement',3100,'usd',true,'pi_legacySettlement']);
  const before=(await legacy.query('select snapshot,buyer_fee_cents from rr_sandbox.orders where id=$1',[O])).rows[0];for(const n of MIGRATIONS.slice(split))await legacy.exec(fs.readFileSync('supabase/test/'+n+'.sql','utf8'));assert.deepEqual((await legacy.query('select snapshot,buyer_fee_cents from rr_sandbox.orders where id=$1',[O])).rows[0],before);
  await call('rr_test_prepare_refund',[R,O,S,3100]);assert.equal((await call('rr_test_dispatch_refund',[R,S])).dispatch,true);await call('rr_test_process_refund_receipt',['evt_legacySettlementRefund','b'.repeat(64),'refund.created','re_legacySettlement','pi_legacySettlement','ch_legacySettlement',3100,'usd','succeeded',Math.floor(Date.now()/1000),R]);
  assert.equal((await legacy.query('select refunded_cents from rr_sandbox.orders where id=$1',[O])).rows[0].refunded_cents,3100);assert.equal(Number((await legacy.query('select sum(amount_cents) n from rr_sandbox.ledger_entries where order_id=$1',[O])).rows[0].n),0);assert.equal((await legacy.query('select count(*)::int n from rr_sandbox.settlement_sim_requests')).rows[0].n,0);
 }finally{await legacy.close();}
});
test('retaining the immutable accepted maximum prevents later within-cap cost increases from overfunding a dispatched transfer',async()=>{
 const q=await known();assert.equal(q.amountCents,1900);const cost=(await db.query("select evidence from rr_sandbox.seller_cost_allocations where order_id=$1 and kind='payout'",[O])).rows[0].evidence;
 await rpc('rr_test_record_seller_cost',[S,O,{...cost,amountCents:190,sourceTotalCents:190,observedAt:Date.now()}]);assert.equal((await context()).maxTransferCents,1900);await rpc('rr_test_record_settlement',[S,T,receipt(q)]);
 const payout=await prepare('payout',1900,P,T);assert.equal(payout.amountCents+600,2500);assert.equal(payout.parentAmountCents,1900);assert.equal((await context()).attempts.find(q=>q.requestId===T).amountCents,1900);
});
test('replacing a reserved cost with a smaller confirmed receipt does not block the frozen parent payout or treat unused reserve as profit',async()=>{
 await transfer();const cost=(await db.query("select evidence from rr_sandbox.seller_cost_allocations where order_id=$1 and kind='radar'",[O])).rows[0].evidence;
 await rpc('rr_test_record_seller_cost',[S,O,{...cost,phase:'confirmed',source:'provider_receipt',amountCents:5,sourceTotalCents:5,sourceReference:'invoice_screening:line',observedAt:Date.now()}]);assert.equal((await context()).maxTransferCents,1900);
 await prepare('payout',1900,P,T);assert.equal((await rpc('rr_test_dispatch_settlement',[S,P])).dispatch,true);assert.equal((await context()).attempts.find(q=>q.requestId===T).availableCents,0);assert.equal((await db.query("select amount_cents from rr_sandbox.ledger_entries where order_id=$1 and kind='buyer_fee_revenue'",[O])).rows[0].amount_cents,-175);
});
