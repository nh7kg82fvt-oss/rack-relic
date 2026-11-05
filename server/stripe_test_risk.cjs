'use strict';
// Conservative SANDBOX fulfillment gate, not a guarantee of card ownership.
// Caller must retrieve fresh Charge/Review data from Stripe server-side.
// Does not configure Radar, accept payments, ship, refund or transfer funds.
function evaluateTestCharge({charge,order,checkedAt,shippingAddressChanged=false},now=Date.now()){
 if(order?.test!==true||typeof order.orderId!=='string'||!Number.isSafeInteger(order.totalCents)||!Number.isSafeInteger(checkedAt)||checkedAt>now+30000||checkedAt<now-300000)throw Error('Fresh trusted test order and charge evidence required');
 if(charge?.livemode!==false||typeof charge.id!=='string'||!/^ch_[A-Za-z0-9]+$/.test(charge.id)||charge.metadata?.order_id!==order.orderId||charge.amount!==order.totalCents||charge.currency!=='usd')throw Error('Test charge does not match order');
 const blocked=[],review=[];
 if(charge.disputed===true||charge.fraud_details?.user_report==='fraudulent'||charge.fraud_details?.stripe_report==='fraudulent')blocked.push('fraud_or_dispute');
 if(charge.disputed!==false)review.push('dispute_status_not_clear');
 if(charge.outcome?.risk_level==='highest'||['blocked','issuer_declined','invalid'].includes(charge.outcome?.type))blocked.push('provider_block');
 if(charge.paid!==true||charge.captured!==true||charge.refunded!==false||charge.amount_refunded!==0)review.push('payment_not_fully_captured_or_refunded');
 if(charge.outcome?.type!=='authorized'||charge.outcome?.risk_level!=='normal')review.push('risk_not_normal');
 const card=charge.payment_method_details?.card;
 if(charge.payment_method_details?.type!=='card'||!card)review.push('unsupported_payment_evidence');
 if(card?.checks?.cvc_check!=='pass')review.push('cvc_not_verified');
 if(card?.checks?.address_postal_code_check!=='pass')review.push('billing_postal_not_verified');
 if(card?.checks?.address_line1_check!=='pass')review.push('billing_street_not_verified');
 if(card?.three_d_secure?.result!=='authenticated')review.push('three_ds_not_authenticated');
 if(shippingAddressChanged!==false)review.push('shipping_changed');
 if(charge.review){
  const r=charge.review;
  if(typeof r!=='object'||r.open!==false||r.closed_reason!=='approved'||r.charge!==charge.id)review.push('provider_review_unresolved');
 }
 const decision=blocked.length?'blocked':review.length?'review':'clear';
 return Object.freeze({test:true,orderId:order.orderId,chargeId:charge.id,decision,checkedAt,
  reasonCodes:Object.freeze([...new Set([...blocked,...review])])});
}
module.exports={evaluateTestCharge};
