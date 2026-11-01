'use strict';
function createTestRiskService({repository,stripe}={}){
 if(!repository?.feeOrder||!repository?.recordOperatorRisk||!stripe?.read)throw Error('Risk check dependencies required');
 return Object.freeze({async assess(input){
  const order=await repository.feeOrder(input),evidence=await stripe.read(order);
  if(evidence?.test!==true||evidence.orderId!==order.orderId)throw Error('Risk evidence order mismatch');
  const saved=await repository.recordOperatorRisk({...input,evidence});
  if(!['clear','review','blocked'].includes(saved?.risk_status))throw Error('Invalid saved risk result');
  return {test:true,orderId:order.orderId,riskStatus:saved.risk_status,checkedAt:evidence.checkedAt,labelGenerated:false,payoutCreated:false};
 }});
}
module.exports={createTestRiskService};
