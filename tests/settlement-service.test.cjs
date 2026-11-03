'use strict';
// Real local SQL and server adapters; every provider/Auth transport is synthetic.
// These journeys never contact Stripe, buy postage or release live seller money.
const {test,before,after,beforeEach}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {createHmac}=require('node:crypto'),{PGlite}=require('@electric-sql/pglite');
const {createTestOrderRepository,OrderAccessDenied}=require('../server/test_order_repository.cjs');
const {createStripeTestSettlementClient}=require('../server/stripe_test_settlement.cjs');
const {createTestSettlementService,SettlementPending}=require('../server/test_settlement_service.cjs');
const {createStripeTestRefundClient}=require('../server/stripe_test_refunds.cjs');
const {createTestRefundService}=require('../server/test_refund_service.cjs');
const {createSellerCostDisclosure,sellerCostObligationKeys}=require('../server/seller_cost_allocation.cjs');
const S='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222',X='33333333-3333-4333-8333-333333333333',
 L='44444444-4444-4444-8444-444444444444',O='55555555-5555-4555-8555-555555555555',T='66666666-6666-4666-8666-666666666666',
 P='77777777-7777-4777-8777-777777777777',R='88888888-8888-4888-8888-888888888888',Z='99999999-9999-4999-8999-999999999999';
const ACCOUNT='acct_simSeller',PLATFORM='acct_1UWJZuGVbz9Pnhxd',PROJECT='https://zvtaqzcqfdjpuwnlpzln.supabase.co';
const INPUT={authorization:'Bearer operator',orderId:O,requestId:T,kind:'transfer'};
const MIGRATIONS=['20261030_order_ledger','20261030_payment_recovery','20261030_checkout_attempts','20261030_refund_receipts','20261030_refund_requests',
 '20261030_checkout_quote_limits','20261030_checkout_quote_refresh','20261031_cancel_preparation','20261031_refund_review','20261031_charge_fee_evidence',
 '20261031_fulfillment_snapshots','20261031_label_attempts','20261031_tracking_observations','20261102_seller_onboarding','20261102_order_issues',
 '20261102_order_issues_review','20261102_order_issues_thread','20261102_order_issues_review_refunds','20261103_seller_protections',
 '20261103_provider_risk_holds','20261103_startup_policy','20261103_startup_limit_200','20261103_fee_policy_v2','20261103_seller_costs','20261103_settlement_simulation','20261103_refund_provider_inventory'];
