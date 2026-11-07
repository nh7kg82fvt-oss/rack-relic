'use strict';
const {test,before,after,beforeEach}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {createHash}=require('node:crypto'),{PGlite}=require('@electric-sql/pglite');
const {createSellerCostDisclosure,assessSellerCostAllocation,sellerCostObligationKeys}=require('../server/seller_cost_allocation.cjs');
const {createTestSellerCostService}=require('../server/test_seller_cost_service.cjs');
const {createTestOrderRepository}=require('../server/test_order_repository.cjs');
const {createTestSellerCostHandler}=require('../server/test_seller_cost_handler.cjs');
const {Readable}=require('node:stream');
const {publicSellerCostReview}=require('../test-seller-cost-review.js');
const S='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222',X='33333333-3333-4333-8333-333333333333',
 L='44444444-4444-4444-8444-444444444444',M='55555555-5555-4555-8555-555555555555',O='66666666-6666-4666-8666-666666666666',P='77777777-7777-4777-8777-777777777777';
const BASE=['20261030_order_ledger','20261030_payment_recovery','20261030_checkout_attempts','20261030_refund_receipts',
 '20261030_refund_requests','20261030_checkout_quote_limits','20261030_checkout_quote_refresh','20261031_charge_fee_evidence','20261103_fee_policy_v2'];
let db;const rpc=(name,args)=>db.query('select public.'+name+'('+args.map((_,i)=>'$'+(i+1)).join(',')+') x',args).then(r=>r.rows[0].x);
before(async()=>{db=new PGlite();await db.exec('create role anon;create role authenticated;create role service_role;');for(const n of [...BASE,'20261103_seller_costs'])await db.exec(fs.readFileSync('supabase/test/'+n+'.sql','utf8'));});
after(async()=>db?.close());
beforeEach(async()=>{await db.exec('truncate rr_sandbox.catalog cascade;');for(const id of [L,M])await db.query("insert into rr_sandbox.catalog(id,seller_id,title,price_cents) values($1,$2,'Synthetic cost fixture',2500)",[id,S]);});
function quote(order=O,listing=L,shipping=500){
 const snapshot={test:true,orderId:order,listingId:listing,sellerId:S,currency:'USD',feePolicyVersion:'rr-fees-v2',itemCents:2500,buyerFeeCents:175,shippingCents:shipping,taxCents:0,baseCents:2675+shipping,totalCents:2675+shipping};
 const input={orderId:order,buyerId:B,feePolicyVersion:'rr-fees-v2',listing:{id:listing,seller_id:S,price_cents:2500},
  shippingQuote:{test:true,orderId:order,amountCents:shipping,destinationHash:'a'.repeat(64),rateId:'b'.repeat(32)},
  taxQuote:{test:true,orderId:order,amountCents:0,baseCents:2675+shipping,destinationHash:'a'.repeat(64),taxCalculationId:'taxcalc_fixture'}};
 return {snapshot,input};
}
async function prepared(order=O,listing=L){await rpc('rr_test_reserve',[order,listing,B]);const {snapshot,input}=quote(order,listing);await rpc('rr_test_prepare_checkout',[order,B,input,snapshot,new Date(Date.now()+600000).toISOString()]);return (await rpc('rr_test_seller_cost_context',[S,order])).order;}
const document=d=>{const {hash,...p}=d;return JSON.stringify(p);};
const hashed=p=>({text:JSON.stringify(p),hash:createHash('sha256').update('rr-cost-disclosure-v1\n'+JSON.stringify(p)).digest('hex')});
async function disclosed(order=O,listing=L,{maxTotalCents=600,costCaps={processing:200,radar:10,connect_active_account:200,payout:190,insurance:0},selectedInsurance=false,accept=true}={}){
 const snapshot=await prepared(order,listing),d=createSellerCostDisclosure({order:snapshot,maxTotalCents,costCaps,selectedInsurance,createdAt:Date.now()});
 await rpc('rr_test_prepare_seller_cost_disclosure',[S,order,document(d),d.hash]);if(accept)await rpc('rr_test_accept_seller_costs',[S,order,d.hash]);return d;
}
async function paid(order=O,listing=L){const {snapshot}=quote(order,listing);await rpc('rr_test_dispatch_checkout',[order,B]);await rpc('rr_test_attach_checkout',[order,'cs_test_'+order.replaceAll('-',''),snapshot,'taxcalc_fixture','a'.repeat(64),'b'.repeat(32),new Date(Date.now()+3600000).toISOString()]);await rpc('rr_test_process_payment_event',['evt_'+order.replaceAll('-',''),'c'.repeat(64),'checkout.session.completed',order,'cs_test_'+order.replaceAll('-',''),snapshot.totalCents,'usd',true,'pi_'+order.replaceAll('-','')]);}
async function evidence(kind,{order=O,amount=100,total=amount,phase='reserved',ref='receipt_'+kind}={}){
 const r=await rpc('rr_test_seller_cost_context',[S,order]),keys=sellerCostObligationKeys(r.order,{selectedInsurance:r.disclosure.selectedInsurance});
 return {test:true,verified:true,source:phase==='reserved'?'disclosed_reserve':'provider_receipt',obligationKey:keys[kind],orderId:order,sellerId:S,kind,phase,amountCents:amount,sourceTotalCents:total,
  sourceReference:phase==='reserved'?null:ref,currency:'USD',observedAt:Date.now(),scope:kind==='connect_active_account'?'seller_month':kind==='payout'?'payout':'order',
  ...(kind==='connect_active_account'?{period:r.order.settlementPeriod}:{}),...(kind==='payout'?{payoutBatchId:r.order.payoutBatchId,...(phase==='confirmed'?{payoutReference:'po_fixture'}:{})}:{})};
}
const record=e=>rpc('rr_test_record_seller_cost',[S,e.orderId,e]);
const ledger=()=>db.query('select kind,amount_cents from rr_sandbox.ledger_entries where order_id=$1 order by kind',[O]).then(r=>r.rows);

