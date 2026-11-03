'use strict';
// Stitched LOCAL acceptance only: PostgreSQL and the application adapters are
// real; Auth, Stripe and shipping transports are synthetic. This is not hosted
// acceptance, real fraud effectiveness, a shipping purchase or a seller payout.
const {test,before,after,beforeEach}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs');
const {createHmac}=require('node:crypto'),{Readable}=require('node:stream');
const {PGlite}=require('@electric-sql/pglite');
const {createTestOrderRepository}=require('../server/test_order_repository.cjs');
const {createTestSellerOnboarding}=require('../server/test_seller_onboarding.cjs');
const {createStripeTestCheckoutClient}=require('../server/marketplace_test_checkout.cjs');
const {createStripeTestTaxClient}=require('../server/stripe_test_tax.cjs');
const {createTestCheckoutService,createTestQuoteService}=require('../server/test_checkout_service.cjs');
const {createTestSellerCostService}=require('../server/test_seller_cost_service.cjs');
const {createTestWebhookHandler,createTestOrdersHandler}=require('../server/test_order_handlers.cjs');
const {createStripeTestFeeClient}=require('../server/stripe_test_fees.cjs');
const {createTestFeeService}=require('../server/test_fee_service.cjs');
const {createStripeTestRiskClient}=require('../server/stripe_test_risk_client.cjs');
const {createTestRiskService}=require('../server/test_risk_service.cjs');
const {createStripeTestRefundClient}=require('../server/stripe_test_refunds.cjs');
const {createTestRefundService}=require('../server/test_refund_service.cjs');
const {sellerCostObligationKeys}=require('../server/seller_cost_allocation.cjs');
const {publicSellerCostReview}=require('../test-seller-cost-review.js');
const O='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222',
 S='33333333-3333-4333-8333-333333333333',L='44444444-4444-4444-8444-444444444444',
 R='55555555-5555-4555-8555-555555555555',T='66666666-6666-4666-8666-666666666666',
 M='77777777-7777-4777-8777-777777777777',P='88888888-8888-4888-8888-888888888888';
const ACCOUNT='acct_1UWJZuGVbz9Pnhxd',PROJECT='https://zvtaqzcqfdjpuwnlpzln.supabase.co';
const TO={line1:'123 Synthetic Street',city:'Seattle',state:'WA',postal_code:'98101',country:'US'};
const BUY={authorization:'Bearer buyer',orderId:O,listingId:L,to:TO},SELL={authorization:'Bearer seller',orderId:O};
const MIGRATIONS=['20261030_order_ledger','20261030_payment_recovery','20261030_checkout_attempts',
 '20261030_refund_receipts','20261030_refund_requests','20261030_checkout_quote_limits','20261030_checkout_quote_refresh',
 '20261031_cancel_preparation','20261031_refund_review','20261031_charge_fee_evidence','20261031_fulfillment_snapshots',
 '20261031_label_attempts','20261031_tracking_observations','20261102_seller_onboarding','20261102_order_issues',
 '20261102_order_issues_review','20261102_order_issues_thread','20261102_order_issues_review_refunds',
 '20261103_seller_protections','20261103_provider_risk_holds','20261103_startup_policy',
 '20261103_fee_policy_v2','20261103_seller_costs'];