let db;const rpc=(name,args)=>db.query('select public.'+name+'('+args.map((_,i)=>'$'+(i+1)).join(',')+') x',args).then(r=>r.rows[0].x);
before(async()=>{db=new PGlite();await db.exec('create role anon;create role authenticated;create role service_role;');for(const n of MIGRATIONS)await db.exec(fs.readFileSync(require.resolve('../supabase/test/'+n+'.sql'),'utf8'));});
after(async()=>db?.close());
beforeEach(async()=>{
 await db.exec('truncate rr_sandbox.catalog cascade;truncate rr_sandbox.seller_accounts cascade;');
 await db.query("insert into rr_sandbox.catalog(id,seller_id,title,price_cents) values($1,$2,'Synthetic settlement service jacket',2500)",[L,S]);
 await rpc('rr_test_claim_seller',[S]);await rpc('rr_test_save_seller',[S,ACCOUNT]);await rpc('rr_test_record_seller_protection',[S,ACCOUNT,true,Date.now()]);
 await rpc('rr_test_reserve',[O,L,B]);
 const snap={test:true,feePolicyVersion:'rr-fees-v2',orderId:O,listingId:L,sellerId:S,currency:'USD',itemCents:2500,buyerFeeCents:175,shippingCents:500,taxCents:0,baseCents:3175,totalCents:3175};
 const input={orderId:O,buyerId:B,feePolicyVersion:'rr-fees-v2',listing:{id:L,seller_id:S,price_cents:2500},shippingQuote:{test:true,orderId:O,amountCents:500,destinationHash:'a'.repeat(64),rateId:'b'.repeat(32)},taxQuote:{test:true,orderId:O,amountCents:0,baseCents:3175,destinationHash:'a'.repeat(64),taxCalculationId:'taxcalc_sim'}};
 await rpc('rr_test_prepare_checkout',[O,B,input,snap,new Date(Date.now()+600000).toISOString()]);
 const order=(await rpc('rr_test_seller_cost_context',[S,O])).order,d=createSellerCostDisclosure({order,maxTotalCents:600,costCaps:{processing:200,radar:10,connect_active_account:200,payout:190,insurance:0},selectedInsurance:false,createdAt:Date.now()});
 const {hash,...document}=d;await rpc('rr_test_prepare_seller_cost_disclosure',[S,O,JSON.stringify(document),hash]);await rpc('rr_test_accept_seller_costs',[S,O,hash]);
 await rpc('rr_test_dispatch_checkout',[O,B]);await rpc('rr_test_attach_checkout',[O,'cs_test_sim',snap,'taxcalc_sim','a'.repeat(64),'b'.repeat(32),new Date(Date.now()+3600000).toISOString()]);
 await rpc('rr_test_process_payment_event',['evt_sim','a'.repeat(64),'checkout.session.completed',O,'cs_test_sim',3175,'usd',true,'pi_sim']);
 await rpc('rr_test_record_charge_fee',[O,S,{test:true,orderId:O,paymentIntentId:'pi_sim',chargeId:'ch_sim',balanceTransactionId:'txn_sim',grossCents:3175,feeCents:100,netCents:3075,currency:'USD',feeDetails:[{type:'stripe_fee',amountCents:100,currency:'USD'}],checkedAt:Date.now()}]);
 const keys=sellerCostObligationKeys(order);
 for(const [kind,amount]of [['processing',100],['radar',7],['connect_active_account',200],['payout',90]])await rpc('rr_test_record_seller_cost',[S,O,{test:true,verified:true,source:kind==='processing'?'provider_receipt':'disclosed_reserve',obligationKey:keys[kind],orderId:O,sellerId:S,kind,phase:kind==='processing'?'confirmed':'reserved',amountCents:amount,sourceTotalCents:amount,sourceReference:kind==='processing'?'txn_sim:fee':null,currency:'USD',observedAt:Date.now(),scope:kind==='connect_active_account'?'seller_month':kind==='payout'?'payout':'order',...(kind==='connect_active_account'?{period:order.settlementPeriod}:{}),...(kind==='payout'?{payoutBatchId:order.payoutBatchId}:{})}]);
 await rpc('rr_test_record_risk',[O,{test:true,orderId:O,chargeId:'ch_sim',decision:'clear',reasonCodes:[],checkedAt:Date.now()},'c'.repeat(64)]);
 const transaction='d'.repeat(32);await db.query('insert into rr_sandbox.label_attempts(request_id,order_id,actor_id,quote,transaction_id,result) values($1,$2,$3,$4,$5,$6)',[Z,O,S,{test:true,rateId:'b'.repeat(32),carrier:'USPS'},transaction,{test:true,status:'SUCCESS',trackingNumber:'SIMULATEDONLY',transactionId:transaction}]);
 await rpc('rr_test_record_tracking',[O,S,{test:true,orderId:O,requestId:Z,transactionId:transaction,trackingNumber:'SIMULATEDONLY',carrier:'USPS',status:'DELIVERED',eventAt:Date.now()-7*86400000,checkedAt:Date.now(),source:'shippo_transaction'}]);
});
function harness(config={}){
 const calls=[],sqlErrors=[],argumentsByName=new Map();let saveResponseLost=false;
 const state={bankId:config.noBank?null:'ba_simBank',capability:'active',connectedAvailable:0,transfer:null,payout:null,reversal:null,refund:null,payoutStatus:'pending',failureReturned:false};
 const repository=createTestOrderRepository({projectUrl:PROJECT,serviceKey:'sb_secret_fixture',allowedMemberIds:[S,B],allowedRefundOperatorIds:[S],refundsEnabled:true,refundRequestsEnabled:true,sellerCostsEnabled:true,settlementSimulationEnabled:true,...config.repositoryOptions,fetchImpl:async(url,options)=>{
  const u=new URL(url);assert.equal(u.origin,PROJECT);calls.push({scope:'database',path:u.pathname,method:options.method});
  if(u.pathname==='/auth/v1/user'){const id=options.headers.Authorization==='Bearer operator'?S:options.headers.Authorization==='Bearer buyer'?B:X;return Response.json({id});}
  assert.equal(options.headers.Authorization,'Bearer sb_secret_fixture');const name=u.pathname.split('/').pop();assert.match(name,/^rr_test_/);
  if(!argumentsByName.has(name))argumentsByName.set(name,(await db.query("select proargnames names from pg_proc where proname=$1 and pronamespace='public'::regnamespace",[name])).rows[0].names);
  const keys=argumentsByName.get(name),body=JSON.parse(options.body);assert.deepEqual(Object.keys(body).sort(),[...keys].sort());
  try{
   const r=await rpc(name,keys.map(k=>body[k]&&typeof body[k]==='object'?JSON.stringify(body[k]):body[k]));
   if(config.loseSaveResponse&&name==='rr_test_save_settlement'&&!saveResponseLost){saveResponseLost=true;return Response.json({error:'private saved response lost'},{status:503});}
   return Response.json(r);
  }catch(e){sqlErrors.push(e.message);return Response.json({error:'Synthetic operation rejected'},{status:400});}
 }});
 const bank=()=>({object:'bank_account',id:state.bankId,account:ACCOUNT,country:'US',currency:'usd',default_for_currency:true,status:'new',available_payout_methods:['standard'],routing_number:'private test routing',account_holder_name:'private test person'});
 const formMetadata=form=>Object.fromEntries([...form].filter(([k])=>k.startsWith('metadata[')).map(([k,v])=>[k.slice(9,-1),v]));
 const balance=amount=>({object:'balance',livemode:false,available:[{currency:'usd',amount,source_types:{card:amount}}]});
 async function transport(url,options){
  const u=new URL(url),path=u.pathname;assert.equal(u.origin,'https://api.stripe.com');assert.equal(options.cache,'no-store');assert.equal(options.redirect,'error');assert.ok(options.signal);
  calls.push({scope:'provider',path,method:options.method,headers:options.headers,body:options.body});let data;
  if(path==='/v1/account')data={object:'account',id:PLATFORM,country:'US'};
  if(path==='/v1/balance')data=balance(options.headers['Stripe-Account']?state.connectedAvailable:3075);
  if(path==='/v2/core/accounts/'+ACCOUNT)data={object:'v2.core.account',id:ACCOUNT,livemode:false,identity:{country:'US'},dashboard:'express',applied_configurations:['recipient'],configuration:{recipient:{capabilities:{stripe_balance:{stripe_transfers:{status:state.capability}}}}},defaults:{responsibilities:{fees_collector:'application',losses_collector:'application'}},metadata:{rr_test_seller_id:S,rr_test_platform:PLATFORM}};
  if(path==='/v1/accounts/'+ACCOUNT)data={object:'account',id:ACCOUNT,settings:{payouts:{schedule:{interval:'manual'}}}};
  if(path==='/v1/accounts/'+ACCOUNT+'/external_accounts')data={object:'list',has_more:false,data:state.bankId?[bank()]:[]};
  if(state.bankId&&path==='/v1/accounts/'+ACCOUNT+'/external_accounts/'+state.bankId)data=bank();
  if(path==='/v1/payment_intents/pi_sim')data={id:'pi_sim',livemode:false,status:'succeeded',currency:'usd',amount:3175,amount_received:3175,metadata:{order_id:O},transfer_group:'rr_test_'+O,latest_charge:'ch_sim'};
  if(path==='/v1/charges/ch_sim')data={object:'charge',id:'ch_sim',payment_intent:'pi_sim',livemode:false,status:'succeeded',paid:true,captured:true,disputed:false,refunded:false,amount_refunded:0,currency:'usd',amount:3175,amount_captured:3175,balance_transaction:'txn_sim',outcome:{type:'authorized',risk_level:'normal'}};
  if(path==='/v1/transfers'&&options.method==='POST'){
   assert.equal(options.headers['Stripe-Account'],undefined);const form=new URLSearchParams(options.body),amount=Number(form.get('amount'));assert.equal(amount,1900);assert.equal(form.get('source_transaction'),'ch_sim');
   state.transfer={object:'transfer',id:'tr_sim',livemode:false,amount,currency:'usd',destination:ACCOUNT,source_transaction:'ch_sim',transfer_group:'rr_test_'+O,amount_reversed:0,reversed:false,balance_transaction:'txn_transfer',metadata:formMetadata(form)};state.connectedAvailable+=amount;data=state.transfer;
  }
  if(path==='/v1/transfers/tr_sim')data=state.transfer;
  if(path==='/v1/payouts'&&options.method==='POST'){
   assert.equal(options.headers['Stripe-Account'],ACCOUNT);const form=new URLSearchParams(options.body),amount=Number(form.get('amount'));assert.equal(form.get('method'),'standard');assert.equal(form.get('destination'),state.bankId);
   state.payout={object:'payout',id:'po_sim',livemode:false,amount,currency:'usd',automatic:false,method:'standard',type:'bank_account',source_type:'card',destination:state.bankId,balance_transaction:'txn_payout',failure_balance_transaction:null,failure_code:null,status:state.payoutStatus,metadata:formMetadata(form)};state.connectedAvailable-=amount;data=state.payout;
  }
  if(path==='/v1/payouts/po_sim'){assert.equal(options.headers['Stripe-Account'],ACCOUNT);data={...state.payout,status:state.payoutStatus,failure_code:state.payoutStatus==='failed'?'account_closed':null,failure_balance_transaction:state.failureReturned?'txn_failure':null};}
  if(path==='/v1/transfers/tr_sim/reversals'&&options.method==='POST'){
   assert.equal(options.headers['Stripe-Account'],undefined);const form=new URLSearchParams(options.body),amount=Number(form.get('amount'));state.reversal={object:'transfer_reversal',id:'trr_sim',amount,currency:'usd',transfer:'tr_sim',source_refund:null,balance_transaction:'txn_reversal',metadata:formMetadata(form)};
   state.connectedAvailable-=amount;state.transfer.amount_reversed+=amount;state.transfer.reversed=state.transfer.amount_reversed===state.transfer.amount;data=state.reversal;
  }
  if(path==='/v1/transfers/tr_sim/reversals/trr_sim')data=state.reversal;
  if(options.method==='GET'&&u.searchParams.has('limit')){
   const records=path==='/v1/transfers'?[state.transfer]:path==='/v1/payouts'?[state.payout]:path==='/v1/transfers/tr_sim/reversals'?[state.reversal]:null;
   if(records)data={object:'list',has_more:false,data:config.hideExisting?[]:records.filter(Boolean)};
  }
  if(path==='/v1/refunds'&&options.method==='POST'){
   const form=new URLSearchParams(options.body);state.refund={object:'refund',id:'re_sim',livemode:false,amount:Number(form.get('amount')),currency:'usd',payment_intent:'pi_sim',charge:'ch_sim',status:'succeeded',metadata:formMetadata(form)};data=state.refund;
  }
  if(path==='/v1/refunds/re_sim')data=state.refund;
  if(path==='/v1/refunds'&&options.method==='GET')data={object:'list',has_more:false,data:state.refund?[state.refund]:[]};
  if(path.startsWith('/v1/balance_transactions/')){
   const id=path.split('/').pop(),transactions={txn_sim:{source:'ch_sim',amount:3175,type:'charge',fee:100,fee_details:[{type:'stripe_fee',amount:100,currency:'usd'}]},txn_transfer:{source:'tr_sim',amount:1900*-1,type:'transfer',fee:0},txn_payout:{source:'po_sim',amount:state.payout?.amount*-1,type:'payout',fee:0},txn_failure:{source:'po_sim',amount:state.payout?.amount,type:'payout_failure',fee:0},txn_reversal:{source:'trr_sim',amount:state.reversal?.amount,type:'transfer_refund',fee:0}},t=transactions[id];assert.ok(t);data={object:'balance_transaction',id,currency:'usd',status:'available',exchange_rate:null,...t,net:t.amount-t.fee};
   assert.equal(options.headers['Stripe-Account'],['txn_payout','txn_failure'].includes(id)?ACCOUNT:undefined);
  }
  assert.ok(data,'Unhandled synthetic provider operation '+options.method+' '+path);
  if(options.method==='POST'&&(config.losePostResponse&&path==='/v1/transfers'||config.losePostKind==='payout'&&path==='/v1/payouts'||config.losePostKind==='reversal'&&path==='/v1/transfers/tr_sim/reversals'))throw Error('private provider accepted response lost');
  if(config.patchProvider)data=config.patchProvider(structuredClone(data),u,options)||data;
  return Response.json(data);
 }
 const stripe=createStripeTestSettlementClient({secretKey:'rk_test_fixture',accountId:PLATFORM,fetchImpl:transport});
 const service=createTestSettlementService({repository,stripe});
 const refunds=createTestRefundService({repository,stripe:createStripeTestRefundClient({secretKey:'rk_test_fixture',accountId:PLATFORM,fetchImpl:transport})});
 return {service,repository,stripe,refunds,state,calls,sqlErrors};
}
const providerCalls=h=>h.calls.filter(c=>c.scope==='provider'),postCount=(h,path)=>providerCalls(h).filter(c=>c.method==='POST'&&c.path===path).length;
const simulationLedger=()=>db.query('select request_id,kind,amount_cents from rr_sandbox.settlement_sim_ledger order by request_id,kind').then(r=>r.rows);
const ordinaryLedger=()=>db.query('select * from rr_sandbox.ledger_entries order by kind').then(r=>r.rows);
const attempt=(id=T)=>rpc('rr_test_settlement_context',[S,O]).then(c=>c.attempts.find(q=>q.requestId===id));
const payoutInput={...INPUT,requestId:P,kind:'payout',parentRequestId:T},reversalInput={...INPUT,requestId:R,kind:'reversal',parentRequestId:T};