test('seller sees a versioned prepared quote before checkout; no private checkout input is projected',async()=>{
 await prepared();const c=await rpc('rr_test_seller_cost_context',[S,O]);assert.equal(c.order.buyerFeeCents,175);assert.equal(c.order.payoutBatchId,O);assert.match(c.order.settlementPeriod,/^20\d\d-\d\d$/);
 assert.equal(c.disclosure,null);assert.equal(c.acceptance,null);assert.equal(c.releaseEnabled,false);assert.equal(JSON.stringify(c).includes('destinationHash'),false);
 await assert.rejects(rpc('rr_test_seller_cost_context',[B,O]),/Seller order unavailable/);await assert.rejects(rpc('rr_test_seller_cost_review',[X,O]),/Order unavailable/);
});
test('current exact disclosure and seller acceptance are mandatory before dispatch or direct checkout attachment',async()=>{
 await prepared();await assert.rejects(rpc('rr_test_dispatch_checkout',[O,B]),/acceptance required/);
 await assert.rejects(rpc('rr_test_attach_checkout',[O,'cs_test_bypass',quote().snapshot,'taxcalc_fixture','a'.repeat(64),'b'.repeat(32),new Date(Date.now()+3600000).toISOString()]),/Accepted seller cost disclosure/);
 const o=(await rpc('rr_test_seller_cost_context',[S,O])).order,d=createSellerCostDisclosure({order:o,maxTotalCents:300,costCaps:{processing:200,radar:10,connect_active_account:50,payout:40,insurance:0},selectedInsurance:false,createdAt:Date.now()});
 await rpc('rr_test_prepare_seller_cost_disclosure',[S,O,document(d),d.hash]);await assert.rejects(rpc('rr_test_dispatch_checkout',[O,B]),/acceptance required/);
 await assert.rejects(rpc('rr_test_accept_seller_costs',[B,O,d.hash]),/Seller order unavailable/);await assert.rejects(rpc('rr_test_accept_seller_costs',[S,O,'0'.repeat(64)]),/Exact seller/);
 await rpc('rr_test_accept_seller_costs',[S,O,d.hash]);const c=await rpc('rr_test_seller_cost_context',[S,O]);assert.equal(c.acceptance.source,'server_verified_session');assert.equal(c.acceptance.authenticated,true);assert.ok(c.acceptance.authenticatedAt>=d.createdAt);
 assert.equal((await rpc('rr_test_dispatch_checkout',[O,B])).dispatch,true);
});
test('unknown caps, private fields, mismatched price/version, fractional cents and invalid hash cannot create a disclosure',async()=>{
 const order=await prepared(),d=createSellerCostDisclosure({order,maxTotalCents:500,costCaps:{processing:200,radar:10,connect_active_account:200,payout:90,insurance:0},selectedInsurance:false,createdAt:Date.now()});const {hash,...p}=d;
 for(const bad of [{...p,costCaps:{...p.costCaps,radar:null}},{...p,privateAddress:'no'},{...p,buyerFeeCents:100},{...p,feePolicyVersion:'rr-fees-v1'},{...p,maxTotalCents:1.5},{...p,selectedInsurance:false,costCaps:{...p.costCaps,insurance:50}}]){
  const h=hashed(bad);await assert.rejects(rpc('rr_test_prepare_seller_cost_disclosure',[S,O,h.text,h.hash]));
 }
 await assert.rejects(rpc('rr_test_prepare_seller_cost_disclosure',[S,O,document(d),'0'.repeat(64)]),/hash/);assert.equal((await rpc('rr_test_seller_cost_context',[S,O])).disclosure,null);
});
test('saved disclosure/acceptance and prepared quote remain immutable and retries preserve acceptance time',async()=>{
 const d=await disclosed(),first=(await rpc('rr_test_seller_cost_context',[S,O])).acceptance;await rpc('rr_test_prepare_seller_cost_disclosure',[S,O,document(d),d.hash]);await rpc('rr_test_accept_seller_costs',[S,O,d.hash]);assert.deepEqual((await rpc('rr_test_seller_cost_context',[S,O])).acceptance,first);
 const {hash,...p}=d,h=hashed({...p,maxTotalCents:599});await assert.rejects(rpc('rr_test_prepare_seller_cost_disclosure',[S,O,h.text,h.hash]),/immutable/);
 await assert.rejects(db.query('update rr_sandbox.seller_cost_acceptances set accepted_at=clock_timestamp() where order_id=$1',[O]),/immutable/);
 await db.query("update rr_sandbox.checkout_attempts set quote_expires_at=clock_timestamp()-interval '1 second' where order_id=$1",[O]);const q=quote(O,L,600);
 await assert.rejects(rpc('rr_test_prepare_checkout',[O,B,q.input,q.snapshot,new Date(Date.now()+600000).toISOString()]),/freezes checkout quote/);
 assert.equal((await rpc('rr_test_seller_cost_context',[S,O])).order.shippingCents,500);
});
test('bounded reservations create no actual ledger movement and remain held for reconciliation',async()=>{
 await disclosed();for(const kind of ['processing','radar','connect_active_account','payout'])await record(await evidence(kind,{amount:kind==='processing'?120:kind==='radar'?5:kind==='connect_active_account'?200:90}));
 const r=await rpc('rr_test_seller_cost_review',[B,O]),assessment=assessSellerCostAllocation(r);assert.equal(r.costs.length,4);assert.equal(assessment.reservedCostCents,415);assert.ok(assessment.blockers.includes('provider_costs_unconfirmed'));assert.equal(assessment.releaseEnabled,false);assert.deepEqual(await ledger(),[]);
});
test('confirmed processing needs original charge receipt, signed payment and no refund activity',async()=>{
 await disclosed();const e=await evidence('processing',{amount:120,phase:'confirmed',ref:'txn_fixture:fee'});await assert.rejects(record(e),/Signed paid/);await paid();await assert.rejects(record(e),/Original verified charge/);
 await rpc('rr_test_record_charge_fee',[O,S,{test:true,orderId:O,paymentIntentId:'pi_'+O.replaceAll('-',''),chargeId:'ch_fixture',balanceTransactionId:'txn_fixture',grossCents:3175,feeCents:120,netCents:3055,currency:'USD',feeDetails:[{type:'stripe_fee',amountCents:120,currency:'USD'}],checkedAt:Date.now()}]);
 await rpc('rr_test_prepare_refund',[X,O,S,100]);await assert.rejects(record(e),/without refund activity/);assert.equal((await rpc('rr_test_seller_cost_context',[S,O])).costs.length,0);
});
test('reserve replacement records balanced actual liability once, keeps fee/shipping/tax unchanged and preserves audit',async()=>{
 await disclosed();const reserve=await evidence('processing',{amount:150});await record(reserve);const audit=(await db.query('select recorded_by,recorded_at from rr_sandbox.seller_cost_allocations')).rows[0];await paid();const original=await ledger();
 await rpc('rr_test_record_charge_fee',[O,S,{test:true,orderId:O,paymentIntentId:'pi_'+O.replaceAll('-',''),chargeId:'ch_fixture',balanceTransactionId:'txn_fixture',grossCents:3175,feeCents:120,netCents:3055,currency:'USD',feeDetails:[{type:'stripe_fee',amountCents:120,currency:'USD'}],checkedAt:Date.now()}]);
 const e=await evidence('processing',{amount:120,phase:'confirmed',ref:'txn_fixture:fee'});await record(e);await record({...e,observedAt:Date.now()});const rows=await ledger();assert.equal(rows.length,original.length+2);assert.equal(rows.reduce((n,r)=>n+Number(r.amount_cents),0),0);
 for(const k of ['buyer_fee_revenue','postage_liability','tax_liability'])assert.deepEqual(rows.find(r=>r.kind===k),original.find(r=>r.kind===k));
 assert.equal(Number(rows.find(r=>r.kind==='seller_cost_recovery_processing').amount_cents),120);assert.equal(Number(rows.find(r=>r.kind==='provider_cost_payable_processing').amount_cents),-120);
 const after=(await db.query('select recorded_by,recorded_at,confirmed_by,confirmed_at from rr_sandbox.seller_cost_allocations')).rows[0];assert.equal(after.recorded_by,audit.recorded_by);assert.deepEqual(after.recorded_at,audit.recorded_at);assert.equal(after.confirmed_by,S);assert.ok(after.confirmed_at);
 const r=await rpc('rr_test_seller_cost_context',[S,O]);assert.equal(r.costs[0].phase,'confirmed');assert.equal(assessSellerCostAllocation(r).confirmedCostCents,120);
 await assert.rejects(record({...e,amountCents:121,sourceTotalCents:121}),/immutable/);assert.equal((await db.query("select count(*)::int n from rr_sandbox.jobs where kind in ('seller_transfer','seller_payout')")).rows[0].n,0);
});
test('an actual cost above its prior reserve requires reconciliation before any actual accounting',async()=>{
 await disclosed();await record(await evidence('radar',{amount:5,total:10}));await paid();await assert.rejects(record(await evidence('radar',{amount:6,total:10,phase:'confirmed'})),/Additional seller cost reservation/);
 assert.equal((await rpc('rr_test_seller_cost_context',[S,O])).costs[0].phase,'reserved');assert.equal((await ledger()).some(r=>r.kind.startsWith('seller_cost_')),false);
});
test('shared seller-month source cannot be charged in full to two orders, including racing requests',async()=>{
 await disclosed();await disclosed(P,M);const a=await evidence('connect_active_account',{amount:200,total:200}),b=await evidence('connect_active_account',{order:P,amount:200,total:200});
 const settled=await Promise.allSettled([record(a),record(b)]);assert.equal(settled.filter(r=>r.status==='fulfilled').length,1);assert.match(settled.find(r=>r.status==='rejected').reason.message,/already allocated/);
 assert.equal(Number((await db.query("select sum(amount_cents) n from rr_sandbox.seller_cost_allocations where kind='connect_active_account'")).rows[0].n),200);
});
test('shared monthly reserve can be apportioned, then replaced by smaller actual allocations without double counting',async()=>{
 await disclosed();await disclosed(P,M);await record(await evidence('connect_active_account',{amount:100,total:200}));await record(await evidence('connect_active_account',{order:P,amount:100,total:200}));await paid();await paid(P,M);
 await record(await evidence('connect_active_account',{amount:80,total:200,phase:'confirmed',ref:'invoice_fixture:account'}));await record(await evidence('connect_active_account',{order:P,amount:100,total:200,phase:'confirmed',ref:'invoice_fixture:account'}));
 const r=await rpc('rr_test_seller_cost_context',[S,O]);assert.equal(r.priorAllocations.length,2);assert.equal(r.priorAllocations.reduce((n,e)=>n+e.amountCents,0),180);assert.equal((await ledger()).filter(e=>e.kind==='seller_cost_recovery_connect_active_account').length,1);
});
test('a provider source reference cannot be reused for another kind or seller',async()=>{
 await disclosed();await disclosed(P,M);await paid();await paid(P,M);await record(await evidence('radar',{amount:5,total:10,phase:'confirmed',ref:'invoice_shared:line'}));
 await assert.rejects(record(await evidence('payout',{order:P,amount:5,total:10,phase:'confirmed',ref:'invoice_shared:line'})),/Provider cost source conflict/);
});
test('order-wide cap, chosen insurance, exact scope and integer evidence fail closed without financial writes',async()=>{
 await disclosed(O,L,{maxTotalCents:205});await record(await evidence('connect_active_account',{amount:200}));
 await assert.rejects(record(await evidence('radar',{amount:6})),/total disclosed cost cap/);
 const radar=await evidence('radar',{amount:5});for(const bad of [{...radar,amountCents:1.1},{...radar,verified:false},{...radar,phase:'estimated'},{...radar,scope:'seller_month'},{...radar,email:'private'},{...radar,sourceReference:'https://example.com'}])await assert.rejects(record(bad));
 const insurance={...radar,kind:'insurance',obligationKey:'insurance:'+O,amountCents:0,sourceTotalCents:0};await assert.rejects(record(insurance),/selection mismatch/);assert.equal((await rpc('rr_test_seller_cost_context',[S,O])).costs.length,1);assert.deepEqual(await ledger(),[]);
});
test('planned payout batch accepts reserves without po receipt and confirmed payout requires its actual receipt',async()=>{
 await disclosed();await record(await evidence('payout',{amount:90,total:90}));await paid();const c=await evidence('payout',{amount:80,total:90,phase:'confirmed',ref:'invoice_payout:line'}),{payoutReference,...missing}=c;
 await assert.rejects(record(missing),/Bound provider receipt/);await record(c);assert.equal((await rpc('rr_test_seller_cost_context',[S,O])).costs[0].payoutReference,'po_fixture');
});
test('legacy four percent orders remain excluded from new assessments and keep their saved evidence',async()=>{
 await db.query("insert into rr_sandbox.orders(id,listing_id,buyer_id,seller_id,listing_version,listing_updated_at,item_cents,buyer_fee_cents,state,fee_policy_version) select $1,id,$2,seller_id,version,updated_at,price_cents,100,'reserved','rr-fees-v1' from rr_sandbox.catalog where id=$3",[O,B,L]);
 const c=await rpc('rr_test_seller_cost_context',[S,O]);assert.equal(c.feePolicyVersion,'rr-fees-v1');assert.equal(c.order.buyerFeeCents,100);assert.equal(c.disclosure,null);assert.equal(c.acceptance,null);assert.deepEqual(c.costs,[]);assert.deepEqual(c.priorAllocations,[]);assert.equal(c.releaseEnabled,false);
 await assert.rejects(rpc('rr_test_seller_cost_context',[B,O]),/Seller order unavailable/);await assert.rejects(rpc('rr_test_prepare_seller_cost_disclosure',[S,O,'{}','0'.repeat(64)]),/Version 2/);await assert.rejects(rpc('rr_test_accept_seller_costs',[S,O,'0'.repeat(64)]),/Seller order unavailable/);
 assert.equal((await db.query('select buyer_fee_cents::int n from rr_sandbox.orders where id=$1',[O])).rows[0].n,100);assert.equal((await db.query('select count(*)::int n from rr_sandbox.seller_cost_disclosures')).rows[0].n,0);
});
test('all new tables and public RPCs are backend-only with row security enabled',async()=>{
 await disclosed();const tables=(await db.query("select relname,relrowsecurity from pg_class where relnamespace='rr_sandbox'::regnamespace and relname in ('seller_cost_disclosures','seller_cost_acceptances','seller_cost_allocations')")).rows;assert.equal(tables.length,3);assert.ok(tables.every(t=>t.relrowsecurity));
 for(const role of ['anon','authenticated']){await db.exec('set role '+role);try{await assert.rejects(rpc('rr_test_seller_cost_context',[S,O]),/permission denied/);await assert.rejects(rpc('rr_test_record_seller_cost',[S,O,{}]),/permission denied/);await assert.rejects(db.query('select * from rr_sandbox.seller_cost_allocations'),/permission denied/);}finally{await db.exec('reset role');}}
 await db.exec('set role service_role');try{assert.equal((await rpc('rr_test_seller_cost_context',[S,O])).orderId,O);await assert.rejects(db.query('select * from rr_sandbox.seller_cost_acceptances'),/permission denied/);}finally{await db.exec('reset role');}
});
test('real repository, seller service, database and public projection preserve canonical consent and remain held',async()=>{
 await prepared();const transport=[],quoteCalls=[];
 const functions={rr_test_seller_cost_context:['p_actor','p_order'],rr_test_prepare_seller_cost_disclosure:['p_actor','p_order','p_document','p_hash'],
  rr_test_accept_seller_costs:['p_actor','p_order','p_hash'],rr_test_dispatch_checkout:['p_order','p_buyer']};
 const repository=createTestOrderRepository({projectUrl:'https://zvtaqzcqfdjpuwnlpzln.supabase.co',serviceKey:'sb_secret_sqlFixture',allowedMemberIds:[S,B],sellerCostsEnabled:true,
  fetchImpl:async(url,options)=>{
   const u=new URL(url);assert.equal(u.origin,'https://zvtaqzcqfdjpuwnlpzln.supabase.co');transport.push({path:u.pathname,authorization:options.headers.Authorization});
   if(u.pathname==='/auth/v1/user')return ['Bearer seller','Bearer buyer'].includes(options.headers.Authorization)?Response.json({id:options.headers.Authorization==='Bearer seller'?S:B}):Response.json({error:'Unauthorized'},{status:401});
   const name=u.pathname.replace('/rest/v1/rpc/',''),keys=functions[name];assert.ok(keys,'No Stripe, Shippo, or other provider is called');assert.equal(options.headers.Authorization,undefined);assert.equal(options.headers.apikey,'sb_secret_sqlFixture');
   const body=JSON.parse(options.body);assert.deepEqual(Object.keys(body).sort(),[...keys].sort());
   try{return Response.json(await rpc(name,keys.map(k=>body[k])));}catch{return Response.json({error:'Rejected SQL fixture request'},{status:400});}
  }});
 const costs=createTestSellerCostService({repository,loadCostQuote:async order=>{quoteCalls.push(order);return {test:true,orderId:order.orderId,sellerId:order.sellerId,expiresAt:Date.now()+60000,maxTotalCents:500,costCaps:{processing:200,radar:10,connect_active_account:200,payout:90,insurance:0},selectedInsurance:false};}});
 const input={authorization:'Bearer seller',orderId:O},before=await costs.status(input);assert.deepEqual(publicSellerCostReview(before,O),before);assert.equal(before.accepted,false);
 await assert.rejects(repository.dispatchCheckout({authorization:'Bearer buyer',orderId:O}));
 const review=await costs.prepare(input);assert.deepEqual(publicSellerCostReview(review,O),review);assert.equal(review.accepted,false);assert.equal(review.disclosure.maxTotalCents,500);
 const accepted=await costs.accept({...input,disclosureHash:review.disclosure.hash});assert.deepEqual(publicSellerCostReview(accepted,O),accepted);assert.equal(accepted.accepted,true);
 assert.equal(accepted.state,'held');assert.equal(accepted.releaseEnabled,false);assert.equal(accepted.sellerNetCents,null);assert.ok(accepted.blockers.includes('provider_cost_schedule_incomplete'));assert.ok(accepted.blockers.includes('cost_inventory_incomplete'));
 assert.equal((await repository.dispatchCheckout({authorization:'Bearer buyer',orderId:O})).dispatch,true);await assert.rejects(costs.status({authorization:'Bearer buyer',orderId:O}));
 const saved=await rpc('rr_test_seller_cost_context',[S,O]);assert.equal(saved.disclosure.hash,review.disclosure.hash);assert.equal(saved.acceptance.disclosureHash,review.disclosure.hash);assert.equal(saved.acceptance.sellerId,S);assert.equal(quoteCalls.length,1);
 assert.ok(transport.filter(c=>c.path==='/auth/v1/user').length>=8);assert.deepEqual(await ledger(),[]);assert.equal((await db.query("select count(*)::int n from rr_sandbox.jobs where kind in ('seller_transfer','seller_payout')")).rows[0].n,0);
});
test('historical paid order crosses SQL, authenticated repository, seller service and HTTP as held without changing saved money',async()=>{
 await db.query("insert into rr_sandbox.orders(id,listing_id,buyer_id,seller_id,listing_version,listing_updated_at,item_cents,buyer_fee_cents,state,fee_policy_version) select $1,id,$2,seller_id,version,updated_at,price_cents,100,'reserved','rr-fees-v1' from rr_sandbox.catalog where id=$3",[O,B,L]);
 const snapshot={...quote().snapshot,feePolicyVersion:'rr-fees-v1',buyerFeeCents:100,baseCents:3100,totalCents:3100};
 await rpc('rr_test_attach_checkout',[O,'cs_test_legacyCost',snapshot,'taxcalc_fixture','a'.repeat(64),'b'.repeat(32),new Date(Date.now()+3600000).toISOString()]);
 await rpc('rr_test_process_payment_event',['evt_legacyCost','c'.repeat(64),'checkout.session.completed',O,'cs_test_legacyCost',3100,'usd',true,'pi_legacyCost']);
 const originalLedger=await ledger(),originalOrder=(await db.query('select * from rr_sandbox.orders where id=$1',[O])).rows[0],transport=[];
 const functions={rr_test_seller_cost_context:['p_actor','p_order'],rr_test_prepare_seller_cost_disclosure:['p_actor','p_order','p_document','p_hash'],rr_test_accept_seller_costs:['p_actor','p_order','p_hash']};
 const repository=createTestOrderRepository({projectUrl:'https://zvtaqzcqfdjpuwnlpzln.supabase.co',serviceKey:'sb_secret_legacyFixture',allowedMemberIds:[S,B],sellerCostsEnabled:true,
  fetchImpl:async(url,options)=>{
   const u=new URL(url);assert.equal(u.origin,'https://zvtaqzcqfdjpuwnlpzln.supabase.co');transport.push(u.pathname);
   if(u.pathname==='/auth/v1/user')return options.headers.Authorization==='Bearer seller'?Response.json({id:S}):Response.json({id:B});
   const name=u.pathname.replace('/rest/v1/rpc/',''),keys=functions[name];assert.ok(keys,'No provider calls');assert.equal(options.headers.Authorization,undefined);assert.equal(options.headers.apikey,'sb_secret_legacyFixture');const body=JSON.parse(options.body);assert.deepEqual(Object.keys(body).sort(),[...keys].sort());
   try{return Response.json(await rpc(name,keys.map(k=>body[k])));}catch{return Response.json({error:'Rejected historical request'},{status:400});}
  }});
 const costs=createTestSellerCostService({repository,loadCostQuote:async()=>assert.fail('Historical order cannot request a new cost quote')});
 const handler=createTestSellerCostHandler({costs,enabled:true});
 const response=()=>({headers:{},setHeader(k,v){this.headers[k]=v;},end(v){this.body=JSON.parse(v);}});
 const request=(action,body,authorization='Bearer seller')=>Object.assign(Readable.from(body===undefined?[]:[JSON.stringify(body)]),{method:body===undefined?'GET':'POST',url:'/api/test-marketplace?action='+action+(body===undefined?'&orderId='+O:''),headers:{authorization,'content-type':'application/json'}});
 const view=response();await handler(request('seller-cost-review'),view);assert.equal(view.statusCode,200);assert.deepEqual(publicSellerCostReview(view.body,O),view.body);
 assert.equal(view.body.feePolicyVersion,'rr-fees-v1');assert.equal(view.body.itemCents,2500);assert.equal(view.body.buyerFeeCents,100);assert.equal(view.body.state,'held');assert.ok(view.body.blockers.includes('unsupported_fee_policy'));assert.equal(view.body.accepted,false);assert.equal(view.body.sellerNetCents,null);assert.equal(view.body.releaseEnabled,false);
 for(const [action,body] of [['seller-cost-prepare',{orderId:O}],['seller-cost-accept',{orderId:O,disclosureHash:'0'.repeat(64)}]]){const denied=response();await handler(request(action,body),denied);assert.notEqual(denied.statusCode,200);}
 const buyer=response();await handler(request('seller-cost-review',undefined,'Bearer buyer'),buyer);assert.notEqual(buyer.statusCode,200);
 assert.equal(transport.some(path=>path.includes('prepare_seller_cost_disclosure')||path.includes('accept_seller_costs')),false);
 assert.deepEqual(await ledger(),originalLedger);assert.deepEqual((await db.query('select * from rr_sandbox.orders where id=$1',[O])).rows[0],originalOrder);assert.equal((await db.query('select count(*)::int n from rr_sandbox.seller_cost_disclosures')).rows[0].n,0);assert.equal((await db.query('select count(*)::int n from rr_sandbox.seller_cost_allocations')).rows[0].n,0);
});
test('seller cost migration coexists with the complete startup, fulfillment, issue and risk protections',async()=>{
 const full=new PGlite();try{
  await full.exec('create role anon;create role authenticated;create role service_role;');
  for(const n of ['20261030_order_ledger','20261030_payment_recovery','20261030_checkout_attempts','20261030_refund_receipts','20261030_refund_requests',
   '20261030_checkout_quote_limits','20261030_checkout_quote_refresh','20261031_cancel_preparation','20261031_refund_review','20261031_charge_fee_evidence',
   '20261031_fulfillment_snapshots','20261031_label_attempts','20261031_tracking_observations','20261102_seller_onboarding','20261102_order_issues',
   '20261102_order_issues_review','20261102_order_issues_thread','20261102_order_issues_review_refunds','20261103_seller_protections',
   '20261103_provider_risk_holds','20261103_startup_policy','20261103_fee_policy_v2','20261103_seller_costs'])await full.exec(fs.readFileSync('supabase/test/'+n+'.sql','utf8'));
  const call=(name,args)=>full.query('select public.'+name+'('+args.map((_,i)=>'$'+(i+1)).join(',')+') x',args).then(r=>r.rows[0].x);
  await full.query("insert into rr_sandbox.catalog(id,seller_id,title,price_cents) values($1,$2,'Complete migration fixture',2500)",[L,S]);
  await call('rr_test_claim_seller',[S]);await call('rr_test_save_seller',[S,'acct_migrationFixture']);await call('rr_test_record_seller_protection',[S,'acct_migrationFixture',true,Date.now()]);
  await call('rr_test_reserve',[O,L,B]);const q=quote();await call('rr_test_prepare_checkout',[O,B,q.input,q.snapshot,new Date(Date.now()+600000).toISOString()]);
  await assert.rejects(call('rr_test_dispatch_checkout',[O,B]),/acceptance required/);
  const c=await call('rr_test_seller_cost_context',[S,O]),d=createSellerCostDisclosure({order:c.order,maxTotalCents:500,costCaps:{processing:200,radar:10,connect_active_account:200,payout:90,insurance:0},selectedInsurance:false,createdAt:Date.now()});
  await call('rr_test_prepare_seller_cost_disclosure',[S,O,document(d),d.hash]);await call('rr_test_accept_seller_costs',[S,O,d.hash]);assert.equal((await call('rr_test_dispatch_checkout',[O,B])).dispatch,true);
  await full.query("insert into rr_sandbox.jobs(order_id,kind,state) values($1,'seller_transfer','held')",[O]);await assert.rejects(full.query("update rr_sandbox.jobs set state='pending' where order_id=$1 and kind='seller_transfer'",[O]),/release disabled/);
 }finally{await full.close();}
});
