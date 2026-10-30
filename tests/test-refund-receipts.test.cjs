const {test,before,after,beforeEach}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
const {createHmac,createHash}=require('node:crypto');
const {verifyStripeTestEvent,stripeTestEventRpc}=require('../server/marketplace_test_checkout.cjs');
const {createTestOrderRepository}=require('../server/test_order_repository.cjs');
let db,counter;
const order='11111111-1111-4111-8111-111111111111',buyer='22222222-2222-4222-8222-222222222222',seller='33333333-3333-4333-8333-333333333333',listing='44444444-4444-4444-8444-444444444444';
const ts=Math.floor(Date.now()/1000)-100;
const snap={test:true,orderId:order,listingId:listing,sellerId:seller,currency:'USD',itemCents:2500,buyerFeeCents:100,shippingCents:500,taxCents:327,totalCents:3427};
const definitions={rr_test_process_payment_event:['p_event','p_payload_hash','p_type','p_order','p_session','p_amount','p_currency','p_paid','p_payment_intent'],rr_test_process_refund:['p_event','p_payload_hash','p_type','p_refund','p_payment_intent','p_charge','p_amount','p_currency','p_status','p_created']};
const rpc=async(name,p)=>(await db.query('select public.'+name+'('+definitions[name].map((_,i)=>'$'+(i+1)).join(',')+') as result',definitions[name].map(k=>p[k]))).rows[0].result;
before(async()=>{db=new PGlite();await db.exec('create role anon;create role authenticated;create role service_role;');for(const f of ['order_ledger','payment_recovery','checkout_attempts','refund_receipts'])await db.exec(fs.readFileSync(require.resolve('../supabase/test/20261030_'+f+'.sql'),'utf8'));});
after(async()=>{await db?.close();});
beforeEach(async()=>{
 counter=0;await db.exec('truncate rr_sandbox.catalog cascade');
 await db.query("insert into rr_sandbox.catalog(id,seller_id,title,price_cents) values($1,$2,'Synthetic jacket',2500)",[listing,seller]);
 await db.query('select public.rr_test_reserve($1,$2,$3)',[order,listing,buyer]);
 await db.query('select public.rr_test_attach_checkout($1,$2,$3,$4,$5,$6,$7)',[order,'cs_test_refund',JSON.stringify(snap),'taxcalc_fixture','a'.repeat(64),'b'.repeat(32),new Date(Date.now()+3600000).toISOString()]);
});
function payment(p={}){return rpc('rr_test_process_payment_event',{p_event:'evt_payment',p_payload_hash:'a'.repeat(64),p_type:'checkout.session.completed',p_order:order,p_session:'cs_test_refund',p_amount:3427,p_currency:'usd',p_paid:true,p_payment_intent:'pi_fixture',...p});}
function args(p={}){const n=++counter;return {p_event:'evt_refund'+n,p_payload_hash:createHash('sha256').update('event'+n).digest('hex'),p_type:'refund.updated',p_refund:'re_fixture',p_payment_intent:'pi_fixture',p_charge:'ch_fixture',p_amount:3427,p_currency:'usd',p_status:'succeeded',p_created:ts+n,...p};}
const refund=p=>rpc('rr_test_process_refund',args(p));
const current=async()=>(await db.query('select * from rr_sandbox.orders where id=$1',[order])).rows[0];
const ledger=async()=>(await db.query('select count(*)::int as count,sum(amount_cents)::int as balance from rr_sandbox.ledger_entries')).rows[0];
function signed(p={}){const e={id:'evt_signed',type:'refund.updated',livemode:false,created:ts,data:{object:{object:'refund',id:'re_fixture',charge:'ch_fixture',payment_intent:'pi_fixture',currency:'usd',amount:3427,status:'succeeded'}},...p};const raw=Buffer.from(JSON.stringify(e)),now=Math.floor(Date.now()/1000),signature='t='+now+',v1='+createHmac('sha256','whsec_fixture').update(now+'.').update(raw).digest('hex');return {rawBody:raw,signature,webhookSecret:'whsec_fixture'};}
function verify(p){const {rawBody,signature,webhookSecret}=signed(p);return verifyStripeTestEvent(rawBody,signature,{secret:webhookSecret});}

