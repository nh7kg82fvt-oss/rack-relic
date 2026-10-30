const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createHmac}=require('node:crypto');
const {buildTestCheckout,createStripeTestCheckoutClient,verifyStripeTestEvent,matchesPaidTestOrder}=require('../server/marketplace_test_checkout.cjs');
const orderId='11111111-1111-4111-8111-111111111111',buyerId='22222222-2222-4222-8222-222222222222',seller='33333333-3333-4333-8333-333333333333',listingId='44444444-4444-4444-8444-444444444444';
function input(){const updated_at='2026-10-30T00:00:00Z',expiresAt=Date.now()+600000;return {orderId,buyerId,listing:{id:listingId,seller_id:seller,status:'published',moderation_status:'active',delivery_mode:'shipping',price_cents:2500,updated_at},shippingQuote:{test:true,orderId,listingId,listingUpdatedAt:updated_at,expiresAt,amountCents:500},taxQuote:{test:true,orderId,expiresAt,status:'calculated',currency:'USD',country:'US',baseCents:3100,amountCents:310}};}
function session(){return {expires_at:Math.floor(Date.now()/1000)+1800,id:'cs_test_fixture',livemode:false,mode:'payment',status:'complete',payment_status:'paid',currency:'usd',amount_total:3410,client_reference_id:orderId,metadata:{order_id:orderId,integration:'rack_relic_test'},url:'https://checkout.stripe.com/c/pay/cs_test_fixture'};}
function signed(event,stamp=1000){const raw=Buffer.from(JSON.stringify(event));const hash=createHmac('sha256','whsec_fixture').update(stamp+'.').update(raw).digest('hex');return {raw,signature:'t='+stamp+',v1='+hash};}
const event=()=>({id:'evt_fixture',livemode:false,type:'checkout.session.completed',data:{object:session()}});
test('calculates 4% on item only and separately accounts for shipping and explicit tax',()=>{
 const s=buildTestCheckout(input());assert.equal(s.buyerFeeCents,100);assert.equal(s.totalCents,3410);assert.ok(Object.isFrozen(s));
 const i=input();i.listing.price_cents=101;i.taxQuote.baseCents=605;i.taxQuote.amountCents=0;assert.equal(buildTestCheckout(i).buyerFeeCents,4);
});
test('rejects hidden, unavailable, self-purchase, pickup, invalid cents and stale/mismatched quotes',()=>{
 const edits=[i=>i.listing.status='sold',i=>i.listing.moderation_status='hidden',i=>i.buyerId=seller,i=>i.listing.delivery_mode='pickup',i=>i.listing.price_cents=1.1,i=>i.listing.price_cents=Infinity,i=>i.shippingQuote.test=false,i=>i.shippingQuote.expiresAt=0,i=>i.shippingQuote.expiresAt=Date.now()+3600000,i=>i.shippingQuote.listingUpdatedAt='stale',i=>i.shippingQuote.orderId=buyerId,i=>i.taxQuote=undefined,i=>i.taxQuote.status='pending',i=>i.taxQuote.baseCents=1,i=>i.taxQuote.currency='CAD',i=>i.taxQuote.amountCents=-1];
 for(const edit of edits){const i=input();edit(i);assert.throws(()=>buildTestCheckout(i));}
});
test('refuses live and missing Stripe credentials',()=>{
 for(const secretKey of [undefined,'','sk_live_fixture','rk_live_fixture'])assert.throws(()=>createStripeTestCheckoutClient({secretKey}));
});
test('test checkout uses one fixed provider, minimal metadata and a stable order idempotency key',async()=>{
 const calls=[];const c=createStripeTestCheckoutClient({secretKey:'sk_test_fixture',fetchImpl:async(url,opts)=>{calls.push({url,opts});return {ok:true,json:async()=>({...session(),status:'open',payment_status:'unpaid'})};}});
 await c.createCheckout(input());await c.createCheckout(input());
 assert.equal(calls.length,2);assert.equal(calls[0].url,'https://api.stripe.com/v1/checkout/sessions');
 assert.equal(calls[0].opts.headers['Idempotency-Key'],calls[1].opts.headers['Idempotency-Key']);
 assert.equal(calls[0].opts.redirect,'error');
 const form=new URLSearchParams(calls[0].opts.body);assert.equal(form.get('line_items[1][price_data][unit_amount]'),'100');
 assert.equal(form.get('payment_method_types[0]'),null);assert.equal(form.get('adaptive_pricing[enabled]'),'false');assert.match(form.get('integration_identifier'),/^rack_relic_test_[a-z]{8}$/);assert.equal(calls[0].opts.body,calls[1].opts.body);assert.equal(calls[0].opts.headers['Stripe-Version'],'2026-10-28.endive');
 assert.equal(form.get('billing_address_collection'),'required');assert.equal(form.get('payment_method_options[card][request_three_d_secure]'),'any');
 assert.equal(form.get('payment_intent_data[transfer_group]'),'rr_test_'+orderId);
 assert.equal(form.get('payment_intent_data[transfer_data][destination]'),null);
 assert.equal(form.get('customer_email'),null);assert.equal(form.get('automatic_tax[enabled]'),null);
 assert.match(form.get('success_url'),/^http:\/\/localhost:3000\//);
});
test('rejects response mode, amount, identity and URL substitution',async()=>{
 for(const patch of [{livemode:true},{id:'cs_live_fixture'},{amount_total:1},{client_reference_id:buyerId},{metadata:{}},{currency:'cad'},{mode:'subscription'},{url:'https://checkout.stripe.com.evil.example/x'},{url:'https://u:p@checkout.stripe.com/x'}]){
  const c=createStripeTestCheckoutClient({secretKey:'sk_test_fixture',fetchImpl:async()=>({ok:true,json:async()=>({...session(),status:'open',payment_status:'unpaid',...patch})})});
  await assert.rejects(c.createCheckout(input()));
 }
});
test('invalid inputs never reach provider; uncertain requests neither retry nor expose secrets',async()=>{
 let calls=0;const c=createStripeTestCheckoutClient({secretKey:'sk_test_fixture',fetchImpl:async()=>{calls++;throw Error('secret and private address');}});
 const i=input();i.listing.status='draft';await assert.rejects(c.createCheckout(i));assert.equal(calls,0);
 await assert.rejects(c.createCheckout(input()),e=>!e.message.includes('secret'));assert.equal(calls,1);
});
test('signed test webhook is accepted with rotated v1 signature and paid matching order',()=>{
 const {raw,signature}=signed(event());const verified=verifyStripeTestEvent(raw,signature+',v1='+'0'.repeat(64),{secret:'whsec_fixture',nowSeconds:1000});
 assert.ok(matchesPaidTestOrder(verified,{...buildTestCheckout(input()),sessionId:'cs_test_fixture'}));
});
test('rejects modified body, expired/future/duplicate timestamp, invalid signature and live event',()=>{
 const {raw,signature}=signed(event());const opts={secret:'whsec_fixture',nowSeconds:1000};
 assert.throws(()=>verifyStripeTestEvent(Buffer.concat([raw,Buffer.from(' ')]),signature,opts));
 for(const nowSeconds of [1301,699])assert.throws(()=>verifyStripeTestEvent(raw,signature,{...opts,nowSeconds}));
 for(const sig of [signature+',t=1000','t=1000,v1=nope','t=1e3,v1='+'0'.repeat(64)])assert.throws(()=>verifyStripeTestEvent(raw,sig,opts));
 for(const change of [e=>e.livemode=true,e=>e.data.object.livemode=true,e=>e.data.object.id='cs_live_fixture',e=>e.type='transfer.created',e=>e.data.object.metadata.order_id=buyerId]){const e=event();change(e);const s=signed(e);assert.throws(()=>verifyStripeTestEvent(s.raw,s.signature,opts));}
});
test('completed but unpaid, expired, wrong session, mismatched amount or order can never fulfill',()=>{
 const o={...buildTestCheckout(input()),sessionId:'cs_test_fixture'};
 for(const change of [e=>e.data.object.payment_status='unpaid',e=>e.data.object.status='open',e=>e.type='checkout.session.expired',e=>e.data.object.id='cs_test_other',e=>e.data.object.amount_total=1,e=>e.data.object.client_reference_id=buyerId]){const e=event();change(e);assert.equal(matchesPaidTestOrder(e,o),false);}
});

test('reconciliation retrieves the existing session without recreating it or returning private Stripe data',async()=>{
 const calls=[];
 for(const [status,payment_status,state] of [['open','unpaid','open'],['complete','unpaid','payment_pending'],['complete','paid','paid'],['expired','unpaid','expired']]){
  const client=createStripeTestCheckoutClient({secretKey:'rk_test_fixture',fetchImpl:async(url,opts)=>{
   calls.push({url,opts});return Response.json({...session(),status,payment_status,url:status==='open'?session().url:null,customer_email:'private@example.test',payment_intent:'pi_private'});
  }});
  const result=await client.retrieveCheckout({sessionId:'cs_test_fixture',snapshot:buildTestCheckout(input())});
  assert.equal(result.state,state);assert.equal(result.url,status==='open'?session().url:null);
  assert.deepEqual(Object.keys(result).sort(),['expiresAt','sessionId','state','test','url']);assert.ok(Object.isFrozen(result));
 }
 assert.equal(calls.length,4);
 for(const {url,opts} of calls){assert.equal(url,'https://api.stripe.com/v1/checkout/sessions/cs_test_fixture');assert.equal(opts.method,'GET');assert.equal(opts.body,undefined);assert.equal(opts.redirect,'error');assert.equal(opts.cache,'no-store');assert.equal(opts.headers['Stripe-Version'],'2026-10-28.endive');}
});
test('reconciliation validates persisted totals and session IDs before contacting Stripe',async()=>{
 let calls=0;const client=createStripeTestCheckoutClient({secretKey:'sk_test_fixture',fetchImpl:async()=>{calls++;return Response.json(session());}});
 const snapshot=buildTestCheckout(input());
 for(const patch of [{test:false},{currency:'CAD'},{orderId:undefined},{listingId:'bad'},{sellerId:'bad'},{totalCents:1},{buyerFeeCents:0},{shippingCents:-1},{taxCents:NaN}])await assert.rejects(client.retrieveCheckout({sessionId:'cs_test_fixture',snapshot:{...snapshot,...patch}}));
 for(const sessionId of ['cs_live_fixture','cs_test_fixture?expand[]=customer','https://evil.example',undefined])await assert.rejects(client.retrieveCheckout({sessionId,snapshot}));
 assert.equal(calls,0);
});
test('reconciliation rejects substituted, contradictory and cached provider evidence',async()=>{
 const snapshot=buildTestCheckout(input());
 for(const patch of [{id:'cs_test_other'},{livemode:true},{amount_total:1},{client_reference_id:buyerId},{metadata:{}},{currency:'cad'},{mode:'subscription'},{status:'open',payment_status:'paid'},{status:'expired',payment_status:'paid'},{payment_status:'no_payment_required'},{status:'unknown'},{expires_at:null}]){
  const c=createStripeTestCheckoutClient({secretKey:'sk_test_fixture',fetchImpl:async()=>Response.json({...session(),...patch})});
  await assert.rejects(c.retrieveCheckout({sessionId:'cs_test_fixture',snapshot}));
 }
 for(const headers of [{age:'1'},{age:'bad'},{'cf-cache-status':'HIT'},{'x-vercel-cache':'STALE'}]){
  const c=createStripeTestCheckoutClient({secretKey:'sk_test_fixture',fetchImpl:async()=>Response.json(session(),{headers})});
  await assert.rejects(c.retrieveCheckout({sessionId:'cs_test_fixture',snapshot}),/Cached/);
 }
});
test('failed or missing reconciliation never falls back to creation or leaks provider errors',async()=>{
 for(const response of [()=>{throw Error('private key');},()=>new Response('private key',{status:404}),()=>new Response('private key',{status:500}),()=>new Response('private key')]){
  let calls=0;const c=createStripeTestCheckoutClient({secretKey:'sk_test_fixture',fetchImpl:async()=>{calls++;return response();}});
  await assert.rejects(c.retrieveCheckout({sessionId:'cs_test_fixture',snapshot:buildTestCheckout(input())}),e=>!e.message.includes('private key'));assert.equal(calls,1);
 }
});
test('signed delayed outcomes and expiry require consistent payment and session states',()=>{
 for(const [type,status,payment_status] of [['checkout.session.completed','complete','unpaid'],['checkout.session.async_payment_succeeded','complete','paid'],['checkout.session.async_payment_failed','complete','unpaid'],['checkout.session.expired','expired','unpaid']]){
  const e=event();e.type=type;Object.assign(e.data.object,{status,payment_status});const good=signed(e);
  assert.equal(verifyStripeTestEvent(good.raw,good.signature,{secret:'whsec_fixture',nowSeconds:1000}).type,type);
  e.data.object.status='open';const bad=signed(e);assert.throws(()=>verifyStripeTestEvent(bad.raw,bad.signature,{secret:'whsec_fixture',nowSeconds:1000}));
 }
 for(const [type,payment_status,status] of [['checkout.session.async_payment_failed','paid','complete'],['checkout.session.async_payment_succeeded','unpaid','complete'],['checkout.session.expired','paid','expired'],['checkout.session.completed','no_payment_required','complete']]){
  const e=event();e.type=type;Object.assign(e.data.object,{status,payment_status});const bad=signed(e);assert.throws(()=>verifyStripeTestEvent(bad.raw,bad.signature,{secret:'whsec_fixture',nowSeconds:1000}));
 }
});
test('reconciliation freezes expected amounts before an asynchronous provider response',async()=>{
 const snapshot={...buildTestCheckout(input())};
 const c=createStripeTestCheckoutClient({secretKey:'sk_test_fixture',fetchImpl:async()=>{
  snapshot.taxCents=0;snapshot.totalCents=3100;
  return Response.json({...session(),amount_total:3100});
 }});
 await assert.rejects(c.retrieveCheckout({sessionId:'cs_test_fixture',snapshot}),/does not match/);
});