test('real service, repository and SQL simulate transfer, payout paid-to-failed recovery, reversal and refund without enabling live release',async()=>{
 const h=harness(),ordinary=await ordinaryLedger(),first=await h.service.start({...INPUT,amountCents:1});assert.equal(first.amountCents,1900);assert.equal(first.state,'succeeded');assert.equal(first.releaseEnabled,false);assert.equal(first.liveReady,false);
 assert.equal(postCount(h,'/v1/transfers'),1);assert.ok(providerCalls(h).some(c=>c.method==='GET'&&c.path==='/v1/transfers/tr_sim'));assert.equal((await simulationLedger()).length,2);
 const paid=await h.service.start(payoutInput);assert.equal(paid.state,'pending');assert.equal(paid.amountCents,1900);assert.equal(postCount(h,'/v1/payouts'),1);assert.equal((await attempt()).availableCents,0);
 h.state.payoutStatus='paid';assert.equal((await h.service.status(payoutInput)).state,'paid');const paidRows=await simulationLedger();assert.ok(paidRows.some(r=>r.kind==='seller_bank_receipt'));
 h.state.payoutStatus='failed';const failed=await h.service.status(payoutInput);assert.equal(failed.recoveryRequired,true);assert.equal((await attempt()).availableCents,0);await assert.rejects(h.service.start(reversalInput),SettlementPending);assert.equal(postCount(h,'/v1/transfers/tr_sim/reversals'),0);
 h.state.failureReturned=true;h.state.connectedAvailable=1900;h.state.capability='restricted';const returned=await h.service.status(payoutInput);assert.equal(returned.state,'failed');assert.equal((await attempt()).availableCents,1900);const returnedRows=await simulationLedger();await h.service.status(payoutInput);assert.deepEqual(await simulationLedger(),returnedRows);
 const recovered=await h.service.start(reversalInput);assert.equal(recovered.state,'succeeded');assert.equal(recovered.amountCents,1900);assert.equal(postCount(h,'/v1/transfers/tr_sim/reversals'),1);const recoveredRows=await simulationLedger();await h.service.status(reversalInput);assert.deepEqual(await simulationLedger(),recoveredRows);assert.equal((await attempt()).availableCents,0);
 assert.deepEqual(await ordinaryLedger(),ordinary);assert.equal(recoveredRows.reduce((n,r)=>n+Number(r.amount_cents),0),0);assert.equal((await h.repository.protectionReview(INPUT)).releaseEnabled,false);
 const refund=await h.refunds.start({...INPUT,requestId:Z,amountCents:3175});assert.equal(refund.state,'request_recorded');assert.equal(postCount(h,'/v1/refunds'),1);
 const event={id:'evt_settlementRefund',type:'refund.created',livemode:false,created:Math.floor(Date.now()/1000),data:{object:h.state.refund}},rawBody=Buffer.from(JSON.stringify(event)),t=Math.floor(Date.now()/1000),notification={rawBody,signature:'t='+t+',v1='+createHmac('sha256','whsec_fixture').update(t+'.').update(rawBody).digest('hex'),webhookSecret:'whsec_fixture'};
 await h.repository.acceptStripeEvent(notification);const refunded=await ordinaryLedger();await h.repository.acceptStripeEvent(notification);assert.deepEqual(await ordinaryLedger(),refunded);assert.equal(refunded.reduce((n,r)=>n+Number(r.amount_cents),0),0);
 assert.equal((await db.query('select refunded_cents from rr_sandbox.orders where id=$1',[O])).rows[0].refunded_cents,3175);
 assert.equal((await db.query("select count(*)::int n from rr_sandbox.jobs where kind in ('seller_transfer','seller_payout') and state<>'held'")).rows[0].n,0);
 for(const word of ['acct_simSeller','ba_simBank','private test'])assert.equal(JSON.stringify(recovered).includes(word),false);
});
test('concurrent start and known-ID status issue one transfer POST and recheck only its saved identity',async()=>{
 const h=harness(),r=await Promise.allSettled([h.service.start(INPUT),h.service.start(INPUT)]);assert.ok(r.some(v=>v.status==='fulfilled'),h.sqlErrors.join(';'));assert.equal(postCount(h,'/v1/transfers'),1);
 const before=providerCalls(h).length,ledger=await simulationLedger();await h.service.start(INPUT);await h.service.status(INPUT);assert.equal(postCount(h,'/v1/transfers'),1);assert.ok(providerCalls(h).slice(before).every(c=>c.method==='GET'));assert.deepEqual(await simulationLedger(),ledger);
});
test('lost provider response leaves the irreversible request dispatched and held across retries',async()=>{
 const h=harness({losePostResponse:true});await assert.rejects(h.service.start(INPUT),SettlementPending);const q=await attempt();assert.equal(q.phase,'dispatched');assert.equal(q.providerId,null);assert.equal(q.needsReview,true);assert.equal(q.holdReason,'provider_outcome_unknown');assert.equal(postCount(h,'/v1/transfers'),1);assert.deepEqual(await simulationLedger(),[]);
 const reads=providerCalls(h).length;await assert.rejects(h.service.start(INPUT),SettlementPending);await assert.rejects(h.service.status(INPUT),SettlementPending);assert.equal(providerCalls(h).length,reads);assert.equal(postCount(h,'/v1/transfers'),1);
});
test('a lost database save response resumes with GET and books a confirmed transfer only once',async()=>{
 const h=harness({loseSaveResponse:true});await assert.rejects(h.service.start(INPUT));assert.equal((await attempt()).phase,'known');assert.equal((await attempt()).providerId,'tr_sim');assert.deepEqual(await simulationLedger(),[]);
 assert.equal((await h.service.start(INPUT)).state,'succeeded');const ledger=await simulationLedger();await h.service.status(INPUT);assert.equal(postCount(h,'/v1/transfers'),1);assert.deepEqual(await simulationLedger(),ledger);
});
test('ordinary members, missing flags and invalid references never reach settlement provider operations',async()=>{
 for(const options of [{authorization:'Bearer buyer'},{authorization:'Bearer outsider'},{requestId:'not-a-reference'}]){const h=harness();await assert.rejects(h.service.start({...INPUT,...options}));assert.equal(providerCalls(h).length,0);assert.equal((await db.query('select count(*)::int n from rr_sandbox.settlement_sim_requests')).rows[0].n,0);}
 const h=harness({repositoryOptions:{settlementSimulationEnabled:false}});await assert.rejects(h.service.start(INPUT),OrderAccessDenied);assert.equal(h.calls.length,0);
});
test('missing default bank blocks payouts and a later first supported bank can be bound',async()=>{
 const none=harness({noBank:true});await none.service.start(INPUT);await assert.rejects(none.service.start(payoutInput));assert.equal(postCount(none,'/v1/payouts'),0);assert.equal((await db.query('select count(*)::int n from rr_sandbox.settlement_sim_requests')).rows[0].n,1);
 // A separate already-prepared order database fixture is unnecessary: this
 // provider now reports a bank, but the original binding was explicitly null.
 none.state.bankId='ba_simBank';assert.equal((await none.service.start(payoutInput)).state,'pending');
});
test('a changed default bank after transfer is held before the first payout can be created',async()=>{
 const h=harness();await h.service.start(INPUT);h.state.bankId='ba_replacement';await assert.rejects(h.service.start(payoutInput));assert.equal(postCount(h,'/v1/payouts'),0);assert.ok(h.sqlErrors.some(s=>/bank|binding/i.test(s)));assert.equal((await db.query('select count(*)::int n from rr_sandbox.settlement_sim_requests')).rows[0].n,1);
});
test('insufficient connected recovery funds are recorded as a hold and never cause a bank debit or new payout',async()=>{
 const h=harness();await h.service.start(INPUT);h.state.connectedAvailable=0;await assert.rejects(h.service.start(reversalInput),SettlementPending);const q=await attempt(R);assert.equal(q.phase,'dispatched');assert.equal(q.needsReview,true);assert.equal(q.holdReason,'provider_balance_insufficient');assert.equal(postCount(h,'/v1/transfers/tr_sim/reversals'),0);
 await assert.rejects(h.service.start(reversalInput),SettlementPending);assert.equal(providerCalls(h).some(c=>/\/debits|\/external_accounts$/.test(c.path)&&c.method==='POST'),false);assert.equal(postCount(h,'/v1/payouts'),0);
});
test('an accepted transfer with a lost response is reconciled through GET only and recorded once',async()=>{
 const h=harness({losePostResponse:true});await assert.rejects(h.service.start(INPUT),SettlementPending);assert.equal((await attempt()).providerId,null);const count=providerCalls(h).length;
 const result=await h.service.reconcile(INPUT);assert.equal(result.state,'succeeded');assert.equal((await attempt()).providerId,'tr_sim');assert.equal(postCount(h,'/v1/transfers'),1);assert.ok(providerCalls(h).slice(count).every(c=>c.method==='GET'));assert.equal((await simulationLedger()).length,2);
 const ledger=await simulationLedger();await h.service.reconcile(INPUT);assert.deepEqual(await simulationLedger(),ledger);assert.equal(postCount(h,'/v1/transfers'),1);assert.equal(result.releaseEnabled,false);
});
test('an uncertain operation absent from a complete provider inventory stays held without a second POST',async()=>{
 const h=harness({losePostResponse:true,hideExisting:true});await assert.rejects(h.service.start(INPUT),SettlementPending);await assert.rejects(h.service.reconcile(INPUT),SettlementPending);await assert.rejects(h.service.reconcile(INPUT),SettlementPending);assert.equal((await attempt()).phase,'dispatched');assert.equal((await attempt()).providerId,null);assert.equal(postCount(h,'/v1/transfers'),1);assert.deepEqual(await simulationLedger(),[]);
});
test('an accepted payout with a lost response is found only in its connected bank scope and never recreated',async()=>{
 const h=harness({losePostKind:'payout'});await h.service.start(INPUT);await assert.rejects(h.service.start(payoutInput),SettlementPending);assert.equal((await attempt(P)).providerId,null);const before=providerCalls(h).length;
 const result=await h.service.reconcile(payoutInput);assert.equal(result.state,'pending');assert.equal((await attempt(P)).providerId,'po_sim');assert.equal((await attempt()).availableCents,0);assert.equal(postCount(h,'/v1/payouts'),1);assert.ok(providerCalls(h).slice(before).every(c=>c.method==='GET'));
 const ledger=await simulationLedger();await h.service.reconcile(payoutInput);assert.deepEqual(await simulationLedger(),ledger);assert.equal(postCount(h,'/v1/payouts'),1);
});
test('an accepted reversal with a lost response is recovered under its original transfer and accounted once',async()=>{
 const h=harness({losePostKind:'reversal'});await h.service.start(INPUT);await assert.rejects(h.service.start(reversalInput),SettlementPending);assert.equal((await attempt(R)).providerId,null);const before=providerCalls(h).length;
 const result=await h.service.reconcile(reversalInput);assert.equal(result.state,'succeeded');assert.equal((await attempt(R)).providerId,'trr_sim');assert.equal((await attempt()).availableCents,0);assert.equal(postCount(h,'/v1/transfers/tr_sim/reversals'),1);assert.ok(providerCalls(h).slice(before).every(c=>c.method==='GET'));
 const ledger=await simulationLedger();await h.service.reconcile(reversalInput);assert.deepEqual(await simulationLedger(),ledger);assert.equal(postCount(h,'/v1/transfers/tr_sim/reversals'),1);
});
test('the immutable full cost reserve covers later cost increases and lower confirmed costs do not block the parent payout',async()=>{
 const h=harness(),initial=await h.service.start(INPUT);assert.equal(initial.amountCents,1900);assert.equal((await attempt()).maxTransferCents,1900);
 const order=(await rpc('rr_test_seller_cost_context',[S,O])).order,keys=sellerCostObligationKeys(order);
 const evidence=(kind,amount,phase)=>({test:true,verified:true,source:phase==='confirmed'?'provider_receipt':'disclosed_reserve',obligationKey:keys[kind],orderId:O,sellerId:S,kind,phase,amountCents:amount,sourceTotalCents:amount,sourceReference:phase==='confirmed'?'inv_simRadar:fee':null,currency:'USD',observedAt:Date.now(),scope:kind==='payout'?'payout':'order',...(kind==='payout'?{payoutBatchId:order.payoutBatchId}:{})});
 await rpc('rr_test_record_seller_cost',[S,O,evidence('payout',190,'reserved')]);
 const increased=await h.repository.settlementContext(INPUT);assert.deepEqual(increased.blockers,[]);assert.equal(increased.maxTransferCents,1900);assert.equal(increased.transferableCents,1900);assert.equal((await attempt()).availableCents,1900);
 await rpc('rr_test_record_seller_cost',[S,O,evidence('radar',5,'confirmed')]);
 const lower=await h.repository.settlementContext(INPUT);assert.deepEqual(lower.blockers,[]);assert.equal(lower.maxTransferCents,1900);assert.equal(lower.transferableCents,1900);
 const allocated=Number((await db.query('select sum(amount_cents) n from rr_sandbox.seller_cost_allocations where order_id=$1',[O])).rows[0].n);assert.equal(allocated,495);assert.ok(2500-initial.amountCents>=allocated);
 const paid=await h.service.start(payoutInput);assert.equal(paid.state,'pending');assert.equal(paid.amountCents,1900);assert.equal(postCount(h,'/v1/transfers'),1);assert.equal(postCount(h,'/v1/payouts'),1);assert.equal((await attempt()).availableCents,0);
 // The remaining $1.05 is still held within the seller's $6 cost reserve.
 // A second transfer cannot convert that unfinalized residual to profit.
 await assert.rejects(h.service.start({...INPUT,requestId:R}));assert.equal(postCount(h,'/v1/transfers'),1);assert.equal(paid.releaseEnabled,false);assert.equal(paid.liveReady,false);
});
test('the same prepared reversal can recover a transfer after an external signed refund while preserving its review hold',async()=>{
 const h=harness();await h.service.start(INPUT);
 const prepared=await h.repository.prepareSettlement({...reversalInput,amountCents:1900});assert.equal(prepared.phase,'prepared');assert.equal(prepared.providerId,null);assert.equal(postCount(h,'/v1/transfers/tr_sim/reversals'),0);
 const event={id:'evt_externalPreparedReversal',type:'refund.created',livemode:false,created:Math.floor(Date.now()/1000),data:{object:{object:'refund',id:'re_externalPreparedReversal',amount:3175,currency:'usd',payment_intent:'pi_sim',charge:'ch_sim',status:'succeeded',metadata:{}}}},rawBody=Buffer.from(JSON.stringify(event)),t=Math.floor(Date.now()/1000);
 const notice={rawBody,signature:'t='+t+',v1='+createHmac('sha256','whsec_fixture').update(t+'.').update(rawBody).digest('hex'),webhookSecret:'whsec_fixture'};
 await h.repository.acceptStripeEvent(notice);const held=await attempt(R);assert.equal(held.phase,'prepared');assert.equal(held.needsReview,true);assert.equal(held.holdReason,'provider_refund_notice');assert.equal((await attempt()).needsReview,true);
 const before=providerCalls(h).length,recovered=await h.service.start(reversalInput);assert.equal(recovered.state,'succeeded');assert.equal(recovered.needsReview,true);assert.equal(recovered.recoveryRequired,true);assert.equal(recovered.releaseEnabled,false);assert.equal(recovered.liveReady,false);assert.equal(postCount(h,'/v1/transfers/tr_sim/reversals'),1);
 assert.ok(providerCalls(h).slice(before).some(c=>c.method==='GET'&&c.path==='/v1/transfers/tr_sim'));assert.ok(providerCalls(h).slice(before).some(c=>c.method==='GET'&&c.path==='/v1/transfers/tr_sim/reversals/trr_sim'));
 const saved=await attempt(R);assert.equal(saved.phase,'known');assert.equal(saved.status,'succeeded');assert.equal(saved.needsReview,true);assert.equal(saved.holdReason,'provider_refund_notice');assert.equal((await attempt()).availableCents,0);
 const ledger=await simulationLedger(),reads=providerCalls(h).length;await h.service.start(reversalInput);await h.service.status(reversalInput);await h.repository.acceptStripeEvent(notice);assert.deepEqual(await simulationLedger(),ledger);assert.ok(providerCalls(h).slice(reads).every(c=>c.method==='GET'));assert.equal(postCount(h,'/v1/transfers/tr_sim/reversals'),1);
 assert.equal((await db.query("select count(*)::int n from rr_sandbox.jobs where kind in ('seller_transfer','seller_payout') and state<>'held'")).rows[0].n,0);
});
