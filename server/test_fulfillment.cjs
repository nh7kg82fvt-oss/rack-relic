'use strict';
const {usAddress,destinationHash}=require('./stripe_test_tax.cjs');
const HOLDS=Object.freeze(['payment_unconfirmed','risk_hold','refund_hold','snapshot_missing','quote_expired','job_held']);
function validateFulfillment(f,input,now=Date.now()){
 if(!f||f.test!==true||Object.keys(f).sort().join(',')!=='amountCents,carrier,currency,destination,expiresAt,origin,parcel,rateId,service,shipmentId,test'||!/^[a-f0-9]{32}$/.test(f.shipmentId||'')||!/^[a-f0-9]{32}$/.test(f.rateId||'')||f.rateId!==input?.shippingQuote?.rateId||f.currency!=='USD'||!Number.isSafeInteger(f.amountCents)||f.amountCents<0||f.amountCents>100000||f.amountCents!==input.shippingQuote.amountCents||!Number.isSafeInteger(f.expiresAt)||f.expiresAt<=now||f.expiresAt>now+1800000||f.expiresAt!==input.shippingQuote.expiresAt)throw Error('Invalid private fulfillment snapshot');
 for(const [k,max] of [['carrier',100],['service',150]])if(typeof f[k]!=='string'||!f[k].trim()||f[k].length>max)throw Error('Invalid carrier description');
 for(const address of [f.origin,f.destination]){const normalized=usAddress(address);if(Object.keys(address).some(k=>!Object.hasOwn(normalized,k))||JSON.stringify(address)!==JSON.stringify(normalized))throw Error('Normalized private address required');}
 if(destinationHash(f.destination)!==input.shippingQuote.destinationHash)throw Error('Fulfillment destination mismatch');
 if(!f.parcel||Object.keys(f.parcel).sort().join(',')!=='height,length,weight,width'||Object.entries(f.parcel).some(([k,n])=>typeof n!=='number'||!Number.isFinite(n)||n<=0||n>(k==='weight'?150:108)))throw Error('Invalid parcel');
 return f;
}
function publicFulfillmentStatus(value,orderId){
 if(value?.test!==true||value.orderId!==orderId||typeof value.snapshotStored!=='boolean'||value.labelPurchaseEnabled!==false||!Array.isArray(value.holdReasons)||value.holdReasons.some(h=>!HOLDS.includes(h))||new Set(value.holdReasons).size!==value.holdReasons.length||value.state!==(value.holdReasons.length?'held':'ready_for_review'))throw Error('Invalid fulfillment status');
 return {test:true,orderId,state:value.state,snapshotStored:value.snapshotStored,holdReasons:value.holdReasons,labelPurchaseEnabled:false};
}
module.exports={validateFulfillment,publicFulfillmentStatus};
