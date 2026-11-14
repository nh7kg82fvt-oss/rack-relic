(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.RackRelicSellerCostReview=factory();})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 const COST_LABELS=Object.freeze({processing:'Payment processing',radar:'Fraud screening',connect_active_account:'Stripe account cost (monthly allocation)',payout:'Bank payout cost (allocated once)',insurance:'Selected extra shipping insurance'});
 const BLOCKERS=Object.freeze({
  unsupported_fee_policy:'This historical order cannot accept the new test payment-cost terms.',
  invalid_order_snapshot:'The saved order amounts need review.',
  cost_disclosure_required:'A server-prepared cost quote is still needed.',
  cost_disclosure_mismatch:'The saved cost quote needs review.',
  seller_cost_acceptance_required:'Review and accept the maximum test payment costs before continuing.',
  provider_cost_schedule_incomplete:'The complete provider cost schedule has not been verified.',
  cost_quote_required:'A verified server cost quote is not configured.',
  cost_inventory_incomplete:'Some payment costs are still pending confirmation.',
  cost_evidence_required:'Payment cost confirmation is still pending.',
  prior_allocations_invalid:'Earlier cost allocations need review.',
  cost_evidence_invalid:'The payment cost records need review.',
  insurance_not_selected:'An unselected insurance cost needs review.',
  cost_binding_mismatch:'A cost could not be matched to this sale.',
  duplicate_cost_obligation:'A repeated cost allocation needs review.',
  invalid_cost_reservation:'A cost reservation needs review.',
  provider_costs_unconfirmed:'Some provider costs are reserved and still await confirmation.',
  provider_receipt_required:'A provider receipt is still needed.',
  duplicate_cost_source:'A repeated provider receipt needs review.',
  cost_exceeds_disclosure:'A cost exceeds the agreed maximum and needs review.',
  allocation_reconciliation_required:'A saved cost allocation needs reconciliation.',
  cost_obligation_source_conflict:'Provider totals conflict with earlier cost allocations.',
  cost_obligation_already_allocated:'A cost has already been allocated and needs review.',
  cost_source_already_allocated:'A provider receipt has already been allocated and needs review.',
  additional_reserve_required:'An additional cost reservation needs review.',
  total_costs_exceed_disclosure:'Total costs exceed the agreed maximum and need review.',
  seller_proceeds_insufficient:'The sale proceeds do not cover the recorded costs.'
 });
 const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
 const cents=v=>Number.isSafeInteger(v)&&v>=0&&v<=30000000;
 const invalid=()=>{throw Error('Payment cost review unavailable. Seller funds remain held.');};
 function publicSellerCostReview(v,orderId){
  if(!UUID.test(orderId||'')||!v||v.test!==true||v.orderId!==orderId||!['rr-fees-v1','rr-fees-v2'].includes(v.feePolicyVersion)
   ||!['held','reconciled_for_review'].includes(v.state)||v.releaseEnabled!==false||typeof v.accepted!=='boolean'
   ||!Array.isArray(v.blockers)||v.blockers.length>Object.keys(BLOCKERS).length||new Set(v.blockers).size!==v.blockers.length
   ||v.blockers.some(k=>!Object.hasOwn(BLOCKERS,k))||v.state!==(v.blockers.length?'held':'reconciled_for_review')
   ||!cents(v.confirmedCostCents)||!cents(v.reservedCostCents))return invalid();
  const unavailable=v.blockers.includes('unsupported_fee_policy')||v.blockers.includes('invalid_order_snapshot');
  if(v.feePolicyVersion!=='rr-fees-v2'&&!v.blockers.includes('unsupported_fee_policy'))return invalid();
  if(unavailable){if(v.disclosure!==null||v.accepted||v.sellerNetCents!==null||v.sellerNetAfterReserveCents!==null)return invalid();
   if(v.itemCents!==null&&(!cents(v.itemCents)||v.itemCents<1)||v.buyerFeeCents!==null&&!cents(v.buyerFeeCents))return invalid();
  }else if(!cents(v.itemCents)||v.itemCents<1||v.itemCents>10000000||!cents(v.buyerFeeCents)||v.buyerFeeCents!==Math.floor((v.itemCents*5+50)/100)+50)return invalid();
  if(v.sellerNetCents!==null&&(!cents(v.sellerNetCents)||v.reservedCostCents!==0||v.sellerNetCents!==Math.max(0,v.itemCents-v.confirmedCostCents)))return invalid();
  if(v.sellerNetAfterReserveCents!==null&&(!cents(v.sellerNetAfterReserveCents)||v.sellerNetAfterReserveCents!==Math.max(0,v.itemCents-v.confirmedCostCents-v.reservedCostCents)))return invalid();
  if(v.sellerNetCents!==null&&v.sellerNetAfterReserveCents!==v.sellerNetCents)return invalid();
  let disclosure=null;
  if(v.disclosure!==null){const d=v.disclosure,keys=Object.keys(COST_LABELS);if(!d||typeof d.hash!=='string'||!/^[0-9a-f]{64}$/.test(d.hash)
    ||!cents(d.maxTotalCents)||d.maxTotalCents>v.itemCents||typeof d.selectedInsurance!=='boolean'
    ||!d.costCaps||typeof d.costCaps!=='object'||Array.isArray(d.costCaps)||Object.keys(d.costCaps).length!==keys.length
    ||keys.some(k=>!Object.hasOwn(d.costCaps,k)||!cents(d.costCaps[k])||d.costCaps[k]>v.itemCents)||!d.selectedInsurance&&d.costCaps.insurance!==0)return invalid();
   disclosure=Object.freeze({hash:d.hash,maxTotalCents:d.maxTotalCents,costCaps:Object.freeze(Object.fromEntries(keys.map(k=>[k,d.costCaps[k]]))),selectedInsurance:d.selectedInsurance});
  }
  if(v.accepted&&(!disclosure||v.blockers.includes('seller_cost_acceptance_required'))||v.state==='reconciled_for_review'&&(!v.accepted||!disclosure||v.reservedCostCents!==0||v.sellerNetCents===null))return invalid();
  return Object.freeze({test:true,orderId,feePolicyVersion:v.feePolicyVersion,state:v.state,blockers:Object.freeze([...v.blockers]),itemCents:v.itemCents,buyerFeeCents:v.buyerFeeCents,
   confirmedCostCents:v.confirmedCostCents,reservedCostCents:v.reservedCostCents,sellerNetCents:v.sellerNetCents,sellerNetAfterReserveCents:v.sellerNetAfterReserveCents,disclosure,accepted:v.accepted,releaseEnabled:false});
 }
 function sellerCostAction(action,value,orderId){
  const r=publicSellerCostReview(value,orderId);
  if(r.blockers.some(k=>['unsupported_fee_policy','invalid_order_snapshot','cost_disclosure_mismatch'].includes(k)))throw Error('This order cannot accept test cost terms. Keep seller funds held.');
  if(action==='seller-cost-prepare'&&!r.disclosure)return {action,options:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({orderId})}};
  if(action==='seller-cost-accept'&&r.disclosure&&!r.accepted)return {action,options:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({orderId,disclosureHash:r.disclosure.hash})}};
  throw Error('Refresh and review the current test payment costs before continuing.');
 }
 return Object.freeze({COST_LABELS,BLOCKERS,publicSellerCostReview,sellerCostAction});
});
