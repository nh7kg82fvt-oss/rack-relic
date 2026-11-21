// Disposable PGlite only. Fictional legacy base-schema fixture for exact queue proposal; not a hosted purchase or tax test.
'use strict';
const {test,before,after,beforeEach}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{PGlite}=require('@electric-sql/pglite');
const S='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222',L='33333333-3333-4333-8333-333333333333',O='44444444-4444-4444-8444-444444444444',W='55555555-5555-4555-8555-555555555555',X='66666666-6666-4666-8666-666666666666';
const migrations=['20261030_order_ledger','20261030_payment_recovery','20261030_checkout_attempts','20261030_refund_receipts','20261030_refund_requests','20261030_checkout_quote_limits','20261030_checkout_quote_refresh','20261031_cancel_preparation','20261031_refund_review','20261031_charge_fee_evidence','20261031_fulfillment_snapshots','20261031_label_attempts','20261031_tracking_observations','20261102_seller_onboarding','20261102_order_issues','20261102_order_issues_review','20261102_order_issues_thread','20261102_order_issues_review_refunds','20261103_seller_protections','20261103_provider_risk_holds','20261103_startup_policy'];
const migration=fs.readFileSync(path.join(__dirname,'../../../supabase/test/20261103_cloud_case_alerts.sql'),'utf8');
let db,stamp;const rpc=(name,args=[],target=db)=>target.query('select public.'+name+'('+args.map((_,i)=>'$'+(i+1)).join(',')+') x',args).then(r=>r.rows[0].x);
async function install(target){await target.exec('create role anon;create role authenticated;create role service_role;');for(const name of migrations)await target.exec(fs.readFileSync(path.join(__dirname,'../../../supabase/test/'+name+'.sql'),'utf8'));}
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
const {projectAlert}=require('../source/server/case_alert_worker.cjs');
let scoped,checked,expires;
async function makeScope(){
 const q=(await db.query('select * from rr_sandbox.case_alert_outbox order by id limit 1')).rows[0];
 const h=(await db.query('select * from rr_sandbox.case_alert_heads where case_id=$1',[q.case_id])).rows[0];
 const a={alertId:Number(q.id),deliveryKey:'rr_test_case_alert_'+q.id,leaseToken:W,leasedUntil:new Date(Date.now()+90000).toISOString(),attempt:1,kind:q.kind,severity:q.severity,case:q.snapshot};
 const p=projectAlert(a,Date.now());checked=Date.now();expires=checked+290000;
 return {version:'rr-case-alert-scope-v1',alertId:Number(q.id),caseId:q.case_id,orderId:O,generation:Number(q.generation),evidenceHash:h.evidence_hash,providerEventId:h.latest_event_id,providerPayloadHash:'b'.repeat(64),createdAfter:checked-10000,payloadHash:p.payloadHash,payloadJson:JSON.stringify(p.message)};
}
const exact=(s=scoped,w=W,c=checked,e=expires)=>rpc('rr_test_claim_enrolled_case_alert',[w,s,c,e]);
const authority=(a,s=scoped,w=W)=>rpc('rr_test_enrolled_case_alert_authority',[a.alertId,w,a.leaseToken,s,checked,expires]);
const row=async id=>(await db.query('select * from rr_sandbox.case_alert_outbox where id=$1',[id])).rows[0];
before(async()=>{db=new PGlite();await install(db);await db.exec(migration);await db.exec(fs.readFileSync(path.join(__dirname,'../../../supabase/proposals/urgent_alert_enrolled_scope.sql'),'utf8'));});
after(async()=>db?.close());
beforeEach(async()=>{await db.exec('truncate rr_sandbox.catalog cascade;truncate rr_sandbox.seller_accounts cascade;');stamp=Math.floor(Date.now()/1000)-5;await paid();await ingest();scoped=await makeScope();});

