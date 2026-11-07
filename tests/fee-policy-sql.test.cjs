'use strict';
const {test,before,after}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {randomUUID}=require('node:crypto'),{PGlite}=require('@electric-sql/pglite');

const S='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222',X='33333333-3333-4333-8333-333333333333';
const V1='rr-fees-v1',V2='rr-fees-v2',migration='20261103_fee_policy_v2';
const baseMigrations=['20261030_order_ledger','20261030_payment_recovery','20261030_checkout_attempts','20261030_refund_receipts','20261030_refund_requests','20261030_checkout_quote_limits','20261030_checkout_quote_refresh'];
const protectionMigrations=['20261031_cancel_preparation','20261031_refund_review','20261031_charge_fee_evidence','20261031_fulfillment_snapshots','20261031_label_attempts','20261031_tracking_observations','20261102_seller_onboarding','20261102_order_issues','20261102_order_issues_review','20261102_order_issues_thread','20261102_order_issues_review_refunds','20261103_seller_protections','20261103_provider_risk_holds','20261103_startup_policy'];
const sql=n=>fs.readFileSync(path.join(__dirname,'../supabase/test',n+'.sql'),'utf8');
const rpcOn=(database,name,args)=>database.query('select public.'+name+'('+args.map((_,i)=>'$'+(i+1)).join(',')+') x',args).then(r=>r.rows[0].x);
let db,legacyPaid,legacyPrepared,legacyDispatched;
const rpc=(name,args)=>rpcOn(db,name,args);
const expires=()=>new Date(Date.now()+600000).toISOString();
async function listing(database=db,item=2500){const f={order:randomUUID(),listing:randomUUID(),item};await database.query("insert into rr_sandbox.catalog(id,seller_id,title,price_cents) values($1,$2,'Synthetic fee migration fixture',$3)",[f.listing,S,item]);return f;}
function quote(f,version){
 const fee=Math.floor((f.item*(version===V2?5:4)+50)/100)+(version===V2?50:0),base=f.item+fee+500;
 const snapshot={test:true,orderId:f.order,listingId:f.listing,sellerId:S,currency:'USD',itemCents:f.item,buyerFeeCents:fee,shippingCents:500,taxCents:327,baseCents:base,totalCents:base+327};
 const input={orderId:f.order,buyerId:B,listing:{id:f.listing,seller_id:S,price_cents:f.item},shippingQuote:{test:true,orderId:f.order,amountCents:500,destinationHash:'a'.repeat(64),rateId:'b'.repeat(32)},taxQuote:{test:true,orderId:f.order,baseCents:base,amountCents:327,destinationHash:'a'.repeat(64),taxCalculationId:'taxcalc_fixture'}};
 if(version){input.feePolicyVersion=version;snapshot.feePolicyVersion=version;}
 return {input,snapshot};
}
async function reserve(f){return rpc('rr_test_reserve',[f.order,f.listing,B]);}
async function prepare(f,q=quote(f,V2),buyer=B){return rpc('rr_test_prepare_checkout',[f.order,buyer,q.input,q.snapshot,expires()]);}
async function row(f){return (await db.query('select * from rr_sandbox.orders where id=$1',[f.order])).rows[0];}
async function attempt(f){return (await db.query('select * from rr_sandbox.checkout_attempts where order_id=$1',[f.order])).rows[0];}
async function attach(f,q,session){return rpc('rr_test_attach_checkout',[f.order,session,q.snapshot,'taxcalc_fixture','a'.repeat(64),'b'.repeat(32),expires()]);}

before(async()=>{
 db=new PGlite();await db.exec('create role anon;create role authenticated;create role service_role;');
 for(const n of baseMigrations)await db.exec(sql(n));
 legacyPaid=await listing();legacyPaid.quote=quote(legacyPaid);
 await reserve(legacyPaid);await attach(legacyPaid,legacyPaid.quote,'cs_test_legacyFee');
 await rpc('rr_test_process_payment_event',['evt_legacyFee','a'.repeat(64),'checkout.session.completed',legacyPaid.order,'cs_test_legacyFee',3427,'usd',true,'pi_legacyFee']);
 legacyPrepared=await listing();legacyPrepared.quote=quote(legacyPrepared);await reserve(legacyPrepared);await prepare(legacyPrepared,legacyPrepared.quote);legacyPrepared.saved=await attempt(legacyPrepared);
 legacyDispatched=await listing();legacyDispatched.quote=quote(legacyDispatched);await reserve(legacyDispatched);await prepare(legacyDispatched,legacyDispatched.quote);await rpc('rr_test_dispatch_checkout',[legacyDispatched.order,B]);legacyDispatched.saved=await attempt(legacyDispatched);
 await db.exec(sql(migration));
});
after(async()=>db?.close());

