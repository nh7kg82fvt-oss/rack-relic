'use strict';
const {createHash}=require('node:crypto');
const {verifyStripeTestEvent,stripeTestEventRpc}=require('./marketplace_test_checkout.cjs');
const {validateFulfillment,publicFulfillmentStatus}=require('./test_fulfillment.cjs');
const {validateLabelAttempt,publicLabel}=require('./test_label_service.cjs');
const {publicTrackingStatus}=require('./test_tracking_service.cjs');
const {RESPONSES,publicIssueThread}=require('./test_issue_thread.cjs');
const {publicIssueRefundReview}=require('../test-issue-refund-review.js');
const {publicProtectionReview}=require('../test-protection-review.js');
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const PRODUCTION_PROJECT='zrfztnbyynrdzfeblkeq';
class OrderServiceUnavailable extends Error{}
class OrderAccessDenied extends Error{}
function createTestOrderRepository({projectUrl,serviceKey,fetchImpl=globalThis.fetch,allowedMemberIds,refundsEnabled=false,refundRequestsEnabled=false,allowedRefundOperatorIds=[]}={}){
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
 async function refundOperator(authorization){
  if(refundsEnabled!==true||refundRequestsEnabled!==true||project!=='zvtaqzcqfdjpuwnlpzln'||!Array.isArray(allowedRefundOperatorIds)||!allowedRefundOperatorIds.length||!allowedRefundOperatorIds.every(v=>UUID.test(v)&&allowedMemberIds?.includes(v)))throw new OrderAccessDenied('Refund operator access required');
  const actor=await member(authorization);
  if(!allowedRefundOperatorIds.includes(actor))throw new OrderAccessDenied('Refund operator access required');return actor;
 }
 function validChargeFee(f,orderId,total,pi){
  return f?.test===true&&f.orderId===orderId&&/^pi_[A-Za-z0-9]+$/.test(f.paymentIntentId||'')&&/^ch_[A-Za-z0-9]+$/.test(f.chargeId||'')&&/^txn_[A-Za-z0-9]+$/.test(f.balanceTransactionId||'')&&f.currency==='USD'&&Number.isSafeInteger(f.grossCents)&&f.grossCents>0&&f.grossCents<=30000000&&(total===undefined||f.grossCents===total)&&(pi===undefined||f.paymentIntentId===pi)&&Number.isSafeInteger(f.feeCents)&&f.feeCents>=0&&f.feeCents<=f.grossCents&&Number.isSafeInteger(f.netCents)&&f.netCents===f.grossCents-f.feeCents&&Number.isSafeInteger(f.checkedAt)&&Array.isArray(f.feeDetails)&&f.feeDetails.length<=20&&f.feeDetails.every(d=>['stripe_fee','tax'].includes(d?.type)&&d.currency==='USD'&&Number.isSafeInteger(d.amountCents)&&d.amountCents>=0)&&f.feeDetails.reduce((n,d)=>n+d.amountCents,0)===f.feeCents;
 }
 return Object.freeze({
  async protectionReview({authorization,orderId}){id(orderId);const actor=await refundOperator(authorization);return publicProtectionReview(await rpc('rr_test_protection_review',{p_actor:actor,p_order:orderId}),orderId);},
  async holdSeller({authorization,orderId,reason}){id(orderId);const actor=await refundOperator(authorization);if(!['suspicious_activity','delivery_problem','verification_problem'].includes(reason))throw new OrderAccessDenied('Invalid hold reason');const r=await rpc('rr_test_hold_seller',{p_actor:actor,p_order:orderId,p_reason:reason});if(r?.test!==true||r.orderId!==orderId||r.held!==true||r.releaseEnabled!==false)throw new OrderServiceUnavailable('Seller hold unavailable');return {test:true,orderId,held:true,releaseEnabled:false};},
  async recordSellerProtection({authorization,accountId,ready,checkedAt}){const actor=await member(authorization);if(!/^acct_[A-Za-z0-9]+$/.test(accountId||'')||typeof ready!=='boolean'||!Number.isSafeInteger(checkedAt))throw new OrderServiceUnavailable('Invalid seller evidence');const r=await rpc('rr_test_record_seller_protection',{p_actor:actor,p_account:accountId,p_ready:ready,p_checked:checkedAt});if(r?.test!==true||r.recorded!==true)throw new OrderServiceUnavailable('Seller verification not recorded');return {test:true,recorded:true};},
  async issueRefundReview({authorization,orderId}){id(orderId);const actor=await refundOperator(authorization);return publicIssueRefundReview(await rpc('rr_test_issue_refund_review',{p_actor:actor,p_order:orderId}),orderId);},
  async reviewOrderIssues({authorization}){
   const actor=await refundOperator(authorization),rows=await rpc('rr_test_issue_review',{p_actor:actor});
   const date=v=>typeof v==='string'&&Number.isFinite(Date.parse(v));
   if(!Array.isArray(rows)||rows.length>101||rows.some(r=>r?.participant!==true||!UUID.test(r.order_id||'')||!['not_received','damaged','not_as_described'].includes(r.reason)||!date(r.reported_at)||r.acknowledged_at!==null&&!date(r.acknowledged_at)||r.seller_response!=null&&(!RESPONSES.includes(r.seller_response)||!date(r.seller_submitted_at))||r.seller_response==null&&r.seller_submitted_at!=null))throw new OrderServiceUnavailable('Invalid issue queue');
   return {test:true,hasMore:rows.length>100,issues:rows.slice(0,100).map(r=>({orderId:r.order_id,reason:r.reason,reportedAt:r.reported_at,acknowledgedAt:r.acknowledged_at,...(r.seller_response?{sellerResponse:{kind:r.seller_response,submittedAt:r.seller_submitted_at}}:{})}))};
  },
  async acknowledgeOrderIssue({authorization,orderId}){
   id(orderId);const actor=await refundOperator(authorization),r=await rpc('rr_test_acknowledge_issue',{p_actor:actor,p_order:orderId});
   if(r?.test!==true||r.orderId!==orderId||r.acknowledged!==true||typeof r.acknowledgedAt!=='string'||!Number.isFinite(Date.parse(r.acknowledgedAt)))throw new OrderServiceUnavailable('Invalid issue acknowledgment');
   return {test:true,orderId,acknowledged:true,acknowledgedAt:r.acknowledgedAt};
  },
  async issueThread({authorization,orderId,response}){id(orderId);const actor=await member(authorization);if(response!==undefined&&!RESPONSES.includes(response))throw new OrderAccessDenied('Invalid seller response');return publicIssueThread(await rpc('rr_test_issue_thread',{p_actor:actor,p_order:orderId,p_response:response??null}),orderId);},
  async orderIssue({authorization,orderId,reason}){id(orderId);const actor=await member(authorization);if(reason!==undefined&&!['not_received','damaged','not_as_described'].includes(reason))throw new OrderAccessDenied('Invalid issue category');return rpc('rr_test_order_issue',{p_actor:actor,p_order:orderId,p_reason:reason??null});},
  async sellerContext({authorization}){const actor=await member(authorization);return rpc('rr_test_seller_context',{p_actor:actor});},
  async claimSeller({authorization}){const actor=await member(authorization);return rpc('rr_test_claim_seller',{p_actor:actor});},
  async saveSeller({authorization,accountId}){const actor=await member(authorization);if(!/^acct_[A-Za-z0-9]+$/.test(accountId||''))throw new OrderAccessDenied('Invalid seller account');return rpc('rr_test_save_seller',{p_actor:actor,p_account:accountId});},
  async refundAccess({authorization}){
   await refundOperator(authorization);return {test:true,allowed:true};
  },
  async refundReview({authorization}){
   const actor=await refundOperator(authorization),rows=await rpc('rr_test_refund_review',{p_actor:actor});
   const phases=['prepared','dispatched','known'],statuses=['pending','requires_action','succeeded','failed','canceled'];
   if(!Array.isArray(rows)||rows.length>101||rows.some(q=>q?.actor_id!==actor||q.participant!==true||!UUID.test(q.id||'')||!UUID.test(q.order_id||'')||!Number.isSafeInteger(q.amount_cents)||q.amount_cents<1||q.amount_cents>30000000||!phases.includes(q.phase)||q.receipt_status!==null&&!statuses.includes(q.receipt_status)||typeof q.needs_review!=='boolean'||typeof q.created_at!=='string'||!Number.isFinite(Date.parse(q.created_at))||typeof q.updated_at!=='string'||!Number.isFinite(Date.parse(q.updated_at))))throw new OrderServiceUnavailable('Invalid refund review evidence');
   return {test:true,hasMore:rows.length>100,requests:rows.slice(0,100).map(q=>({requestId:q.id,orderId:q.order_id,amountCents:q.amount_cents,
    reviewState:q.needs_review?'needs_review':q.phase==='prepared'?'not_dispatched':q.phase==='dispatched'?'outcome_unknown':q.receipt_status===null?'awaiting_notice':q.receipt_status==='succeeded'?'confirmed':['failed','canceled'].includes(q.receipt_status)?'failed':'processing',
    createdAt:q.created_at,updatedAt:q.updated_at}))};
  },
  async feeOrder({authorization,orderId}){
   id(orderId);const actor=await refundOperator(authorization),o=await rpc('rr_test_fee_order',{p_order:orderId,p_actor:actor});
   if(o?.test!==true||o.orderId!==orderId||!/^pi_[A-Za-z0-9]+$/.test(o.paymentIntentId||'')||!Number.isSafeInteger(o.totalCents)||o.totalCents<1||o.totalCents>30000000||o.recordedFee!==null&&!validChargeFee(o.recordedFee,orderId,o.totalCents,o.paymentIntentId))throw new OrderServiceUnavailable('Invalid fee order');
   return o;
  },
  async recordChargeFee({authorization,orderId,evidence}){
   id(orderId);const actor=await refundOperator(authorization);
   if(!validChargeFee(evidence,orderId))throw new OrderServiceUnavailable('Invalid fee evidence');
   const fee=await rpc('rr_test_record_charge_fee',{p_order:orderId,p_actor:actor,p_evidence:evidence});
   if(!validChargeFee(fee,orderId,evidence.grossCents,evidence.paymentIntentId)||fee.chargeId!==evidence.chargeId||fee.balanceTransactionId!==evidence.balanceTransactionId||fee.feeCents!==evidence.feeCents)throw new OrderServiceUnavailable('Invalid recorded fee');return fee;
  },
  async prepareRefund({authorization,requestId,orderId,amountCents}){
   id(requestId);id(orderId);
   if(!Number.isSafeInteger(amountCents)||amountCents<1||amountCents>30000000)throw new OrderAccessDenied('Invalid refund amount');
   const actor=await refundOperator(authorization);
   return rpc('rr_test_prepare_refund',{p_request:requestId,p_order:orderId,p_actor:actor,p_amount:amountCents});
  },
  async getRefundRequest({authorization,requestId}){
   id(requestId);const actor=await refundOperator(authorization);
   return rpc('rr_test_get_refund_request',{p_request:requestId,p_actor:actor});
  },
  async dispatchRefund({authorization,requestId}){
   id(requestId);const actor=await refundOperator(authorization);
   return rpc('rr_test_dispatch_refund',{p_request:requestId,p_actor:actor});
  },
  async saveRefund({authorization,requestId,refundId,chargeId}){
   id(requestId);const actor=await refundOperator(authorization);
   if(!/^re_[A-Za-z0-9]+$/.test(refundId||'')||!/^ch_[A-Za-z0-9]+$/.test(chargeId||''))throw new OrderServiceUnavailable('Invalid refund identity');
   return rpc('rr_test_save_refund',{p_request:requestId,p_actor:actor,p_refund:refundId,p_charge:chargeId});
  },
  async reserve({authorization,orderId,listingId}){
   id(orderId);id(listingId);const buyer=await member(authorization);
   return rpc('rr_test_reserve',{p_order:orderId,p_listing:listingId,p_buyer:buyer});
  },
  async cancelPreparation({authorization,orderId}){
   id(orderId);const buyer=await member(authorization);
   const result=await rpc('rr_test_cancel_preparation',{p_order:orderId,p_buyer:buyer});
   if(result?.test!==true||result.orderId!==orderId||result.state!=='cancelled')throw new OrderServiceUnavailable('Invalid cancellation result');
   return {test:true,orderId,state:'cancelled'};
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
  async quotePermit({authorization,orderId}){
   id(orderId);const buyer=await member(authorization);
   const permit=await rpc('rr_test_quote_permit',{p_order:orderId,p_buyer:buyer});
   if(permit?.test!==true||typeof permit.allowed!=='boolean'||!Number.isSafeInteger(permit.retryAfter)||
    (permit.allowed?permit.retryAfter!==0:permit.retryAfter<1||permit.retryAfter>86400))throw new OrderServiceUnavailable('Invalid quote limit response');
   return {test:true,allowed:permit.allowed,retryAfter:permit.retryAfter};
  },
  async prepareCheckout({authorization,orderId,input,snapshot,expiresAt}){
   id(orderId);const buyer=await member(authorization);
   return rpc('rr_test_prepare_checkout',{p_order:orderId,p_buyer:buyer,p_input:input,p_snapshot:snapshot,p_expires:new Date(expiresAt).toISOString()});
  },
  async prepareCarrierCheckout({authorization,orderId,input,snapshot,expiresAt,fulfillment}){
   id(orderId);const buyer=await member(authorization);validateFulfillment(fulfillment,input);
   return rpc('rr_test_prepare_carrier_checkout',{p_order:orderId,p_buyer:buyer,p_input:input,p_snapshot:snapshot,p_expires:new Date(expiresAt).toISOString(),p_fulfillment:fulfillment});
  },
  async fulfillmentStatus({authorization,orderId}){
   id(orderId);const actor=await refundOperator(authorization);
   return publicFulfillmentStatus(await rpc('rr_test_fulfillment_status',{p_order:orderId,p_actor:actor}),orderId);
  },
  async labelAttempt({authorization,orderId,requestId}){
   id(orderId);id(requestId);const actor=await refundOperator(authorization);
   return validateLabelAttempt(await rpc('rr_test_label_attempt',{p_order:orderId,p_actor:actor}),orderId);
  },
  async labelContext({authorization,orderId,requestId}){
   id(orderId);id(requestId);const actor=await refundOperator(authorization),c=await rpc('rr_test_label_context',{p_order:orderId,p_actor:actor});
   if(c?.test!==true||c.orderId!==orderId||!Number.isSafeInteger(c.shippingCents)||c.shippingCents<0||c.shippingCents>100000||c.snapshot?.test!==true||c.snapshot.amountCents!==c.shippingCents)throw new OrderServiceUnavailable('Invalid private label context');
   return c;
  },
  async claimLabel({authorization,orderId,requestId,quote}){
   id(orderId);id(requestId);const actor=await refundOperator(authorization),c=await rpc('rr_test_claim_label',{p_order:orderId,p_actor:actor,p_request:requestId,p_quote:quote});
   if(typeof c?.dispatch!=='boolean')throw new OrderServiceUnavailable('Invalid label claim');
   return {dispatch:c.dispatch,attempt:validateLabelAttempt(c.attempt,orderId)};
  },
  async saveLabel({authorization,orderId,requestId,evidence}){
   id(orderId);id(requestId);const actor=await refundOperator(authorization);
   return validateLabelAttempt(await rpc('rr_test_save_label',{p_order:orderId,p_actor:actor,p_request:requestId,p_evidence:evidence}),orderId);
  },
  publicLabel,
  async trackingContext({authorization,orderId}){
   id(orderId);const actor=await refundOperator(authorization),a=validateLabelAttempt(await rpc('rr_test_label_attempt',{p_order:orderId,p_actor:actor}),orderId);
   if(a?.result?.status!=='SUCCESS'||!a.transactionId)throw new OrderServiceUnavailable('Successful saved sample required');return a;
  },
  async trackingStatus({authorization,orderId}){
   id(orderId);const actor=await refundOperator(authorization);
   return publicTrackingStatus(await rpc('rr_test_tracking_status',{p_order:orderId,p_actor:actor}),orderId);
  },
  async recordTracking({authorization,orderId,evidence}){
   id(orderId);const actor=await refundOperator(authorization);
   if(evidence?.test!==true||evidence.orderId!==orderId)throw new OrderServiceUnavailable('Invalid sample tracking');
   return publicTrackingStatus(await rpc('rr_test_record_tracking',{p_order:orderId,p_actor:actor,p_evidence:evidence}),orderId);
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
   if(rows.some(row=>Object.hasOwn(row,'can_cancel_preparation')&&typeof row.can_cancel_preparation!=='boolean'))throw new OrderServiceUnavailable('Invalid preparation status');
   const fields=['id','listing_id','buyer_id','seller_id','state','risk_status','item_cents','buyer_fee_cents','shipping_cents','tax_cents','total_cents','refund_state','refunded_cents','refund_pending_cents','can_cancel_preparation','created_at','updated_at'];
   return rows.map(row=>Object.fromEntries(fields.filter(k=>Object.hasOwn(row,k)).map(k=>[k,row[k]])));
  },
  async acceptStripeEvent({rawBody,signature,webhookSecret,nowSeconds}){
   const event=verifyStripeTestEvent(rawBody,signature,{secret:webhookSecret,...(nowSeconds===undefined?{}:{nowSeconds})});
   const {name,payload}=stripeTestEventRpc(event,rawBody,{refundsEnabled:refundsEnabled===true,refundRequestsEnabled:refundRequestsEnabled===true});
   return rpc(name,payload);
  },
  // Assessment must come from evaluateTestCharge with freshly fetched Stripe data.
  async recordRisk(evidence){
   id(evidence?.orderId);if(evidence.test!==true)throw new OrderAccessDenied('Test evidence required');
   return rpc('rr_test_record_risk',{p_order:evidence.orderId,p_evidence:evidence,p_hash:createHash('sha256').update(JSON.stringify(evidence)).digest('hex')});
  },
  async recordOperatorRisk({authorization,orderId,evidence}){
   id(orderId);const actor=await refundOperator(authorization);
   if(evidence?.test!==true||evidence.orderId!==orderId||!['clear','review','blocked'].includes(evidence.decision))throw new OrderServiceUnavailable('Invalid risk evidence');
   const o=await rpc('rr_test_fee_order',{p_order:orderId,p_actor:actor});
   if(o?.test!==true||o.orderId!==orderId)throw new OrderAccessDenied('Order unavailable');
   return rpc('rr_test_record_risk',{p_order:orderId,p_evidence:evidence,p_hash:createHash('sha256').update(JSON.stringify(evidence)).digest('hex')});
  }
 });
}
module.exports={createTestOrderRepository,OrderServiceUnavailable,OrderAccessDenied};
