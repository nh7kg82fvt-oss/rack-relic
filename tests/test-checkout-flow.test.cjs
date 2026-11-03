const {test,before,after,beforeEach}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {Readable}=require('node:stream');
const {createHmac}=require('node:crypto');
const {PGlite}=require('@electric-sql/pglite');
const {createTestOrderRepository}=require('../server/test_order_repository.cjs');
const {createStripeTestCheckoutClient}=require('../server/marketplace_test_checkout.cjs');
const {createTestCheckoutService,createTestQuoteService}=require('../server/test_checkout_service.cjs');
const {createTestCheckoutHandler,createTestWebhookHandler,createTestOrdersHandler,createTestCancelPreparationHandler}=require('../server/test_order_handlers.cjs');
let db,calls,sessions,failCreate,failFinish,failSave,quoteFailure,quoteCalls,taxCents;
const orderId='11111111-1111-4111-8111-111111111111',buyer='22222222-2222-4222-8222-222222222222',seller='33333333-3333-4333-8333-333333333333',listingId='44444444-4444-4444-8444-444444444444',other='55555555-5555-4555-8555-555555555555';
const to={line1:'123 Test Street',city:'Seattle',state:'WA',postal_code:'98101',country:'US'};
const definitions={rr_test_cancel_preparation:['p_order','p_buyer'],rr_test_quote_permit:['p_order','p_buyer'],rr_test_reserve:['p_order','p_listing','p_buyer'],rr_test_member_orders:['p_member'],rr_test_checkout_attempt:['p_order','p_buyer'],rr_test_prepare_checkout:['p_order','p_buyer','p_input','p_snapshot','p_expires'],rr_test_dispatch_checkout:['p_order','p_buyer'],rr_test_save_checkout_session:['p_order','p_buyer','p_session','p_expires'],rr_test_finish_checkout:['p_order','p_buyer'],rr_test_process_event:['p_event','p_payload_hash','p_type','p_order','p_session','p_amount','p_currency','p_paid']};
before(async()=>{db=new PGlite();await db.exec('create role anon;create role authenticated;create role service_role;');for(const name of ['20261030_order_ledger.sql','20261030_payment_recovery.sql','20261030_checkout_attempts.sql','20261030_refund_receipts.sql','20261030_refund_requests.sql','20261030_checkout_quote_limits.sql','20261030_checkout_quote_refresh.sql','20261031_cancel_preparation.sql'])await db.exec(fs.readFileSync(require.resolve('../supabase/test/'+name),'utf8'));});
after(async()=>db?.close());
beforeEach(async()=>{calls=[];quoteCalls=0;taxCents=310;sessions=new Map();failCreate=false;failFinish=false;failSave=false;quoteFailure=false;await db.exec('truncate rr_sandbox.catalog, rr_sandbox.checkout_quote_limits cascade');await db.query("insert into rr_sandbox.catalog(id,seller_id,title,price_cents) values($1,$2,'Synthetic test jacket',2500)",[listingId,seller]);});
function repository(){return createTestOrderRepository({projectUrl:'https://zvtaqzcqfdjpuwnlpzln.supabase.co',serviceKey:'sb_secret_fixture',fetchImpl:async(url,opts)=>{
 if(url.endsWith('/auth/v1/user')){const id={'Bearer buyer':buyer,'Bearer seller':seller,'Bearer other':other}[opts.headers.Authorization];return Response.json(id?{id}:{},{status:id?200:401});}
 const name=url.split('/').pop(),p=JSON.parse(opts.body),keys=definitions[name];assert.ok(keys,name);
 if(name==='rr_test_finish_checkout'&&failFinish){failFinish=false;throw Error('temporary database interruption');}
 if(name==='rr_test_save_checkout_session'&&failSave){failSave=false;throw Error('temporary database interruption');}
 const args=keys.map(k=>p[k]&&typeof p[k]==='object'?JSON.stringify(p[k]):p[k]);
 try{return Response.json((await db.query('select public.'+name+'('+keys.map((_,i)=>'$'+(i+1)).join(',')+') as result',args)).rows[0].result);}catch{return Response.json({error:'private SQL detail'},{status:400});}
 }});}
