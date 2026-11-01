'use strict';
const STATUSES=Object.freeze(['UNKNOWN','PRE_TRANSIT','TRANSIT','DELIVERED','RETURNED','FAILURE']);
function publicTrackingStatus(v,orderId){
 if(v?.test!==true||v.orderId!==orderId||!['not_recorded','recorded'].includes(v.state)||typeof v.needsReview!=='boolean'||v.labelPurchaseEnabled!==false||v.payoutAvailable!==false)throw Error('Invalid tracking result');
 if(v.state==='recorded'){
  if(!STATUSES.includes(v.status)||!STATUSES.includes(v.providerStatus)||!Number.isSafeInteger(v.checkedAt)||v.checkedAt<1000000000000||v.eventAt!==null&&(!Number.isSafeInteger(v.eventAt)||v.eventAt<1000000000000||v.eventAt>v.checkedAt+30000))throw Error('Invalid tracking evidence');
 }else if(v.status!==null||v.providerStatus!==null||v.checkedAt!==null||v.eventAt!==null||v.needsReview!==false)throw Error('Unexpected unsaved tracking evidence');
 return {test:true,orderId,state:v.state,status:v.status,providerStatus:v.providerStatus,checkedAt:v.checkedAt,eventAt:v.eventAt,needsReview:v.needsReview,labelPurchaseEnabled:false,payoutAvailable:false};
}
function createTestTrackingService({repository,shipping}={}){
 if(!repository?.trackingStatus||!repository?.trackingContext||!repository?.recordTracking||!shipping?.tracking)throw Error('Tracking dependencies required');
 return Object.freeze({
  async status(args){return repository.trackingStatus(args);},
  async refresh(args){const a=await repository.trackingContext(args);const evidence=await shipping.tracking({...a,trackingNumber:a.result.trackingNumber});return repository.recordTracking({...args,evidence});}
 });
}
module.exports={STATUSES,publicTrackingStatus,createTestTrackingService};
