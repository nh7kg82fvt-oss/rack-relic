'use strict';
(function(root){
function publicIssueRefundReview(r,orderId){
 if(r?.test!==true||r.orderId!==orderId||r.fulfillmentReleased!==false||typeof r.canPrepare!=='boolean')throw Error('Invalid issue refund review');
 if(r.state==='not_reported'){if(r.canPrepare!==false)throw Error('Invalid issue refund review');return {test:true,orderId,state:r.state,canPrepare:false,fulfillmentReleased:false};}
 const fields=['totalCents','confirmedCents','pendingCents','unconfirmedRequestCount','remainingCents'];
 if(!['needs_reconciliation','pending','refunded','awaiting_acknowledgment','available_for_review'].includes(r.state)||fields.some(k=>!Number.isSafeInteger(r[k])||r[k]<0||r[k]>30000000)||r.totalCents<1||r.remainingCents!==Math.max(r.totalCents-r.confirmedCents,0)||r.canPrepare!==(r.state==='available_for_review'))throw Error('Invalid issue refund review');
 if(r.canPrepare&&(r.remainingCents<1||r.pendingCents!==0||r.unconfirmedRequestCount!==0)||r.state==='refunded'&&(r.confirmedCents!==r.totalCents||r.pendingCents!==0||r.unconfirmedRequestCount!==0))throw Error('Inconsistent refund readiness');
 return {test:true,orderId,state:r.state,...Object.fromEntries(fields.map(k=>[k,r[k]])),canPrepare:r.canPrepare,fulfillmentReleased:false};
}
if(typeof module==='object'&&module.exports)module.exports={publicIssueRefundReview};else root.publicTestIssueRefundReview=publicIssueRefundReview;
})(typeof globalThis==='object'?globalThis:this);