test('migration backfills only legacy policy metadata and replays preserve paid 4% snapshots',async()=>{
 const old=await row(legacyPaid);assert.equal(old.fee_policy_version,V1);assert.equal(old.buyer_fee_cents,100);assert.deepEqual(old.snapshot,legacyPaid.quote.snapshot);
 const replay=await reserve(legacyPaid);assert.equal(replay.fee_policy_version,V1);assert.equal(replay.buyer_fee_cents,100);assert.deepEqual(replay.snapshot,legacyPaid.quote.snapshot);
 const fees=(await db.query("select amount_cents from rr_sandbox.ledger_entries where order_id=$1 and kind='buyer_fee_revenue'",[legacyPaid.order])).rows;
 assert.deepEqual(fees,[{amount_cents:-100}]);
});

test('new reservations select 5% with half-up rounding plus fifty cents once per order',async()=>{
 for(const [item,fee] of [[100,55],[101,55],[109,55],[110,56],[2500,175],[3000,200]]){
  const f=await listing(db,item),saved=await reserve(f);assert.equal(saved.fee_policy_version,V2);assert.equal(saved.buyer_fee_cents,fee);assert.equal(saved.item_cents,item);
  const again=await reserve(f);assert.equal(again.buyer_fee_cents,fee);
 }
});

test('order policy, item and fee amounts are immutable even before a snapshot exists',async()=>{
 const f=await listing();await reserve(f);
 for(const update of ["fee_policy_version='rr-fees-v1',buyer_fee_cents=100","buyer_fee_cents=176","item_cents=2520,buyer_fee_cents=176"]){
  await assert.rejects(db.query('update rr_sandbox.orders set '+update+' where id=$1',[f.order]),/immutable/);
 }
 const old=await row(f);assert.equal(old.fee_policy_version,V2);assert.equal(old.item_cents,2500);assert.equal(old.buyer_fee_cents,175);
 await assert.rejects(db.query('update rr_sandbox.orders set snapshot=$2 where id=$1',[legacyPaid.order,{...legacyPaid.quote.snapshot,buyerFeeCents:175}]),/immutable/);
 await assert.rejects(db.query('update rr_sandbox.orders set snapshot=null where id=$1',[legacyPaid.order]),/immutable/);
 assert.deepEqual((await row(legacyPaid)).snapshot,legacyPaid.quote.snapshot);
});

test('legacy prepared and dispatched quotes keep their original evidence on recovery',async()=>{
 for(const f of [legacyPrepared,legacyDispatched]){
  const replay=await prepare(f,f.quote);assert.deepEqual(replay.input,f.saved.input);assert.deepEqual(replay.snapshot,f.saved.snapshot);assert.equal(replay.phase,f.saved.phase);
  const tagged=quote(f,V1);const again=await prepare(f,tagged);assert.deepEqual(again.snapshot,f.saved.snapshot);assert.deepEqual(again.input,f.saved.input);
  await assert.rejects(prepare(f,quote(f,V2)),/Fee policy version mismatch/);
  const current=await attempt(f);assert.deepEqual(current.input,f.saved.input);assert.deepEqual(current.snapshot,f.saved.snapshot);
 }
 await assert.rejects(db.query('update rr_sandbox.checkout_attempts set snapshot=$2 where order_id=$1',[legacyDispatched.order,{...legacyDispatched.quote.snapshot,extra:'replacement'}]),/immutable/);
 // A legacy dispatched provider result can still be attached after migration.
 await rpc('rr_test_save_checkout_session',[legacyDispatched.order,B,'cs_test_legacyRecovered',expires()]);
 const recovered=await rpc('rr_test_finish_checkout',[legacyDispatched.order,B]);assert.equal(recovered.fee_policy_version,V1);assert.deepEqual(recovered.snapshot,legacyDispatched.quote.snapshot);assert.equal(recovered.buyer_fee_cents,100);
});