test('refunds cannot create order bindings; paid event must bind an exact non-null PaymentIntent',async()=>{
 await assert.rejects(refund(),/binding not yet/);
 await assert.rejects(payment({p_payment_intent:null}),/PaymentIntent required/);
 await assert.rejects(payment({p_payment_intent:'pi_bad/path'}),/PaymentIntent required/);
 await assert.rejects(payment({p_session:'cs_test_wrong'}),/mismatch/);
 assert.equal((await current()).payment_intent_id,null);
 await payment();await assert.rejects(payment({p_payment_intent:'pi_other'}),/PaymentIntent mismatch/);
 assert.equal((await current()).payment_intent_id,'pi_fixture');
});
test('full refund is counted once across event replay and different success events; sale stays held',async()=>{
 await payment();const p=args();await rpc('rr_test_process_refund',p);
 assert.equal((await rpc('rr_test_process_refund',p)).duplicate,true);
 await refund({p_created:p.p_created+1});
 const o=await current();assert.equal(o.refund_state,'refunded');assert.equal(o.refunded_cents,3427);assert.equal(o.state,'paid');assert.equal(o.risk_status,'review');
 assert.deepEqual(await ledger(),{count:7,balance:0});
 assert.equal((await db.query('select status from rr_sandbox.catalog')).rows[0].status,'sold');
 await assert.rejects(db.query('select public.rr_test_reserve($1,$2,$3)',['55555555-5555-4555-8555-555555555555',listing,buyer]),/unavailable/);
 const jobs=(await db.query('select kind,state from rr_sandbox.jobs')).rows;
 assert.ok(jobs.filter(j=>j.kind!=='manual_refund_review').every(j=>j.state==='held'));
 await payment({p_event:'evt_latepayment',p_payload_hash:'b'.repeat(64)});assert.deepEqual(await ledger(),{count:7,balance:0});
});
test('pending and requires-action refunds do not claim returned money; failures never debit funds',async()=>{
 await payment();await refund({p_status:'pending'});let o=await current();assert.equal(o.refund_state,'pending');assert.equal(o.refund_pending_cents,3427);assert.equal(o.refunded_cents,0);
 await refund({p_status:'requires_action'});assert.deepEqual(await ledger(),{count:5,balance:0});
 await refund({p_status:'failed',p_type:'refund.failed'});o=await current();assert.equal(o.refund_state,'failed');assert.equal(o.refund_pending_cents,0);assert.equal(o.refunded_cents,0);assert.deepEqual(await ledger(),{count:5,balance:0});
});
test('canceled pending refund stays held and is not treated as successful',async()=>{
 await payment();await refund({p_status:'pending'});await refund({p_status:'canceled'});
 assert.equal((await current()).refund_state,'failed');assert.equal((await current()).refunded_cents,0);assert.deepEqual(await ledger(),{count:5,balance:0});
});
test('partial refunds accumulate to the full total with balanced suspense and immutable identities',async()=>{
 await payment();await refund({p_amount:1000});assert.equal((await current()).refund_state,'partial');
 await refund({p_refund:'re_second',p_amount:2427});assert.equal((await current()).refund_state,'refunded');assert.equal((await current()).refunded_cents,3427);
 assert.deepEqual(await ledger(),{count:9,balance:0});
 for(const p of [{p_amount:999},{p_charge:'ch_wrong'}])await assert.rejects(refund(p),/identity mismatch/);
 await assert.rejects(refund({p_refund:'re_excess',p_amount:1}),/Aggregate refunds/);assert.deepEqual(await ledger(),{count:9,balance:0});
});
test('overlapping refund amounts serialize and cannot over-refund the order',async()=>{
 await payment();const outcomes=await Promise.allSettled([refund({p_refund:'re_one',p_amount:2000}),refund({p_refund:'re_two',p_amount:2000})]);
 assert.equal(outcomes.filter(x=>x.status==='fulfilled').length,1);assert.equal(outcomes.filter(x=>x.status==='rejected').length,1);assert.equal((await current()).refunded_cents,2000);assert.deepEqual(await ledger(),{count:7,balance:0});
});
test('payment and refund IDs cannot be rebound to a second order or overwrite its accounting',async()=>{
 await payment();await refund();
 const otherOrder='55555555-5555-4555-8555-555555555555',otherListing='66666666-6666-4666-8666-666666666666';
 await db.query("insert into rr_sandbox.catalog(id,seller_id,title,price_cents) values($1,$2,'Other synthetic jacket',2500)",[otherListing,seller]);
 await db.query('select public.rr_test_reserve($1,$2,$3)',[otherOrder,otherListing,buyer]);
 await db.query('select public.rr_test_attach_checkout($1,$2,$3,$4,$5,$6,$7)',[otherOrder,'cs_test_second',JSON.stringify({...snap,orderId:otherOrder,listingId:otherListing}),'taxcalc_second','a'.repeat(64),'b'.repeat(32),new Date(Date.now()+3600000).toISOString()]);
 const p={p_order:otherOrder,p_session:'cs_test_second',p_event:'evt_secondpaid',p_payload_hash:'b'.repeat(64)};
 await assert.rejects(payment(p),/unique constraint/);
 assert.equal((await db.query('select state from rr_sandbox.orders where id=$1',[otherOrder])).rows[0].state,'checkout_open');
 await payment({...p,p_payment_intent:'pi_second'});
 await assert.rejects(refund({p_payment_intent:'pi_second'}),/identity mismatch/);
 assert.equal((await db.query('select order_id from rr_sandbox.refunds')).rows[0].order_id,order);
 assert.equal((await db.query('select count(*)::int as count from rr_sandbox.ledger_entries where order_id=$1',[otherOrder])).rows[0].count,5);
});
test('late failed refund appends one reversal without erasing the original accounting',async()=>{
 await payment();await refund({p_created:ts+10});await refund({p_created:ts+20,p_status:'failed',p_type:'refund.failed'});
 assert.equal((await current()).refunded_cents,0);assert.equal((await current()).refund_state,'failed');assert.deepEqual(await ledger(),{count:9,balance:0});
 await refund({p_created:ts+30,p_status:'failed',p_type:'refund.failed'});assert.deepEqual(await ledger(),{count:9,balance:0});
});
test('older signed snapshots cannot regress a refund, including success arriving after a newer failure',async()=>{
 await payment();await refund({p_created:ts+20,p_status:'failed'});
 assert.equal((await refund({p_created:ts+10})).stale,true);assert.equal((await current()).refunded_cents,0);assert.deepEqual(await ledger(),{count:5,balance:0});
});
test('same-second conflicting states and impossible terminal regressions enter persistent review',async()=>{
 await payment();await refund({p_status:'pending',p_created:ts+10});await refund({p_status:'succeeded',p_created:ts+10});
 assert.equal((await current()).refund_state,'review');assert.equal((await current()).refunded_cents,0);
 await refund({p_status:'succeeded',p_created:ts+20});assert.equal((await current()).refund_state,'review');assert.deepEqual(await ledger(),{count:5,balance:0});
});
test('success cannot silently return to pending even with a newer timestamp',async()=>{
 await payment();await refund();await refund({p_status:'pending'});assert.equal((await current()).refund_state,'review');assert.equal((await current()).refunded_cents,3427);assert.deepEqual(await ledger(),{count:7,balance:0});
});
test('event collision, missing values, future timestamp, wrong currency and totals roll back atomically',async()=>{
 await payment();const p=args();await rpc('rr_test_process_refund',p);
 await assert.rejects(rpc('rr_test_process_refund',{...p,p_payload_hash:'b'.repeat(64)}),/collision/);
 for(const patch of [{p_amount:3428},{p_currency:'cad'},{p_created:Math.floor(Date.now()/1000)+3600},{p_status:null},{p_payment_intent:null},{p_type:'refund.failed',p_status:'succeeded'},{p_amount:0}])await assert.rejects(refund(patch));
 assert.deepEqual(await ledger(),{count:7,balance:0});
});
test('a refund received before the paid event retries and then succeeds on the same event',async()=>{
 const p=args();await assert.rejects(rpc('rr_test_process_refund',p),/binding/);await payment();assert.equal((await rpc('rr_test_process_refund',p)).state,'refunded');
});
test('late-payment review orders can receive refunds without changing competing inventory',async()=>{
 await payment({p_type:'checkout.session.expired',p_paid:false,p_payment_intent:null});
 await db.query('select public.rr_test_reserve($1,$2,$3)',['55555555-5555-4555-8555-555555555555',listing,buyer]);
 await payment({p_event:'evt_latepaid',p_payload_hash:'b'.repeat(64)});assert.equal((await current()).state,'review');
 await refund();assert.equal((await current()).refund_state,'refunded');assert.equal((await db.query('select status from rr_sandbox.catalog')).rows[0].status,'published');assert.deepEqual(await ledger(),{count:4,balance:0});
});
test('refund review cannot be cleared by a later automated risk assessment',async()=>{
 await payment();await refund({p_status:'pending'});
 await assert.rejects(db.query('select public.rr_test_record_risk($1,$2,$3)',[order,JSON.stringify({test:true,orderId:order,chargeId:'ch_fixture',decision:'clear',checkedAt:Date.now()}),'a'.repeat(64)]),/Manual review/);
});
test('new tables and RPCs remain inaccessible to browser roles; member views omit provider identifiers',async()=>{
 const grants=(await db.query("select grantee from information_schema.routine_privileges where routine_name in ('rr_test_process_refund','rr_test_process_payment_event')")).rows;
 assert.ok(!grants.some(r=>['PUBLIC','anon','authenticated'].includes(r.grantee)));
 assert.equal((await db.query("select relrowsecurity from pg_class where oid='rr_sandbox.refunds'::regclass")).rows[0].relrowsecurity,true);
 await payment();await refund();
 for(const member of [buyer,seller]){const rows=(await db.query('select public.rr_test_member_orders($1) as result',[member])).rows[0].result;assert.equal(rows[0].refunded_cents,3427);for(const key of ['payment_intent_id','charge_id','session_id','destination_hash'])assert.equal(rows[0][key],undefined);}
 assert.deepEqual((await db.query('select public.rr_test_member_orders($1) as result',['66666666-6666-4666-8666-666666666666'])).rows[0].result,[]);
 await db.exec('set role authenticated');try{await assert.rejects(refund(),/permission denied/);await assert.rejects(db.query('select * from rr_sandbox.refunds'),/permission denied/);}finally{await db.exec('reset role');}
});
test('refund verifier requires raw signatures, test account, valid identity and explicit statuses',()=>{
 assert.equal(verify().type,'refund.updated');
 for(const p of [{livemode:true},{account:'acct_wrong'},{created:0},{created:Math.floor(Date.now()/1000)+60},{type:'charge.refunded'},{type:'refund.failed'}])assert.throws(()=>verify(p));
 for(const patch of [{object:'charge'},{payment_intent:null},{charge:'wrong'},{amount:0},{currency:'eur'},{status:'complete'}]){const e=verify();assert.throws(()=>verify({data:{object:{...e.data.object,...patch}}}));}
 const s=signed();assert.throws(()=>verifyStripeTestEvent(Buffer.concat([s.rawBody,Buffer.from(' ')]),s.signature,{secret:s.webhookSecret}));
});
test('signed Node refund receipt reaches the actual SQL transaction and deduplicates',async()=>{
 await payment();const repo=createTestOrderRepository({projectUrl:'https://zvtaqzcqfdjpuwnlpzln.supabase.co',serviceKey:'sb_secret_fixture',refundsEnabled:true,fetchImpl:async(url,opts)=>Response.json(await rpc(url.split('/').pop(),JSON.parse(opts.body)))});
 assert.equal((await repo.acceptStripeEvent(signed())).state,'refunded');assert.equal((await repo.acceptStripeEvent(signed())).duplicate,true);assert.deepEqual(await ledger(),{count:7,balance:0});
});
test('generated Edge refund receipt and payment binding use the exact staging RPCs',async()=>{
 const {createTestEdgeWebhook}=await import('../supabase/functions/stripe-test-events/index.mjs');
 const config={projectUrl:'https://zvtaqzcqfdjpuwnlpzln.supabase.co',serviceKey:'sb_secret_fixture',webhookSecret:'whsec_fixture'};
 const h=createTestEdgeWebhook({...config,refundsEnabled:true,fetchImpl:async(url,opts)=>{assert.equal(url.startsWith(config.projectUrl+'/rest/v1/rpc/'),true);return Response.json(await rpc(url.split('/').pop(),JSON.parse(opts.body)));}});
 const e={id:'evt_edgepaid',type:'checkout.session.completed',livemode:false,data:{object:{id:'cs_test_refund',livemode:false,mode:'payment',status:'complete',payment_status:'paid',payment_intent:'pi_fixture',amount_total:3427,currency:'usd',client_reference_id:order,metadata:{integration:'rack_relic_test',order_id:order}}}};
 const make=p=>{const s=signed(p);return new Request('https://example.test',{method:'POST',body:s.rawBody,headers:{'stripe-signature':s.signature}});};
 assert.equal((await h(make(e))).status,200);assert.equal((await h(make())).status,200);assert.deepEqual(await ledger(),{count:7,balance:0});
 const disabled=createTestEdgeWebhook({...config,fetchImpl:()=>{throw Error('must not call');}});assert.equal((await disabled(make())).status,503);
});
test('routing is disabled by default and does not expose an API that creates refunds',()=>{
 const e=verify(),raw=signed().rawBody;assert.throws(()=>stripeTestEventRpc(e,raw),/not activated/);
 const call=stripeTestEventRpc(e,raw,{refundsEnabled:true});assert.equal(call.name,'rr_test_process_refund');assert.equal(call.payload.p_order,undefined);
});