let db;
const rpc=(name,args)=>db.query('select public.'+name+'('+args.map((_,i)=>'$'+(i+1)).join(',')+') x',args).then(r=>r.rows[0].x);
before(async()=>{
 db=new PGlite();await db.exec('create role anon;create role authenticated;create role service_role;');
 for(const name of MIGRATIONS)await db.exec(fs.readFileSync(require.resolve('../supabase/test/'+name+'.sql'),'utf8'));
});
after(async()=>db?.close());
beforeEach(async()=>{
 await db.exec('truncate rr_sandbox.catalog cascade;truncate rr_sandbox.seller_accounts cascade;');
 for(const [listing,seller]of [[L,S],[M,T]])await db.query("insert into rr_sandbox.catalog(id,seller_id,title,price_cents) values($1,$2,'Synthetic acceptance jacket',2500)",[listing,seller]);
 // A second already-onboarded seller proves the startup cap is marketplace-wide.
 await rpc('rr_test_claim_seller',[T]);await rpc('rr_test_save_seller',[T,'acct_secondFixture']);
 await rpc('rr_test_record_seller_protection',[T,'acct_secondFixture',true,Date.now()]);
});
const response=()=>({headers:{},setHeader(k,v){this.headers[k]=v;},end(body){this.body=JSON.parse(body);}});
function harness({loseCheckoutResponse=false}={}){
 const databaseCalls=[],providerCalls=[],sqlErrors=[],argumentNames=new Map();let session,refund,quoteCalls=0,elevated=false;
 const allowed=new Set(['rr_test_seller_context','rr_test_claim_seller','rr_test_save_seller','rr_test_record_seller_protection',
  'rr_test_reserve','rr_test_quote_permit','rr_test_checkout_attempt','rr_test_prepare_checkout','rr_test_dispatch_checkout',
  'rr_test_save_checkout_session','rr_test_finish_checkout','rr_test_member_orders','rr_test_process_payment_event',
  'rr_test_seller_cost_context','rr_test_prepare_seller_cost_disclosure','rr_test_accept_seller_costs','rr_test_fee_order',
  'rr_test_record_charge_fee','rr_test_record_risk','rr_test_order_issue','rr_test_acknowledge_issue','rr_test_protection_review',
  'rr_test_prepare_refund','rr_test_get_refund_request','rr_test_dispatch_refund','rr_test_save_refund','rr_test_process_refund_receipt']);
 const repository=createTestOrderRepository({projectUrl:PROJECT,serviceKey:'sb_secret_journeyFixture',allowedMemberIds:[B,S],
  allowedRefundOperatorIds:[S],refundsEnabled:true,refundRequestsEnabled:true,sellerCostsEnabled:true,disputesEnabled:true,
  fetchImpl:async(url,options)=>{
   const u=new URL(url);assert.equal(u.origin,PROJECT);databaseCalls.push({path:u.pathname,authorization:options.headers.Authorization});
   if(u.pathname==='/auth/v1/user'){
    const id={'Bearer buyer':B,'Bearer seller':S}[options.headers.Authorization];return Response.json(id?{id}:{},{status:id?200:401});
   }
   const name=u.pathname.split('/').pop();assert.ok(allowed.has(name),'Unexpected financial RPC: '+name);
   assert.equal(options.headers.Authorization,'Bearer sb_secret_journeyFixture');
   if(!argumentNames.has(name))argumentNames.set(name,(await db.query("select proargnames names from pg_proc where proname=$1 and pronamespace='public'::regnamespace",[name])).rows[0].names);
   const body=JSON.parse(options.body),keys=argumentNames.get(name);assert.deepEqual(Object.keys(body).sort(),[...keys].sort());
   try{return Response.json(await rpc(name,keys.map(k=>body[k]&&typeof body[k]==='object'?JSON.stringify(body[k]):body[k])));}
   catch(e){sqlErrors.push(e.message);return Response.json({error:'Synthetic database operation rejected'},{status:400});}
  }});
 async function stripeTransport(url,options){
  const u=new URL(url);assert.equal(u.origin,'https://api.stripe.com');providerCalls.push({path:u.pathname,method:options.method,body:options.body});
  assert.equal(options.cache,'no-store');assert.equal(options.redirect,'error');assert.ok(options.signal);
  const path=u.pathname;
  if(path==='/v1/account')return Response.json({id:ACCOUNT});
  if(path==='/v1/balance')return Response.json({livemode:false});
  if(path==='/v2/core/accounts/acct_journeySeller')return Response.json({object:'v2.core.account',id:'acct_journeySeller',livemode:false,identity:{country:'US'},dashboard:'express',applied_configurations:['recipient'],defaults:{responsibilities:{fees_collector:'application',losses_collector:'application',requirements_collector:'stripe'}},configuration:{recipient:{capabilities:{stripe_balance:{stripe_transfers:{status:'active'}}}}},requirements:{entries:[]},metadata:{rr_test_seller_id:S,rr_test_platform:ACCOUNT}});
  if(path==='/v1/tax/settings')return Response.json({livemode:false,status:'active',head_office:{address:TO}});
  if(path==='/v1/tax/registrations')return Response.json({object:'list',has_more:false,data:[{livemode:false,status:'active',active_from:Math.floor(Date.now()/1000)-100,country:'US',country_options:{us:{type:'state_sales_tax',state:'WA'}}}]});
  if(path==='/v1/tax/calculations'){
   const f=new URLSearchParams(options.body);assert.equal(f.get('line_items[0][amount]'),'2500');assert.equal(f.get('line_items[1][amount]'),'175');assert.equal(f.get('shipping_cost[amount]'),'500');
   return Response.json({id:'taxcalc_journey',livemode:false,currency:'usd',tax_amount_exclusive:327,tax_amount_inclusive:0,amount_total:3502,expires_at:Math.floor(Date.now()/1000)+600,
    line_items:{has_more:false,data:[0,1].map(i=>({reference:f.get('line_items['+i+'][reference]'),amount:Number(f.get('line_items['+i+'][amount]')),tax_code:f.get('line_items['+i+'][tax_code]')}))},
    tax_breakdown:[{amount:327,inclusive:false,tax_rate_details:{country:'US'},taxability_reason:'standard_rated'}]});
  }
  if(path==='/v1/checkout/sessions'&&options.method==='POST'){
   const f=new URLSearchParams(options.body);assert.equal(f.get('line_items[1][price_data][unit_amount]'),'175');assert.equal(f.get('line_items[1][quantity]'),'1');assert.match(f.get('line_items[1][price_data][product_data][name]'),/5%.*0\.50 per order/);
   session={object:'checkout.session',id:'cs_test_journey',livemode:false,mode:'payment',status:'open',payment_status:'unpaid',currency:'usd',amount_total:3502,
    client_reference_id:O,metadata:{order_id:O,integration:'rack_relic_test'},expires_at:Math.floor(Date.now()/1000)+3600,url:'https://checkout.stripe.com/c/pay/cs_test_journey'};
   if(loseCheckoutResponse)throw Error('Synthetic response lost after provider acceptance');return Response.json(session);
  }
  if(path==='/v1/checkout/sessions/cs_test_journey')return Response.json(session);
  if(path==='/v1/payment_intents/pi_journey')return Response.json({id:'pi_journey',livemode:false,status:'succeeded',amount:3502,amount_received:3502,currency:'usd',metadata:{order_id:O},transfer_group:'rr_test_'+O,latest_charge:'ch_journey'});
  if(path==='/v1/charges/ch_journey')return Response.json({object:'charge',id:'ch_journey',livemode:false,payment_intent:'pi_journey',status:'succeeded',paid:true,captured:true,disputed:false,refunded:false,amount_refunded:0,
   amount:3502,amount_captured:3502,currency:'usd',balance_transaction:'txn_journey',metadata:{order_id:O},outcome:{type:'authorized',risk_level:elevated?'elevated':'normal'},
   payment_method_details:{type:'card',card:{checks:{cvc_check:'pass',address_line1_check:'pass',address_postal_code_check:'pass'},three_d_secure:{result:'authenticated'}}}});
  if(path==='/v1/balance_transactions/txn_journey')return Response.json({object:'balance_transaction',id:'txn_journey',source:'ch_journey',amount:3502,currency:'usd',fee:132,net:3370,
   type:'charge',reporting_category:'charge',status:'available',exchange_rate:null,fee_details:[{type:'stripe_fee',amount:132,currency:'usd'}]});
  if(path==='/v1/refunds'&&options.method==='POST'){
   const f=new URLSearchParams(options.body);assert.equal(f.get('amount'),'3502');assert.equal(f.get('payment_intent'),'pi_journey');
   refund={object:'refund',id:'re_journey',livemode:false,amount:3502,currency:'usd',payment_intent:'pi_journey',charge:'ch_journey',status:'succeeded',metadata:{integration:'rack_relic_test_refund',request_id:R,order_id:O}};return Response.json(refund);
  }
  if(path==='/v1/refunds/re_journey')return Response.json(refund);
  assert.fail('Unexpected synthetic provider operation: '+options.method+' '+path);
 }
 const stripe=createStripeTestCheckoutClient({secretKey:'rk_test_journeyFixture',fetchImpl:stripeTransport});
 const quotes=createTestQuoteService({shipping:{async quote(){quoteCalls++;return {test:true,rates:[{test:true,id:'a'.repeat(32),currency:'USD',amountCents:500}]};}},
  tax:createStripeTestTaxClient({secretKey:'sk_test_journeyFixture',fetchImpl:stripeTransport}),
  loadFulfillment:async(_,order)=>({test:true,sellerId:S,listingUpdatedAt:order.listing_updated_at,from:TO,package:{length:10,width:8,height:2,weight:1},itemTaxCode:'txcd_30011000',buyerFeeTaxCode:'txcd_30011000'})});
 const checkout=createTestCheckoutService({repository,quotes,stripe,quoteLimitsEnabled:true});
 const costs=createTestSellerCostService({repository,loadCostQuote:async order=>({test:true,orderId:order.orderId,sellerId:S,expiresAt:Date.now()+60000,
  maxTotalCents:600,costCaps:{processing:200,radar:10,connect_active_account:200,payout:190,insurance:0},selectedInsurance:false})});
 const sellers=createTestSellerOnboarding({repository,protectionsEnabled:true,secretKey:'rk_test_journeyFixture',accountId:ACCOUNT,fetchImpl:stripeTransport});
 const fees=createTestFeeService({repository,stripe:createStripeTestFeeClient({secretKey:'rk_test_journeyFixture',accountId:ACCOUNT,fetchImpl:stripeTransport})});
 const risk=createTestRiskService({repository,stripe:createStripeTestRiskClient({secretKey:'rk_test_journeyFixture',accountId:ACCOUNT,fetchImpl:stripeTransport})});
 const refunds=createTestRefundService({repository,stripe:createStripeTestRefundClient({secretKey:'rk_test_journeyFixture',accountId:ACCOUNT,fetchImpl:stripeTransport})});
 async function notify(event){
  const raw=Buffer.from(JSON.stringify(event)),t=Math.floor(Date.now()/1000),signature='t='+t+',v1='+createHmac('sha256','whsec_journeyFixture').update(t+'.').update(raw).digest('hex');
  const req=Object.assign(Readable.from([raw]),{method:'POST',headers:{'stripe-signature':signature}}),res=response();
  await createTestWebhookHandler({repository,webhookSecret:'whsec_journeyFixture',enabled:true})(req,res);assert.equal(res.statusCode,200,sqlErrors.at(-1));return event;
 }
 return {repository,checkout,costs,sellers,fees,risk,refunds,databaseCalls,providerCalls,sqlErrors,notify,
  get quoteCalls(){return quoteCalls;},get session(){return session;},get refund(){return refund;},set elevated(value){elevated=value;}};
}
const row=()=>db.query('select * from rr_sandbox.orders where id=$1',[O]).then(r=>r.rows[0]);
const ledger=()=>db.query('select kind,amount_cents from rr_sandbox.ledger_entries where order_id=$1 order by kind',[O]).then(r=>r.rows);
const postCount=(h,path)=>h.providerCalls.filter(c=>c.method==='POST'&&c.path===path).length;
async function readySellerAndConsent(h){
 await h.repository.claimSeller(SELL);await h.repository.saveSeller({...SELL,accountId:'acct_journeySeller'});
 assert.equal((await h.sellers.status(SELL)).state,'provider_ready');
 await assert.rejects(h.checkout.start(BUY));assert.match(h.sqlErrors.at(-1),/Seller cost acceptance required/);
 const d=await h.costs.prepare(SELL);assert.equal(d.accepted,false);assert.equal(d.buyerFeeCents,175);
 const accepted=await h.costs.accept({...SELL,disclosureHash:d.disclosure.hash});assert.equal(accepted.accepted,true);assert.equal(accepted.releaseEnabled,false);
 assert.deepEqual(publicSellerCostReview(accepted,O),accepted);return accepted;
}

