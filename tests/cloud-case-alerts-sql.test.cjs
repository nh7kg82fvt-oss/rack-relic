'use strict';
const {test,before,after,beforeEach}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),{PGlite}=require('@electric-sql/pglite');
const S='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222',L='33333333-3333-4333-8333-333333333333',O='44444444-4444-4444-8444-444444444444',W='55555555-5555-4555-8555-555555555555',X='66666666-6666-4666-8666-666666666666';
const migrations=['20261030_order_ledger','20261030_payment_recovery','20261030_checkout_attempts','20261030_refund_receipts','20261030_refund_requests','20261030_checkout_quote_limits','20261030_checkout_quote_refresh','20261031_cancel_preparation','20261031_refund_review','20261031_charge_fee_evidence','20261031_fulfillment_snapshots','20261031_label_attempts','20261031_tracking_observations','20261102_seller_onboarding','20261102_order_issues','20261102_order_issues_review','20261102_order_issues_thread','20261102_order_issues_review_refunds','20261103_seller_protections','20261103_provider_risk_holds','20261103_startup_policy'];
const migration=fs.readFileSync('supabase/test/20261103_cloud_case_alerts.sql','utf8');
let db,stamp;const rpc=(name,args=[],target=db)=>target.query('select public.'+name+'('+args.map((_,i)=>'$'+(i+1)).join(',')+') x',args).then(r=>r.rows[0].x);
async function install(target){await target.exec('create role anon;create role authenticated;create role service_role;');for(const name of migrations)await target.exec(fs.readFileSync('supabase/test/'+name+'.sql','utf8'));}
async function paid(target=db){
 await target.query("insert into rr_sandbox.catalog(id,seller_id,title,price_cents) values($1,$2,'Synthetic case jacket',2500)",[L,S]);
 await rpc('rr_test_claim_seller',[S],target);await rpc('rr_test_save_seller',[S,'acct_caseSeller'],target);await rpc('rr_test_record_seller_protection',[S,'acct_caseSeller',true,Date.now()],target);
 await rpc('rr_test_reserve',[O,L,B],target);
 const snapshot={test:true,orderId:O,listingId:L,sellerId:S,currency:'USD',baseCents:3100,itemCents:2500,buyerFeeCents:100,shippingCents:500,taxCents:0,totalCents:3100};
 await rpc('rr_test_attach_checkout',[O,'cs_test_case',snapshot,'taxcalc_case','a'.repeat(64),'b'.repeat(32),new Date(Date.now()+3600000).toISOString()],target);
 await rpc('rr_test_process_payment_event',['evt_payment','a'.repeat(64),'checkout.session.completed',O,'cs_test_case',3100,'usd',true,'pi_case'],target);
}
function notice(patch={}){const n={event:'evt_notice',type:'charge.dispute.created',caseId:'du_case',status:'needs_response',due:stamp+172800,created:stamp,...patch};return [n.event,'b'.repeat(64),n.type,n.caseId,'ch_case','pi_case',3100,'usd',n.status,n.due,n.created];}
const ingest=(patch={},target=db)=>rpc('rr_test_process_risk_notice',notice(patch),target),queue=()=>rpc('rr_test_case_alert_queue',[25]);
const claim=(worker=W,limit=10)=>rpc('rr_test_claim_case_alerts',[worker,limit]);
const finish=(a,outcome='delivered',reference='msg_confirmed')=>rpc('rr_test_finish_case_alert',[a.alertId,W,a.leaseToken,outcome,reference]);
const count=()=>db.query('select count(*)::int n from rr_sandbox.case_alert_outbox').then(r=>r.rows[0].n);
before(async()=>{db=new PGlite();await install(db);await db.exec(migration);});after(async()=>db?.close());
beforeEach(async()=>{await db.exec('truncate rr_sandbox.catalog cascade;truncate rr_sandbox.seller_accounts cascade;');stamp=Math.floor(Date.now()/1000)-5;await paid();});

