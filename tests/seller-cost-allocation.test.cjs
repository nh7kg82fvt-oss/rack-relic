'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {POLICY_VERSION,FEE_POLICY_VERSION,createSellerCostDisclosure,sellerCostObligationKeys,assessSellerCostAllocation}=require('../server/seller_cost_allocation.cjs');
const O='11111111-1111-4111-8111-111111111111',S='22222222-2222-4222-8222-222222222222',B='33333333-3333-4333-8333-333333333333',OTHER='44444444-4444-4444-8444-444444444444',NOW=1793685000000;
function fixture({insurance=false}={}){
 const order={test:true,orderId:O,sellerId:S,currency:'USD',feePolicyVersion:FEE_POLICY_VERSION,itemCents:2500,buyerFeeCents:175,shippingCents:500,taxCents:0,totalCents:3175,settlementPeriod:'2026-11',payoutBatchId:B};
 const disclosure=createSellerCostDisclosure({order,maxTotalCents:500,costCaps:{processing:200,radar:10,connect_active_account:200,payout:50,insurance:40},selectedInsurance:true,createdAt:NOW-1000});
 const d=insurance?disclosure:createSellerCostDisclosure({order,maxTotalCents:500,costCaps:{processing:200,radar:10,connect_active_account:200,payout:90,insurance:0},selectedInsurance:false,createdAt:NOW-1000});
 const keys=sellerCostObligationKeys(order,{selectedInsurance:insurance});
 const make=(kind,amount,patch={})=>({test:true,verified:true,source:'provider_receipt',obligationKey:keys[kind],orderId:O,sellerId:S,kind,phase:'confirmed',amountCents:amount,sourceTotalCents:amount,sourceReference:'txn_'+kind+':fee',currency:'USD',observedAt:NOW,scope:kind==='connect_active_account'?'seller_month':kind==='payout'?'payout':'order',...(kind==='connect_active_account'?{period:'2026-11'}:{}),...(kind==='payout'?{payoutBatchId:B,payoutReference:'po_fixture'}:{}),...patch});
 return {order,disclosure:d,acceptance:{test:true,source:'server_verified_session',authenticated:true,orderId:O,sellerId:S,policyVersion:POLICY_VERSION,feePolicyVersion:FEE_POLICY_VERSION,disclosureHash:d.hash,authenticatedAt:NOW-500},
  costs:[make('processing',120),make('radar',7),make('connect_active_account',200),make('payout',31),...(insurance?[make('insurance',32)]:[])],expectedCostKeys:Object.values(keys),priorAllocations:[],make};
}
const assess=f=>assessSellerCostAllocation(f,NOW);
test('5% plus 50 cents platform fee, shipping and tax stay distinct from seller-attributable actual costs',()=>{
 const f=fixture(),r=assess(f);assert.equal(r.state,'reconciled_for_review');assert.equal(r.platformFeeCents,175);assert.equal(r.buyerShippingCents,500);assert.equal(r.buyerTaxCents,0);assert.equal(r.confirmedCostCents,358);assert.equal(r.sellerNetCents,2142);assert.equal(r.reservedCostCents,0);assert.equal(r.releaseEnabled,false);assert.equal(r.transferCreated,false);assert.equal(r.payoutCreated,false);
 assert.equal(r.sellerNetCents+r.confirmedCostCents+r.platformFeeCents+r.buyerShippingCents+r.buyerTaxCents,r.buyerTotalCents);
});
test('a historical 4% snapshot cannot be silently reassessed under the new fee policy',()=>{
 for(const patch of [{feePolicyVersion:'rr-fees-v1',buyerFeeCents:100,totalCents:3100},{buyerFeeCents:100,totalCents:3100},{buyerFeeCents:125,totalCents:3125}]){const f=fixture();f.order={...f.order,...patch};const r=assess(f);assert.equal(r.state,'held');assert.equal(r.sellerNetCents,null);assert.equal(r.releaseEnabled,false);}
});
test('all monetary values are integer cents, with exact order conservation and half-up 5% rounding',()=>{
 for(const patch of [{itemCents:25.5},{buyerFeeCents:'175'},{shippingCents:-1},{taxCents:NaN},{totalCents:3176},{totalCents:Number.MAX_SAFE_INTEGER}]){const f=fixture();f.order={...f.order,...patch};assert.equal(assess(f).state,'held');}
 const f=fixture();const order={...f.order,itemCents:2510,buyerFeeCents:176,totalCents:3186};assert.ok(createSellerCostDisclosure({order,maxTotalCents:500,costCaps:f.disclosure.costCaps,selectedInsurance:false,createdAt:NOW-1000}).hash);
 assert.throws(()=>createSellerCostDisclosure({order:{...order,buyerFeeCents:175,totalCents:3185},maxTotalCents:500,costCaps:f.disclosure.costCaps,selectedInsurance:false,createdAt:NOW-1000}));
});
test('canonical disclosure hash binds price, policy, accepted insurance, caps and planned payout batch',()=>{
 const f=fixture();assert.deepEqual(createSellerCostDisclosure({order:f.order,maxTotalCents:500,costCaps:{insurance:0,payout:90,connect_active_account:200,radar:10,processing:200},selectedInsurance:false,createdAt:NOW-1000}),f.disclosure);
 for(const patch of [{maxTotalCents:499},{selectedInsurance:true},{hash:'a'.repeat(64)},{payoutBatchId:OTHER},{policyVersion:'old'},{costCaps:{...f.disclosure.costCaps,radar:9}}])assert.equal(assess({...f,disclosure:{...f.disclosure,...patch}}).state,'held');
});
test('fresh server-authenticated seller acceptance of the exact disclosure is required before reconciliation',()=>{
 const f=fixture();for(const acceptance of [null,{...f.acceptance,source:'browser'},{...f.acceptance,authenticated:false},{...f.acceptance,sellerId:OTHER},{...f.acceptance,orderId:OTHER},{...f.acceptance,disclosureHash:'b'.repeat(64)},{...f.acceptance,authenticatedAt:NOW-1001},{...f.acceptance,authenticatedAt:NOW+30001},{...f.acceptance,feePolicyVersion:'old'}])assert.ok(assess({...f,acceptance}).blockers.includes('seller_cost_acceptance_required'));
 assert.ok(assess({...f,order:{...f.order,paidAt:NOW-600}}).blockers.includes('seller_cost_acceptance_required'));
});
test('missing cost inventory and unsupported financial evidence never imply zero costs',()=>{
 const f=fixture();for(const costs of [null,[],f.costs.slice(0,3),f.costs.map((c,i)=>i===0?{...c,phase:'estimated',source:'estimate'}:c),f.costs.map((c,i)=>i===0?{...c,phase:'unknown'}:c)]){const r=assess({...f,costs});assert.equal(r.state,'held');assert.equal(r.sellerNetCents,null);}
 assert.ok(assess({...f,expectedCostKeys:f.expectedCostKeys.slice(0,3)}).blockers.includes('cost_inventory_incomplete'));
});
test('provider costs require bound evidence and cannot shift another order, seller, month or payout onto this sale',()=>{
 const f=fixture();for(const patch of [{test:false},{verified:false},{orderId:OTHER},{sellerId:OTHER},{currency:'EUR'},{source:'browser'},{observedAt:NOW+30001},{amountCents:-1},{amountCents:1.1},{sourceTotalCents:119}]){const costs=f.costs.map((c,i)=>i===0?{...c,...patch}:c);assert.equal(assess({...f,costs}).state,'held');}
 for(const [index,patch] of [[2,{period:'2026-12'}],[3,{payoutBatchId:OTHER}],[3,{payoutReference:'not-a-payout'}]])assert.equal(assess({...f,costs:f.costs.map((c,i)=>i===index?{...c,...patch}:c)}).state,'held');
});
test('unknown payout cost can reserve a planned batch without requiring an already executed payout',()=>{
 const f=fixture();f.costs[3]={...f.costs[3],phase:'reserved',source:'disclosed_reserve',sourceReference:null,amountCents:50,sourceTotalCents:50};delete f.costs[3].payoutReference;
 const r=assess(f);assert.equal(r.state,'held');assert.equal(r.reservedCostCents,50);assert.equal(r.confirmedCostCents,327);assert.equal(r.sellerNetCents,null);assert.equal(r.sellerNetAfterReserveCents,2123);assert.ok(r.blockers.includes('provider_costs_unconfirmed'));
});
test('selected extra insurance is required, while unselected insurance cannot be charged',()=>{
 const yes=fixture({insurance:true});assert.equal(assess(yes).confirmedCostCents,390);assert.equal(assess({...yes,costs:yes.costs.slice(0,4)}).state,'held');
 const no=fixture();assert.ok(assess({...no,costs:[...no.costs,yes.costs[4]]}).blockers.includes('insurance_not_selected'));
});
test('individual and order-wide accepted ceilings both constrain actual deductions',()=>{
 const f=fixture();const over=f.costs.map((c,i)=>i===1?{...c,amountCents:11,sourceTotalCents:11}:c);assert.ok(assess({...f,costs:over}).blockers.includes('cost_exceeds_disclosure'));
 const d=createSellerCostDisclosure({order:f.order,maxTotalCents:350,costCaps:f.disclosure.costCaps,selectedInsurance:false,createdAt:NOW-1000});const r=assess({...f,disclosure:d,acceptance:{...f.acceptance,disclosureHash:d.hash}});assert.ok(r.blockers.includes('total_costs_exceed_disclosure'));assert.equal(r.platformFeeCents,175);
});
test('costs exceeding item proceeds hold rather than consume shipping, tax or platform fee',()=>{
 const f=fixture(),costs=f.costs.map((c,i)=>i===0?{...c,amountCents:2500,sourceTotalCents:2500}:c),r=assess({...f,costs});assert.ok(r.blockers.includes('seller_proceeds_insufficient'));assert.equal(r.state,'held');assert.equal(r.sellerNetCents,0);assert.equal(r.platformFeeCents,175);assert.equal(r.buyerShippingCents,500);assert.equal(r.releaseEnabled,false);
});
test('duplicate obligations and duplicate receipt lines cannot be deducted twice',()=>{
 const f=fixture();assert.ok(assess({...f,costs:[...f.costs,f.costs[0]]}).blockers.includes('duplicate_cost_obligation'));
 const costs=f.costs.map((c,i)=>i===1?{...c,sourceReference:f.costs[0].sourceReference}:c);assert.ok(assess({...f,costs}).blockers.includes('duplicate_cost_source'));
});
test('monthly active-account cost is keyed to seller/month and cannot be charged in full on every order',()=>{
 const f=fixture(),c=f.costs[2];assert.equal(c.obligationKey,'connect_active_account:'+S+':2026-11');
 const prior={...c,orderId:OTHER};assert.ok(assess({...f,priorAllocations:[prior]}).blockers.includes('cost_obligation_already_allocated'));
 const partial={...prior,amountCents:125};const candidate={...c,amountCents:75};const r=assess({...f,costs:f.costs.map((x,i)=>i===2?candidate:x),priorAllocations:[partial]});assert.equal(r.state,'reconciled_for_review');
});
test('a shared invoice line cannot exceed its confirmed source total across multiple order obligations',()=>{
 const f=fixture(),c=f.costs[1],costs=f.costs.map((x,i)=>i===1?{...c,sourceTotalCents:10}:x),prior={...c,orderId:OTHER,obligationKey:'radar:'+OTHER,amountCents:4,sourceTotalCents:10};
 assert.ok(assess({...f,costs,priorAllocations:[prior]}).blockers.includes('cost_source_already_allocated'));
});
test('an enlarged monthly receipt total cannot silently reopen already allocated seller/month capacity',()=>{
 const f=fixture(),c=f.costs[2],prior={...c,orderId:OTHER},costs=f.costs.map((x,i)=>i===2?{...c,sourceTotalCents:400,sourceReference:'txn_changedReceipt:fee'}:x);
 assert.ok(assess({...f,costs,priorAllocations:[prior]}).blockers.includes('cost_obligation_source_conflict'));
});
test('malformed prior obligation keys cannot hide earlier monthly costs from allocation checks',()=>{
 const f=fixture(),prior={...f.costs[2],orderId:OTHER,obligationKey:'unbound_monthly_fee'};assert.ok(assess({...f,priorAllocations:[prior]}).blockers.includes('prior_allocations_invalid'));
 for(const sourceTotalCents of [undefined,null,1.5,199]){const reserved={...f.costs[2],orderId:OTHER,phase:'reserved',sourceReference:null,sourceTotalCents};assert.ok(assess({...f,priorAllocations:[reserved]}).blockers.includes('prior_allocations_invalid'));}
});
test('idempotent reconciliation does not add a second allocation or mutate caller data',()=>{
 const f=fixture();f.priorAllocations=f.costs.map(c=>({...c}));const original=JSON.stringify(f),r=assess(f);assert.equal(r.state,'reconciled_for_review');assert.ok(r.allocationPlan.every(p=>p.idempotent&&p.additionalReservationCents===0));assert.equal(JSON.stringify(f),original);assert.ok(Object.isFrozen(r));assert.ok(Object.isFrozen(r.allocationPlan));
});
test('reserve-to-actual reconciliation counts one obligation once and shows unused reservation explicitly',()=>{
 const f=fixture(),c=f.costs[2];f.priorAllocations=[{...c,phase:'reserved',sourceReference:null,amountCents:200}];f.costs[2]={...c,amountCents:190,sourceTotalCents:190};const r=assess(f),p=r.allocationPlan.find(x=>x.kind==='connect_active_account');assert.equal(r.confirmedCostCents,348);assert.equal(r.reservedCostCents,0);assert.equal(p.releaseReservationCents,10);assert.equal(p.additionalReservationCents,0);assert.equal(r.state,'reconciled_for_review');
});
test('larger actual cost than reserved needs an additional reserve and confirmed allocations are immutable',()=>{
 const f=fixture(),c=f.costs[3];f.priorAllocations=[{...c,phase:'reserved',sourceReference:null,amountCents:20}];assert.ok(assess(f).blockers.includes('additional_reserve_required'));
 f.priorAllocations=[{...c,amountCents:30}];assert.ok(assess(f).blockers.includes('allocation_reconciliation_required'));
 f.priorAllocations=[{...c},{...c}];assert.ok(assess(f).blockers.includes('prior_allocations_invalid'));
});
test('live scope and unknown historical policy are not enabled by this test-only module',()=>{
 const f=fixture();assert.equal(assess({...f,order:{...f.order,test:false}}).state,'held');assert.equal(assess({...f,order:{...f.order,feePolicyVersion:'old'}}).state,'held');assert.throws(()=>assessSellerCostAllocation(f,NaN));
});