test('local seller-to-buyer journey preserves one 5% plus 50-cent payment, cost evidence, issue hold and full-refund accounting',async()=>{
 const h=harness();await assert.rejects(h.checkout.start(BUY));assert.equal((await db.query('select count(*)::int n from rr_sandbox.orders')).rows[0].n,0);assert.equal(h.providerCalls.length,0);
 await readySellerAndConsent(h);assert.equal(postCount(h,'/v1/checkout/sessions'),0);assert.equal(h.quoteCalls,1);
 const prepared=(await db.query('select input,snapshot from rr_sandbox.checkout_attempts where order_id=$1',[O])).rows[0];
 assert.equal(prepared.snapshot.totalCents,3502);assert.equal(prepared.snapshot.feePolicyVersion,'rr-fees-v2');assert.equal(JSON.stringify(prepared).includes(TO.line1),false);
 await assert.rejects(h.costs.status({...SELL,authorization:'Bearer buyer'}));
 const context=await h.repository.sellerCostContext(SELL),keys=sellerCostObligationKeys(context.order);
 for(const [kind,amount]of [['processing',150],['radar',7],['connect_active_account',200],['payout',90]]){
  await rpc('rr_test_record_seller_cost',[S,O,{test:true,verified:true,source:'disclosed_reserve',obligationKey:keys[kind],orderId:O,sellerId:S,kind,phase:'reserved',amountCents:amount,sourceTotalCents:amount,sourceReference:null,currency:'USD',observedAt:Date.now(),
   scope:kind==='connect_active_account'?'seller_month':kind==='payout'?'payout':'order',...(kind==='connect_active_account'?{period:context.order.settlementPeriod}:{}),...(kind==='payout'?{payoutBatchId:context.order.payoutBatchId}:{})}]);
 }
 assert.deepEqual(await ledger(),[]);
 const concurrent=await Promise.allSettled([h.checkout.start(BUY),h.checkout.start(BUY)]);assert.ok(concurrent.some(r=>r.status==='fulfilled'));assert.equal(postCount(h,'/v1/checkout/sessions'),1);
 assert.equal((await h.checkout.start(BUY)).state,'checkout_open');assert.equal(h.quoteCalls,1);assert.equal((await row()).state,'checkout_open');assert.deepEqual(await ledger(),[]);
 const paidSession={...h.session,status:'complete',payment_status:'paid',payment_intent:'pi_journey'};
 const paymentEvent={id:'evt_journeyPaid',type:'checkout.session.completed',livemode:false,created:Math.floor(Date.now()/1000),data:{object:paidSession}};
 await h.notify(paymentEvent);const paidLedger=await ledger();await h.notify(paymentEvent);assert.deepEqual(await ledger(),paidLedger);
 assert.equal((await row()).state,'paid');assert.equal((await db.query('select status from rr_sandbox.catalog where id=$1',[L])).rows[0].status,'sold');assert.equal(paidLedger.reduce((n,l)=>n+Number(l.amount_cents),0),0);
 for(const authorization of ['Bearer buyer','Bearer seller']){const res=response();await createTestOrdersHandler({repository:h.repository,enabled:true})({method:'GET',headers:{authorization}},res);assert.equal(res.statusCode,200);assert.equal(res.body.orders[0].total_cents,3502);assert.equal(res.body.orders[0].buyer_fee_cents,175);}
 const fee=await h.fees.reconcile(SELL);assert.equal(fee.feeCents,132);assert.equal(fee.payoutAvailable,false);
 const actual={test:true,verified:true,source:'provider_receipt',obligationKey:keys.processing,orderId:O,sellerId:S,kind:'processing',phase:'confirmed',amountCents:132,sourceTotalCents:132,sourceReference:'txn_journey:fee',currency:'USD',observedAt:Date.now(),scope:'order'};
 // The server-only SQL accounting path accepts only the previously verified
 // matching receipt. No browser record-cost endpoint is introduced by this test.
 await rpc('rr_test_record_seller_cost',[S,O,actual]);const accounted=await ledger();await rpc('rr_test_record_seller_cost',[S,O,{...actual,observedAt:Date.now()}]);assert.deepEqual(await ledger(),accounted);
 assert.equal(Number(accounted.find(l=>l.kind==='buyer_fee_revenue').amount_cents),-175);assert.equal(accounted.reduce((n,l)=>n+Number(l.amount_cents),0),0);
 const pendingCosts=await h.costs.status(SELL);assert.equal(pendingCosts.confirmedCostCents,132);assert.equal(pendingCosts.reservedCostCents,297);assert.equal(pendingCosts.sellerNetCents,null);assert.ok(pendingCosts.blockers.includes('provider_cost_schedule_incomplete'));
 assert.equal((await h.risk.assess(SELL)).riskStatus,'clear');h.elevated=true;assert.equal((await h.risk.assess(SELL)).riskStatus,'review');
 await h.repository.orderIssue({...BUY,reason:'not_received'});await h.repository.acknowledgeOrderIssue(SELL);
 const held=await h.repository.protectionReview(SELL);assert.ok(held.blockers.includes('buyer_issue_open'));assert.ok(held.blockers.includes('risk_review_required'));assert.equal(held.releaseEnabled,false);
 h.elevated=false;await assert.rejects(h.risk.assess(SELL));assert.equal((await row()).risk_status,'review');
 const refundInput={...SELL,requestId:R,amountCents:3502};await h.refunds.start(refundInput);assert.equal((await row()).refunded_cents,0);assert.equal(postCount(h,'/v1/refunds'),1);
 await h.refunds.start(refundInput);assert.equal(postCount(h,'/v1/refunds'),1);
 const refundEvent={id:'evt_journeyRefund',type:'refund.created',livemode:false,created:Math.floor(Date.now()/1000),data:{object:h.refund}};
 await h.notify(refundEvent);const refundedLedger=await ledger();await h.notify(refundEvent);assert.deepEqual(await ledger(),refundedLedger);
 assert.equal((await row()).refund_state,'refunded');assert.equal((await row()).refunded_cents,3502);assert.equal(refundedLedger.reduce((n,l)=>n+Number(l.amount_cents),0),0);
 assert.equal((await db.query("select count(*)::int n from rr_sandbox.jobs where kind in ('seller_transfer','seller_payout') and state<>'held'")).rows[0].n,0);
 assert.equal((await h.repository.protectionReview(SELL)).releaseEnabled,false);assert.equal((await row()).snapshot.buyerFeeCents,175);
 await assert.rejects(rpc('rr_test_reserve',[P,M,B]),/marketplace exposure/);assert.equal((await db.query('select count(*)::int n from rr_sandbox.orders')).rows[0].n,1);
 assert.equal(postCount(h,'/v1/checkout/sessions'),1);assert.equal(postCount(h,'/v1/tax/calculations'),1);assert.equal(h.providerCalls.some(c=>/\/(transfers|payouts|transactions)\b/.test(c.path)),false);
});

test('a lost synthetic Checkout response preserves accepted prices and blocks duplicate payment creation across retries',async()=>{
 const h=harness({loseCheckoutResponse:true});await readySellerAndConsent(h);
 const before=await h.repository.sellerCostContext(SELL);await assert.rejects(h.checkout.start(BUY));
 assert.equal(postCount(h,'/v1/checkout/sessions'),1);assert.equal((await row()).state,'reserved');
 const attempt=(await db.query('select phase,session_id,snapshot from rr_sandbox.checkout_attempts where order_id=$1',[O])).rows[0];assert.equal(attempt.phase,'dispatched');assert.equal(attempt.session_id,null);assert.equal(attempt.snapshot.buyerFeeCents,175);
 await assert.rejects(h.checkout.start(BUY),/reconciliation/);assert.equal(postCount(h,'/v1/checkout/sessions'),1);assert.equal(h.quoteCalls,1);
 assert.deepEqual((await h.repository.sellerCostContext(SELL)).acceptance,before.acceptance);assert.deepEqual(await ledger(),[]);
 await assert.rejects(rpc('rr_test_reserve',[P,M,B]),/marketplace exposure/);assert.equal((await h.repository.protectionReview(SELL)).releaseEnabled,false);
});
