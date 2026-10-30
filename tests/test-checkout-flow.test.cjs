const {test,before,after,beforeEach}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {Readable}=require('node:stream');
const {createHmac}=require('node:crypto');
const {PGlite}=require('@electric-sql/pglite');
const {createTestOrderRepository}=require('../server/test_order_repository.cjs');
const {createStripeTestCheckoutClient}=require('../server/marketplace_test_checkout.cjs');
const {createTestCheckoutService,createTestQuoteService}=require('../server/test_checkout_service.cjs');
const {createTestCheckoutHandler,createTestWebhookHandler,createTestOrdersHandler}=require('../server/test_order_handlers.cjs');
let db,calls,sessions,failCreate,failFinish,failSave,quoteFailure;
const orderId='11111111-1111-4111-8111-111111111111',buyer='22222222-2222-4222-8222-222222222222',seller='33333333-3333-4333-8333-333333333333',listingId='44444444-4444-4444-8444-444444444444',other='55555555-5555-4555-8555-555555555555';
const to={line1:'123 Test Street',city:'Seattle',state:'WA',postal_code:'98101',country:'US'};
const definitions={rr_test_reserve:['p_order','p_listing','p_buyer'],rr_test_member_orders:['p_member'],rr_test_checkout_attempt:['p_order','p_buyer'],rr_test_prepare_checkout:['p_order','p_buyer','p_input','p_snapshot','p_expires'],rr_test_dispatch_checkout:['p_order','p_buyer'],rr_test_save_checkout_session:['p_order','p_buyer','p_session','p_expires'],rr_test_finish_checkout:['p_order','p_buyer'],rr_test_process_event:['p_event','p_payload_hash','p_type','p_order','p_session','p_amount','p_currency','p_paid']};
before(async()=>{db=new PGlite();await db.exec('create role anon;create role authenticated;create role service_role;');for(const name of ['20261030_order_ledger.sql','20261030_payment_recovery.sql','20261030_checkout_attempts.sql'])await db.exec(fs.readFileSync(require.resolve('../supabase/test/'+name),'utf8'));});
after(async()=>db?.close());
beforeEach(async()=>{calls=[];sessions=new Map();failCreate=false;failFinish=false;failSave=false;quoteFailure=false;await db.exec('truncate rr_sandbox.catalog cascade');await db.query("insert into rr_sandbox.catalog(id,seller_id,title,price_cents) values($1,$2,'Synthetic test jacket',2500)",[listingId,seller]);});
function repository(){return createTestOrderRepository({projectUrl:'https://abcdefghijklmnopqrst.supabase.co',serviceKey:'sb_secret_fixture',fetchImpl:async(url,opts)=>{
 if(url.endsWith('/auth/v1/user')){const id={'Bearer buyer':buyer,'Bearer seller':seller,'Bearer other':other}[opts.headers.Authorization];return Response.json(id?{id}:{},{status:id?200:401});}
 const name=url.split('/').pop(),p=JSON.parse(opts.body),keys=definitions[name];assert.ok(keys,name);
 if(name==='rr_test_finish_checkout'&&failFinish){failFinish=false;throw Error('temporary database interruption');}
 if(name==='rr_test_save_checkout_session'&&failSave){failSave=false;throw Error('temporary database interruption');}
 const args=keys.map(k=>p[k]&&typeof p[k]==='object'?JSON.stringify(p[k]):p[k]);
 try{return Response.json((await db.query('select public.'+name+'('+keys.map((_,i)=>'$'+(i+1)).join(',')+') as result',args)).rows[0].result);}catch{return Response.json({error:'private SQL detail'},{status:400});}
 }});}
