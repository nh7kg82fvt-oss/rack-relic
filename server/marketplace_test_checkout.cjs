'use strict';
// Server-only test foundation. No public route, production configuration,
// inventory writes, transfers, refund issuance or live credentials are supported.
const {createHmac, timingSafeEqual, createHash}=require('node:crypto');
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SESSION=/^cs_test_[A-Za-z0-9]+$/;
const STRIPE_VERSION='2026-10-28.endive';
// Generated once per integration, never per request: retries must be identical.
const INTEGRATION_IDENTIFIER='rack_relic_test_eblyngyn';
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
// Reconciliation consumes the immutable persisted snapshot, not expired quotes
// and never browser-supplied prices. It only reports evidence; it cannot fulfill.
function validatePersistedSnapshot(snapshot){
  if(snapshot?.test!==true||snapshot.currency!=='USD')throw Error('Trusted test snapshot required');
  uuid(snapshot.orderId);uuid(snapshot.listingId);uuid(snapshot.sellerId);
  for(const key of ['itemCents','buyerFeeCents','taxCents'])cents(snapshot[key]);
  cents(snapshot.shippingCents,100000);cents(snapshot.totalCents,30000000);
  if(snapshot.itemCents<100||snapshot.buyerFeeCents!==Math.floor((snapshot.itemCents*4+50)/100)||snapshot.totalCents!==snapshot.itemCents+snapshot.buyerFeeCents+snapshot.shippingCents+snapshot.taxCents)throw Error('Invalid persisted test total');
}
function validateSession(data,snapshot,expectedId){
  if(data?.livemode!==false||!SESSION.test(data.id)||expectedId&&data.id!==expectedId||data.mode!=='payment'||data.currency!=='usd'||data.amount_total!==snapshot.totalCents||data.client_reference_id!==snapshot.orderId||data.metadata?.integration!=='rack_relic_test'||data.metadata?.order_id!==snapshot.orderId)throw Error('Stripe test response does not match the order');
  const states={open:'unpaid',expired:'unpaid'};
  if(!['open','complete','expired'].includes(data.status)||!['unpaid','paid'].includes(data.payment_status)||states[data.status]&&data.payment_status!==states[data.status])throw Error('Invalid Stripe test session state');
  if(!Number.isSafeInteger(data.expires_at)||data.expires_at<=0)throw Error('Invalid Stripe test expiry');
  let url=null;
  if(data.status==='open'){
    try{url=new URL(data.url);}catch{throw Error('Invalid Stripe test checkout URL');}
    if(url.protocol!=='https:'||url.hostname!=='checkout.stripe.com'||url.port||url.username||url.password)throw Error('Invalid Stripe test checkout URL');
  }
  return Object.freeze({test:true,sessionId:data.id,url:url?.href||null,
    state:data.status==='complete'?(data.payment_status==='paid'?'paid':'payment_pending'):data.status,
    expiresAt:data.expires_at*1000});
}
function createStripeTestCheckoutClient({secretKey,fetchImpl=globalThis.fetch,returnOrigin='http://localhost:3000'}={}){
  if(!['http://localhost:3000','https://rack-relic-git-test-only-marketplace-foundation-rack-relic.vercel.app'].includes(returnOrigin))throw Error('Protected test return origin required');
  if(typeof secretKey!=='string'||!/^(sk|rk)_test_[A-Za-z0-9]+$/.test(secretKey))throw Error('Stripe test secret key required');
  if(typeof fetchImpl!=='function')throw Error('Test transport required');
  return Object.freeze({
    async createCheckout(input){
      const snapshot=buildTestCheckout(input);
      const form=new URLSearchParams({mode:'payment',integration_identifier:INTEGRATION_IDENTIFIER,'adaptive_pricing[enabled]':'false',billing_address_collection:'required','payment_method_options[card][request_three_d_secure]':'any',success_url:returnOrigin+'/api/test-marketplace?view=return&session_id={CHECKOUT_SESSION_ID}',cancel_url:returnOrigin+'/api/test-marketplace?view=cancel',client_reference_id:snapshot.orderId,
        'metadata[order_id]':snapshot.orderId,'metadata[integration]':'rack_relic_test',
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
        headers:{Authorization:'Bearer '+secretKey,'Content-Type':'application/x-www-form-urlencoded','Stripe-Version':STRIPE_VERSION,'Idempotency-Key':'rr_test_checkout_'+snapshot.orderId},body:form.toString()
      });}catch{throw Error('Stripe test request uncertain; reconcile the same order before retrying');}
      if(!response.ok)throw Error('Stripe test checkout rejected; reconcile before retrying');
      let data;try{data=await response.json();}catch{throw Error('Invalid Stripe test response');}
      const evidence=validateSession(data,snapshot);
      if(evidence.state!=='open')throw Error('Existing test checkout is closed; reconcile the order');
      return Object.freeze({...evidence,snapshot});
    },
    // Safe after attachment uncertainty when the session ID is known. No POST,
    // replacement checkout, inventory release, ledger entry or job is issued.
    async retrieveCheckout({sessionId,snapshot}={}){
      if(typeof sessionId!=='string'||!SESSION.test(sessionId))throw Error('Test session required');
      const expected=Object.freeze({...snapshot});
      validatePersistedSnapshot(expected);
      let response;
      try{response=await fetchImpl('https://api.stripe.com/v1/checkout/sessions/'+sessionId,{
        method:'GET',redirect:'error',cache:'no-store',signal:AbortSignal.timeout(20000),
        headers:{Authorization:'Bearer '+secretKey,'Stripe-Version':STRIPE_VERSION}
      });}catch{throw Error('Stripe test reconciliation unavailable; keep the order held');}
      if(!response.ok)throw Error('Stripe test reconciliation unavailable; keep the order held');
      const age=response.headers?.get('age');
      if(age!=null&&(!/^\d+$/.test(age)||Number(age)>0)||['x-vercel-cache','cf-cache-status'].some(k=>['HIT','STALE','UPDATING'].includes((response.headers?.get(k)||'').toUpperCase())))throw Error('Cached checkout evidence rejected');
      let data;try{data=await response.json();}catch{throw Error('Invalid Stripe test response');}
      return validateSession(data,expected,sessionId);
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
  if(event?.livemode!==false||typeof event.id!=='string'||!/^evt_[A-Za-z0-9]+$/.test(event.id)||event.account&&event.account!=='acct_1UWJZuGVbz9Pnhxd')throw Error('Unsupported test event');
  if(['refund.created','refund.updated','refund.failed'].includes(event.type)){
    const r=event.data?.object;
    // Refund objects have no livemode field: the signed event supplies it.
    // Never use refund metadata to select an order; use its bound PaymentIntent.
    if(r?.object!=='refund'||!/^re_[A-Za-z0-9]+$/.test(r.id||'')||!/^pi_[A-Za-z0-9]+$/.test(r.payment_intent||'')||!/^ch_[A-Za-z0-9]+$/.test(r.charge||'')||r.currency!=='usd'||r.livemode===true)throw Error('Invalid test refund');
    if(!Number.isSafeInteger(event.created)||event.created<=0||event.created>nowSeconds+30||!['pending','requires_action','succeeded','failed','canceled'].includes(r.status))throw Error('Invalid refund evidence');
    if(event.type==='refund.failed'&&r.status!=='failed')throw Error('Conflicting refund evidence');
    if(r.metadata?.integration==='rack_relic_test_refund'){uuid(r.metadata.request_id);uuid(r.metadata.order_id);}
    if(cents(r.amount,30000000)<1)throw Error('Invalid refund amount');
    return event;
  }
  if(!['checkout.session.completed','checkout.session.async_payment_succeeded','checkout.session.async_payment_failed','checkout.session.expired'].includes(event.type))throw Error('Unsupported test event');
  const session=event.data?.object;
  if(session?.livemode!==false||!SESSION.test(session.id)||session.mode!=='payment'||session.metadata?.integration!=='rack_relic_test')throw Error('Invalid test session');
  uuid(session.client_reference_id);if(session.metadata?.order_id!==session.client_reference_id)throw Error('Order metadata mismatch');
  cents(session.amount_total,30000000);if(session.currency!=='usd')throw Error('Unsupported currency');
  if(!['paid','unpaid'].includes(session.payment_status))throw Error('Invalid test payment state');
  if(event.type==='checkout.session.expired'){
    if(session.status!=='expired'||session.payment_status!=='unpaid')throw Error('Invalid expiry evidence');
  }else{
    if(session.status!=='complete')throw Error('Invalid completed session');
    if(event.type==='checkout.session.async_payment_succeeded'&&session.payment_status!=='paid'||event.type==='checkout.session.async_payment_failed'&&session.payment_status!=='unpaid')throw Error('Conflicting delayed payment evidence');
  }
  return event;
}
// Shared Node/Edge routing. Activation follows the refund migration; defaults
// preserve the already-deployed checkout receiver until staging is upgraded.
function stripeTestEventRpc(event,raw,{refundsEnabled=false,refundRequestsEnabled=false}={}){
  const s=event.data.object;
  const common={p_event:event.id,p_payload_hash:createHash('sha256').update(raw).digest('hex'),p_type:event.type};
  if(event.type.startsWith('refund.')){
    if(!refundsEnabled)throw Error('Test refund receiver not activated');
    const payload={...common,p_refund:s.id,p_payment_intent:s.payment_intent,p_charge:s.charge,p_amount:s.amount,p_currency:s.currency,p_status:s.status,p_created:event.created};
    if(refundRequestsEnabled)payload.p_request=s.metadata?.integration==='rack_relic_test_refund'?s.metadata.request_id:null;
    return {name:refundRequestsEnabled?'rr_test_process_refund_receipt':'rr_test_process_refund',payload};
  }
  const payload={...common,p_order:s.client_reference_id,p_session:s.id,p_amount:s.amount_total,p_currency:s.currency,p_paid:s.payment_status==='paid'&&s.status==='complete'};
  if(refundsEnabled)payload.p_payment_intent=s.payment_intent??null;
  return {name:refundsEnabled?'rr_test_process_payment_event':'rr_test_process_event',payload};
}
// Call only with a verified event and an immutable order loaded from the DB.
// The success URL alone must NEVER mark an order paid.
function matchesPaidTestOrder(event,order){
  const s=event?.data?.object;
  return !!(order?.test===true&&event?.livemode===false&&['checkout.session.completed','checkout.session.async_payment_succeeded'].includes(event.type)&&s?.livemode===false&&s.payment_status==='paid'&&s.status==='complete'&&s.mode==='payment'&&s.currency==='usd'&&s.metadata?.integration==='rack_relic_test'&&s.id===order.sessionId&&s.client_reference_id===order.orderId&&s.metadata?.order_id===order.orderId&&s.amount_total===order.totalCents);
}
module.exports={buildTestOrderBase,buildTestCheckout,createStripeTestCheckoutClient,verifyStripeTestEvent,stripeTestEventRpc,matchesPaidTestOrder};
