'use strict';
const LEGACY_FEE_POLICY='rr-fees-v1',PREVIOUS_FEE_POLICY='rr-fees-v2',CURRENT_FEE_POLICY='rr-fees-v3';
function feePolicy(version=LEGACY_FEE_POLICY){
 if(![LEGACY_FEE_POLICY,PREVIOUS_FEE_POLICY,CURRENT_FEE_POLICY].includes(version))throw Error('Unknown saved fee policy');
 return Object.freeze({version,percent:version===LEGACY_FEE_POLICY?4:5,fixedCents:version===CURRENT_FEE_POLICY?100:version===PREVIOUS_FEE_POLICY?50:0});
}
function isSellerFeePolicy(version){return version===PREVIOUS_FEE_POLICY||version===CURRENT_FEE_POLICY;}
// Calculate once on the aggregate item subtotal, preserving the saved version.
// Shipping and tax are separate; neither enters this percentage calculation.
function buyerFee(orderItemCents,version){
 if(!Number.isSafeInteger(orderItemCents)||orderItemCents<100||orderItemCents>10000000)throw Error('Invalid item price');
 const policy=feePolicy(version);
 return Math.floor((orderItemCents*policy.percent+50)/100)+policy.fixedCents;
}
module.exports={LEGACY_FEE_POLICY,PREVIOUS_FEE_POLICY,CURRENT_FEE_POLICY,isSellerFeePolicy,feePolicy,buyerFee};