test('v2 quote persistence requires matching explicit input and snapshot versions',async()=>{
 const f=await listing();await reserve(f);
 for(const field of ['input','snapshot'])for(const bad of [undefined,null,V1,'rr-fees-v3',2]){
  const q=quote(f,V2);if(bad===undefined)delete q[field].feePolicyVersion;else q[field].feePolicyVersion=bad;
  await assert.rejects(prepare(f,q),/Fee policy version/);assert.equal(await attempt(f),undefined);
 }
 const q=quote(f,V2),saved=await prepare(f,q);assert.deepEqual(saved.input,q.input);assert.deepEqual(saved.snapshot,q.snapshot);
 // A fresh first quote still cannot let a mismatched policy bypass the guard.
 await assert.rejects(prepare(f,quote(f,V1)),/Fee policy version mismatch/);assert.deepEqual((await attempt(f)).snapshot,q.snapshot);
});

test('a matching version label cannot disguise wrong cents and quote evidence stays bound',async()=>{
 const f=await listing();await reserve(f);
 const wrong=quote(f,V2);wrong.snapshot.buyerFeeCents=100;wrong.snapshot.baseCents-=75;wrong.snapshot.totalCents-=75;wrong.input.taxQuote.baseCents-=75;
 await assert.rejects(prepare(f,wrong),/amount mismatch/);
 const extra=quote(f,V2);extra.input.arbitraryBrowserData='untrusted';await assert.rejects(prepare(f,extra),/Unexpected checkout input/);
 const wrongBase=quote(f,V2);wrongBase.input.taxQuote.baseCents-=1;await assert.rejects(prepare(f,wrongBase),/quote evidence mismatch/);
 for(const bad of [quote(f),quote(f,V1),wrong])await assert.rejects(attach(f,bad,'cs_test_badFee'),/Fee policy|fee amounts|Snapshot amount mismatch/);
 for(const bad of [undefined,null,V1]){
  const q=quote(f,V2);if(bad===undefined)delete q.snapshot.feePolicyVersion;else q.snapshot.feePolicyVersion=bad;
  await assert.rejects(attach(f,q,'cs_test_badTag'),/Fee policy version/);
 }
 const good=quote(f,V2);await prepare(f,good);await rpc('rr_test_dispatch_checkout',[f.order,B]);
 await assert.rejects(db.query('update rr_sandbox.checkout_attempts set input=$2 where order_id=$1',[f.order,{...good.input,feePolicyVersion:V1}]),/immutable/);
 await rpc('rr_test_save_checkout_session',[f.order,B,'cs_test_newFee',expires()]);const attached=await rpc('rr_test_finish_checkout',[f.order,B]);assert.equal(attached.buyer_fee_cents,175);assert.deepEqual(attached.snapshot,good.snapshot);
});

test('unknown policy values and mathematically inconsistent direct inserts fail the versioned check',async()=>{
 const f=await listing();
 const insert=(version,fee)=>db.query("insert into rr_sandbox.orders(id,listing_id,buyer_id,seller_id,listing_version,listing_updated_at,item_cents,buyer_fee_cents,fee_policy_version,state) select $1,id,$3,seller_id,version,updated_at,price_cents,$4,$5,'reserved' from rr_sandbox.catalog where id=$2",[f.order,f.listing,B,fee,version]);
 for(const [version,fee] of [['rr-fees-v3',175],[V1,175],[V2,100],[V2,125],[null,175]])await assert.rejects(insert(version,fee),/constraint|null/);
 assert.equal(await row(f),undefined);
 // The default remains v1 for untagged historical import tooling, not the new
 // reserve API, so an additive migration never relabels old 4% documents.
 await db.query("insert into rr_sandbox.orders(id,listing_id,buyer_id,seller_id,listing_version,listing_updated_at,item_cents,buyer_fee_cents,state) select $1,id,$3,seller_id,version,updated_at,price_cents,100,'reserved' from rr_sandbox.catalog where id=$2",[f.order,f.listing,B]);
 assert.equal((await row(f)).fee_policy_version,V1);
});

test('wrong actors and null buyers cannot reserve, prepare, or replay another buyer order',async()=>{
 const f=await listing();await reserve(f);const q=quote(f,V2);
 for(const buyer of [X,S,null]){
  await assert.rejects(rpc('rr_test_reserve',[f.order,f.listing,buyer]));await assert.rejects(prepare(f,q,buyer),/Order unavailable/);
 }
 assert.equal(await attempt(f),undefined);assert.equal((await row(f)).buyer_fee_cents,175);
});

