'use strict';
const LEGACY_FEE_POLICY='rr-fees-v1',CURRENT_FEE_POLICY='rr-fees-v2';
function feePolicy(version=LEGACY_FEE_POLICY){
 if(version!==LEGACY_FEE_POLICY&&version!==CURRENT_FEE_POLICY)throw Error('Unknown saved fee policy');
 return Object.freeze({version,percent:version===CURRENT_FEE_POLICY?5:4,fixedCents:version===CURRENT_FEE_POLICY?50:0});
}
// Pass the aggregate item subtotal for one order. Future bundles use one call
// on their combined subtotal so the fixed charge is never applied per item.
function buyerFee(orderItemCents,version){
 if(!Number.isSafeInteger(orderItemCents)||orderItemCents<100||orderItemCents>10000000)throw Error('Invalid item price');
 const policy=feePolicy(version);
 return Math.floor((orderItemCents*policy.percent+50)/100)+policy.fixedCents;
}
module.exports={LEGACY_FEE_POLICY,CURRENT_FEE_POLICY,feePolicy,buyerFee};
