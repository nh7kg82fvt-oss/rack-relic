'use strict';
const {createSellerCostDisclosure,assessSellerCostAllocation}=require('./seller_cost_allocation.cjs');
const {CURRENT_FEE_POLICY}=require('./fee_policy.cjs');
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// This adapter prepares a test disclosure from a trusted server quote. Browser
// amounts, provider payloads and assertions of consent are never authority.
// Test disclosure acceptance does not accept live platform or Stripe terms.
function createTestSellerCostService({repository,loadCostQuote,clock=Date.now,costScheduleComplete=false}={}){
 if(!repository?.sellerCostContext||!repository?.prepareSellerCostDisclosure||!repository?.acceptSellerCosts)throw Error('Seller cost storage required');
 function context(c,orderId){
  if(c?.test!==true||c.orderId!==orderId||!UUID.test(orderId||'')||c.order?.orderId!==orderId
   ||c.feePolicyVersion!==c.order?.feePolicyVersion||!Array.isArray(c.costs)||!Array.isArray(c.priorAllocations))throw Error('Invalid seller cost context');
  return c;
 }
 function review(c){
  if(c.feePolicyVersion==='rr-fees-v1'){
   if(!Number.isSafeInteger(c.order.itemCents)||c.order.itemCents<1||!Number.isSafeInteger(c.order.buyerFeeCents)||c.order.buyerFeeCents<0||c.disclosure!==null||c.acceptance!==null)throw Error('Invalid historical seller context');
   return Object.freeze({test:true,orderId:c.orderId,feePolicyVersion:'rr-fees-v1',state:'held',blockers:['unsupported_fee_policy'],
    itemCents:c.order.itemCents,buyerFeeCents:c.order.buyerFeeCents,confirmedCostCents:0,reservedCostCents:0,
    sellerNetCents:null,sellerNetAfterReserveCents:null,disclosure:null,accepted:false,releaseEnabled:false});
  }
  const a=assessSellerCostAllocation(c,clock()),blockers=[...a.blockers];
  if(costScheduleComplete!==true)blockers.push('provider_cost_schedule_incomplete');
  const d=c.disclosure;
  // Recompute the hash before returning anything that a seller can accept.
  let disclosure=null;
  if(d){
   const canonical=createSellerCostDisclosure({order:c.order,maxTotalCents:d.maxTotalCents,costCaps:d.costCaps,selectedInsurance:d.selectedInsurance,createdAt:d.createdAt});
   if(canonical.hash!==d.hash||Object.keys(canonical).some(k=>k!=='costCaps'&&canonical[k]!==d[k]))throw Error('Invalid saved seller disclosure');
   disclosure={hash:d.hash,maxTotalCents:d.maxTotalCents,costCaps:{...d.costCaps},selectedInsurance:d.selectedInsurance};
  }
  return Object.freeze({test:true,orderId:c.orderId,feePolicyVersion:c.feePolicyVersion,state:blockers.length?'held':'reconciled_for_review',
   blockers:[...new Set(blockers)],itemCents:a.buyerTotalCents===null?null:c.order.itemCents,buyerFeeCents:a.platformFeeCents,
   confirmedCostCents:a.confirmedCostCents,reservedCostCents:a.reservedCostCents,sellerNetCents:a.sellerNetCents,
   sellerNetAfterReserveCents:a.sellerNetAfterReserveCents,disclosure,
   accepted:!!disclosure&&!a.blockers.includes('seller_cost_acceptance_required')&&!a.blockers.includes('cost_disclosure_mismatch'),releaseEnabled:false});
 }
 const get=async input=>context(await repository.sellerCostContext(input),input.orderId);
 return Object.freeze({
  async status(input){return review(await get(input));},
  async prepare(input){
   const c=await get(input);
   if(c.feePolicyVersion!==CURRENT_FEE_POLICY)throw Error('Current fee policy required');
   if(c.disclosure)return review(c);
   if(typeof loadCostQuote!=='function')throw Error('Verified cost quote required');
   const now=clock(),q=await loadCostQuote(c.order);
   if(q?.test!==true||q.orderId!==c.orderId||q.sellerId!==c.order.sellerId||!Number.isSafeInteger(q.expiresAt)||q.expiresAt<=clock()
    ||q.expiresAt>now+600000||q.selectedInsurance!==false)throw Error('Verified cost quote required');
   const d=createSellerCostDisclosure({order:c.order,maxTotalCents:q.maxTotalCents,costCaps:q.costCaps,selectedInsurance:false,createdAt:now});
   const {hash,...document}=d;
   await repository.prepareSellerCostDisclosure({...input,document:JSON.stringify(document),hash});
   const saved=await get(input);
   if(saved.disclosure?.hash!==hash)throw Error('Seller disclosure not confirmed');
   return review(saved);
  },
  async accept(input){
   if(!/^[a-f0-9]{64}$/.test(input.disclosureHash||''))throw Error('Saved disclosure required');
   const c=await get(input),before=review(c);
   if(!before.disclosure||before.disclosure.hash!==input.disclosureHash)throw Error('Disclosure changed; review required');
   await repository.acceptSellerCosts(input);
   const saved=review(await get(input));
   if(!saved.accepted||saved.disclosure?.hash!==input.disclosureHash)throw Error('Seller consent not confirmed');
   return saved;
  }
 });
}
module.exports={createTestSellerCostService};
