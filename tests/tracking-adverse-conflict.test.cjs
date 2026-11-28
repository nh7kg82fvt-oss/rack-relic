'use strict';
// Disposable PGlite only. No native/provider/hosted acceptance or actual money.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const F=require('./helpers/tracking-adverse-fixture.cjs');
const proposal=fs.readFileSync(path.join(__dirname,'../supabase/proposals/tracking_adverse_conflict_guard.sql'),'utf8');
const signature='public.rr_test_record_tracking(uuid,uuid,jsonb)';
async function withFixture(run){await F.install();try{await F.seed({deliveryAgeMs:7*86400000});await run(F.getDb());}finally{await F.getDb()?.close();}}
async function saved(){return (await F.getDb().query('select snapshot,last_checked,provider_status,needs_review from rr_sandbox.tracking_current where order_id=$1',[F.orderId])).rows[0];}
async function observe(status,{eventAt,checkedAt,patch={}}={}){
 const current=await saved();return F.rpc('rr_test_record_tracking',[F.orderId,F.sellerId,{...current.snapshot,status,
  eventAt:eventAt??Number(current.snapshot.eventAt)-1000,checkedAt:checkedAt??Date.now(),...patch}]);
}
async function finances(){return (await F.getDb().query(`select jsonb_build_object(
 'orders',(select jsonb_agg(o order by id) from rr_sandbox.orders o),
 'catalog',(select jsonb_agg(c order by id) from rr_sandbox.catalog c),
 'ledger',(select jsonb_agg(l order by order_id,kind) from rr_sandbox.ledger_entries l),
 'jobs',(select jsonb_agg(j order by order_id,kind) from rr_sandbox.jobs j),
 'labels',(select jsonb_agg(l order by request_id) from rr_sandbox.label_attempts l),
 'settlement_requests',(select jsonb_agg(s order by id) from rr_sandbox.settlement_sim_requests s),
 'settlement_ledger',(select jsonb_agg(l order by request_id,kind) from rr_sandbox.settlement_sim_ledger l)) value`)).rows[0].value;}