test('verified notice creates one minimal case-change alert; replay and identical newer evidence do not duplicate it',async()=>{
 await ingest();await ingest();await ingest({event:'evt_same',type:'charge.dispute.updated',created:stamp+1});
 const q=await queue();assert.equal(q.test,true);assert.equal(q.cloudReady,false);assert.equal(q.releaseEnabled,false);assert.equal(q.cases.length,1);assert.equal(q.cases[0].generation,1);assert.equal(q.cases[0].amountCents,3100);assert.equal(q.cases[0].holdRequired,true);assert.equal(await count(),1);
 const serialized=JSON.stringify(q);for(const omitted of ['ch_case','pi_case','payload_hash','seller_id','buyer_id','email','address','secret'])assert.equal(serialized.includes(omitted),false);
 await assert.rejects(rpc('rr_test_process_risk_notice',[...notice({event:'evt_bad'}).slice(0,1),'invalid',...notice().slice(2)]));assert.equal(await count(),1);
});
test('older provider notices cannot replace current status or deadline; equal-time conflicts preserve earliest action',async()=>{
 await ingest();await ingest({event:'evt_old',type:'charge.dispute.closed',status:'won',due:null,created:stamp-1});
 let c=(await queue()).cases[0];assert.equal(c.status,'needs_response');assert.equal(c.generation,1);assert.equal(c.requiresResponse,true);
 await ingest({event:'evt_conflict',type:'charge.dispute.updated',status:'under_review',due:stamp+3600});
 c=(await queue()).cases[0];assert.equal(c.status,'conflicting_evidence');assert.equal(c.evidenceConflict,true);assert.equal(c.requiresResponse,true);assert.equal(new Date(c.dueBy).getTime(),(stamp+3600)*1000);assert.equal(c.generation,2);
 await ingest({event:'evt_conflictAgain',type:'charge.dispute.updated',status:'under_review',due:stamp+3600});assert.equal(await count(),2);
 assert.equal((await db.query('select risk_status from rr_sandbox.orders where id=$1',[O])).rows[0].risk_status,'blocked');
});
test('equivalent provider evidence is not a new case generation when the database session timezone changes',async()=>{
 await ingest();await db.exec("set time zone 'America/Los_Angeles'");try{await ingest({event:'evt_otherTimezone',type:'charge.dispute.updated',created:stamp+1});assert.equal((await queue()).cases[0].generation,1);assert.equal(await count(),1);}finally{await db.exec("set time zone 'UTC'");}
});
test('new provider evidence supersedes unsent stale alerts but never clears the order hold',async()=>{
 await ingest();const a=(await claim()).alerts[0];assert.equal((await rpc('rr_test_case_alert_authority',[a.alertId,W,a.leaseToken])).allowed,true);
 await ingest({event:'evt_updated',type:'charge.dispute.updated',created:stamp+1,due:stamp+3600});
 assert.equal((await rpc('rr_test_case_alert_authority',[a.alertId,W,a.leaseToken])).allowed,false);
 const next=(await claim()).alerts;assert.equal(next.length,1);assert.equal(next[0].case.generation,2);assert.equal(next[0].severity,2);
 // A late known transport confirmation is still audit evidence for the older
 // alert; it cannot change the latest provider case or authorize another send.
 assert.equal((await finish(a)).state,'delivered');assert.equal((await queue()).cases[0].generation,2);
 await ingest({event:'evt_won',type:'charge.dispute.closed',status:'won',due:null,created:stamp+2});
 const c=(await queue()).cases[0];assert.equal(c.providerDueBy,null);assert.equal(new Date(c.dueBy).getTime(),(stamp+3600)*1000);assert.equal(c.deadlineReviewRequired,true);assert.equal(c.requiresResponse,false);
 assert.equal((await db.query('select risk_status from rr_sandbox.orders where id=$1',[O])).rows[0].risk_status,'blocked');
});
test('minimal queue bounds are enforced and browser roles cannot read or operate cloud worker state',async()=>{
 await ingest();await ingest({event:'evt_second',caseId:'du_second'});
 assert.equal((await rpc('rr_test_case_alert_queue',[1])).hasMore,true);
 for(const limit of [null,0,51])await assert.rejects(rpc('rr_test_case_alert_queue',[limit]));
 for(const role of ['anon','authenticated']){
  await db.exec('set role '+role);try{
   await assert.rejects(db.query('select * from rr_sandbox.case_alert_outbox'));
   await assert.rejects(queue());await assert.rejects(claim());
  }finally{await db.exec('reset role');}
 }
 await db.exec('set role service_role');try{assert.equal((await queue()).cases.length,2);await assert.rejects(db.query('select * from rr_sandbox.case_alert_heads'));}finally{await db.exec('reset role');}
 const tables=(await db.query("select relrowsecurity from pg_class where oid in ('rr_sandbox.case_alert_heads'::regclass,'rr_sandbox.case_alert_outbox'::regclass,'rr_sandbox.case_alert_delivery_audit'::regclass)")).rows;assert.equal(tables.length,3);assert.ok(tables.every(r=>r.relrowsecurity));
});
test('concurrent workers claim one durable lease and cannot forge another worker or token',async()=>{
 await ingest();const r=await Promise.all([claim(),claim(X)]),alerts=r.flatMap(x=>x.alerts);assert.equal(alerts.length,1);const a=alerts[0];assert.equal(a.attempt,1);assert.equal(a.deliveryKey,'rr_test_case_alert_'+a.alertId);
 assert.equal((await rpc('rr_test_case_alert_authority',[a.alertId,X,a.leaseToken])).allowed,false);await assert.rejects(rpc('rr_test_finish_case_alert',[a.alertId,X,a.leaseToken,'delivered','msg_foreign']),/Matching alert lease/);
 assert.equal((await rpc('rr_test_case_alert_authority',[a.alertId,W,X])).allowed,false);await assert.rejects(rpc('rr_test_finish_case_alert',[a.alertId,W,X,'delivered','msg_foreign']),/Matching alert lease/);
});
test('delivered confirmation requires an opaque reference; retries preserve receipt and conflicts stop automatic retry',async()=>{
 await ingest();const a=(await claim()).alerts[0];for(const ref of [null,'1234567890123456','private@example.com','https://provider.test/message'])await assert.rejects(finish(a,'delivered',ref),/Minimal delivery outcome/);
 assert.equal((await finish(a)).state,'delivered');assert.equal((await finish(a)).duplicate,true);assert.equal((await db.query('select count(*)::int n from rr_sandbox.case_alert_delivery_audit')).rows[0].n,1);
 assert.equal((await finish(a,'temporary_failure',null)).state,'unknown');assert.equal((await queue()).cases[0].delivery.unknown,1);assert.equal((await claim()).alerts.length,0);
});
test('confirmed temporary failures back off, have stable delivery keys, and exhaust after five attempts',async()=>{
 await ingest();let previous;
 for(let attempt=1;attempt<=5;attempt++){
  const a=(await claim()).alerts[0];assert.equal(a.attempt,attempt);if(previous){assert.equal(a.deliveryKey,previous.deliveryKey);assert.notEqual(a.leaseToken,previous.leaseToken);await assert.rejects(finish(previous),/Matching alert lease/);}
  const r=await finish(a,'temporary_failure',null);assert.equal(r.state,attempt===5?'exhausted':'pending');assert.equal((await claim()).alerts.length,0);
  // Simulate passage of the retry delay without injecting a caller clock.
  if(attempt<5)await db.exec("update rr_sandbox.case_alert_outbox set next_attempt_at=clock_timestamp()-interval '1 second'");previous=a;
 }
 assert.equal((await queue()).cases[0].delivery.exhausted,1);assert.equal((await db.query('select count(*)::int n from rr_sandbox.case_alert_delivery_audit')).rows[0].n,5);
});
test('ambiguous sends and expired leases remain visible for reconciliation instead of sending a replacement',async()=>{
 await ingest();const a=(await claim()).alerts[0];await finish(a,'outcome_unknown',null);assert.equal((await claim()).alerts.length,0);assert.equal((await queue()).delivery.unknown,1);
 await ingest({event:'evt_other',caseId:'du_other'});const b=(await claim()).alerts[0];
 await db.query("update rr_sandbox.case_alert_outbox set leased_until=clock_timestamp()-interval '1 second' where id=$1",[b.alertId]);
 assert.equal((await claim()).alerts.length,0);assert.equal((await queue()).delivery.unknown,2);assert.equal((await rpc('rr_test_case_alert_authority',[b.alertId,W,b.leaseToken])).allowed,false);
 assert.equal((await finish(b,'delivered','msg_lateKnown')).state,'delivered');assert.equal((await queue()).delivery.unknown,1);
});
test('verified read-only reconciliation can confirm an unknown original delivery, but a receipt cannot bind two alerts',async()=>{
 await ingest();const a=(await claim()).alerts[0];await finish(a,'outcome_unknown','msg_original');assert.equal((await finish(a,'delivered','msg_original')).state,'delivered');assert.equal((await finish(a,'delivered','msg_original')).duplicate,true);
 await ingest({event:'evt_otherReceipt',caseId:'du_otherReceipt'});const b=(await claim()).alerts[0];await assert.rejects(finish(b,'delivered','msg_original'),/unique/);assert.equal((await queue()).cases.find(c=>c.caseId==='du_otherReceipt').delivery.pending,1);
});
test('an unknown earlier delivery never suppresses a stronger deadline escalation and replay cannot multiply it',async()=>{
 await ingest({due:stamp+7200});const a=(await claim()).alerts[0];assert.equal(a.severity,2);await finish(a,'outcome_unknown',null);
 // Simulate the later deadline boundary with trusted database fixture state.
 await db.exec("update rr_sandbox.case_alert_heads set due_by=clock_timestamp()-interval '1 minute'");
 const b=(await claim()).alerts[0];assert.equal(b.kind,'deadline');assert.equal(b.severity,3);assert.equal(b.case.caseId,'du_case');assert.equal((await claim()).alerts.length,0);assert.equal((await queue()).cases[0].delivery.unknown,1);assert.equal(await count(),2);
});
test('a stronger deadline warning revokes an unsent weaker lease and changing deadline evidence freezes old authority',async()=>{
 await ingest({due:stamp+82800});const a=(await claim()).alerts[0];assert.equal(a.severity,1);
 await db.exec("update rr_sandbox.case_alert_heads set due_by=clock_timestamp()+interval '3 hours'");const b=(await claim()).alerts[0];assert.equal(b.severity,2);assert.equal((await rpc('rr_test_case_alert_authority',[a.alertId,W,a.leaseToken])).allowed,false);
 await ingest({event:'evt_deadlineChanged',type:'charge.dispute.updated',created:stamp+1,due:stamp+345600});
 assert.equal((await rpc('rr_test_case_alert_authority',[b.alertId,W,b.leaseToken])).allowed,false);const updated=(await claim()).alerts[0];assert.equal(updated.case.generation,2);assert.equal(updated.severity,2);assert.equal(updated.case.deadlineReviewRequired,true);assert.ok(new Date(updated.case.dueBy)<new Date(updated.case.providerDueBy));
});
test('bounded deadline refresh advances beyond already escalated cases instead of starving later cases',async()=>{
 for(let i=0;i<101;i++)await ingest({event:'evt_bulk'+i,caseId:'du_bulk'+i});
 await db.exec("update rr_sandbox.case_alert_heads set due_by=clock_timestamp()-interval '1 minute'");
 await claim();await claim();
 assert.equal((await db.query("select count(*)::int n from rr_sandbox.case_alert_outbox where kind='deadline' and severity=3")).rows[0].n,101);
 const ids=[];let cursor=null;do{const page=await rpc('rr_test_case_alert_queue',[50,cursor]);ids.push(...page.cases.map(c=>c.caseId));cursor=page.nextCaseCursor;if(!page.hasMore)break;}while(cursor);
 assert.equal(ids.length,101);assert.equal(new Set(ids).size,101);assert.equal(cursor,null);await assert.rejects(rpc('rr_test_case_alert_queue',[25,'private@example.com']));
});
test('early fraud warning has no invented amount or response deadline and stays a review alert',async()=>{
 await rpc('rr_test_process_risk_notice',['evt_warning','c'.repeat(64),'radar.early_fraud_warning.created','issfr_case','ch_case','pi_case',null,null,'warning_received',null,stamp]);
 const c=(await queue()).cases[0];assert.equal(c.kind,'early_fraud_warning');assert.equal(c.amountCents,null);assert.equal(c.currency,null);assert.equal(c.dueBy,null);assert.equal(c.requiresResponse,false);assert.equal((await claim()).alerts[0].severity,0);
});
test('queue, deadline and delivery workers cannot mutate orders, financial ledger, inventory or ordinary jobs',async()=>{
 await ingest();const snapshot=async()=>{const rows={};for(const table of ['orders','catalog','ledger_entries','jobs'])rows[table]=(await db.query('select * from rr_sandbox.'+table+' order by 1')).rows;return rows;};
 const before=await snapshot();const a=(await claim()).alerts[0];await rpc('rr_test_case_alert_authority',[a.alertId,W,a.leaseToken]);await finish(a);await queue();await claim();assert.deepEqual(await snapshot(),before);
 for(const kind of ['seller_transfer','seller_payout'])await assert.rejects(db.query("insert into rr_sandbox.jobs(order_id,kind,state) values($1,$2,'pending')",[O,kind]),/release disabled/);
});
test('installing the addition preserves and backfills existing verified case history without replaying money',async()=>{
 const older=new PGlite();try{await install(older);await paid(older);await ingest({},older);const ledger=(await older.query('select * from rr_sandbox.ledger_entries order by 1')).rows;await older.exec(migration);const q=await rpc('rr_test_case_alert_queue',[25],older);assert.equal(q.cases.length,1);assert.equal(q.cases[0].generation,1);assert.deepEqual((await older.query('select * from rr_sandbox.ledger_entries order by 1')).rows,ledger);}finally{await older.close();}
});