function providers(){
 const wrappedQuotes={quote:async(args)=>{
  quoteCalls++;
  const timestamp=(await db.query('select to_jsonb(o)->>\'listing_updated_at\' as ts from rr_sandbox.orders o where id=$1',[args.order.id])).rows[0].ts;
  const real=createTestQuoteService({shipping:{quote:async()=>{if(quoteFailure)throw Error('shipping unavailable');return {test:true,rates:[{test:true,id:'b'.repeat(32),currency:'USD',amountCents:700},{test:true,id:'a'.repeat(32),currency:'USD',amountCents:500}]};}},tax:{quote:async(input)=>({test:true,status:'calculated',country:'US',currency:'USD',orderId:input.orderId,baseCents:3100,amountCents:taxCents,expiresAt:Date.now()+600000,destinationHash:input.shippingQuote.destinationHash,taxCalculationId:'taxcalc_fixture',taxabilityReasons:['standard_rated']})},loadFulfillment:async()=>({test:true,sellerId:seller,listingUpdatedAt:timestamp,from:to,package:{length:10,width:8,height:2,weight:1},itemTaxCode:'txcd_99999999',buyerFeeTaxCode:'txcd_99999999'})});
  return real.quote(args);
 }};
 const stripe=createStripeTestCheckoutClient({secretKey:'rk_test_fixture',fetchImpl:async(url,opts)=>{
  calls.push({url,opts});
  if(opts.method==='GET')return sessions.has(url.split('/').pop())?Response.json(sessions.get(url.split('/').pop())):new Response('',{status:404});
  const f=new URLSearchParams(opts.body),session={id:'cs_test_flow',livemode:false,mode:'payment',status:'open',payment_status:'unpaid',currency:'usd',amount_total:[...f].filter(([k])=>k.endsWith('[price_data][unit_amount]')).reduce((sum,[,v])=>sum+Number(v),0),client_reference_id:f.get('client_reference_id'),metadata:{order_id:f.get('metadata[order_id]'),integration:'rack_relic_test'},expires_at:Math.floor(Date.now()/1000)+3600,url:'https://checkout.stripe.com/c/pay/cs_test_flow'};
  sessions.set(session.id,session);if(failCreate)throw Error('connection lost after Stripe accepted request');return Response.json(session);
 }});
 return {quotes:wrappedQuotes,stripe};
}
function service(options={}){return createTestCheckoutService({repository:repository(),...providers(),...options});}
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