test('baseline reproduces fresh backdated RETURNED omission; proposal correction holds settlement without altering accepted delivery or money',async()=>withFixture(async db=>{
 const before=await saved(),money=await finances();assert.deepEqual((await F.context()).blockers,[]);
 const baseline=await observe('RETURNED',{checkedAt:Date.now()+1});
 assert.equal(baseline.status,'DELIVERED');assert.equal(baseline.providerStatus,'DELIVERED');assert.equal(baseline.needsReview,false);
 assert.deepEqual((await F.context()).blockers,[]); // Latent source omission, no provider or release action.
 await db.exec(proposal);
 const held=await observe('RETURNED',{checkedAt:Date.now()+2});
 assert.equal(held.status,'DELIVERED');assert.equal(held.providerStatus,'RETURNED');assert.equal(held.needsReview,true);
 assert.deepEqual((await saved()).snapshot,before.snapshot);assert.equal(held.eventAt,before.snapshot.eventAt);
 const c=await F.context();assert.deepEqual(c.blockers,['test_delivery_simulation_required']);assert.equal(c.releaseEnabled,false);assert.equal(c.liveReady,false);
 await assert.rejects(F.rpc('rr_test_prepare_settlement',[F.sellerId,F.orderId,F.transferRequestId,'transfer',1900,null]),/release evidence incomplete/);
 assert.deepEqual(await finances(),money);assert.equal((await F.context()).attempts.length,0);
 const forbidden=(await db.query("select count(*)::int n from rr_sandbox.jobs where kind in ('seller_transfer','seller_payout') and state<>'held'")).rows[0].n;assert.equal(forbidden,0);
}));
test('fresh backdated FAILURE is sticky through later positive and duplicate observations, with original delivery timestamp retained',async()=>withFixture(async db=>{
 await db.exec(proposal);const before=await saved(),checked=Date.now()+10;
 const failure=await observe('FAILURE',{checkedAt:checked});assert.equal(failure.needsReview,true);assert.equal(failure.providerStatus,'FAILURE');
 const repeat=await observe('FAILURE',{checkedAt:checked+1});assert.equal(repeat.needsReview,true);
 const positive=await observe('DELIVERED',{eventAt:Number(before.snapshot.eventAt)+1000,checkedAt:checked+2});
 assert.equal(positive.needsReview,true);assert.equal(positive.status,'DELIVERED');assert.equal(positive.eventAt,before.snapshot.eventAt);
 assert.deepEqual((await saved()).snapshot,before.snapshot);assert.deepEqual((await F.context()).blockers,['test_delivery_simulation_required']);
 const n=(await db.query('select count(*)::int n from rr_sandbox.tracking_observations')).rows[0].n;assert.equal(n,3); // Original + one deduplicated FAILURE + positive conflict.
}));
test('old checkedAt and fresh older nonadverse TRANSIT remain nonregressing, while unbound input cannot set a hold',async()=>withFixture(async db=>{
 await db.exec(proposal);const before=await saved(),checked=new Date(before.last_checked).getTime();
 const stale=await observe('RETURNED',{checkedAt:checked-1});assert.equal(stale.needsReview,false);assert.equal(stale.providerStatus,'DELIVERED');assert.equal(stale.checkedAt,checked);
 const transit=await observe('TRANSIT',{checkedAt:checked+1});assert.equal(transit.needsReview,false);assert.equal(transit.status,'DELIVERED');assert.equal(transit.checkedAt,checked);
 await assert.rejects(observe('FAILURE',{checkedAt:checked+2,patch:{transactionId:'e'.repeat(32)}}),/Tracking identity mismatch/);
 assert.deepEqual((await saved()).snapshot,before.snapshot);assert.deepEqual((await F.context()).blockers,[]);
}));
test('one existing routine body changes; OID, non-body attributes, other definitions, permissions and RLS remain exact',async()=>withFixture(async db=>{
 const attrs=async()=> (await db.query("select to_jsonb(p)-'prosrc' value from pg_proc p where p.oid=$1::regprocedure",[signature])).rows[0].value;
 const other=async()=> (await db.query("select md5(string_agg(pg_get_functiondef(p.oid)||coalesce(p.proacl::text,'')||coalesce(p.proconfig::text,'')||p.proowner::text,E'\\n' order by p.oid)) hash from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','rr_sandbox') and p.prokind='f' and p.oid<>$1::regprocedure",[signature])).rows[0].hash;
 const a=await attrs(),o=await other(),money=await finances();await db.exec(proposal);assert.deepEqual(await attrs(),a);assert.equal(await other(),o);assert.deepEqual(await finances(),money);
 for(const role of ['anon','authenticated'])assert.equal((await db.query("select has_function_privilege($1,$2,'EXECUTE') yes",[role,signature])).rows[0].yes,false);
 assert.equal((await db.query("select has_function_privilege('service_role',$1,'EXECUTE') yes",[signature])).rows[0].yes,true);
 for(const name of ['tracking_current','tracking_observations'])assert.equal((await db.query("select relrowsecurity yes from pg_class where oid=$1::regclass",['rr_sandbox.'+name])).rows[0].yes,true);
 assert.equal((proposal.match(/create or replace function /gi)||[]).length,1);
 assert.equal(/\b(?:grant|revoke|alter table|create table|truncate|delete from)\b/i.test(proposal),false);
}));
test('fresh backdated RETURNED or FAILURE is sticky for every accepted status and later DELIVERED cannot clear it',async t=>{
 for(const initial of ['UNKNOWN','PRE_TRANSIT','TRANSIT','DELIVERED','RETURNED','FAILURE'])for(const adverse of ['RETURNED','FAILURE']){
  await F.install();try{
   await F.seed({deliveryAgeMs:7*86400000,trackingStatus:initial});const db=F.getDb();await db.exec(proposal);
   const before=await saved(),money=await finances(),checked=Date.now()+10;
   const held=await observe(adverse,{checkedAt:checked});
   assert.equal(held.needsReview,true,initial+' -> '+adverse);assert.equal(held.status,initial);assert.equal(held.providerStatus,adverse);
   assert.deepEqual((await saved()).snapshot,before.snapshot);
   const later=await observe('DELIVERED',{eventAt:Number(before.snapshot.eventAt)+1000,checkedAt:checked+1});
   assert.equal(later.needsReview,true);assert.equal(later.status,initial);assert.equal(later.providerStatus,'DELIVERED');
   assert.deepEqual((await saved()).snapshot,before.snapshot);
   const c=await F.context();assert.deepEqual(c.blockers,['test_delivery_simulation_required']);assert.equal(c.releaseEnabled,false);assert.equal(c.liveReady,false);
   await assert.rejects(F.rpc('rr_test_prepare_settlement',[F.sellerId,F.orderId,F.transferRequestId,'transfer',1900,null]),/release evidence incomplete/);
   assert.deepEqual(await finances(),money);assert.equal(c.attempts.length,0);
  }finally{await F.getDb()?.close();}
 }
 t.diagnostic('All six accepted statuses × both adverse statuses preserve the independent hold; no provider or release action.');
});
