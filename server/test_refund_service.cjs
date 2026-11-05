'use strict';
class RefundPending extends Error{}
function createTestRefundService({repository,stripe}={}){
 if(!repository?.prepareRefund||!repository?.getRefundRequest||!repository?.dispatchRefund||!repository?.saveRefund||!stripe?.createRefund||!stripe?.retrieveRefund)throw Error('Refund dependencies required');
 const result=q=>Object.freeze({test:true,requestId:q.id,orderId:q.order_id,amountCents:q.amount_cents,state:'request_recorded'});
 function match(q,expected){
  if(q?.id!==expected.id||q.order_id!==expected.order_id||q.amount_cents!==expected.amount_cents||['payment_intent_id','total_cents','actor_id'].some(k=>expected[k]!==undefined&&q[k]!==expected[k]))throw Error('Refund request mismatch');
 }
 async function recover(q){
  if(q.phase!=='known'||!q.refund_id)throw new RefundPending('Refund outcome needs reconciliation; do not create another request');
  await stripe.retrieveRefund(q);
  // GET evidence never enters the ledger or clears a review hold.
  return result(q);
 }
 return Object.freeze({
  async start({authorization,requestId,orderId,amountCents}={}){
   const q=await repository.prepareRefund({authorization,requestId,orderId,amountCents});
   match(q,{id:requestId,order_id:orderId,amount_cents:amountCents});
   if(q.phase!=='prepared')return recover(q);
   const claim=await repository.dispatchRefund({authorization,requestId});
   match(claim.request,q);
   if(claim.dispatch!==true)return recover(claim.request);
   const evidence=await stripe.createRefund(claim.request);
   const saved=await repository.saveRefund({authorization,requestId,refundId:evidence.refundId,chargeId:evidence.chargeId});
   match(saved,q);
   if(saved.phase!=='known'||saved.refund_id!==evidence.refundId||saved.charge_id!==evidence.chargeId)throw Error('Refund identity was not saved');
   return result(saved);
  },
  async status({authorization,requestId}={}){
   const q=await repository.getRefundRequest({authorization,requestId});
   if(q?.id!==requestId)throw Error('Refund request mismatch');return recover(q);
  }
 });
}
module.exports={createTestRefundService,RefundPending};
