const {test,before,after,beforeEach}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
const {createShippoTestLabelClient,safeLabelUrl}=require('../server/shippo_test_labels.cjs');
const {createTestLabelService}=require('../server/test_label_service.cjs');
const order='11111111-1111-4111-8111-111111111111',buyer='22222222-2222-4222-8222-222222222222',seller='33333333-3333-4333-8333-333333333333',listing='44444444-4444-4444-8444-444444444444',requestId='55555555-5555-4555-8555-555555555555',other='66666666-6666-4666-8666-666666666666';
const originalRate='a'.repeat(32),rate='b'.repeat(32),transaction='c'.repeat(32),shipment='d'.repeat(32),url='https://shippo-delivery.s3.amazonaws.com/sample.pdf';
const address={line1:'400 Broad St',city:'Seattle',state:'WA',postal_code:'98109',country:'US'},args={orderId:order,requestId,authorization:'Bearer operator'};
let db,quote;
before(async()=>{db=new PGlite();await db.exec('create role anon;create role authenticated;create role service_role;');for(const n of ['20261030_order_ledger','20261030_payment_recovery','20261030_checkout_attempts','20261030_refund_receipts','20261030_refund_requests','20261030_checkout_quote_limits','20261030_checkout_quote_refresh','20261031_cancel_preparation','20261031_refund_review','20261031_charge_fee_evidence','20261031_fulfillment_snapshots','20261031_label_attempts'])await db.exec(fs.readFileSync(require.resolve('../supabase/test/'+n+'.sql'),'utf8'));});
after(async()=>db?.close());
beforeEach(async()=>{
 await db.exec('truncate rr_sandbox.catalog cascade');
 await db.query("insert into rr_sandbox.catalog(id,seller_id,title,price_cents) values($1,$2,'Synthetic jacket',2500)",[listing,seller]);
 await db.query('select public.rr_test_reserve($1,$2,$3)',[order,listing,buyer]);
 const {destinationHash}=require('../server/stripe_test_tax.cjs'),hash=destinationHash(address);
 await db.query("update rr_sandbox.orders set state='paid',payment_intent_id='pi_fixture',risk_status='clear',shipping_rate_id=$2,destination_hash=$3,snapshot=$4 where id=$1",[order,originalRate,hash,JSON.stringify({shippingCents:619,totalCents:3559})]);
 await db.query('insert into rr_sandbox.fulfillment_quotes(order_id,rate_id,snapshot) values($1,$2,$3)',[order,originalRate,JSON.stringify({test:true,rateId:originalRate,amountCents:619,origin:address,destination:address,parcel:{length:10,width:8,height:2,weight:1},expiresAt:Date.now()-600000})]);
 await db.query("insert into rr_sandbox.jobs(order_id,kind,state) values($1,'prepare_test_label','pending')",[order]);
 await db.query("insert into rr_sandbox.risk_assessments(order_id,charge_id,evidence_hash,decision,reason_codes,checked_at) values($1,'ch_fixture',$2,'clear','[]',now())",[order,'a'.repeat(64)]);
 quote={test:true,shipmentId:shipment,sourceRateId:originalRate,rateId:rate,currency:'USD',amountCents:619,carrier:'USPS',service:'Ground Advantage',expiresAt:Date.now()+300000};
});
const attempt=(actor=buyer)=>db.query('select public.rr_test_label_attempt($1,$2) as a',[order,actor]).then(r=>r.rows[0].a);
const context=(actor=buyer)=>db.query('select public.rr_test_label_context($1,$2) as a',[order,actor]).then(r=>r.rows[0].a);
const claim=(q=quote,r=requestId)=>db.query('select public.rr_test_claim_label($1,$2,$3,$4) as a',[order,buyer,r,JSON.stringify(q)]).then(r=>r.rows[0].a);
const evidence=(status='SUCCESS')=>({test:true,orderId:order,requestId,transactionId:transaction,rateId:rate,status,labelUrl:status==='SUCCESS'?url:null,trackingNumber:status==='SUCCESS'?'TEST123':null,checkedAt:Date.now()});
const save=e=>db.query('select public.rr_test_save_label($1,$2,$3,$4) as a',[order,buyer,requestId,JSON.stringify(e)]).then(r=>r.rows[0].a);
test('fresh rate replaces expired provider quote only within the original shipping budget; one durable dispatch wins',async()=>{
 const c=await context();assert.equal(c.shippingCents,619);assert.equal(c.snapshot.expiresAt<Date.now(),true);
 const claims=await Promise.all([claim(),claim(),claim(quote,other)]);assert.equal(claims.filter(c=>c.dispatch).length,1);assert.equal(claims.every(c=>c.attempt.requestId===requestId),true);
 const job=(await db.query('select * from rr_sandbox.jobs')).rows[0];assert.equal(job.state,'leased');assert.equal(job.attempts,1);
 assert.equal((await db.query('select snapshot from rr_sandbox.orders')).rows[0].snapshot.shippingCents,619);
});
test('unpaid, stale risk, refunds, missing address evidence and held jobs cannot claim a sample',async()=>{
 for(const change of ["update rr_sandbox.orders set state='checkout_open'","update rr_sandbox.orders set payment_intent_id=null","update rr_sandbox.orders set risk_status='review'","update rr_sandbox.orders set refund_pending_cents=100","update rr_sandbox.orders set refund_state='refunded'","update rr_sandbox.risk_assessments set checked_at=now()-interval '6 minutes'","update rr_sandbox.jobs set state='held'","delete from rr_sandbox.fulfillment_quotes"]){
  await db.exec('begin');try{await db.exec(change);await assert.rejects(claim());}finally{await db.exec('rollback');}assert.equal(await attempt(),null);
 }
 for(const patch of [{test:false},{currency:'EUR'},{amountCents:620},{amountCents:-1},{amountCents:'619'},{sourceRateId:'f'.repeat(32)},{rateId:'foreign'},{expiresAt:Date.now()-1},{expiresAt:Date.now()+600000},{carrier:null},{extra:1}])await assert.rejects(claim({...quote,...patch}));
 assert.equal(await attempt(),null);
});
test('known pending samples reconcile by identity; terminal evidence and accounting stay immutable',async()=>{
 await claim();await save(evidence('WAITING'));await save(evidence());const a=await save(evidence());assert.equal(a.result.status,'SUCCESS');
 await assert.rejects(save(evidence('WAITING')),/Terminal/);await assert.rejects(save({...evidence(),transactionId:'e'.repeat(32)}),/identity/);await assert.rejects(save({...evidence(),labelUrl:'https://attacker.example/sample.pdf'}));
 assert.equal((await db.query('select state,attempts,provider_reference from rr_sandbox.jobs')).rows[0].state,'done');
 assert.equal((await db.query('select count(*)::int as n from rr_sandbox.ledger_entries')).rows[0].n,0);
 assert.equal((await claim(quote,other)).dispatch,false);
});
test('foreign participants and browser roles cannot inspect or dispatch private label records',async()=>{
 await assert.rejects(context(other));await assert.rejects(attempt(other));
 assert.equal((await db.query("select relrowsecurity from pg_class where oid='rr_sandbox.label_attempts'::regclass")).rows[0].relrowsecurity,true);
 await db.exec('set role authenticated');try{await assert.rejects(context(),/permission denied/);await assert.rejects(claim(),/permission denied/);await assert.rejects(db.query('select * from rr_sandbox.label_attempts'),/permission denied/);}finally{await db.exec('reset role');}
});
function repository(){return {labelAttempt:()=>attempt(),labelContext:()=>context(),claimLabel:({quote})=>claim(quote),saveLabel:({evidence})=>save(evidence),publicLabel:a=>({test:true,orderId:a.orderId,requestId:a.requestId,state:a.result?.status==='SUCCESS'?'ready':'processing',labelUrl:a.result?.labelUrl||null,trackingNumber:a.result?.trackingNumber||null})};}
test('lost provider POST or database-save response never triggers another label purchase',async()=>{
 let posts=0,quotes=0;const service=createTestLabelService({repository:repository(),shipping:{quote:async()=>{quotes++;return quote;},create:async()=>{posts++;throw Error('network outcome unknown');}}});
 await assert.rejects(service.request(args));assert.equal((await service.request(args)).state,'outcome_unknown');assert.equal((await service.status(args)).state,'outcome_unknown');await assert.rejects(service.request({...args,requestId:other}),/different/);assert.equal(posts,1);assert.equal(quotes,1);
});
test('concurrent service requests dispatch once; known pending records use provider GET only',async()=>{
 let posts=0,reads=0;const shipping={quote:async()=>quote,create:async()=>{posts++;return evidence('WAITING');},retrieve:async()=>{reads++;return evidence();}},service=createTestLabelService({repository:repository(),shipping});
 await Promise.all([service.request(args),service.request(args)]);assert.equal(posts,1);assert.equal((await service.status(args)).state,'ready');assert.equal(reads,1);await service.request(args);assert.equal(posts,1);
});
test('no request status is explicit and does not request rates or labels',async()=>{
 const service=createTestLabelService({repository:repository(),shipping:{}});assert.equal((await service.status(args)).state,'not_requested');await assert.rejects(service.request({...args,requestId:'bad'}));
});
test('test label transport binds metadata, rate, mode and exact transaction; private context never becomes provider-controlled',async()=>{
 const calls=[],client=createShippoTestLabelClient({token:'shippo_test_fixture',fetchImpl:async(u,o)=>{calls.push([u,o]);return Response.json({test:true,object_id:transaction,rate,status:'SUCCESS',metadata:'rr_test_label_'+order+'_'+requestId,label_url:url,tracking_number:'TEST123'});}});
 const e=await client.create({orderId:order,requestId,quote});assert.equal(e.labelUrl,url);assert.equal(calls[0][1].redirect,'error');assert.equal(calls[0][1].cache,'no-store');const payload=JSON.parse(calls[0][1].body);assert.equal(payload.metadata,'rr_test_label_'+order+'_'+requestId);assert.equal(payload.rate,rate);
 await client.retrieve({orderId:order,requestId,quote,transactionId:transaction});assert.equal(calls[1][1].method,'GET');
 for(const patch of [{test:false},{metadata:'another request'},{rate:'e'.repeat(32)},{object_id:'foreign'},{label_url:'https://attacker.example/label'},{status:'UNKNOWN'},{tracking_number:''}]){
  const bad=createShippoTestLabelClient({token:'shippo_test_fixture',fetchImpl:async()=>Response.json({test:true,object_id:transaction,rate,status:'SUCCESS',metadata:payload.metadata,label_url:url,tracking_number:'TEST123',...patch})});await assert.rejects(bad.create({orderId:order,requestId,quote}));
 }
 for(const bad of ['http://shippo-delivery.s3.amazonaws.com/a','https://shippo-delivery.s3.amazonaws.com.attacker.example/a','https://user@deliver.goshippo.com/a','https://deliver.goshippo.com:444/a'])assert.throws(()=>safeLabelUrl(bad));
});
test('fresh rate requests use the saved parcel and destination and cannot exceed collected shipping',async()=>{
 const c=await context(),bodies=[],client=createShippoTestLabelClient({token:'shippo_test_fixture',fetchImpl:async(u,o)=>{bodies.push(JSON.parse(o.body));return Response.json({test:true,object_id:shipment,rates:[{test:true,object_id:rate,currency:'USD',amount:'6.19',provider:'USPS',servicelevel:{name:'Ground'}},{test:true,object_id:'e'.repeat(32),currency:'USD',amount:'8.00',provider:'UPS',servicelevel:{name:'Ground'}}]});}});
 const fresh=await client.quote(c);assert.equal(fresh.amountCents,619);assert.equal(fresh.sourceRateId,originalRate);assert.equal(bodies[0].address_to.street1,address.line1);assert.equal(bodies[0].address_from.email,'sender@example.com');assert.equal(bodies[0].address_from.phone,'+12025550123');assert.equal(bodies[0].address_to.email,undefined);assert.equal(bodies[0].parcels[0].weight,'1');await assert.rejects(client.quote({...c,shippingCents:618}),/budget/);
});
test('cached provider results and lost database-save responses stay held without a second POST',async()=>{
 const bad=createShippoTestLabelClient({token:'shippo_test_fixture',fetchImpl:async()=>Response.json({},{headers:{age:'1'}})});await assert.rejects(bad.create({orderId:order,requestId,quote}),/Fresh/);
 let posts=0;const repo=repository();repo.saveLabel=async()=>{throw Error('database response lost');};const service=createTestLabelService({repository:repo,shipping:{quote:async()=>quote,create:async()=>{posts++;return evidence();}}});await assert.rejects(service.request(args));assert.equal((await service.status(args)).state,'outcome_unknown');assert.equal((await service.request(args)).state,'outcome_unknown');assert.equal(posts,1);
});
test('sample HTTP route is disabled by default, bounded and accepts no browser rate, address or provider identity',async()=>{
 const {Readable}=require('node:stream'),{createTestLabelHandler}=require('../server/test_label_handler.cjs');let calls=0;const labels={request:async a=>{calls++;return a;},status:async a=>{calls++;return a;}},response=()=>({headers:{},setHeader(k,v){this.headers[k]=v;},end(s){this.body=JSON.parse(s);}});
 const req=(method,url,body)=>Object.assign(Readable.from(body===undefined?[]:[body]),{method,url,headers:{'content-type':'application/json',authorization:'Bearer operator'}});
 const h=createTestLabelHandler({labels,enabled:true});for(const [method,url,body,status] of [['PUT','/api/test-marketplace?action=sample-label',undefined,405],['POST','/api/test-marketplace?action=sample-label',JSON.stringify({...args,rateId:rate}),400],['POST','/api/test-marketplace?action=sample-label',"x".repeat(1025),413],['GET','/api/test-marketplace?action=sample-label&orderId='+order+'&requestId='+requestId+'&requestId='+requestId,undefined,400],['POST','/api/test-marketplace?action=sample-label&orderId='+order,'{}',400]]){const r=response();await h(req(method,url,body),r);assert.equal(r.statusCode,status);}assert.equal(calls,0);
 const r=response();await h(req('POST','/api/test-marketplace?action=sample-label',JSON.stringify({orderId:order,requestId})),r);assert.equal(r.statusCode,200);assert.equal(calls,1);assert.match(r.headers['Cache-Control'],/no-store/);
 const disabled=response();await createTestLabelHandler({labels})(req('POST','/api/test-marketplace?action=sample-label','{}'),disabled);assert.equal(disabled.statusCode,404);
});
