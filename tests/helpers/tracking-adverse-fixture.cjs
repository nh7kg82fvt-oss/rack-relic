// Disposable fictional fixture for the uninstalled tracking proposal only.
// No native/provider access, credentials, actual fixtures or installed SQL.
'use strict';
const fs=require('node:fs');
const path=require('node:path');
const BASE=path.resolve(__dirname,'../..');
const {PGlite}=require('@electric-sql/pglite');
const {createSellerCostDisclosure,sellerCostObligationKeys}=require(path.join(BASE,'server/seller_cost_allocation.cjs'));
const S='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222',X='33333333-3333-4333-8333-333333333333',
 L='44444444-4444-4444-8444-444444444444',O='55555555-5555-4555-8555-555555555555',T='66666666-6666-4666-8666-666666666666',
 P='77777777-7777-4777-8777-777777777777',R='88888888-8888-4888-8888-888888888888',Z='99999999-9999-4999-8999-999999999999';
const MIGRATIONS=['20261030_order_ledger','20261030_payment_recovery','20261030_checkout_attempts','20261030_refund_receipts','20261030_refund_requests',
 '20261030_checkout_quote_limits','20261030_checkout_quote_refresh','20261031_cancel_preparation','20261031_refund_review','20261031_charge_fee_evidence',
 '20261031_fulfillment_snapshots','20261031_label_attempts','20261031_tracking_observations','20261102_seller_onboarding','20261102_order_issues',
 '20261102_order_issues_review','20261102_order_issues_thread','20261102_order_issues_review_refunds','20261103_seller_protections',
 '20261103_provider_risk_holds','20261103_startup_policy','20261103_startup_limit_200','20261103_fee_policy_v2','20261103_seller_costs','20261103_settlement_simulation'];
let db,eventAt;
const rpc=async(name,args)=>{
 await db.exec('set role service_role');
 try{return (await db.query('select public.'+name+'('+args.map((_,i)=>'$'+(i+1)).join(',')+') x',args)).rows[0].x;}
 finally{await db.exec('reset role');}
};
const context=()=>rpc('rr_test_settlement_context',[S,O]);
async function install(){db=new PGlite();await db.exec('create role anon;create role authenticated;create role service_role;');for(const n of MIGRATIONS)await db.exec(fs.readFileSync(path.join(BASE,'supabase/test/'+n+'.sql'),'utf8'));}
async function seed({deliveryAgeMs=15*60_000,trackingStatus='DELIVERED'}={}){
 await db.query("insert into rr_sandbox.catalog(id,seller_id,title,price_cents) values($1,$2,'Synthetic settlement jacket',2500)",[L,S]);
 await rpc('rr_test_claim_seller',[S]);await rpc('rr_test_save_seller',[S,'acct_simSeller']);await rpc('rr_test_record_seller_protection',[S,'acct_simSeller',true,Date.now()]);
 await rpc('rr_test_reserve',[O,L,B]);
 const snapshot={test:true,feePolicyVersion:'rr-fees-v2',orderId:O,listingId:L,sellerId:S,currency:'USD',itemCents:2500,buyerFeeCents:175,shippingCents:500,taxCents:0,baseCents:3175,totalCents:3175};
 const input={orderId:O,buyerId:B,feePolicyVersion:'rr-fees-v2',listing:{id:L,seller_id:S,price_cents:2500},shippingQuote:{test:true,orderId:O,amountCents:500,destinationHash:'a'.repeat(64),rateId:'b'.repeat(32)},taxQuote:{test:true,orderId:O,amountCents:0,baseCents:3175,destinationHash:'a'.repeat(64),taxCalculationId:'taxcalc_sim'}};
 await rpc('rr_test_prepare_checkout',[O,B,input,snapshot,new Date(Date.now()+600000).toISOString()]);
 const order=(await rpc('rr_test_seller_cost_context',[S,O])).order,d=createSellerCostDisclosure({order,maxTotalCents:600,costCaps:{processing:200,radar:10,connect_active_account:200,payout:190,insurance:0},selectedInsurance:false,createdAt:Date.now()});
 const {hash,...document}=d;await rpc('rr_test_prepare_seller_cost_disclosure',[S,O,JSON.stringify(document),hash]);await rpc('rr_test_accept_seller_costs',[S,O,hash]);
 await rpc('rr_test_dispatch_checkout',[O,B]);await rpc('rr_test_attach_checkout',[O,'cs_test_sim',snapshot,'taxcalc_sim','a'.repeat(64),'b'.repeat(32),new Date(Date.now()+3600000).toISOString()]);
 await rpc('rr_test_process_payment_event',['evt_sim','a'.repeat(64),'checkout.session.completed',O,'cs_test_sim',3175,'usd',true,'pi_sim']);
 await rpc('rr_test_record_charge_fee',[O,S,{test:true,orderId:O,paymentIntentId:'pi_sim',chargeId:'ch_sim',balanceTransactionId:'txn_sim',grossCents:3175,feeCents:100,netCents:3075,currency:'USD',feeDetails:[{type:'stripe_fee',amountCents:100,currency:'USD'}],checkedAt:Date.now()}]);
 const keys=sellerCostObligationKeys(order);
 for(const [kind,amount]of [['processing',100],['radar',7],['connect_active_account',200],['payout',90]])await rpc('rr_test_record_seller_cost',[S,O,{test:true,verified:true,source:kind==='processing'?'provider_receipt':'disclosed_reserve',obligationKey:keys[kind],orderId:O,sellerId:S,kind,phase:kind==='processing'?'confirmed':'reserved',amountCents:amount,sourceTotalCents:amount,sourceReference:kind==='processing'?'txn_sim:fee':null,currency:'USD',observedAt:Date.now(),scope:kind==='connect_active_account'?'seller_month':kind==='payout'?'payout':'order',...(kind==='connect_active_account'?{period:order.settlementPeriod}:{}),...(kind==='payout'?{payoutBatchId:order.payoutBatchId}:{})}]);
 await rpc('rr_test_record_risk',[O,{test:true,orderId:O,chargeId:'ch_sim',decision:'clear',reasonCodes:[],checkedAt:Date.now()},'c'.repeat(64)]);
 eventAt=Date.now()-deliveryAgeMs;
 const transaction='d'.repeat(32);await db.query('insert into rr_sandbox.label_attempts(request_id,order_id,actor_id,quote,transaction_id,result) values($1,$2,$3,$4,$5,$6)',[Z,O,S,{test:true,rateId:'b'.repeat(32),carrier:'USPS'},transaction,{test:true,status:'SUCCESS',trackingNumber:'SIMULATEDONLY',transactionId:transaction}]);
 await rpc('rr_test_record_tracking',[O,S,{test:true,orderId:O,requestId:Z,transactionId:transaction,trackingNumber:'SIMULATEDONLY',carrier:'USPS',status:trackingStatus,eventAt,checkedAt:Date.now(),source:'shippo_transaction'}]);
 await rpc('rr_test_record_settlement_binding',[S,O,{test:true,simulationOnly:true,source:'stripe_sandbox',accountId:'acct_simSeller',bankAccountId:'ba_simBank',checkedAt:Date.now()}]);
}

module.exports={install,seed,rpc,context,getDb:()=>db,getEventAt:()=>eventAt,orderId:O,sellerId:S,requestId:Z,transferRequestId:T,transactionId:'d'.repeat(32)};
