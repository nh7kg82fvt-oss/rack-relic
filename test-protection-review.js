(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.RackRelicProtectionReview=factory();})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 const BLOCKERS=Object.freeze({
  live_acceptance_pending:'Live payments and the Stripe agreement remain on hold.',
  real_delivery_unverified:'Real carrier delivery has not been verified.',
  delivery_wait_unverified:'The approved waiting period after delivery has not been verified.',
  seller_terms_pending:'Live seller refund and recovery terms still need review and acceptance.',
  platform_reserve_unconfigured:'The business cash cushion and reserve rules are not configured.',
  tax_recovery_unverified:'Tax, refunds and recovery have not completed live acceptance.',
  settlement_unavailable:'Seller transfers and bank payouts are not enabled.',
  seller_verification_required:'Fresh seller verification is required.',
  seller_review_hold:'This seller is held for operator review.',
  payment_unconfirmed:'The saved payment is not confirmed.',
  ledger_needs_reconciliation:'The money records need reconciliation.',
  risk_review_required:'A fresh payment risk review is required.',
  buyer_issue_open:'A buyer issue remains open.',
  refund_review_required:'A refund or recovery needs review.',
  processing_fee_unverified:'Actual payment processing fees are not verified.',
  seller_net_requires_review:'The seller earnings need review.',
  sample_tracking_only:'Sample shipment results do not establish real delivery.'
 });
 const REQUIRED=['live_acceptance_pending','real_delivery_unverified','delivery_wait_unverified','seller_terms_pending','platform_reserve_unconfigured','tax_recovery_unverified','settlement_unavailable'];
 function publicProtectionReview(v,orderId){
  if(!v||v.test!==true||v.orderId!==orderId||v.state!=='held'||v.releaseEnabled!==false||v.transferCreated!==false||v.payoutCreated!==false||!Array.isArray(v.blockers)||v.blockers.length>Object.keys(BLOCKERS).length||new Set(v.blockers).size!==v.blockers.length||v.blockers.some(k=>!Object.hasOwn(BLOCKERS,k))||REQUIRED.some(k=>!v.blockers.includes(k)))throw Error('Protection review unavailable; seller funds remain held');
  let policy;
  if(v.policy!==undefined){
   const p=v.policy;
   const limit=p?.version==='startup-v1'?10000:p?.version==='startup-v2'?20000:null;
   if(limit===null||p.maxOrderCents!==limit||p.maxUnsettledOrders!==1||p.maxUnsettledGrossCents!==limit||p.minBusinessDaysAfterDelivery!==2||p.automaticRelease!==false)throw Error('Startup policy needs review; seller funds remain held');
   policy={version:p.version,maxOrderCents:limit,maxUnsettledOrders:1,maxUnsettledGrossCents:limit,minBusinessDaysAfterDelivery:2,automaticRelease:false};
  }
  return {test:true,orderId,state:'held',blockers:[...v.blockers],releaseEnabled:false,transferCreated:false,payoutCreated:false,...(policy?{policy}:{})};
 }
 return Object.freeze({BLOCKERS,publicProtectionReview});
});
