'use strict';
function createTestFeeService({repository,stripe}={}){
 if(!repository?.feeOrder||!repository?.recordChargeFee||!stripe?.read)throw Error('Fee reconciliation dependencies required');
 const result=(o,fee)=>({test:true,orderId:o.orderId,state:fee?'recorded':'not_recorded',...(fee?{grossCents:fee.grossCents,feeCents:fee.feeCents,netCents:fee.netCents}:{}),payoutAvailable:false});
 return Object.freeze({
  async status(input){const o=await repository.feeOrder(input);return result(o,o.recordedFee);},
  async reconcile(input){const o=await repository.feeOrder(input),evidence=await stripe.read(o);const fee=await repository.recordChargeFee({...input,evidence});return result(o,fee);}
 });
}
module.exports={createTestFeeService};