test('durable quote budget stops repeated provider failures before another quote or Stripe call',async()=>{
 quoteFailure=true;
 const handler=createTestCheckoutHandler({checkout:service({quoteLimitsEnabled:true}),enabled:true});
 for(let i=0;i<6;i++){
  const res=response();await handler(request({orderId,listingId,to}),res);
  assert.equal(res.statusCode,i<5?503:429);
  if(i===5)assert.ok(Number(res.headers['Retry-After'])>=1&&Number(res.headers['Retry-After'])<=60);
 }
 assert.equal(quoteCalls,5);assert.equal(calls.length,0);
 assert.equal((await db.query('select minute_count from rr_sandbox.checkout_quote_limits where buyer_id=$1',[buyer])).rows[0].minute_count,5);
});
test('saved checkout recovery remains GET-only when the account quote budget is exhausted',async()=>{
 await service({quoteLimitsEnabled:true}).start(input());
 await db.query('update rr_sandbox.checkout_quote_limits set minute_count=5,day_count=20 where buyer_id=$1',[buyer]);
 assert.equal((await service({quoteLimitsEnabled:true}).start(input())).state,'checkout_open');
 assert.equal(quoteCalls,1);assert.equal(calls.filter(x=>x.opts.method==='POST').length,1);assert.equal(calls.filter(x=>x.opts.method==='GET').length,1);
});
test('missing or malformed durable permit fails closed before contacting quote providers',async()=>{
 for(const permit of [null,{test:true,allowed:true,retryAfter:10},{test:true,allowed:false,retryAfter:0},{test:false,allowed:true,retryAfter:0}]){
  const original=repository(),checkout=service({quoteLimitsEnabled:true,repository:{...original,quotePermit:async()=>permit}});
  await assert.rejects(checkout.start(input()),/limit evidence/);
 }
 await assert.rejects(service({quoteLimitsEnabled:true,repository:{...repository(),quotePermit:async()=>{throw Error('database offline');}}}).start(input()),/database offline/);
 assert.equal(quoteCalls,0);assert.equal(calls.length,0);
});
test('quote limits keep the daily cap across short-window resets and recover after a full day',async()=>{
 await repository().reserve(input());
 const permit=()=>repository().quotePermit(input());
 for(let group=0;group<4;group++){
  await db.query("update rr_sandbox.checkout_quote_limits set minute_started=clock_timestamp()-interval '2 minutes' where buyer_id=$1",[buyer]);
  for(let i=0;i<5;i++)assert.equal((await permit()).allowed,true);
 }
 const blocked=await permit();assert.equal(blocked.allowed,false);assert.ok(blocked.retryAfter>60);
 await db.query("update rr_sandbox.checkout_quote_limits set minute_started=clock_timestamp()-interval '25 hours',day_started=clock_timestamp()-interval '25 hours' where buyer_id=$1",[buyer]);
 assert.equal((await permit()).allowed,true);
 const row=(await db.query('select minute_count,day_count from rr_sandbox.checkout_quote_limits where buyer_id=$1',[buyer])).rows[0];assert.deepEqual(row,{minute_count:1,day_count:1});
});
test('quote permit requires reservation ownership and excludes browser roles',async()=>{
 await repository().reserve(input());
 await assert.rejects(repository().quotePermit({...input(),authorization:'Bearer other'}));
 assert.equal((await db.query('select count(*)::int as count from rr_sandbox.checkout_quote_limits')).rows[0].count,0);
 await db.exec('set role authenticated');
 try{
  await assert.rejects(db.query('select public.rr_test_quote_permit($1,$2)',[orderId,buyer]),/permission denied/);
  await assert.rejects(db.exec('select * from rr_sandbox.checkout_quote_limits'),/permission denied/);
 }finally{await db.exec('reset role');}
});
test('simultaneous permits share one account budget even across different orders',async()=>{
 const secondListing='66666666-6666-4666-8666-666666666666';
 await db.query("insert into rr_sandbox.catalog(id,seller_id,title,price_cents) values($1,$2,'Second synthetic jacket',2500)",[secondListing,seller]);
 const r=repository();await r.reserve(input());await r.reserve({...input(),orderId:other,listingId:secondListing});
 const results=await Promise.all(Array.from({length:8},(_,i)=>r.quotePermit({...input(),orderId:i%2?other:orderId})));
 assert.equal(results.filter(r=>r.allowed).length,5);assert.equal(results.filter(r=>!r.allowed).length,3);
 assert.deepEqual((await db.query('select minute_count,day_count from rr_sandbox.checkout_quote_limits where buyer_id=$1',[buyer])).rows[0],{minute_count:5,day_count:5});
});
test('a future quote-budget timestamp stays held rather than granting extra attempts',async()=>{
 const r=repository();await r.reserve(input());await r.quotePermit(input());
 await db.query("update rr_sandbox.checkout_quote_limits set minute_started=clock_timestamp()+interval '1 hour' where buyer_id=$1",[buyer]);
 assert.deepEqual(await r.quotePermit(input()),{test:true,allowed:false,retryAfter:86400});
 assert.equal((await db.query('select day_count from rr_sandbox.checkout_quote_limits where buyer_id=$1',[buyer])).rows[0].day_count,1);
});

