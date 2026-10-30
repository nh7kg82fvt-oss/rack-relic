'use strict';
const {buildTestCheckout}=require('./marketplace_test_checkout.cjs');
const {usAddress,destinationHash}=require('./stripe_test_tax.cjs');
class CheckoutPending extends Error{}
// Only a trusted server loader may supply a synthetic seller's return address,
// packed dimensions, listing version and explicit tax classifications.
function createTestQuoteService({shipping,tax,loadFulfillment,clock=Date.now}={}){
 if(!shipping?.quote||!tax?.quote||typeof loadFulfillment!=='function')throw Error('Test quote providers required');
 return Object.freeze({async quote({order,to}){
  const destination=usAddress(to),source=await loadFulfillment(order.listing_id,order);
  if(source?.test!==true||source.sellerId!==order.seller_id||source.listingUpdatedAt!==order.listing_updated_at)throw Error('Trusted test fulfillment details required');
  const origin=usAddress(source.from);
  const toShippo=(a,name)=>({name,street1:a.line1,street2:a.line2,city:a.city,state:a.state,zip:a.postal_code,country:a.country});
  const shipment=await shipping.quote({from:toShippo(origin,'Synthetic test seller'),to:toShippo(destination,'Synthetic test buyer'),package:source.package});
  if(shipment?.test!==true||!Array.isArray(shipment.rates))throw Error('Test shipping unavailable');
  const rate=shipment.rates.filter(r=>r.test===true&&r.currency==='USD'&&/^[a-f0-9]{32}$/.test(r.id)&&Number.isSafeInteger(r.amountCents)&&r.amountCents>=0&&r.amountCents<=100000).sort((a,b)=>a.amountCents-b.amountCents||a.id.localeCompare(b.id))[0];
  if(!rate)throw Error('No eligible test shipping rate');
  const input={orderId:order.id,buyerId:order.buyer_id,listing:{id:order.listing_id,seller_id:order.seller_id,price_cents:order.item_cents,updated_at:order.listing_updated_at,status:'published',moderation_status:'active',delivery_mode:'shipping'},shippingQuote:{test:true,orderId:order.id,listingId:order.listing_id,listingUpdatedAt:order.listing_updated_at,expiresAt:clock()+600000,amountCents:rate.amountCents,rateId:rate.id,destinationHash:destinationHash(destination)}};
  const result=await tax.quote({...input,to:destination,from:origin,itemTaxCode:source.itemTaxCode,buyerFeeTaxCode:source.buyerFeeTaxCode});
  // Persist only the financial evidence, never addresses or provider payloads.
  input.taxQuote=Object.fromEntries(['test','status','country','currency','orderId','baseCents','amountCents','expiresAt','destinationHash','taxCalculationId','taxabilityReasons','blocked'].filter(k=>Object.hasOwn(result,k)).map(k=>[k,result[k]]));
  buildTestCheckout(input,clock());
  return input;
 }});
}
function createTestCheckoutService({repository,quotes,stripe,clock=Date.now}={}){
 if(!repository||!quotes?.quote||!stripe?.createCheckout||!stripe?.retrieveCheckout)throw Error('Test checkout dependencies required');
 const result=(order,evidence)=>Object.freeze({test:true,orderId:order.id,state:order.state,url:order.state==='checkout_open'&&evidence.state==='open'?evidence.url:null,totalCents:order.snapshot?.totalCents??evidence.snapshot?.totalCents});
 async function recover({authorization,orderId},state){
  const a=state.attempt;
  if(!a?.session_id)throw new CheckoutPending('Checkout is awaiting reconciliation');
  const evidence=await stripe.retrieveCheckout({sessionId:a.session_id,snapshot:a.snapshot});
  // Retrieval is not payment authority. Existing signed webhook state wins.
  if(a.phase!=='attached'&&evidence.state!=='open')throw new CheckoutPending('Closed checkout requires reconciliation');
  const order=await repository.finishCheckout({authorization,orderId});
  return result(order,evidence);
 }
 return Object.freeze({async start({authorization,orderId,listingId,to}={}){
  const order=await repository.reserve({authorization,orderId,listingId});
  let state=await repository.checkoutAttempt({authorization,orderId});
  const hash=destinationHash(to);
  if(state.attempt&&state.attempt.input.shippingQuote.destinationHash!==hash)throw Error('Destination differs from the saved checkout');
  if(state.attempt&&state.attempt.phase!=='prepared')return recover({authorization,orderId},state);
  if(!state.attempt){
   const input=await quotes.quote({order,to});
   // Price, buyer and listing always come from the authenticated reservation.
   if(input.orderId!==order.id||input.buyerId!==order.buyer_id||input.listing?.id!==order.listing_id||input.listing?.seller_id!==order.seller_id||input.listing?.price_cents!==order.item_cents||input.listing?.updated_at!==order.listing_updated_at)throw Error('Quote does not match reservation');
   const snapshot=buildTestCheckout(input,clock());
   if(!/^[a-f0-9]{32}$/.test(input.shippingQuote.rateId)||!/^taxcalc_[A-Za-z0-9]+$/.test(input.taxQuote.taxCalculationId)||!/^[a-f0-9]{64}$/.test(input.shippingQuote.destinationHash)||input.taxQuote.destinationHash!==input.shippingQuote.destinationHash)throw Error('Missing order-bound quote evidence');
   const prepared=await repository.prepareCheckout({authorization,orderId,input,snapshot,expiresAt:Math.min(input.shippingQuote.expiresAt,input.taxQuote.expiresAt)});
   if(prepared.input.shippingQuote.destinationHash!==hash)throw Error('Destination differs from the saved checkout');
  }
  const claim=await repository.dispatchCheckout({authorization,orderId});
  if(!claim.dispatch)return recover({authorization,orderId},await repository.checkoutAttempt({authorization,orderId}));
  // From this point, all failures leave the durable dispatched marker in place.
  // Retrying this HTTP request can never issue a second Stripe POST.
  const created=await stripe.createCheckout(claim.attempt.input);
  await repository.saveCheckoutSession({authorization,orderId,sessionId:created.sessionId,expiresAt:created.expiresAt});
  const attached=await repository.finishCheckout({authorization,orderId});
  return result(attached,created);
 },async status({authorization,orderId}){
  return recover({authorization,orderId},await repository.checkoutAttempt({authorization,orderId}));
 }});
}
module.exports={createTestQuoteService,createTestCheckoutService,CheckoutPending};
