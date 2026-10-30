'use strict';
const {createHash}=require('node:crypto');
const {verifyStripeTestEvent}=require('./marketplace_test_checkout.cjs');
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const PRODUCTION_PROJECT='zrfztnbyynrdzfeblkeq';
class OrderServiceUnavailable extends Error{}
class OrderAccessDenied extends Error{}
function createTestOrderRepository({projectUrl,serviceKey,fetchImpl=globalThis.fetch,allowedMemberIds}={}){
 let url;try{url=new URL(projectUrl);}catch{throw Error('Separate test database required');}
 const project=url.hostname.split('.')[0];
 if(!/^[a-z0-9]{20}$/.test(project)||url.hostname!==project+'.supabase.co'||project===PRODUCTION_PROJECT||url.protocol!=='https:'||url.port||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw Error('Separate test database required');
 if(typeof serviceKey!=='string'||!/^sb_secret_[A-Za-z0-9_-]+$/.test(serviceKey)){
  let claims;try{claims=JSON.parse(Buffer.from(serviceKey.split('.')[1],'base64url').toString());}catch{throw Error('Server-only test database key required');}
  if(claims.role!=='service_role'||claims.ref!==project)throw Error('Server-only test database key required');
 }
 if(typeof fetchImpl!=='function')throw Error('Test transport required');
 const origin=url.origin;
 async function request(path,body,authorization){
  let response;try{response=await fetchImpl(origin+path,{method:body?'POST':'GET',redirect:'error',cache:'no-store',signal:AbortSignal.timeout(10000),headers:{apikey:serviceKey,Authorization:authorization||'Bearer '+serviceKey,'Content-Type':'application/json','Cache-Control':'no-store'},...(body?{body:JSON.stringify(body)}:{})});}catch{throw new OrderServiceUnavailable('Test order service unavailable');}
  const age=response.headers?.get('age');if((age!==null&&age!==undefined&&(!/^\d+$/.test(age)||Number(age)>0))||['x-vercel-cache','cf-cache-status'].some(k=>['HIT','STALE','UPDATING'].includes((response.headers?.get(k)||'').toUpperCase())))throw new OrderServiceUnavailable('Cached order authority rejected');
  if(!response.ok){if(authorization&&[401,403].includes(response.status))throw new OrderAccessDenied('Sign in required');throw new OrderServiceUnavailable('Test order operation rejected');}
  try{return await response.json();}catch{throw new OrderServiceUnavailable('Invalid order service response');}
 }
 async function member(authorization){
  if(typeof authorization!=='string'||!/^Bearer [^\s]{1,8192}$/.test(authorization))throw new OrderAccessDenied('Sign in required');
  const user=await request('/auth/v1/user',undefined,authorization);
  if(!UUID.test(user?.id||'')||allowedMemberIds&&!allowedMemberIds.includes(user.id))throw new OrderAccessDenied('Sign in required');return user.id;
 }
 const id=v=>{if(!UUID.test(v||''))throw new OrderAccessDenied('Invalid order identifier');return v;};
 const rpc=(name,args)=>request('/rest/v1/rpc/'+name,args);
 return Object.freeze({
  async reserve({authorization,orderId,listingId}){
   id(orderId);id(listingId);const buyer=await member(authorization);
   return rpc('rr_test_reserve',{p_order:orderId,p_listing:listingId,p_buyer:buyer});
  },
  // Server orchestration only: never publish this as a browser-supplied RPC.
  async attachCheckout({orderId,sessionId,snapshot,taxCalculationId,destinationHash,shippingRateId,expiresAt}){
   id(orderId);
   if(snapshot?.test!==true||snapshot.orderId!==orderId)throw new OrderAccessDenied('Invalid test snapshot');
   return rpc('rr_test_attach_checkout',{p_order:orderId,p_session:sessionId,p_snapshot:snapshot,p_tax_calculation:taxCalculationId,p_destination_hash:destinationHash,p_shipping_rate:shippingRateId,p_expires:expiresAt});
  },
  async checkoutAttempt({authorization,orderId}){
   id(orderId);const buyer=await member(authorization);
   return rpc('rr_test_checkout_attempt',{p_order:orderId,p_buyer:buyer});
  },
  async prepareCheckout({authorization,orderId,input,snapshot,expiresAt}){
   id(orderId);const buyer=await member(authorization);
   return rpc('rr_test_prepare_checkout',{p_order:orderId,p_buyer:buyer,p_input:input,p_snapshot:snapshot,p_expires:new Date(expiresAt).toISOString()});
  },
  async dispatchCheckout({authorization,orderId}){
   id(orderId);const buyer=await member(authorization);
   return rpc('rr_test_dispatch_checkout',{p_order:orderId,p_buyer:buyer});
  },
  async saveCheckoutSession({authorization,orderId,sessionId,expiresAt}){
   id(orderId);const buyer=await member(authorization);
   return rpc('rr_test_save_checkout_session',{p_order:orderId,p_buyer:buyer,p_session:sessionId,p_expires:new Date(expiresAt).toISOString()});
  },
  async finishCheckout({authorization,orderId}){
   id(orderId);const buyer=await member(authorization);
   return rpc('rr_test_finish_checkout',{p_order:orderId,p_buyer:buyer});
  },
  async memberOrders({authorization}){
   const user=await member(authorization);const rows=await rpc('rr_test_member_orders',{p_member:user});
   if(!Array.isArray(rows)||rows.length>100)throw new OrderServiceUnavailable('Invalid order list');
   if(rows.some(row=>!UUID.test(row?.id||'')||(row.buyer_id!==user&&row.seller_id!==user)))throw new OrderServiceUnavailable('Order ownership mismatch');
   const fields=['id','listing_id','buyer_id','seller_id','state','risk_status','item_cents','buyer_fee_cents','shipping_cents','tax_cents','total_cents','created_at','updated_at'];
   return rows.map(row=>Object.fromEntries(fields.filter(k=>Object.hasOwn(row,k)).map(k=>[k,row[k]])));
  },
  async acceptStripeEvent({rawBody,signature,webhookSecret,nowSeconds}){
   const event=verifyStripeTestEvent(rawBody,signature,{secret:webhookSecret,...(nowSeconds===undefined?{}:{nowSeconds})});
   const s=event.data.object;
   return rpc('rr_test_process_event',{p_event:event.id,p_payload_hash:createHash('sha256').update(rawBody).digest('hex'),p_type:event.type,p_order:s.client_reference_id,p_session:s.id,p_amount:s.amount_total,p_currency:s.currency,p_paid:s.payment_status==='paid'&&s.status==='complete'});
  },
  // Assessment must come from evaluateTestCharge with freshly fetched Stripe data.
  async recordRisk(evidence){
   id(evidence?.orderId);if(evidence.test!==true)throw new OrderAccessDenied('Test evidence required');
   return rpc('rr_test_record_risk',{p_order:evidence.orderId,p_evidence:evidence,p_hash:createHash('sha256').update(JSON.stringify(evidence)).digest('hex')});
  }
 });
}
module.exports={createTestOrderRepository,OrderServiceUnavailable,OrderAccessDenied};
