'use strict';
const {createHash}=require('node:crypto');
const {CURRENT_FEE_POLICY,buyerFee}=require('./fee_policy.cjs');
const POLICY_VERSION='rr-seller-costs-v1',FEE_POLICY_VERSION=CURRENT_FEE_POLICY;
const KINDS=Object.freeze(['processing','radar','connect_active_account','payout','insurance']);
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const REFERENCE=/^[A-Za-z][A-Za-z0-9_]*(?::[A-Za-z0-9_.-]+)*$/;
const cents=(v,max=30000000)=>Number.isSafeInteger(v)&&v>=0&&v<=max;
const time=(v,now)=>Number.isSafeInteger(v)&&v>=1000000000000&&v<=now+30000;
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
function validOrder(o){
 return object(o)&&o.test===true&&UUID.test(o.orderId||'')&&UUID.test(o.sellerId||'')&&o.currency==='USD'
  &&o.feePolicyVersion===FEE_POLICY_VERSION&&cents(o.itemCents,10000000)&&o.itemCents>=100
  &&[o.buyerFeeCents,o.shippingCents,o.taxCents,o.totalCents].every(v=>cents(v))
  &&o.buyerFeeCents===buyerFee(o.itemCents,o.feePolicyVersion)
  &&o.totalCents===o.itemCents+o.buyerFeeCents+o.shippingCents+o.taxCents
  &&/^20[0-9]{2}-(?:0[1-9]|1[0-2])$/.test(o.settlementPeriod||'')&&UUID.test(o.payoutBatchId||'')
  &&(o.payoutReference===undefined||/^po_[A-Za-z0-9]+$/.test(o.payoutReference));
}
function sellerCostObligationKeys(order,{selectedInsurance=false}={}){
 if(!validOrder(order)||typeof selectedInsurance!=='boolean')throw Error('Versioned test order required');
 return Object.freeze({processing:'processing:'+order.orderId,radar:'radar:'+order.orderId,
  connect_active_account:'connect_active_account:'+order.sellerId+':'+order.settlementPeriod,
  payout:'payout:'+order.payoutBatchId,...(selectedInsurance?{insurance:'insurance:'+order.orderId}:{})});
}
function canonicalDisclosure({order,maxTotalCents,costCaps,selectedInsurance,createdAt}){
 if(!validOrder(order)||!cents(maxTotalCents,order.itemCents)||!object(costCaps)||typeof selectedInsurance!=='boolean'
  ||Object.keys(costCaps).length!==KINDS.length||KINDS.some(k=>!Object.hasOwn(costCaps,k)||!cents(costCaps[k],order.itemCents))
  ||(!selectedInsurance&&costCaps.insurance!==0)||!Number.isSafeInteger(createdAt)||createdAt<1000000000000)throw Error('Invalid seller cost disclosure');
 return {test:true,policyVersion:POLICY_VERSION,feePolicyVersion:FEE_POLICY_VERSION,orderId:order.orderId,sellerId:order.sellerId,
  currency:'USD',itemCents:order.itemCents,buyerFeeCents:order.buyerFeeCents,shippingCents:order.shippingCents,
  taxCents:order.taxCents,totalCents:order.totalCents,settlementPeriod:order.settlementPeriod,payoutBatchId:order.payoutBatchId,
  maxTotalCents,costCaps:Object.fromEntries(KINDS.map(k=>[k,costCaps[k]])),selectedInsurance,createdAt};
}
function createSellerCostDisclosure(input){
 const d=canonicalDisclosure(input),hash=createHash('sha256').update('rr-cost-disclosure-v1\n'+JSON.stringify(d)).digest('hex');
 return Object.freeze({...d,costCaps:Object.freeze({...d.costCaps}),hash});
}
// Pure planning/reconciliation only. These inputs MUST be loaded by a trusted
// server repository after authentication and provider verification. Booleans or
// hashes supplied by a browser do not prove consent, attribution or payment.
// Durable allocation changes still require one database transaction with locks
// on obligation/source keys. This module cannot grant a transfer/payout permit.
function assessSellerCostAllocation({order,disclosure,acceptance,costs,expectedCostKeys,priorAllocations=[]}={},now=Date.now()){
 if(!Number.isSafeInteger(now)||now<1000000000000)throw Error('Trusted assessment time required');
 const blockers=new Set(),plan=[];let confirmed=0,reserved=0,unknown=false;
 const block=code=>blockers.add(code);
 const finish=()=>Object.freeze({test:true,orderId:UUID.test(order?.orderId||'')?order.orderId:null,
  policyVersion:POLICY_VERSION,feePolicyVersion:FEE_POLICY_VERSION,state:blockers.size?'held':'reconciled_for_review',
  blockers:Object.freeze([...blockers]),buyerTotalCents:validOrder(order)?order.totalCents:null,
  platformFeeCents:validOrder(order)?order.buyerFeeCents:null,buyerShippingCents:validOrder(order)?order.shippingCents:null,
  buyerTaxCents:validOrder(order)?order.taxCents:null,confirmedCostCents:confirmed,reservedCostCents:reserved,
  encumberedCostCents:confirmed+reserved,sellerNetCents:validOrder(order)&&!unknown&&reserved===0?Math.max(0,order.itemCents-confirmed):null,
  sellerNetAfterReserveCents:validOrder(order)&&!unknown?Math.max(0,order.itemCents-confirmed-reserved):null,
  allocationPlan:Object.freeze(plan.map(p=>Object.freeze({...p}))),releaseEnabled:false,transferCreated:false,payoutCreated:false});
 if(!validOrder(order)){block(order?.feePolicyVersion!==FEE_POLICY_VERSION?'unsupported_fee_policy':'invalid_order_snapshot');unknown=true;return finish();}
 let expectedDisclosure;
 try{expectedDisclosure=createSellerCostDisclosure({order,maxTotalCents:disclosure?.maxTotalCents,costCaps:disclosure?.costCaps,selectedInsurance:disclosure?.selectedInsurance,createdAt:disclosure?.createdAt});}
 catch{block('cost_disclosure_required');unknown=true;return finish();}
 const d=expectedDisclosure;
 if(!time(d.createdAt,now)||disclosure?.hash!==d.hash||Object.keys(d).some(k=>k!=='costCaps'&&disclosure[k]!==d[k]))block('cost_disclosure_mismatch');
 if(acceptance?.test!==true||acceptance.source!=='server_verified_session'||acceptance.authenticated!==true
  ||acceptance.orderId!==order.orderId||acceptance.sellerId!==order.sellerId||acceptance.policyVersion!==POLICY_VERSION
  ||acceptance.feePolicyVersion!==FEE_POLICY_VERSION||acceptance.disclosureHash!==d.hash||!time(acceptance.authenticatedAt,now)
  ||acceptance.authenticatedAt<d.createdAt||order.paidAt!==undefined&&(!time(order.paidAt,now)||acceptance.authenticatedAt>order.paidAt))block('seller_cost_acceptance_required');
 const keys=sellerCostObligationKeys(order,{selectedInsurance:d.selectedInsurance}),required=Object.values(keys);
 if(expectedCostKeys!==undefined&&(!Array.isArray(expectedCostKeys)||new Set(expectedCostKeys).size!==expectedCostKeys.length
  ||expectedCostKeys.length!==required.length||required.some(k=>!expectedCostKeys.includes(k))))block('cost_inventory_incomplete');
 if(!Array.isArray(costs)||costs.length>20){block('cost_evidence_required');unknown=true;return finish();}
 if(!Array.isArray(priorAllocations)||priorAllocations.length>10000){block('prior_allocations_invalid');unknown=true;return finish();}
 const priorPairs=new Set(),validPrior=[];
 for(const p of priorAllocations){
  const pair=p?.orderId+'|'+p?.obligationKey;
  const canonicalPrior=p?.kind==='connect_active_account'?typeof p.obligationKey==='string'&&p.obligationKey.startsWith('connect_active_account:'+p.sellerId+':')&&p.obligationKey.split(':').length===3&&/^20[0-9]{2}-(?:0[1-9]|1[0-2])$/.test(p.obligationKey.split(':')[2]||'')
   :p?.kind==='payout'?typeof p.obligationKey==='string'&&p.obligationKey.startsWith('payout:')&&UUID.test(p.obligationKey.slice(7))
   :KINDS.includes(p?.kind)&&p.obligationKey===p.kind+':'+p.orderId;
  if(!object(p)||!UUID.test(p.orderId||'')||!UUID.test(p.sellerId||'')||!KINDS.includes(p.kind)
   ||!canonicalPrior||typeof p.obligationKey!=='string'||p.obligationKey.length>160||!['reserved','confirmed'].includes(p.phase)||!cents(p.amountCents)
   ||!cents(p.sourceTotalCents)||p.amountCents>p.sourceTotalCents||p.phase==='confirmed'&&!REFERENCE.test(p.sourceReference||'')
   ||p.phase==='reserved'&&p.sourceReference!==null||priorPairs.has(pair)){block('prior_allocations_invalid');continue;}
  priorPairs.add(pair);validPrior.push(p);
 }
 const seenKeys=new Set(),seenSources=new Set();
 for(const c of costs){
  if(!object(c)||!KINDS.includes(c.kind)||c.orderId!==order.orderId||c.sellerId!==order.sellerId||c.currency!=='USD'
   ||c.test!==true||c.verified!==true||!time(c.observedAt,now)||!cents(c.amountCents)||!cents(c.sourceTotalCents)
   ||c.amountCents>c.sourceTotalCents){block('cost_evidence_invalid');unknown=true;continue;}
  if(!Object.hasOwn(keys,c.kind)||c.obligationKey!==keys[c.kind]){block(c.kind==='insurance'?'insurance_not_selected':'cost_binding_mismatch');continue;}
  if(seenKeys.has(c.obligationKey)){block('duplicate_cost_obligation');continue;}seenKeys.add(c.obligationKey);
  const scoped=c.kind==='connect_active_account'?c.scope==='seller_month'&&c.period===order.settlementPeriod
   :c.kind==='payout'?c.scope==='payout'&&c.payoutBatchId===order.payoutBatchId:c.scope==='order';
  if(!scoped){block('cost_binding_mismatch');unknown=true;continue;}
  if(c.phase==='reserved'){
   if(c.source!=='disclosed_reserve'||c.sourceReference!==null){block('invalid_cost_reservation');unknown=true;continue;}
   reserved+=c.amountCents;block('provider_costs_unconfirmed');
  }else if(c.phase==='confirmed'){
   if(c.source!=='provider_receipt'||!REFERENCE.test(c.sourceReference||'')||c.sourceReference.length>200
    ||c.kind==='payout'&&(!/^po_[A-Za-z0-9]+$/.test(c.payoutReference||'')||order.payoutReference!==undefined&&c.payoutReference!==order.payoutReference)){
    block('provider_receipt_required');unknown=true;continue;
   }
   if(seenSources.has(c.sourceReference)){block('duplicate_cost_source');continue;}seenSources.add(c.sourceReference);
   confirmed+=c.amountCents;
  }else{block('provider_costs_unconfirmed');unknown=true;continue;}
  if(c.amountCents>d.costCaps[c.kind])block('cost_exceeds_disclosure');
  const prior=validPrior.find(p=>p.orderId===order.orderId&&p.obligationKey===c.obligationKey);
  if(prior&&(prior.sellerId!==order.sellerId||prior.kind!==c.kind||prior.phase==='confirmed'&&(c.phase!=='confirmed'||prior.amountCents!==c.amountCents||prior.sourceReference!==c.sourceReference||prior.sourceTotalCents!==c.sourceTotalCents)))block('allocation_reconciliation_required');
  const obligationOthers=validPrior.filter(p=>p.obligationKey===c.obligationKey&&p.orderId!==order.orderId);
  if(obligationOthers.some(p=>p.phase==='confirmed'&&p.sourceTotalCents!==c.sourceTotalCents))block('cost_obligation_source_conflict');
  if(obligationOthers.some(p=>p.sellerId!==order.sellerId||p.kind!==c.kind)||obligationOthers.reduce((n,p)=>n+p.amountCents,0)+c.amountCents>c.sourceTotalCents)block('cost_obligation_already_allocated');
  if(c.phase==='confirmed'){
   const sourceOthers=validPrior.filter(p=>p.sourceReference===c.sourceReference&&!(p.orderId===order.orderId&&p.obligationKey===c.obligationKey));
   if(sourceOthers.some(p=>p.kind!==c.kind||p.sellerId!==order.sellerId||p.sourceTotalCents!==c.sourceTotalCents)
    ||sourceOthers.reduce((n,p)=>n+p.amountCents,0)+c.amountCents>c.sourceTotalCents)block('cost_source_already_allocated');
  }
  if(prior?.phase==='reserved'&&c.phase==='confirmed'&&c.amountCents>prior.amountCents)block('additional_reserve_required');
  plan.push({obligationKey:c.obligationKey,kind:c.kind,phase:c.phase,amountCents:c.amountCents,sourceReference:c.sourceReference,
   previousReservedCents:prior?.phase==='reserved'?prior.amountCents:0,previousConfirmedCents:prior?.phase==='confirmed'?prior.amountCents:0,
   additionalReservationCents:Math.max(0,c.amountCents-(prior?.amountCents||0)),releaseReservationCents:prior?.phase==='reserved'?Math.max(0,prior.amountCents-c.amountCents):0,
   idempotent:!!prior&&prior.phase===c.phase&&prior.amountCents===c.amountCents&&prior.sourceReference===c.sourceReference&&prior.sourceTotalCents===c.sourceTotalCents});
 }
 if(required.some(k=>!seenKeys.has(k))){block('cost_inventory_incomplete');unknown=true;}
 if(confirmed+reserved>d.maxTotalCents)block('total_costs_exceed_disclosure');
 if(confirmed+reserved>order.itemCents)block('seller_proceeds_insufficient');
 return finish();
}
module.exports={POLICY_VERSION,FEE_POLICY_VERSION,KINDS,createSellerCostDisclosure,sellerCostObligationKeys,assessSellerCostAllocation};