test('browser roles retain no ledger, quote, private helper, or fee RPC access',async()=>{
 const f=await listing();await reserve(f);
 for(const role of ['anon','authenticated']){
  await db.exec('set role '+role);
  try{
   await assert.rejects(reserve(f),/permission denied/);await assert.rejects(prepare(f),/permission denied/);
   await assert.rejects(db.query('select * from rr_sandbox.orders'),/permission denied/);
   await assert.rejects(db.query("select rr_sandbox.check_fee_policy_document('{}'::jsonb,'rr-fees-v1')"),/permission denied/);
  }finally{await db.exec('reset role');}
 }
});

test('historical payment replay and full refund use the frozen 4% total after migration',async()=>{
 const payment=['evt_legacyFee','a'.repeat(64),'checkout.session.completed',legacyPaid.order,'cs_test_legacyFee',3427,'usd',true,'pi_legacyFee'];
 assert.equal((await rpc('rr_test_process_payment_event',payment)).duplicate,true);
 const refund=['evt_legacyFeeRefund','b'.repeat(64),'refund.updated','re_legacyFee','pi_legacyFee','ch_legacyFee',3427,'usd','succeeded',Math.floor(Date.now()/1000)-1];
 assert.equal((await rpc('rr_test_process_refund',refund)).state,'refunded');assert.equal((await rpc('rr_test_process_refund',refund)).duplicate,true);
 const current=await row(legacyPaid);assert.equal(current.refunded_cents,3427);assert.equal(current.fee_policy_version,V1);assert.equal(current.buyer_fee_cents,100);assert.deepEqual(current.snapshot,legacyPaid.quote.snapshot);
 const ledger=(await db.query('select sum(amount_cents)::int balance,count(*)::int count from rr_sandbox.ledger_entries where order_id=$1',[legacyPaid.order])).rows[0];assert.deepEqual(ledger,{balance:0,count:7});
});

test('fee migration preserves existing startup, seller verification and money-release guards',async()=>{
 const protectedDb=new PGlite();
 try{
  await protectedDb.exec('create role anon;create role authenticated;create role service_role;');
  for(const n of [...baseMigrations,...protectionMigrations])await protectedDb.exec(sql(n));
  const before=(await protectedDb.query("select tgname from pg_trigger where not tgisinternal order by tgname")).rows.map(r=>r.tgname);
  await protectedDb.exec(sql(migration));
  const after=(await protectedDb.query("select tgname from pg_trigger where not tgisinternal order by tgname")).rows.map(r=>r.tgname);assert.ok(before.every(t=>after.includes(t)));
  const call=(name,args)=>rpcOn(protectedDb,name,args),f=await listing(protectedDb),second=await listing(protectedDb);
  await assert.rejects(call('rr_test_reserve',[f.order,f.listing,B]),/verification/);
  await call('rr_test_claim_seller',[S]);await call('rr_test_save_seller',[S,'acct_feeProtection']);await call('rr_test_record_seller_protection',[S,'acct_feeProtection',true,Date.now()]);
  const saved=await call('rr_test_reserve',[f.order,f.listing,B]);assert.equal(saved.buyer_fee_cents,175);
  await assert.rejects(call('rr_test_reserve',[second.order,second.listing,B]),/marketplace exposure/);
  const q=quote(f,V2);q.snapshot.shippingCents=10001-q.snapshot.itemCents-q.snapshot.buyerFeeCents;q.snapshot.taxCents=0;q.snapshot.totalCents=10001;
  await assert.rejects(call('rr_test_attach_checkout',[f.order,'cs_test_feeLimit',q.snapshot,'taxcalc_fixture','a'.repeat(64),'b'.repeat(32),expires()]),/Startup order limit/);
  await assert.rejects(protectedDb.query("insert into rr_sandbox.jobs(order_id,kind,state) values($1,'seller_transfer','pending')",[f.order]),/release disabled/);
  const source=(await protectedDb.query("select pg_get_functiondef('public.rr_test_reserve(uuid,uuid,uuid)'::regprocedure) source")).rows[0].source;assert.ok(source.indexOf('FROM catalog')<source.indexOf('FROM orders'));
 }finally{await protectedDb.close();}
});