function providers(){
 const wrappedQuotes={quote:async(args)=>{
  const timestamp=(await db.query('select to_jsonb(o)->>\'listing_updated_at\' as ts from rr_sandbox.orders o where id=$1',[args.order.id])).rows[0].ts;
  const real=createTestQuoteService({shipping:{quote:async()=>{if(quoteFailure)throw Error('shipping unavailable');return {test:true,rates:[{test:true,id:'b'.repeat(32),currency:'USD',amountCents:700},{test:true,id:'a'.repeat(32),currency:'USD',amountCents:500}]};}},tax:{quote:async(input)=>({test:true,status:'calculated',country:'US',currency:'USD',orderId:input.orderId,baseCents:3100,amountCents:310,expiresAt:Date.now()+600000,destinationHash:input.shippingQuote.destinationHash,taxCalculationId:'taxcalc_fixture',taxabilityReasons:['standard_rated']})},loadFulfillment:async()=>({test:true,sellerId:seller,listingUpdatedAt:timestamp,from:to,package:{length:10,width:8,height:2,weight:1},itemTaxCode:'txcd_99999999',buyerFeeTaxCode:'txcd_99999999'})});
  return real.quote(args);
 }};
 const stripe=createStripeTestCheckoutClient({secretKey:'rk_test_fixture',fetchImpl:async(url,opts)=>{
  calls.push({url,opts});
  if(opts.method==='GET')return sessions.has(url.split('/').pop())?Response.json(sessions.get(url.split('/').pop())):new Response('',{status:404});
  const f=new URLSearchParams(opts.body),session={id:'cs_test_flow',livemode:false,mode:'payment',status:'open',payment_status:'unpaid',currency:'usd',amount_total:3410,client_reference_id:f.get('client_reference_id'),metadata:{order_id:f.get('metadata[order_id]'),integration:'rack_relic_test'},expires_at:Math.floor(Date.now()/1000)+3600,url:'https://checkout.stripe.com/c/pay/cs_test_flow'};
  sessions.set(session.id,session);if(failCreate)throw Error('connection lost after Stripe accepted request');return Response.json(session);
 }});
 return {quotes:wrappedQuotes,stripe};
}
function service(){return createTestCheckoutService({repository:repository(),...providers()});}
const input=()=>({authorization:'Bearer buyer',orderId,listingId,to});
const response=()=>({headers:{},setHeader(k,v){this.headers[k]=v;},end(s){this.body=JSON.parse(s);}});
function request(body,authorization='Bearer buyer'){const r=Readable.from([Buffer.from(JSON.stringify(body))]);r.method='POST';r.headers={'content-type':'application/json',authorization};return r;}
async function notify(type='checkout.session.completed',payment_status='paid'){
 const session={...sessions.get('cs_test_flow'),status:type==='checkout.session.expired'?'expired':'complete',payment_status};sessions.set(session.id,session);
 const event={id:'evt_'+type.split('.').pop().replace(/_/g,'')+payment_status,livemode:false,type,data:{object:session}},raw=Buffer.from(JSON.stringify(event)),t=Math.floor(Date.now()/1000);
 const req=Readable.from([raw]);req.method='POST';req.headers={'stripe-signature':'t='+t+',v1='+createHmac('sha256','whsec_fixture').update(t+'.').update(raw).digest('hex')};
 const res=response();await createTestWebhookHandler({repository:repository(),webhookSecret:'whsec_fixture',enabled:true})(req,res);assert.equal(res.statusCode,200);return event;
}
test('authenticated HTTP checkout persists trusted quotes, creates one session and attaches immutable totals',async()=>{
 const handler=createTestCheckoutHandler({checkout:service(),enabled:true}),res=response();await handler(request({orderId,listingId,to}),res);
 assert.equal(res.statusCode,200);assert.equal(res.body.totalCents,3410);assert.equal(res.body.state,'checkout_open');assert.match(res.body.url,/^https:\/\/checkout.stripe.com\//);
 const row=(await db.query('select phase,input,snapshot from rr_sandbox.checkout_attempts')).rows[0];assert.equal(row.phase,'attached');assert.equal(row.input.shippingQuote.rateId,'a'.repeat(32));assert.equal(row.snapshot.buyerFeeCents,100);assert.equal(JSON.stringify(row).includes('123 Test Street'),false);
 assert.equal(calls.filter(x=>x.opts.method==='POST').length,1);
});
test('payment webhook sells once and buyer/seller views show the paid order after browser close',async()=>{
 await service().start(input());await notify();await notify();
 assert.equal((await db.query('select status from rr_sandbox.catalog')).rows[0].status,'sold');
 const ledger=(await db.query('select count(*)::int as count,sum(amount_cents)::int as balance from rr_sandbox.ledger_entries')).rows[0];assert.deepEqual(ledger,{count:5,balance:0});
 for(const authorization of ['Bearer buyer','Bearer seller','Bearer other']){const res=response();await createTestOrdersHandler({repository:repository(),enabled:true})({method:'GET',headers:{authorization}},res);assert.equal(res.statusCode,200);assert.equal(res.body.orders.length,authorization==='Bearer other'?0:1);if(res.body.orders[0])assert.equal(res.body.orders[0].state,'paid');}
 assert.equal((await service().start(input())).url,null);assert.equal(calls.filter(x=>x.opts.method==='POST').length,1);
});
test('simultaneous checkout clicks dispatch exactly one Stripe creation',async()=>{
 const results=await Promise.allSettled([service().start(input()),service().start(input())]);
 assert.ok(results.some(r=>r.status==='fulfilled'));assert.equal(calls.filter(x=>x.opts.method==='POST').length,1);
 assert.equal((await service().start(input())).state,'checkout_open');assert.equal(calls.filter(x=>x.opts.method==='POST').length,1);
});
test('uncertain Stripe creation stays dispatched across process restarts and cannot create another session',async()=>{
 failCreate=true;await assert.rejects(service().start(input()));failCreate=false;
 await assert.rejects(service().start(input()),/reconciliation/);
 assert.equal((await db.query('select phase,session_id from rr_sandbox.checkout_attempts')).rows[0].phase,'dispatched');assert.equal(calls.filter(x=>x.opts.method==='POST').length,1);
});
test('saved Stripe session survives attachment interruption and recovers with GET only',async()=>{
 failFinish=true;await assert.rejects(service().start(input()));
 const result=await service().start(input());assert.equal(result.state,'checkout_open');assert.equal(calls.filter(x=>x.opts.method==='POST').length,1);assert.equal(calls.filter(x=>x.opts.method==='GET').length,1);
});
test('uncertain session persistence holds the reservation instead of guessing that no payment exists',async()=>{
 failSave=true;await assert.rejects(service().start(input()));await assert.rejects(service().start(input()),/reconciliation/);assert.equal(calls.length,1);
});
test('failed shipping quotes never contact Stripe and the same reservation can be retried',async()=>{
 quoteFailure=true;await assert.rejects(service().start(input()));assert.equal(calls.length,0);
 quoteFailure=false;assert.equal((await service().start(input())).state,'checkout_open');
});
test('retries cannot substitute a different destination or another buyer',async()=>{
 await service().start(input());await assert.rejects(service().start({...input(),to:{...to,postal_code:'98102'}}),/Destination differs/);
 await assert.rejects(service().start({...input(),authorization:'Bearer other'}));assert.equal(calls.length,1);
});
test('request cannot supply prices, fee, tax or a buyer identity; endpoint remains disabled by default',async()=>{
 for(const extra of [{amount:1},{buyerId:other},{snapshot:{}},{shippingQuote:{}}]){const res=response();await createTestCheckoutHandler({checkout:service(),enabled:true})(request({orderId,listingId,to,...extra}),res);assert.equal(res.statusCode,400);}
 const denied=response();await createTestCheckoutHandler({checkout:service(),enabled:true})(request({orderId,listingId,to},'Bearer invalid'),denied);assert.equal(denied.statusCode,401);
 const closed=response();await createTestCheckoutHandler({checkout:service()})(request({orderId,listingId,to}),closed);assert.equal(closed.statusCode,503);assert.equal(calls.length,0);
});
test('delayed failure releases unpaid test items without recording a sale',async()=>{
 await service().start(input());await notify('checkout.session.completed','unpaid');await notify('checkout.session.async_payment_failed','unpaid');
 assert.equal((await db.query('select state from rr_sandbox.orders')).rows[0].state,'payment_failed');assert.equal((await db.query('select count(*)::int as count from rr_sandbox.ledger_entries')).rows[0].count,0);
 assert.equal((await service().start(input())).url,null);
});
test('checkout preparation and attempt controls are inaccessible to browser roles',async()=>{
 await db.exec('set role authenticated');try{await assert.rejects(db.query('select public.rr_test_checkout_attempt($1,$2)',[orderId,buyer]),/permission denied/);await assert.rejects(db.exec('select * from rr_sandbox.checkout_attempts'),/permission denied/);}finally{await db.exec('reset role');}
});
test('a competing committed destination cannot silently replace this request before dispatch',async()=>{
 const original=repository(),providersForRace=providers();
 const racing={...original,async prepareCheckout(args){
  const state=await original.checkoutAttempt(args);
  const competing=await providersForRace.quotes.quote({order:state.order,to:{...to,postal_code:'98102'}});
  await original.prepareCheckout({...args,input:competing});
  return original.prepareCheckout(args);
 }};
 const checkout=createTestCheckoutService({repository:racing,...providersForRace});
 await assert.rejects(checkout.start(input()),/Destination differs/);
 assert.equal(calls.length,0);
 assert.equal((await db.query('select phase from rr_sandbox.checkout_attempts')).rows[0].phase,'prepared');
});
