'use strict';
// New coordinator-only regression checks. All ports/data/clocks are fictional;
// advancing virtual time is not hosted timing or provider/SQL acceptance.
const {test}=require('node:test'),assert=require('node:assert/strict'),{createHash}=require('node:crypto');
const {createOriginalTaxActionCoordinator,ENVIRONMENT}=require('../server/private-tax/tax_original_action_coordinator.cjs');
const {buyerFee}=require('../server/fee_policy.cjs');
const START=1795200000000,OWNER='11111111-1111-4111-8111-111111111111';
const ORDER='22222222-2222-4222-8222-222222222222',REQUEST='33333333-3333-4333-8333-333333333333';
const ACCOUNT='acct_1UXdWBGppSOhWnq8',CALC='taxcalc_FictionalClock',TX='tax_FictionalClock';
const REFERENCE='rrTax_'+ORDER.replaceAll('-',''),CODE='txcd_30011000';
const copy=value=>structuredClone(value);
const BODY_HASH=createHash('sha256').update(JSON.stringify({calculation:CALC,reference:REFERENCE})).digest('hex');
const INPUT=Object.freeze({authorization:'Bearer FICTIONAL_COORDINATOR_PORT',orderId:ORDER,requestId:REQUEST});
function rig(options={}){
 const version=options.version??'rr-fees-v3',fee=buyerFee(2500,version),cutover=START-10000;
 const amounts={itemCents:2500,buyerFeeCents:fee,shippingCents:500,taxCents:100,totalCents:3100+fee};
 const components={item:{reference:ORDER+'_item',amountCents:2500,taxCents:80,taxCode:CODE},buyerFee:{reference:ORDER+'_buyer_fee',amountCents:fee,taxCents:10,taxCode:CODE},shipping:{amountCents:500,taxCents:10,taxCode:CODE}};
 const binding={version:'rr-test-tax-saved-binding-v1',requestId:REQUEST,orderId:ORDER,accountId:ACCOUNT,kind:'original',calculationId:CALC,
  originalDispatch:{version:'rr-test-tax-original-dispatch-v1',requestId:REQUEST,status:'known',transactionId:TX,calculationId:CALC,reference:REFERENCE,requestBodySha256:BODY_HASH},
  chain:[{kind:'original',requestId:REQUEST,transactionId:TX,reference:REFERENCE,parentTransactionId:null,parentLineItemIds:null,components}],policyHash:null,refund:null};
 let wall=START,mono=0,saved=null,readDelayPending=Boolean(options.existingReadDelay),rollbackPending=true;
 const calls={book:0,prepare:0,dispatch:0,verify:0,receipt:0,inspect:0};
 const originalAmounts=copy(amounts),originalComponents=copy(components);
 function receipt(observedAt=wall){return{test:true,accountId:ACCOUNT,source:'verified_test_tax_receipt',transactionId:TX,parentTransactionId:null,reference:REFERENCE,currency:'USD',type:'transaction',...copy(amounts),observedAt};}
 function booked(bookedAt,observedAt){return{version:'rr-test-tax-booked-original-v1',requestId:REQUEST,orderId:ORDER,accountId:ACCOUNT,calculationId:CALC,transactionId:TX,reference:REFERENCE,requestBodySha256:BODY_HASH,components:copy(components),receipt:receipt(observedAt),bookedAt};}
 if(readDelayPending)saved=booked(START+options.existingReadDelay,START+options.existingReadDelay);
 const actionPorts={
  async inspect(){calls.inspect++;return{version:'rr-test-tax-original-action-state-v1',requestId:REQUEST,orderId:ORDER,ownerId:OWNER,cutoverAt:cutover,orderCreatedAt:START-9000,calculationId:CALC,feePolicyVersion:version,amounts:copy(amounts),job:{state:'uncertain',attempts:1,providerReference:null},action:{requestId:REQUEST,reference:REFERENCE,createdAt:START-8000},refundRequestCount:0,observedAt:wall};},
  async receipt(){calls.receipt++;if(readDelayPending){wall+=options.existingReadDelay;mono+=options.existingReadDelay;readDelayPending=false;}if(calls.book>0&&rollbackPending&&(options.receiptWallMs||options.receiptMonoMs)){wall+=options.receiptWallMs??0;mono+=options.receiptMonoMs??0;rollbackPending=false;}return copy(saved);},
  async prepare(){calls.prepare++;throw Error('Unexpected fictional prepare');},
  async book(args){calls.book++;assert.deepEqual(args.receipt,receipt(args.receipt.observedAt));
   wall+=options.bookWallMs??1501;mono+=options.bookMonoMs??options.bookWallMs??1501;
   if(options.persist!==false)saved=booked(options.preCutover?cutover-1:wall+(options.futureMs??0),args.receipt.observedAt);
   return{genericAcknowledgement:true};
  }
 };
 const coordinator=createOriginalTaxActionCoordinator({enabled:true,environment:ENVIRONMENT,ownerId:OWNER,actionPorts,
  privateTransport:{async authenticateOwner(){return OWNER;},async rpc(){return copy(binding);}},
  quoteReader:{async loadTrustedQuoteDetail(){throw Error('Unexpected fictional quote read');}},
  originalPair:{async sendOriginal(){throw Error('Unexpected fictional provider write');},async acceptTrustedDispatchResult(){throw Error('Unexpected fictional provider acceptance');}},
  createReceiptVerifier(){throw Error('Unexpected fictional verifier construction');},
  createBridge(){return{async loadOriginalBinding(){return copy(binding);},async dispatchOriginal(){calls.dispatch++;throw Error('No replacement original permitted');},async verifyOriginal(){calls.verify++;return receipt();},close(){}};},
  clock:()=>wall,monotonicClock:()=>mono});
 return{coordinator,calls,amounts,components,originalAmounts,originalComponents,saved:()=>copy(saved),close:()=>coordinator.close()};
}
function closed(result){for(const [key,value]of Object.entries({test:true,holdRequired:true,releaseEnabled:false,refundDispatchEnabled:false,closeGlobalClaim:false,taxAccountingAccepted:false}))assert.equal(result[key],value,key);}
test('a booking 1501ms after inspection succeeds using fresh validation time for saved v2 and v3',async()=>{
 for(const version of ['rr-fees-v2','rr-fees-v3']){const r=rig({version});try{
  const result=await r.coordinator.runOriginal(INPUT);assert.equal(result.status,'booked');assert.equal(result.transactionId,TX);closed(result);
  assert.equal(r.saved().bookedAt,START+1501);assert.equal(r.calls.book,1);assert.equal(r.calls.prepare,0);assert.equal(r.calls.dispatch,0);
  assert.deepEqual(r.amounts,r.originalAmounts);assert.deepEqual(r.components,r.originalComponents);assert.equal(r.saved().receipt.buyerFeeCents,version==='rr-fees-v2'?175:225);
  const again=await r.coordinator.runOriginal(INPUT);assert.equal(again.status,'booked');assert.equal(r.calls.book,1);assert.equal(r.calls.verify,1);closed(again);
 }finally{r.close();}}
});
test('bookedAt permits exactly fresh-now plus1000ms and rejects plus1001ms without another booking',async()=>{
 const allowed=rig({futureMs:1000});try{const result=await allowed.coordinator.runOriginal(INPUT);assert.equal(result.status,'booked');closed(result);}finally{allowed.close();}
 const denied=rig({futureMs:1001});try{await assert.rejects(denied.coordinator.runOriginal(INPUT));await assert.rejects(denied.coordinator.runOriginal(INPUT));assert.equal(denied.calls.book,1);assert.equal(denied.calls.dispatch,0);}finally{denied.close();}
});
test('a booked timestamp before the original cutover remains rejected',async()=>{
 const r=rig({preCutover:true});try{await assert.rejects(r.coordinator.runOriginal(INPUT));assert.equal(r.calls.book,1);assert.equal(r.calls.dispatch,0);assert.deepEqual(r.amounts,r.originalAmounts);}finally{r.close();}
});
test('independent clock expiry or rollback around receipt holds without retrying the uncertain booking',async()=>{
 for(const options of [{bookWallMs:60001,bookMonoMs:0},{bookWallMs:0,bookMonoMs:60001},{receiptWallMs:-1},{receiptMonoMs:-1}]){const r=rig({...options,persist:false});try{
  await assert.rejects(r.coordinator.runOriginal(INPUT));assert.equal(r.calls.book,1);
  const again=await r.coordinator.runOriginal(INPUT);assert.equal(again.status,'booking_unknown');closed(again);assert.equal(r.calls.book,1);assert.equal(r.calls.dispatch,0);
 }finally{r.close();}}
});
test('a generic acknowledgement without a saved row remains UNKNOWN across another call',async()=>{
 const r=rig({persist:false});try{for(let n=0;n<2;n++){const result=await r.coordinator.runOriginal(INPUT);assert.equal(result.status,'booking_unknown');closed(result);}assert.equal(r.calls.book,1);assert.equal(r.calls.dispatch,0);assert.equal(r.saved(),null);}finally{r.close();}
});
test('an existing booking first observed after a1501ms receipt read is accepted without any write',async()=>{
 for(const version of ['rr-fees-v2','rr-fees-v3']){const r=rig({version,existingReadDelay:1501});try{const result=await r.coordinator.loadBookedOriginal(INPUT);assert.equal(result.bookedAt,START+1501);assert.equal(result.receipt.buyerFeeCents,version==='rr-fees-v2'?175:225);assert.equal(r.calls.book,0);assert.equal(r.calls.dispatch,0);assert.equal(r.calls.verify,0);}finally{r.close();}}
});
