const {test,before,after,beforeEach}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),{Readable}=require('node:stream');
const {PGlite}=require('@electric-sql/pglite');
const {destinationHash}=require('../server/stripe_test_tax.cjs');
const {validateFulfillment,publicFulfillmentStatus}=require('../server/test_fulfillment.cjs');
const {createTestFulfillmentHandler}=require('../server/test_fulfillment_handler.cjs');
const {createTestOrderRepository}=require('../server/test_order_repository.cjs');
const order='11111111-1111-4111-8111-111111111111',buyer='22222222-2222-4222-8222-222222222222',seller='33333333-3333-4333-8333-333333333333',listing='44444444-4444-4444-8444-444444444444',rate='b'.repeat(32);
const address={line1:'400 Broad St',city:'Seattle',state:'WA',postal_code:'98109',country:'US'};
let db,input,snapshot,fulfillment,expires;
before(async()=>{db=new PGlite();await db.exec('create role anon;create role authenticated;create role service_role;');for(const n of ['20261030_order_ledger','20261030_payment_recovery','20261030_checkout_attempts','20261030_refund_receipts','20261030_refund_requests','20261030_checkout_quote_limits','20261030_checkout_quote_refresh','20261031_cancel_preparation','20261031_refund_review','20261031_charge_fee_evidence','20261031_fulfillment_snapshots'])await db.exec(fs.readFileSync(require.resolve('../supabase/test/'+n+'.sql'),'utf8'));});
after(async()=>db?.close());
beforeEach(async()=>{
 await db.exec('truncate rr_sandbox.catalog cascade');await db.query("insert into rr_sandbox.catalog(id,seller_id,title,price_cents) values($1,$2,'Synthetic jacket',2500)",[listing,seller]);
 const o=(await db.query('select public.rr_test_reserve($1,$2,$3) as o',[order,listing,buyer])).rows[0].o;expires=Date.now()+600000;
 input={orderId:order,buyerId:buyer,listing:{id:listing,seller_id:seller,price_cents:2500,updated_at:o.listing_updated_at},shippingQuote:{test:true,orderId:order,rateId:rate,amountCents:619,expiresAt:expires,destinationHash:destinationHash(address)},taxQuote:{test:true,orderId:order,amountCents:340,baseCents:3219,destinationHash:destinationHash(address),taxCalculationId:'taxcalc_fixture'}};
 snapshot={test:true,orderId:order,listingId:listing,sellerId:seller,currency:'USD',itemCents:2500,buyerFeeCents:100,shippingCents:619,taxCents:340,baseCents:3219,totalCents:3559};
 fulfillment={test:true,shipmentId:'a'.repeat(32),rateId:rate,currency:'USD',amountCents:619,carrier:'USPS',service:'Ground Advantage',origin:{...address},destination:{...address},parcel:{length:10,width:8,height:2,weight:1},expiresAt:expires};
});
const prepare=(f=fulfillment,i=input,s=snapshot)=>db.query('select public.rr_test_prepare_carrier_checkout($1,$2,$3,$4,$5,$6) as a',[order,buyer,JSON.stringify(i),JSON.stringify(s),new Date(expires).toISOString(),JSON.stringify(f)]).then(r=>r.rows[0].a);
const status=(actor=buyer)=>db.query('select public.rr_test_fulfillment_status($1,$2) as s',[order,actor]).then(r=>r.rows[0].s);
test('private snapshot and financial checkout commit atomically; repeat keeps one immutable record',async()=>{
 validateFulfillment(fulfillment,input);const a=await prepare();assert.equal(a.input.fulfillment,undefined);assert.equal(a.input.destination,undefined);assert.equal(a.snapshot.totalCents,3559);await Promise.all([prepare(),prepare()]);
 assert.equal((await db.query('select count(*)::int as n from rr_sandbox.fulfillment_quotes')).rows[0].n,1);const s=await status();assert.equal(s.snapshotStored,true);assert.deepEqual(s.holdReasons,['payment_unconfirmed','risk_hold','job_held']);assert.equal(s.labelPurchaseEnabled,false);assert.equal(JSON.stringify(s).includes('Broad'),false);
 const altered={...fulfillment,origin:{...address,line1:'Another street'}};await prepare(altered);const row=(await db.query('select snapshot from rr_sandbox.fulfillment_quotes')).rows[0].snapshot;assert.equal(row.origin.line1,'400 Broad St');
});
test('invalid address binding, parcel, rate and expiry roll back financial preparation too',async()=>{
 for(const patch of [{test:false},{rateId:'c'.repeat(32)},{shipmentId:null},{amountCents:620},{currency:'EUR'},{expiresAt:Date.now()-1},{destination:{...address,line1:'Different street'}},{origin:{...address,state:'ZZ'}},{origin:{...address,email:'private@example.com'}},{parcel:{length:10,width:8,height:2,weight:151}},{parcel:{length:'10',width:8,height:2,weight:1}},{carrier:null},{extra:'private'}]){
  await assert.rejects(prepare({...fulfillment,...patch}));assert.equal((await db.query('select count(*)::int as n from rr_sandbox.checkout_attempts')).rows[0].n,0);
 }
});
test('SQL address hash matches normalized server addresses including optional lines and punctuation',async()=>{
 for(const a of [address,{...address,line2:'Suite 2'},{...address,line1:'A "quoted" place \\ NW'},{...address,city:'San José',line2:''}])assert.equal((await db.query('select rr_sandbox.fulfillment_address_hash($1) as h',[JSON.stringify(a)])).rows[0].h,destinationHash(a));
});
test('expired undispatched quote refresh appends new private evidence; dispatched quotes never acquire reconstructed addresses',async()=>{
 await prepare();await db.query("update rr_sandbox.checkout_attempts set quote_expires_at=now()-interval '1 minute' where order_id=$1",[order]);
 const newRate='c'.repeat(32),next={...input,shippingQuote:{...input.shippingQuote,rateId:newRate}},f={...fulfillment,rateId:newRate,shipmentId:'d'.repeat(32)};await prepare(f,next);assert.equal((await db.query('select count(*)::int as n from rr_sandbox.fulfillment_quotes')).rows[0].n,2);
 await db.exec('truncate rr_sandbox.fulfillment_quotes');await db.query('select public.rr_test_dispatch_checkout($1,$2)',[order,buyer]);await assert.rejects(prepare(f,next),/Missing carrier snapshot/);assert.equal((await db.query('select count(*)::int as n from rr_sandbox.fulfillment_quotes')).rows[0].n,0);
});
test('financial, risk, refund, expiry and job gates are read-only and never enable label purchase',async()=>{
 await prepare();await db.query('select public.rr_test_attach_checkout($1,$2,$3,$4,$5,$6,$7)',[order,'cs_test_fulfillment',JSON.stringify(snapshot),'taxcalc_fixture',destinationHash(address),rate,new Date(Date.now()+3600000).toISOString()]);await db.query('select public.rr_test_process_payment_event($1,$2,$3,$4,$5,$6,$7,$8,$9)',['evt_paid','a'.repeat(64),'checkout.session.completed',order,'cs_test_fulfillment',3559,'usd',true,'pi_fixture']);
 assert.ok((await status()).holdReasons.includes('risk_hold'));await db.query("update rr_sandbox.orders set risk_status='clear' where id=$1",[order]);await db.query("update rr_sandbox.jobs set state='pending' where order_id=$1 and kind='prepare_test_label'",[order]);let s=await status();assert.equal(s.state,'ready_for_review');assert.equal(s.labelPurchaseEnabled,false);
 await db.query("update rr_sandbox.orders set refund_state='partial',refunded_cents=100 where id=$1",[order]);assert.ok((await status()).holdReasons.includes('refund_hold'));
 await db.query("update rr_sandbox.fulfillment_quotes set snapshot=jsonb_set(snapshot,'{expiresAt}',to_jsonb($1::bigint))",[Date.now()-1000]);assert.ok((await status()).holdReasons.includes('quote_expired'));
 const before=(await db.query('select jsonb_agg(j order by kind) as j from rr_sandbox.jobs j')).rows[0].j;await status();assert.deepEqual((await db.query('select jsonb_agg(j order by kind) as j from rr_sandbox.jobs j')).rows[0].j,before);
});
test('foreign participants, public roles and legacy orders without snapshots stay closed',async()=>{
 assert.equal((await status()).snapshotStored,false);await assert.rejects(status(listing));
 assert.equal((await db.query("select relrowsecurity from pg_class where oid='rr_sandbox.fulfillment_quotes'::regclass")).rows[0].relrowsecurity,true);
 await db.exec('set role authenticated');try{await assert.rejects(db.query('select * from rr_sandbox.fulfillment_quotes'),/permission denied/);await assert.rejects(status(),/permission denied/);await assert.rejects(db.query('select rr_sandbox.fulfillment_address_hash($1)',[JSON.stringify(address)]),/permission denied/);}finally{await db.exec('reset role');}
});
test('server snapshot validator and public result validator reject malformed or address-bearing authority',()=>{
 for(const patch of [{extra:1},{parcel:{...fulfillment.parcel,extra:1}},{destination:{...address,line2:' untrimmed '}},{origin:{...address,email:'private'}},{expiresAt:expires+1}])assert.throws(()=>validateFulfillment({...fulfillment,...patch},input));
 assert.throws(()=>publicFulfillmentStatus({test:true,orderId:order,snapshotStored:true,labelPurchaseEnabled:true,holdReasons:[],state:'ready_for_review'},order));
});
test('repository checks fresh operator membership before shipping reads and strips private RPC fields',async()=>{
 const calls=[],repo=createTestOrderRepository({projectUrl:'https://zvtaqzcqfdjpuwnlpzln.supabase.co',serviceKey:'sb_secret_fixture',allowedMemberIds:[buyer,seller],allowedRefundOperatorIds:[seller],refundsEnabled:true,refundRequestsEnabled:true,fetchImpl:async(url,options)=>{calls.push(url);if(url.endsWith('/auth/v1/user'))return Response.json({id:options.headers.Authorization==='Bearer operator'?seller:buyer});return Response.json({...await status(seller),destination:address});}});
 await assert.rejects(repo.fulfillmentStatus({authorization:'Bearer buyer',orderId:order}));assert.equal(calls.length,1);const s=await repo.fulfillmentStatus({authorization:'Bearer operator',orderId:order});assert.equal(s.destination,undefined);assert.equal(s.labelPurchaseEnabled,false);
});
test('HTTP readiness is GET-only, strict, disabled by default and sends no provider requests',async()=>{
 const result={test:true,orderId:order,snapshotStored:false,labelPurchaseEnabled:false,state:'held',holdReasons:['payment_unconfirmed']};let calls=0;const repository={fulfillmentStatus:async()=>{calls++;return result;}},response=()=>({headers:{},setHeader(k,v){this.headers[k]=v;},end(body){this.body=JSON.parse(body);}});
 const req=(method='GET',url='/api/test-marketplace?action=fulfillment&orderId='+order)=>({method,url,headers:{authorization:'Bearer operator'}});
 const disabled=response();await createTestFulfillmentHandler({repository})(req(),disabled);assert.equal(disabled.statusCode,404);
 const h=createTestFulfillmentHandler({repository,enabled:true});for(const [method,url,expected] of [['POST','/api/test-marketplace?action=fulfillment&orderId='+order,405],['GET','/api/test-marketplace?action=fulfillment&orderId='+order+'&rate=other',400],['GET','/api/test-marketplace?action=fulfillment&orderId='+order+'&orderId='+order,400]]){const r=response();await h(req(method,url),r);assert.equal(r.statusCode,expected);}assert.equal(calls,0);
 const r=response();await h(req(),r);assert.equal(r.statusCode,200);assert.equal(calls,1);assert.match(r.headers['Cache-Control'],/no-store/);
});