test('exact claim selects only approved row and returns original stable key, immutable body and ancestry',async()=>{
 await ingest({event:'evt_foreign',caseId:'du_foreign',due:stamp-30});
 const foreign=(await db.query("select * from rr_sandbox.case_alert_outbox where case_id='du_foreign'")).rows[0];
 const a=(await exact()).alerts[0];assert.equal(a.alertId,scoped.alertId);assert.equal(a.deliveryKey,'rr_test_case_alert_'+scoped.alertId);
 assert.equal(projectAlert(a,Date.now()).payloadHash,scoped.payloadHash);assert.equal(a.evidenceHash,scoped.evidenceHash);assert.equal(a.providerPayloadHash,scoped.providerPayloadHash);
 assert.equal((await authority(a)).allowed,true);assert.deepEqual(await row(foreign.id),foreign);
});
test('case/order/generation/evidence/event/raw-body/payload swaps cannot lease any row',async()=>{
 for(const [k,v] of Object.entries({alertId:scoped.alertId+1,caseId:'du_foreign',orderId:B,generation:2,evidenceHash:'0'.repeat(32),providerEventId:'evt_foreign',providerPayloadHash:'0'.repeat(64),payloadHash:'0'.repeat(64),payloadJson:'{}'}))assert.equal((await exact({...scoped,[k]:v})).alerts.length,0,k);
 assert.equal((await row(scoped.alertId)).attempts,0);
});
test('missing, null and extra scope fields cannot mint authority',async()=>{
 for(const key of Object.keys(scoped)){const s={...scoped};delete s[key];assert.equal((await exact(s)).alerts.length,0,key);assert.equal((await exact({...scoped,[key]:null})).alerts.length,0,key);}
 assert.equal((await exact({...scoped,approved:true})).alerts.length,0);assert.equal((await row(scoped.alertId)).attempts,0);
});
test('new enrollment cannot consume an old delivered/manual rehearsal fixture or old row',async()=>{
 assert.equal((await exact({...scoped,caseId:'issfr_RackOwnerAlertRehearsal'})).alerts.length,0);
 assert.equal((await exact({...scoped,orderId:'a11e4700-0000-4000-8000-000000000002'})).alerts.length,0);
 assert.equal((await exact({...scoped,createdAfter:checked+1})).alerts.length,0);
 await db.query("update rr_sandbox.case_alert_outbox set created_at=clock_timestamp()-interval '1 day' where id=$1",[scoped.alertId]);
 assert.equal((await exact()).alerts.length,0);
});
test('expired/future/long enrollment and manual worker cannot claim',async()=>{
 for(const [w,c,e] of [[W,checked,checked-1],[W,checked+10000,checked+20000],[W,checked,checked+300001],['a11e4700-0000-4000-8000-000000000001',checked,expires],[null,checked,expires]])assert.equal((await exact(scoped,w,c,e)).alerts.length,0);
 assert.equal((await row(scoped.alertId)).attempts,0);
});
test('PGlite overlapping submissions serialize to one lease; committed loss/restart never reclaims',async()=>{
 const replies=await Promise.all([exact(),exact(scoped,X),exact()]);const all=replies.flatMap(r=>r.alerts);assert.equal(all.length,1);
 assert.equal((await exact()).alerts.length,0);assert.equal((await row(scoped.alertId)).attempts,1);
 assert.equal((await authority(all[0],scoped,X)).allowed,false);
});
test('rollback restores uncommitted claim; commit creates durable no-reclaim barrier',async()=>{
 await db.exec('begin');const a=(await exact()).alerts[0];await db.exec('rollback');assert.equal((await row(scoped.alertId)).attempts,0);
 const b=(await exact()).alerts[0];assert.notEqual(a.leaseToken,b.leaseToken);assert.equal((await authority(a)).allowed,false);assert.equal((await authority(b)).allowed,true);
 assert.equal((await exact()).alerts.length,0);
});
test('all prior outcome/attempt states hold without resetting row or audit',async()=>{
 const a=(await exact()).alerts[0];await finish(a,'temporary_failure',null);
 await db.query("update rr_sandbox.case_alert_outbox set next_attempt_at=clock_timestamp()-interval '1 second' where id=$1",[a.alertId]);
 const before=await row(a.alertId);assert.equal(before.state,'pending');assert.equal((await exact()).alerts.length,0);assert.deepEqual(await row(a.alertId),before);
 for(const state of ['unknown','delivered','exhausted','superseded']){await db.query('update rr_sandbox.case_alert_outbox set state=$1 where id=$2',[state,a.alertId]);const held=await row(a.alertId);assert.equal((await exact()).alerts.length,0);assert.deepEqual(await row(a.alertId),held);}
});
test('expiry neither cleans a foreign expired lease nor refreshes global deadlines',async()=>{
 await ingest({event:'evt_foreign',caseId:'du_foreign'});const foreign=(await db.query("select id from rr_sandbox.case_alert_outbox where case_id='du_foreign'")).rows[0].id;
 await db.query("update rr_sandbox.case_alert_outbox set state='leased',attempts=1,worker_id=$1,lease_token=$1,leased_until=clock_timestamp()-interval '1 second' where id=$2",[X,foreign]);
 await db.query("update rr_sandbox.case_alert_heads set due_by=clock_timestamp()-interval '1 minute' where case_id='du_foreign'");
 const before=await row(foreign),n=await count();await exact();assert.deepEqual(await row(foreign),before);assert.equal(await count(),n);
 assert.equal((await db.query('select count(*)::int n from rr_sandbox.case_alert_delivery_audit')).rows[0].n,0);
});
test('changed generation and final outcome revoke already leased authority and cannot retarget enrollment',async()=>{
 const a=(await exact()).alerts[0];await ingest({event:'evt_won',type:'charge.dispute.closed',status:'won',due:null,created:stamp+1});
 assert.equal((await authority(a)).allowed,false);assert.equal((await exact()).alerts.length,0);
 const final=(await db.query("select * from rr_sandbox.case_alert_outbox where generation=2")).rows[0];
 const h=(await db.query('select * from rr_sandbox.case_alert_heads')).rows[0];
 assert.equal((await exact({...scoped,alertId:Number(final.id),generation:2,evidenceHash:h.evidence_hash,providerEventId:'evt_won'})).alerts.length,0);
 assert.equal((await db.query('select risk_status from rr_sandbox.orders where id=$1',[O])).rows[0].risk_status,'blocked');
});
test('changed raw ancestry and snapshot revoke authority even without a generation change',async()=>{
 const a=(await exact()).alerts[0];await db.query("update rr_sandbox.provider_events set payload_hash=$1 where id='evt_notice'",['0'.repeat(64)]);assert.equal((await authority(a)).allowed,false);
 await db.query("update rr_sandbox.provider_events set payload_hash=$1 where id='evt_notice'",['b'.repeat(64)]);
 await db.query("update rr_sandbox.case_alert_outbox set snapshot=snapshot||'{\"requiresResponse\":false}'::jsonb where id=$1",[a.alertId]);assert.equal((await authority(a)).allowed,false);
});
test('closed proposal grants neither browser nor service-role execution and preserves RLS',async()=>{
 for(const role of ['anon','authenticated','service_role']){await db.exec('set role '+role);try{await assert.rejects(exact(),/permission denied/);}finally{await db.exec('reset role');}}
 assert.equal((await db.query("select relrowsecurity from pg_class where oid='rr_sandbox.case_alert_outbox'::regclass")).rows[0].relrowsecurity,true);
});

