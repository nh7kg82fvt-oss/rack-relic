'use strict';
const RESPONSES=Object.freeze(['investigating','propose_return','request_review']);
function publicIssueThread(r,orderId){
 const date=v=>typeof v==='string'&&Number.isFinite(Date.parse(v));
 if(r?.test!==true||r.orderId!==orderId||!['not_reported','review_required'].includes(r.state))throw Error('Invalid issue thread');
 if(r.state==='not_reported')return {test:true,orderId,state:r.state};
 if(!['not_received','damaged','not_as_described'].includes(r.reason)||!date(r.reportedAt)||r.acknowledgedAt!==null&&!date(r.acknowledgedAt)||r.sellerResponse!==null&&(!RESPONSES.includes(r.sellerResponse?.kind)||!date(r.sellerResponse.submittedAt)))throw Error('Invalid issue thread');
 return {test:true,orderId,state:r.state,reason:r.reason,reportedAt:r.reportedAt,acknowledgedAt:r.acknowledgedAt,sellerResponse:r.sellerResponse?{kind:r.sellerResponse.kind,submittedAt:r.sellerResponse.submittedAt}:null};
}
module.exports={RESPONSES,publicIssueThread};
