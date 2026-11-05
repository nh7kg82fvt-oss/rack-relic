'use strict';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const {safeLabelUrl}=require('./shippo_test_labels.cjs');
function validateLabelAttempt(a,orderId){
 if(a===null)return null;
 if(a?.test!==true||a.orderId!==orderId||!UUID.test(a.requestId||'')||a.quote?.test!==true||!/^[a-f0-9]{32}$/.test(a.quote.rateId||'')||a.transactionId!==null&&!/^[a-f0-9]{32}$/.test(a.transactionId||''))throw Error('Invalid saved sample attempt');
 if(a.result!==null){const r=a.result;if(r?.test!==true||r.orderId!==orderId||r.requestId!==a.requestId||r.rateId!==a.quote.rateId||r.transactionId!==a.transactionId||!['SUCCESS','WAITING','QUEUED','ERROR'].includes(r.status))throw Error('Invalid saved sample evidence');if(r.status==='SUCCESS'){safeLabelUrl(r.labelUrl);if(typeof r.trackingNumber!=='string'||!r.trackingNumber||r.trackingNumber.length>100)throw Error('Invalid sample tracking');}else if(r.labelUrl!==null||r.trackingNumber!==null)throw Error('Unexpected sample document');}
 return {test:true,orderId,requestId:a.requestId,quote:a.quote,transactionId:a.transactionId,result:a.result};
}
function publicLabel(a){
 validateLabelAttempt(a,a?.orderId);
 return {test:true,orderId:a.orderId,requestId:a.requestId,state:!a.transactionId?'outcome_unknown':a.result?.status==='SUCCESS'?'ready':a.result?.status==='ERROR'?'failed':'processing',labelUrl:a.result?.status==='SUCCESS'?safeLabelUrl(a.result.labelUrl):null,trackingNumber:a.result?.status==='SUCCESS'?a.result.trackingNumber:null};
}
// The database commits the claim before the one provider POST. A lost response
// remains held; neither a new browser UUID nor a retry may purchase again.
function createTestLabelService({repository,shipping}={}){
 const refs=x=>{if(!UUID.test(x?.orderId||'')||!UUID.test(x?.requestId||''))throw Error('Saved test label references required');};
 async function known(args,saved){
  if(!saved)return null;
  if(saved.orderId!==args.orderId||saved.requestId!==args.requestId)throw Error('A different sample label request already exists; review it before continuing');
  if(!saved.transactionId)return {test:true,orderId:args.orderId,requestId:args.requestId,state:'outcome_unknown',labelUrl:null,trackingNumber:null};
  if(saved.result?.status==='SUCCESS'||saved.result?.status==='ERROR')return repository.publicLabel(saved);
  const evidence=await shipping.retrieve({...saved,orderId:args.orderId,requestId:args.requestId});
  return repository.publicLabel(await repository.saveLabel({...args,evidence}));
 }
 return Object.freeze({
  async request(args){
   refs(args);const saved=await repository.labelAttempt(args);if(saved)return known(args,saved);
   const context=await repository.labelContext(args),quote=await shipping.quote(context);
   const claim=await repository.claimLabel({...args,quote});
   if(claim?.dispatch!==true)return known(args,claim?.attempt);
   const a=claim.attempt;
   if(a?.orderId!==args.orderId||a.requestId!==args.requestId||!a.quote||Object.keys(quote).length!==Object.keys(a.quote).length||Object.keys(quote).some(k=>a.quote[k]!==quote[k]))throw Error('Saved sample claim mismatch');
   // No catch/retry around this POST. The committed claim survives every error.
   const evidence=await shipping.create({orderId:args.orderId,requestId:args.requestId,quote});
   return repository.publicLabel(await repository.saveLabel({...args,evidence}));
  },
  async status(args){refs(args);return await known(args,await repository.labelAttempt(args))||{test:true,orderId:args.orderId,requestId:args.requestId,state:'not_requested',labelUrl:null,trackingNumber:null};}
 });
}
module.exports={createTestLabelService,validateLabelAttempt,publicLabel};