async function wireHost(mode){
 const F=require('./fictional-fixture.cjs'),{createUrgentAlertHost}=require('../source/server/urgent_alert_edge_host.cjs');
 const x=F.fixture(),base=x.options.fetchImpl;x.state.now=checked;x.state.enrollment={...F.enrollment(checked),alertScope:scoped};let authorityCalls=0,totalCalls=0;
 const fetchImpl=async(url,init)=>{
  totalCalls++;const p=init.body?JSON.parse(init.body):{},name=url.split('/').at(-1);let result;
  if(name==='rr_test_process_risk_notice')result=await ingest();
  else if(name==='rr_test_claim_enrolled_case_alert')result=await exact(p.p_scope,p.p_worker,p.p_checked_at,p.p_expires_at);
  else if(name==='rr_test_enrolled_case_alert_authority'){
   if(++authorityCalls===2&&mode==='finality')await ingest({event:'evt_finalityWire',type:'charge.dispute.closed',status:'won',due:null,created:stamp+1});
   result=await rpc(name,[p.p_alert,p.p_worker,p.p_lease,p.p_scope,p.p_checked_at,p.p_expires_at]);
  }else if(name==='rr_test_finish_case_alert')result=await rpc(name,[p.p_alert,p.p_worker,p.p_lease,p.p_outcome,p.p_delivery_reference]);
  else {const r=await base(url,init);if(url==='https://api.resend.com/emails'&&mode==='lost')throw Error('fictional lost provider ACK');return r;}
  return F.response(result,url);
 };
 const receiverFactory=({fetchImpl})=>req=>fetchImpl(F.RISK,{method:'POST',redirect:'error',cache:'no-store',headers:{apikey:'sb_secret_fictional'},signal:req.signal,
  body:JSON.stringify({p_type:'charge.dispute.created',p_event:scoped.providerEventId,p_case:scoped.caseId,p_payload_hash:scoped.providerPayloadHash})});
 return {x,calls:()=>totalCalls,run:()=>createUrgentAlertHost({...x.options,receiverFactory,fetchImpl})(new Request('https://fixture.invalid/approved'))};
}
test('integrated JS host + exact SQL claim + original journal adapter send only one fixture after duplicate risk ACK',async()=>{
 const h=await wireHost();await h.run();assert.equal(h.x.state.emails.length,1);assert.equal(h.x.state.journal.state,'accepted');assert.equal(h.x.state.journal.delivered,false);
 assert.equal(h.calls(),20);await h.run();assert.equal(h.x.state.emails.length,1);assert.equal((await row(scoped.alertId)).attempts,1);
});
test('SQL finality observed between journal and email prevents send; no fresh-host retry grant',async()=>{
 const h=await wireHost('finality');await h.run();assert.equal(h.x.state.emails.length,0);assert.equal(h.x.state.journal.state,'unknown');
 await h.run();assert.equal(h.x.state.emails.length,0);assert.equal((await row(scoped.alertId)).attempts,1);
});
test('integrated lost email ACK persists SQL unknown and blocks another provider POST after restart',async()=>{
 const h=await wireHost('lost');await h.run();assert.equal(h.x.state.emails.length,1);assert.equal((await row(scoped.alertId)).state,'unknown');
 await h.run();assert.equal(h.x.state.emails.length,1);assert.equal(h.x.state.journal.state,'unknown');
});
