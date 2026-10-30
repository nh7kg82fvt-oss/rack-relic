'use strict';
// Server-only test foundation. No public route, production configuration,
// inventory writes, transfers, refunds or live credentials are supported.
const {createHmac, timingSafeEqual}=require('node:crypto');
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SESSION=/^cs_test_[A-Za-z0-9]+$/;
function cents(n,max=10000000){
  if(!Number.isSafeInteger(n)||n<0||n>max)throw Error('Invalid test amount');
  return n;
}
function uuid(s){if(typeof s!=='string'||!UUID.test(s))throw Error('Invalid test identifier');return s;}
function quote(value,orderId,now){
  if(value?.test!==true||value.orderId!==orderId||!Number.isSafeInteger(value.expiresAt)||value.expiresAt<=now||value.expiresAt>now+1800000)throw Error('A current order-bound test quote is required');
  return cents(value.amountCents);
}
// Input must come from a trusted server snapshot after reservation, never a
// request body. This validator does NOT implement authentication or a DB lock.
function buildTestOrderBase({orderId,buyerId,listing,shippingQuote},now=Date.now()){
  uuid(orderId);uuid(buyerId);uuid(listing?.id);uuid(listing?.seller_id);
  if(!Number.isSafeInteger(now)||buyerId===listing.seller_id||listing.status!=='published'||listing.moderation_status!=='active')throw Error('Listing is not eligible');
  if(!['shipping','both'].includes(listing.delivery_mode))throw Error('Initial test checkout supports US shipping only');
  const itemCents=cents(listing.price_cents);if(itemCents<100)throw Error('Invalid item price');
  if(shippingQuote?.listingId!==listing.id||shippingQuote?.listingUpdatedAt!==listing.updated_at||typeof listing.updated_at!=='string'||!Number.isFinite(Date.parse(listing.updated_at)))throw Error('Shipping quote does not match the listing version');
  const shippingCents=quote(shippingQuote,orderId,now);cents(shippingCents,100000);
  const buyerFeeCents=Math.floor((itemCents*4+50)/100);
  const taxableTotalCents=itemCents+buyerFeeCents+shippingCents;
  return Object.freeze({test:true,orderId,listingId:listing.id,sellerId:listing.seller_id,
    currency:'USD',itemCents,buyerFeeCents,shippingCents,baseCents:taxableTotalCents});
}
function buildTestCheckout(input,now=Date.now()){
  const base=buildTestOrderBase(input,now),{taxQuote}=input;
  const {orderId,baseCents:taxableTotalCents}=base;
  if(taxQuote?.status!=='calculated'||taxQuote?.currency!=='USD'||taxQuote?.country!=='US')throw Error('An explicit US test tax calculation is required');
  if(taxQuote.baseCents!==taxableTotalCents)throw Error('Tax quote does not match checkout');
  if(taxQuote.blocked===true||taxQuote.taxabilityReasons?.includes('not_collecting'))throw Error('Tax registration is not ready');
  if(taxQuote.destinationHash!==undefined&&taxQuote.destinationHash!==input.shippingQuote.destinationHash)throw Error('Tax and shipping destinations do not match');
  const taxCents=quote(taxQuote,orderId,now);
  return Object.freeze({...base,taxCents,
    totalCents:taxableTotalCents+taxCents});
}
function createStripeTestCheckoutClient({secretKey,fetchImpl=globalThis.fetch}={}){
  if(typeof secretKey!=='string'||!/^sk_test_[A-Za-z0-9]+$/.test(secretKey))throw Error('Stripe test secret key required');
  if(typeof fetchImpl!=='function')throw Error('Test transport required');
  return Object.freeze({
    async createCheckout(input){
      const snapshot=buildTestCheckout(input);
      const form=new URLSearchParams({mode:'payment',billing_address_collection:'required','payment_method_options[card][request_three_d_secure]':'any',success_url:'http://localhost:3000/test-checkout/success?session_id={CHECKOUT_SESSION_ID}',cancel_url:'http://localhost:3000/test-checkout/cancel',client_reference_id:snapshot.orderId,
        'payment_method_types[0]':'card','metadata[order_id]':snapshot.orderId,'metadata[integration]':'rack_relic_test',
        'payment_intent_data[metadata][order_id]':snapshot.orderId,'payment_intent_data[transfer_group]':'rr_test_'+snapshot.orderId});
      let index=0;
      for(const [name,amount] of [['Test item',snapshot.itemCents],['Buyer platform fee (4%)',snapshot.buyerFeeCents],['US test shipping',snapshot.shippingCents],['Test tax',snapshot.taxCents]]){
        if(amount===0)continue;
        const key='line_items['+(index++)+']';
        form.set(key+'[quantity]','1');form.set(key+'[price_data][currency]','usd');form.set(key+'[price_data][unit_amount]',String(amount));form.set(key+'[price_data][product_data][name]',name);
      }
      let response;
      try{response=await fetchImpl('https://api.stripe.com/v1/checkout/sessions',{
        method:'POST',redirect:'error',cache:'no-store',signal:AbortSignal.timeout(20000),
        headers:{Authorization:'Bearer '+secretKey,'Content-Type':'application/x-www-form-urlencoded','Stripe-Version':'2025-02-24.acacia','Idempotency-Key':'rr_test_checkout_'+snapshot.orderId},body:form.toString()
      });}catch{throw Error('Stripe test request uncertain; reconcile the same order before retrying');}
      if(!response.ok)throw Error('Stripe test checkout rejected; reconcile before retrying');
      let data;try{data=await response.json();}catch{throw Error('Invalid Stripe test response');}
      let url;try{url=new URL(data.url);}catch{throw Error('Invalid Stripe test checkout URL');}
      if(data.livemode!==false||!SESSION.test(data.id)||data.mode!=='payment'||data.currency!=='usd'||data.amount_total!==snapshot.totalCents||data.client_reference_id!==snapshot.orderId||data.metadata?.integration!=='rack_relic_test'||data.metadata?.order_id!==snapshot.orderId||url.protocol!=='https:'||url.hostname!=='checkout.stripe.com'||url.port||url.username||url.password)throw Error('Stripe test response does not match the order');
      return Object.freeze({test:true,sessionId:data.id,url:url.href,snapshot});
    }
  });
}
// Verify RAW bytes before parsing. A durable unique event ID + atomic order
// update is still required by the future consumer; this is not replay storage.
function verifyStripeTestEvent(raw,signature,{secret,nowSeconds=Math.floor(Date.now()/1000)}={}){
  if(!Buffer.isBuffer(raw)||raw.length>1048576||typeof signature!=='string'||signature.length>4096||typeof secret!=='string'||!/^whsec_[A-Za-z0-9]+$/.test(secret)||!Number.isSafeInteger(nowSeconds))throw Error('Invalid test webhook input');
  const parts=signature.split(',').map(x=>x.trim().split('='));
  const times=parts.filter(x=>x[0]==='t');const signatures=parts.filter(x=>x[0]==='v1').map(x=>x[1]);
  if(times.length!==1||!/^\d{1,12}$/.test(times[0][1]))throw Error('Invalid webhook timestamp');
  const timestamp=Number(times[0][1]);if(Math.abs(nowSeconds-timestamp)>300)throw Error('Expired webhook signature');
  const expected=createHmac('sha256',secret).update(String(timestamp)+'.').update(raw).digest();
  if(!signatures.some(s=>/^[0-9a-f]{64}$/.test(s)&&timingSafeEqual(expected,Buffer.from(s,'hex'))))throw Error('Invalid webhook signature');
  let event;try{event=JSON.parse(raw.toString('utf8'));}catch{throw Error('Invalid webhook JSON');}
  if(event?.livemode!==false||typeof event.id!=='string'||!/^evt_[A-Za-z0-9]+$/.test(event.id)||!['checkout.session.completed','checkout.session.async_payment_succeeded','checkout.session.expired'].includes(event.type))throw Error('Unsupported test event');
  const session=event.data?.object;
  if(session?.livemode!==false||!SESSION.test(session.id)||session.mode!=='payment'||session.metadata?.integration!=='rack_relic_test')throw Error('Invalid test session');
  uuid(session.client_reference_id);if(session.metadata?.order_id!==session.client_reference_id)throw Error('Order metadata mismatch');
  cents(session.amount_total,30000000);if(session.currency!=='usd')throw Error('Unsupported currency');
  return event;
}
// Call only with a verified event and an immutable order loaded from the DB.
// The success URL alone must NEVER mark an order paid.
function matchesPaidTestOrder(event,order){
  const s=event?.data?.object;
  return !!(order?.test===true&&event?.livemode===false&&['checkout.session.completed','checkout.session.async_payment_succeeded'].includes(event.type)&&s?.livemode===false&&s.payment_status==='paid'&&s.status==='complete'&&s.mode==='payment'&&s.currency==='usd'&&s.metadata?.integration==='rack_relic_test'&&s.id===order.sessionId&&s.client_reference_id===order.orderId&&s.metadata?.order_id===order.orderId&&s.amount_total===order.totalCents);
}
module.exports={buildTestOrderBase,buildTestCheckout,createStripeTestCheckoutClient,verifyStripeTestEvent,matchesPaidTestOrder};
