'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createPostRestoreStripeReconciliation}=require('../server/backup_recovery_reconciliation.cjs');
const {TEST_ENVIRONMENTS}=require('../server/test_environment_registry.cjs');
const NOW=1793700000000,RUN='11111111-1111-4111-8111-111111111111',A='22222222-2222-4222-8222-222222222222',B='33333333-3333-4333-8333-333333333333';
const copy=x=>structuredClone(x);
function order({orderId=A,paymentIntentId='pi_TestA',chargeId='ch_TestA',...rest}={}){return {orderId,paymentIntentId,chargeId,amountCents:3500,currency:'USD',state:'paid',refundedCents:0,refunds:[],transfers:[],payouts:[],...rest};}
function fixture({rows=[order()],provider=rows,environment=TEST_ENVIRONMENTS.acceptance,options={}}={}){
 const data={restored:copy(rows),stripe:copy(provider)},calls={hold:0,identity:0,restored:0,stripe:0},hooks={};
 const hold=async input=>{calls.hold++;return hooks.hold?hooks.hold(input,calls):{...input,durable:true,checkoutBlocked:true,fulfillmentBlocked:true,releaseBlocked:true,checkedAt:NOW};};
 const identity=async input=>{calls.identity++;return hooks.identity?hooks.identity(input,calls):{accountId:environment.accountId,livemode:false,checkedAt:NOW};};
 const page=kind=>async input=>{
  calls[kind]++;if(hooks[kind])return hooks[kind](input,calls,data);
  const offset=input.cursor===null?0:Number(input.cursor.slice(1)),items=data[kind].slice(offset,offset+input.limit);
  return {items:copy(items),nextCursor:offset+input.limit<data[kind].length?'p'+(offset+input.limit):null,checkedAt:NOW,snapshotId:kind+'v1',coverageFrom:0,coverageThrough:NOW,...kind==='restored'?{projectRef:environment.projectRef}:{accountId:environment.accountId,livemode:false}};
 };
 const args={enabled:true,environmentId:environment.id,readRecoveryHold:hold,readStripeIdentity:identity,readRestoredPage:page('restored'),readStripePage:page('stripe'),clock:()=>NOW,...options};
 return {service:createPostRestoreStripeReconciliation(args),args,data,calls,hooks,environment};
}
const reconcile=f=>f.service.reconcile({runId:RUN});
const codes=r=>r.reasons.map(x=>x.code);
test('recovery is off by default and malformed run identities never contact a provider',async()=>{
 const f=fixture();assert.deepEqual(codes(await createPostRestoreStripeReconciliation({...f.args,enabled:false}).reconcile({runId:RUN})),['recovery_reconciliation_not_configured']);assert.deepEqual(codes(await f.service.reconcile({runId:'bad'})),['invalid_recovery_run']);assert.equal(f.calls.identity,0);assert.equal(f.calls.restored,0);
});
test('complete stable inventories reconcile in either approved test environment while money remains held',async()=>{
 for(const environment of Object.values(TEST_ENVIRONMENTS)){
  const f=fixture({environment,rows:[order(),order({orderId:B,paymentIntentId:'pi_TestB',chargeId:'ch_TestB'})],options:{pageSize:1}}),r=await reconcile(f);
  assert.equal(r.consistent,true);assert.equal(r.matchedOrders,2);assert.equal(r.requiresOperatorReview,true);assert.equal(r.holdPayouts,true);assert.equal(r.releaseEnabled,false);assert.equal(r.productionRestoreEnabled,false);assert.equal(r.cloudReady,false);assert.equal(f.calls.identity,2);assert.equal(f.calls.hold,2);assert.equal(f.calls.restored,4);assert.equal(f.calls.stripe,4);assert.equal(JSON.stringify(r).includes('pi_Test'),false);
 }
});
test('payments created after the database backup are detected even when no restored order refers to them',async()=>{
 const extra=order({orderId:B,paymentIntentId:'pi_NewAfterBackup',chargeId:'ch_NewAfterBackup'}),f=fixture({provider:[order(),extra]}),r=await reconcile(f);assert.equal(r.consistent,false);assert.equal(r.matchedOrders,1);assert.deepEqual(r.reasons,[{orderId:B,code:'provider_payment_missing_from_restored_records'}]);
 const missing=fixture({provider:[]});assert.deepEqual(codes(await reconcile(missing)),['saved_payment_missing_from_provider']);
});
test('order, payment, charge, amount, currency, refund and seller-transfer bindings cannot be silently changed',async()=>{
 const transferred=order({transfers:[{id:'tr_Original',destination:'acct_SellerA',amountCents:2500,reversedCents:0}]}),paidOut=order({transfers:transferred.transfers,payouts:[{id:'po_Original',sellerAccountId:'acct_SellerA',transferId:'tr_Original',amountCents:2500,status:'paid'}]});
 const cases=[
  [order(),order({orderId:B})],
  [order(),order({paymentIntentId:'pi_Substitute'})],
  [order(),order({chargeId:'ch_Substitute'})],
  [order(),order({amountCents:3501})],
  [order(),order({currency:'EUR'})],
  [order(),order({state:'partially_refunded',refundedCents:500,refunds:[{id:'re_Unrecorded',amountCents:500,status:'succeeded'}]})],
  [transferred,order({transfers:[{...transferred.transfers[0],destination:'acct_SellerB'}]})],
  [paidOut,order({...paidOut,payouts:[{...paidOut.payouts[0],status:'failed'}]})]
 ];
 for(const [saved,provider]of cases){const r=await reconcile(fixture({rows:[saved],provider:[provider]}));assert.equal(r.consistent,false);assert.equal(r.releaseEnabled,false);assert.equal(r.holdPayouts,true);assert.ok(r.reasons.length>0);}
});
test('Stripe identity must be fresh, test-mode and match the configured account before any order reads',async()=>{
 for(const patch of [{accountId:TEST_ENVIRONMENTS.legacy.accountId},{livemode:true},{checkedAt:NOW-1},{checkedAt:NOW+2000}]){
  const f=fixture();f.hooks.identity=()=>({accountId:f.environment.accountId,livemode:false,checkedAt:NOW,...patch});const r=await reconcile(f);assert.deepEqual(codes(r),['fresh_test_stripe_identity_required']);assert.equal(f.calls.restored,0);assert.equal(f.calls.stripe,0);
 }
});
test('a fresh durable recovery hold must block checkout, fulfillment and seller money for the exact run',async()=>{
 for(const patch of [{durable:false},{checkoutBlocked:false},{fulfillmentBlocked:false},{releaseBlocked:false},{runId:B},{projectRef:TEST_ENVIRONMENTS.legacy.projectRef},{checkedAt:NOW-1}]){
  const f=fixture();f.hooks.hold=i=>({...i,durable:true,checkoutBlocked:true,fulfillmentBlocked:true,releaseBlocked:true,checkedAt:NOW,...patch});const r=await reconcile(f);assert.deepEqual(codes(r),['durable_recovery_hold_required']);assert.equal(f.calls.identity,0);
 }
});
test('wrong database or provider page identities cannot be paired with a valid account preflight',async()=>{
 for(const kind of ['restored','stripe']){const f=fixture();f.hooks[kind]=()=>({items:[],nextCursor:null,checkedAt:NOW,snapshotId:'test',coverageFrom:0,coverageThrough:NOW,projectRef:TEST_ENVIRONMENTS.legacy.projectRef,accountId:TEST_ENVIRONMENTS.legacy.accountId,livemode:false});assert.deepEqual(codes(await reconcile(f)),['wrong_financial_inventory']);}
});
test('duplicate payment, order, charge, refund, transfer or payout references reject the entire inventory',async()=>{
 const a=order(),b=order({orderId:B,paymentIntentId:'pi_TestB',chargeId:'ch_TestB'});
 const refund={id:'re_Shared',amountCents:200,status:'succeeded'},transfer={id:'tr_Shared',destination:'acct_SellerA',amountCents:1000,reversedCents:0};
 const cases=[
  [a,{...b,paymentIntentId:a.paymentIntentId}],
  [a,{...b,orderId:A}],
  [a,{...b,chargeId:a.chargeId}],
  [{...a,state:'partially_refunded',refundedCents:200,refunds:[refund]},{...b,state:'partially_refunded',refundedCents:200,refunds:[refund]}],
  [{...a,transfers:[transfer]},{...b,transfers:[transfer]}],
  [{...a,transfers:[transfer],payouts:[{id:'po_Shared',sellerAccountId:'acct_SellerA',transferId:transfer.id,amountCents:1000,status:'paid'}]},{...b,transfers:[{...transfer,id:'tr_B'}],payouts:[{id:'po_Shared',sellerAccountId:'acct_SellerA',transferId:'tr_B',amountCents:1000,status:'paid'}]}]
 ];
 for(const rows of cases)assert.deepEqual(codes(await reconcile(fixture({rows}))),['duplicate_financial_reference']);
});
test('complete provider coverage and bounded terminating pagination are mandatory',async()=>{
 for(const patch of [{coverageFrom:NOW-3600000},{coverageThrough:NOW-1},{snapshotId:''},{items:[],nextCursor:'loop'}]){
  const f=fixture();f.hooks.stripe=()=>({items:[order()],nextCursor:null,checkedAt:NOW,snapshotId:'provider',coverageFrom:0,coverageThrough:NOW,accountId:f.environment.accountId,livemode:false,...patch});assert.deepEqual(codes(await reconcile(f)),['complete_financial_inventory_required']);
 }
 const f=fixture({rows:[order(),order({orderId:B,paymentIntentId:'pi_TestB',chargeId:'ch_TestB'})],options:{pageSize:1,maxPages:1}});assert.deepEqual(codes(await reconcile(f)),['complete_financial_inventory_required']);
 const g=fixture({options:{maxOrders:0}});assert.deepEqual(codes(await reconcile(g)),['financial_inventory_limit']);
});
test('new payment evidence during a run or a revoked final hold cannot be declared reconciled',async()=>{
 const f=fixture();f.hooks.stripe=(i,c)=>({items:[order({amountCents:c.stripe>1?3600:3500})],nextCursor:null,checkedAt:NOW,snapshotId:'provider',coverageFrom:0,coverageThrough:NOW,accountId:f.environment.accountId,livemode:false});assert.deepEqual(codes(await reconcile(f)),['financial_inventory_changed']);
 const g=fixture();g.hooks.hold=(i,c)=>({...i,durable:true,checkoutBlocked:true,fulfillmentBlocked:true,releaseBlocked:c.hold===1,checkedAt:NOW});assert.deepEqual(codes(await reconcile(g)),['durable_recovery_hold_required']);
 const h=fixture();h.hooks.identity=(i,c)=>({accountId:h.environment.accountId,livemode:c.identity>1,checkedAt:NOW});assert.deepEqual(codes(await reconcile(h)),['fresh_test_stripe_identity_required']);
});
test('matching pending refunds or payouts stay unresolved and transferred refunds need funding review',async()=>{
 const transfer={id:'tr_Paid',destination:'acct_Seller',amountCents:2500,reversedCents:0};
 const cases=[
  [order({refunds:[{id:'re_Pending',amountCents:500,status:'pending'}]}),'unresolved_refund'],
  [order({transfers:[transfer],payouts:[{id:'po_Pending',sellerAccountId:'acct_Seller',transferId:'tr_Paid',amountCents:2500,status:'in_transit'}]}),'unresolved_payout'],
  [order({state:'partially_refunded',refundedCents:500,refunds:[{id:'re_Done',amountCents:500,status:'succeeded'}],transfers:[transfer]}),'transferred_refund_needs_funding_review']
 ];
 for(const [row,code]of cases){const r=await reconcile(fixture({rows:[row]}));assert.equal(r.consistent,false);assert.deepEqual(codes(r),[code]);assert.equal(r.holdPayouts,true);}
});
test('even identical inventories cannot validate impossible refund, transfer or payout accounting',async()=>{
 const cases=[
  order({refundedCents:500}),
  order({refunds:[{id:'re_TooMuch',amountCents:3501,status:'failed'}]}),
  order({transfers:[{id:'tr_A',destination:'acct_Seller',amountCents:2000,reversedCents:0},{id:'tr_B',destination:'acct_Seller',amountCents:2000,reversedCents:0}]}),
  order({transfers:[{id:'tr_A',destination:TEST_ENVIRONMENTS.acceptance.accountId,amountCents:100,reversedCents:0}]}),
  order({payouts:[{id:'po_Orphan',sellerAccountId:'acct_Seller',transferId:'tr_Missing',amountCents:100,status:'paid'}]}),
  order({transfers:[{id:'tr_A',destination:'acct_Seller',amountCents:1000,reversedCents:0}],payouts:[{id:'po_A',sellerAccountId:'acct_Seller',transferId:'tr_A',amountCents:900,status:'paid'},{id:'po_B',sellerAccountId:'acct_Seller',transferId:'tr_A',amountCents:900,status:'paid'}]})
 ];
 for(const row of cases){const r=await reconcile(fixture({rows:[row]}));assert.equal(r.consistent,false);assert.equal(r.releaseEnabled,false);}
});
test('upstream exceptions and unbounded raw/private projections are sanitized rather than returned to the owner',async()=>{
 const f=fixture();f.hooks.stripe=()=>{throw Error('secret card/account details');};const r=await reconcile(f);assert.deepEqual(codes(r),['recovery_evidence_unavailable']);assert.equal(JSON.stringify(r).includes('secret'),false);
 const g=fixture({rows:[{...order(),privateAddress:'not permitted in this projection'}]});assert.deepEqual(codes(await reconcile(g)),['invalid_financial_inventory']);
});
test('timeout prevents delayed identity work from continuing into financial inventory access',async()=>{
 const f=fixture({options:{timeoutMs:5}});let release;f.hooks.identity=()=>new Promise(resolve=>{release=()=>resolve({accountId:f.environment.accountId,livemode:false,checkedAt:NOW});});assert.deepEqual(codes(await reconcile(f)),['recovery_evidence_unavailable']);release();await new Promise(resolve=>setImmediate(resolve));assert.equal(f.calls.restored,0);assert.equal(f.calls.stripe,0);
});