async function pausePrepared(){
 const r=repository();
 await assert.rejects(service({repository:{...r,dispatchCheckout:async()=>{throw Error('browser closed before dispatch');}},quoteLimitsEnabled:true}).start(input()),/before dispatch/);
 assert.equal(calls.length,0);
}
async function expirePrepared(){await db.query("update rr_sandbox.checkout_attempts set quote_expires_at=clock_timestamp()-interval '1 second' where order_id=$1",[orderId]);}
test('expired undispatched quotes refresh on the same order with fresh totals and one payment session',async()=>{
 await pausePrepared();await expirePrepared();taxCents=340;
 const result=await service({quoteLimitsEnabled:true}).start(input());
 assert.equal(result.orderId,orderId);assert.equal(result.totalCents,3440);assert.equal(quoteCalls,2);assert.equal(calls.filter(c=>c.opts.method==='POST').length,1);
 const row=(await db.query('select phase,snapshot,quote_expires_at>clock_timestamp() as fresh from rr_sandbox.checkout_attempts')).rows[0];
 assert.equal(row.fresh,true);assert.equal(row.phase,'attached');assert.equal(row.snapshot.taxCents,340);
 assert.equal((await db.query('select count(*)::int as count from rr_sandbox.orders')).rows[0].count,1);
});
test('a still-current prepared quote keeps its committed price and does not call quote providers again',async()=>{
 await pausePrepared();taxCents=900;
 assert.equal((await service({quoteLimitsEnabled:true}).start(input())).totalCents,3410);
 assert.equal(quoteCalls,1);assert.equal(calls.length,1);
});
test('expired preparation cannot change the saved destination or bypass the quote budget',async()=>{
 await pausePrepared();await expirePrepared();
 await assert.rejects(service({quoteLimitsEnabled:true}).start({...input(),to:{...to,postal_code:'98102'}}),/Destination differs/);
 await db.query('update rr_sandbox.checkout_quote_limits set minute_count=5 where buyer_id=$1',[buyer]);
 const res=response();await createTestCheckoutHandler({checkout:service({quoteLimitsEnabled:true}),enabled:true})(request({orderId,listingId,to}),res);
 assert.equal(res.statusCode,429);assert.equal(quoteCalls,1);assert.equal(calls.length,0);
 const row=(await db.query('select phase,snapshot from rr_sandbox.checkout_attempts')).rows[0];assert.equal(row.phase,'prepared');assert.equal(row.snapshot.taxCents,310);
});
test('expiry never refreshes or reissues a dispatched checkout with an unknown provider result',async()=>{
 failCreate=true;await assert.rejects(service({quoteLimitsEnabled:true}).start(input()));
 await expirePrepared();taxCents=900;failCreate=false;
 await assert.rejects(service({quoteLimitsEnabled:true}).start(input()),/reconciliation/);
 assert.equal(quoteCalls,1);assert.equal(calls.filter(c=>c.opts.method==='POST').length,1);
});
test('racing refresh requests still dispatch at most one payment creation',async()=>{
 await pausePrepared();await expirePrepared();
 const results=await Promise.allSettled([service({quoteLimitsEnabled:true}).start(input()),service({quoteLimitsEnabled:true}).start(input())]);
 assert.ok(results.some(r=>r.status==='fulfilled'));assert.equal(calls.filter(c=>c.opts.method==='POST').length,1);
 assert.equal((await service({quoteLimitsEnabled:true}).start(input())).totalCents,3410);
});
test('database refresh rejects destination substitution and preserves the old expired evidence',async()=>{
 await pausePrepared();await expirePrepared();const r=repository(),state=await r.checkoutAttempt(input());
 const next=await providers().quotes.quote({order:state.order,to:{...to,postal_code:'98102'}});
 await assert.rejects(r.prepareCheckout({...input(),input:next,snapshot:state.attempt.snapshot,expiresAt:next.shippingQuote.expiresAt}));
 assert.deepEqual((await r.checkoutAttempt(input())).attempt.input,state.attempt.input);assert.equal(calls.length,0);
});
test('ambiguous preparation expiry or conflicting dispatch markers stay held',async()=>{
 await pausePrepared();const r=repository();
 await assert.rejects(service({repository:{...r,async checkoutAttempt(args){const s=await r.checkoutAttempt(args);s.attempt.quote_expires_at='unknown';return s;}},quoteLimitsEnabled:true}).start(input()),/reconciliation/);
 await db.query('update rr_sandbox.checkout_attempts set dispatched_at=clock_timestamp() where order_id=$1',[orderId]);
 await assert.rejects(service({quoteLimitsEnabled:true}).start(input()));assert.equal(quoteCalls,1);assert.equal(calls.length,0);
});
test('refreshed quote inputs must agree with the exact persisted financial snapshot',async()=>{
 await pausePrepared();await expirePrepared();const r=repository(),state=await r.checkoutAttempt(input());
 const fresh=await providers().quotes.quote({order:state.order,to});
 for(const change of [q=>{q.taxQuote.amountCents++;},q=>{q.shippingQuote.amountCents++;},q=>{q.taxQuote.baseCents++;},q=>{q.taxQuote.destinationHash='f'.repeat(64);}]){
  const bad=structuredClone(fresh);change(bad);
  await assert.rejects(r.prepareCheckout({...input(),input:bad,snapshot:state.attempt.snapshot,expiresAt:fresh.shippingQuote.expiresAt}));
  assert.deepEqual((await r.checkoutAttempt(input())).attempt.snapshot,state.attempt.snapshot);
 }
 assert.equal(calls.length,0);
});
test('only an undispatched prepared buyer order exposes cancellation capability',async()=>{
 const r=repository();await r.reserve(input());
 assert.equal((await r.memberOrders({authorization:'Bearer buyer'}))[0].can_cancel_preparation,false);
 await pausePrepared();
 const mine=(await r.memberOrders({authorization:'Bearer buyer'}))[0];assert.equal(mine.can_cancel_preparation,true);assert.equal(mine.session_id,undefined);
 assert.equal((await r.memberOrders({authorization:'Bearer seller'}))[0].can_cancel_preparation,false);
 assert.deepEqual(await r.memberOrders({authorization:'Bearer other'}),[]);
});
test('cancelling preparation preserves history, releases only its claim and creates no payment or ledger',async()=>{
 await pausePrepared();const handler=createTestCancelPreparationHandler({repository:repository(),enabled:true});
 for(let i=0;i<2;i++){
  const res=response();await handler(request({orderId}),res);assert.equal(res.statusCode,200);assert.deepEqual(res.body,{test:true,orderId,state:'cancelled'});
 }
 assert.equal((await repository().memberOrders({authorization:'Bearer buyer'}))[0].state,'cancelled');
 assert.equal((await db.query('select status from rr_sandbox.catalog')).rows[0].status,'published');
 assert.equal((await db.query('select count(*)::int as count from rr_sandbox.ledger_entries')).rows[0].count,0);
 assert.equal((await db.query('select count(*)::int as count from rr_sandbox.provider_events')).rows[0].count,0);
 await assert.rejects(service().start(input()));assert.equal(calls.length,0);
 assert.equal((await repository().reserve({...input(),orderId:other})).state,'reserved');
});
test('a dispatch racing ahead of cancellation remains reserved and cannot be cancelled',async()=>{
 await pausePrepared();const r=repository();assert.equal((await r.dispatchCheckout(input())).dispatch,true);
 const res=response();await createTestCancelPreparationHandler({repository:r,enabled:true})(request({orderId}),res);assert.equal(res.statusCode,409);
 assert.equal((await r.checkoutAttempt(input())).attempt.phase,'dispatched');
 assert.equal((await r.memberOrders({authorization:'Bearer buyer'}))[0].can_cancel_preparation,false);
 await assert.rejects(r.reserve({...input(),orderId:other}));assert.equal(calls.length,0);
});
test('unprepared reservations and non-buyers cannot cancel another member’s claim',async()=>{
 const r=repository();await r.reserve(input());await assert.rejects(r.cancelPreparation(input()));
 await pausePrepared();
 for(const authorization of ['Bearer seller','Bearer other','Bearer invalid'])await assert.rejects(r.cancelPreparation({...input(),authorization}));
 assert.equal((await r.memberOrders({authorization:'Bearer buyer'}))[0].state,'reserved');
 assert.equal((await r.checkoutAttempt(input())).attempt.phase,'prepared');assert.equal(calls.length,0);
});
test('any recorded financial or dispatch evidence keeps preparation on hold',async()=>{
 await pausePrepared();const r=repository();
 for(const change of ["update rr_sandbox.checkout_attempts set dispatched_at=clock_timestamp()","update rr_sandbox.checkout_attempts set session_id='cs_test_conflicting'","update rr_sandbox.orders set payment_intent_id='pi_conflicting'","insert into rr_sandbox.jobs(order_id,kind,state) values('"+orderId+"','fraud_assessment','held')"]){
  await db.exec('begin');
  try{await db.exec(change);assert.equal((await r.memberOrders({authorization:'Bearer buyer'}))[0].can_cancel_preparation,false);await assert.rejects(r.cancelPreparation(input()));}finally{await db.exec('rollback');}
 }
 assert.equal(calls.length,0);
});
test('cancel handler rejects extra authority fields, wrong methods and browser-role direct calls',async()=>{
 await pausePrepared();const handler=createTestCancelPreparationHandler({repository:repository(),enabled:true});
 for(const body of [{orderId,buyerId:buyer},{orderId,refund:true},{},null]){const res=response();await handler(request(body),res);assert.equal(res.statusCode,400);}
 const wrong=response();await handler({method:'GET'},wrong);assert.equal(wrong.statusCode,405);
 const disabled=response();await createTestCancelPreparationHandler({repository:repository()})(request({orderId}),disabled);assert.equal(disabled.statusCode,404);
 await db.exec('set role authenticated');try{await assert.rejects(db.query('select public.rr_test_cancel_preparation($1,$2)',[orderId,buyer]),/permission denied/);}finally{await db.exec('reset role');}
 assert.equal(calls.length,0);
});
