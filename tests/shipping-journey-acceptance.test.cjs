'use strict';
// LOCAL integration acceptance only. Shippo/Auth/Stripe transports are
// synthetic; no valid postage is bought and no real delivery is established.
const {test,before,after,beforeEach}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs');
const {createHmac}=require('node:crypto'),{PGlite}=require('@electric-sql/pglite');
const {createTestOrderRepository}=require('../server/test_order_repository.cjs');
const {createTestQuoteService,createTestCheckoutService}=require('../server/test_checkout_service.cjs');
const {buildTestOrderBase,buildTestCheckout}=require('../server/marketplace_test_checkout.cjs');
const {destinationHash}=require('../server/stripe_test_tax.cjs');
const {createTestSellerCostService}=require('../server/test_seller_cost_service.cjs');
const {createShippoTestClient}=require('../server/shippo_test_client.cjs');
const {createShippoTestLabelClient}=require('../server/shippo_test_labels.cjs');
const {createTestLabelService}=require('../server/test_label_service.cjs');
const {createTestTrackingService}=require('../server/test_tracking_service.cjs');
const {createTestRiskService}=require('../server/test_risk_service.cjs');
const {evaluateTestCharge}=require('../server/stripe_test_risk.cjs');
const O='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222',
 S='33333333-3333-4333-8333-333333333333',L='44444444-4444-4444-8444-444444444444',
 R='55555555-5555-4555-8555-555555555555',OTHER='66666666-6666-4666-8666-666666666666';
const ORIGINAL_RATE='a'.repeat(32),LABEL_RATE='b'.repeat(32),TRANSACTION='c'.repeat(32),
 ORIGINAL_SHIPMENT='d'.repeat(32),LABEL_SHIPMENT='e'.repeat(32);
const PROJECT='https://zvtaqzcqfdjpuwnlpzln.supabase.co';
const FROM={line1:'400 Broad St',city:'Seattle',state:'WA',postal_code:'98109',country:'US'};
const TO={line1:'123 Synthetic Street',city:'Seattle',state:'WA',postal_code:'98101',country:'US'};
const BUY={authorization:'Bearer buyer',orderId:O,listingId:L,to:TO},SELL={authorization:'Bearer seller',orderId:O},
 LABEL={...SELL,requestId:R};
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
 await db.query("insert into rr_sandbox.catalog(id,seller_id,title,price_cents) values($1,$2,'Synthetic shipping jacket',2500)",[L,S]);
 // A known, currently eligible synthetic seller is a trusted fixture; this
 // shipping journey does not claim to exercise hosted financial onboarding.
 await rpc('rr_test_claim_seller',[S]);await rpc('rr_test_save_seller',[S,'acct_shippingFixture']);
 await rpc('rr_test_record_seller_protection',[S,'acct_shippingFixture',true,Date.now()]);
});
function harness({loseLabelResponse=false}={}){
 const providerCalls=[],databaseCalls=[],sqlErrors=[],names=new Map();let shippingQuotes=0,labelPosts=0,labelGets=0,checkoutPosts=0,
  currentTracking='PRE_TRANSIT',eventAt=Date.now()-10000,freshRateCents=619,trackingMetadata=null;
 const allowed=new Set(['rr_test_reserve','rr_test_checkout_attempt','rr_test_quote_permit','rr_test_prepare_carrier_checkout',
  'rr_test_dispatch_checkout','rr_test_save_checkout_session','rr_test_finish_checkout','rr_test_process_payment_event',
  'rr_test_seller_cost_context','rr_test_prepare_seller_cost_disclosure','rr_test_accept_seller_costs','rr_test_member_orders',
  'rr_test_fee_order','rr_test_record_risk','rr_test_fulfillment_status','rr_test_label_attempt','rr_test_label_context',
  'rr_test_claim_label','rr_test_save_label','rr_test_tracking_status','rr_test_record_tracking','rr_test_protection_review']);
 const repository=createTestOrderRepository({projectUrl:PROJECT,serviceKey:'sb_secret_shippingFixture',allowedMemberIds:[B,S],
  allowedRefundOperatorIds:[S],refundsEnabled:true,refundRequestsEnabled:true,sellerCostsEnabled:true,fetchImpl:async(url,options)=>{
   const u=new URL(url);assert.equal(u.origin,PROJECT);databaseCalls.push(u.pathname);
   if(u.pathname==='/auth/v1/user'){
    const id={'Bearer buyer':B,'Bearer seller':S}[options.headers.Authorization];return Response.json(id?{id}:{},{status:id?200:401});
   }
   const name=u.pathname.split('/').pop();assert.ok(allowed.has(name),'Unexpected RPC '+name);
   assert.equal(options.headers.Authorization,undefined);assert.equal(options.headers.apikey,'sb_secret_shippingFixture');
   if(!names.has(name))names.set(name,(await db.query("select proargnames names from pg_proc where proname=$1 and pronamespace='public'::regnamespace",[name])).rows[0].names);
   const p=JSON.parse(options.body),keys=names.get(name);assert.deepEqual(Object.keys(p).sort(),[...keys].sort());
   try{return Response.json(await rpc(name,keys.map(k=>p[k]&&typeof p[k]==='object'?JSON.stringify(p[k]):p[k])));}
   catch(e){sqlErrors.push(e.message);return Response.json({error:'Synthetic operation rejected'},{status:400});}
  }});
 const marker='rr_test_label_'+O+'_'+R;
 async function shippoTransport(url,options){
  const u=new URL(url);assert.equal(u.origin,'https://api.goshippo.com');assert.equal(options.headers.Authorization,'ShippoToken shippo_test_shippingFixture');
  assert.equal(options.cache,'no-store');assert.equal(options.redirect,'error');assert.ok(options.signal);providerCalls.push({path:u.pathname,method:options.method,body:options.body});
  if(u.pathname==='/shipments/'){
   assert.equal(options.method,'POST');const p=JSON.parse(options.body);shippingQuotes++;
   assert.equal(p.address_to.street1,TO.line1);assert.equal(p.address_to.zip,TO.postal_code);assert.equal(p.address_from.street1,FROM.line1);
   assert.deepEqual(p.parcels,[{distance_unit:'in',mass_unit:'lb',length:'10',width:'8',height:'2',weight:'1'}]);
   if(shippingQuotes>1){assert.equal(p.address_from.email,'sender@example.com');assert.equal(p.address_from.phone,'+12025550123');}
   const amount=shippingQuotes===1?619:freshRateCents;
   return Response.json({test:true,object_id:shippingQuotes===1?ORIGINAL_SHIPMENT:LABEL_SHIPMENT,rates:[{test:true,object_id:shippingQuotes===1?ORIGINAL_RATE:LABEL_RATE,currency:'USD',amount:(amount/100).toFixed(2),provider:'USPS',servicelevel:{name:'Ground Advantage'}}]});
  }
  if(u.pathname==='/transactions/'&&options.method==='POST'){
   labelPosts++;const p=JSON.parse(options.body);assert.equal(p.rate,LABEL_RATE);assert.equal(p.metadata,marker);assert.equal(p.label_file_type,'PDF_4x6');
   if(loseLabelResponse)throw Error('Synthetic response lost after sample label creation');
   return Response.json({test:true,object_id:TRANSACTION,rate:LABEL_RATE,metadata:marker,status:'WAITING'});
  }
  if(u.pathname==='/transactions/'+TRANSACTION+'/'&&options.method==='GET'){
   labelGets++;return Response.json({test:true,object_id:TRANSACTION,rate:LABEL_RATE,metadata:trackingMetadata||marker,status:'SUCCESS',
    label_url:'https://deliver.goshippo.com/synthetic-sample.pdf',tracking_number:'TEST-SHIPPING-123',tracking_status:{status:currentTracking,status_date:new Date(eventAt).toISOString()}});
  }
  assert.fail('Unexpected synthetic Shippo request '+options.method+' '+u.pathname);
 }
 const quoteService=createTestQuoteService({captureFulfillment:true,shipping:createShippoTestClient({token:'shippo_test_shippingFixture',fetchImpl:shippoTransport}),
  tax:{async quote(input){const base=buildTestOrderBase(input);return {test:true,status:'calculated',country:'US',currency:'USD',orderId:O,
   baseCents:base.baseCents,amountCents:0,expiresAt:input.shippingQuote.expiresAt,destinationHash:destinationHash(input.to),taxCalculationId:'taxcalc_shippingFixture',taxabilityReasons:['not_subject_to_tax']};}},
  loadFulfillment:async(_,order)=>({test:true,sellerId:S,listingUpdatedAt:order.listing_updated_at,from:FROM,package:{length:10,width:8,height:2,weight:1},itemTaxCode:'txcd_30011000',buyerFeeTaxCode:'txcd_30011000'})});
 const stripe={async createCheckout(input){checkoutPosts++;const snapshot=buildTestCheckout(input);return {test:true,snapshot,sessionId:'cs_test_shippingJourney',state:'open',expiresAt:Date.now()+3600000,url:'https://checkout.stripe.com/c/pay/cs_test_shippingJourney'};},
  async retrieveCheckout({snapshot}){return {test:true,snapshot,state:'open',url:'https://checkout.stripe.com/c/pay/cs_test_shippingJourney'};}};
 const checkout=createTestCheckoutService({repository,quotes:quoteService,stripe,quoteLimitsEnabled:true});
 const costs=createTestSellerCostService({repository,loadCostQuote:async order=>({test:true,orderId:O,sellerId:S,expiresAt:Date.now()+60000,
  maxTotalCents:600,costCaps:{processing:200,radar:10,connect_active_account:200,payout:190,insurance:0},selectedInsurance:false})});
 const shipping=createShippoTestLabelClient({token:'shippo_test_shippingFixture',fetchImpl:shippoTransport});
 const labels=createTestLabelService({repository,shipping}),tracking=createTestTrackingService({repository,shipping});
 const risk=createTestRiskService({repository,stripe:{async read(order){
  const charge={livemode:false,id:'ch_shippingJourney',metadata:{order_id:O},amount:3294,currency:'usd',paid:true,captured:true,disputed:false,refunded:false,amount_refunded:0,
   outcome:{type:'authorized',risk_level:'normal'},payment_method_details:{type:'card',card:{checks:{cvc_check:'pass',address_line1_check:'pass',address_postal_code_check:'pass'},three_d_secure:{result:'authenticated'}}}};
  return evaluateTestCharge({order,checkedAt:Date.now(),charge});
 }}});
 async function pay(){
  const event={id:'evt_shippingJourneyPaid',type:'checkout.session.completed',livemode:false,created:Math.floor(Date.now()/1000),data:{object:{object:'checkout.session',id:'cs_test_shippingJourney',livemode:false,mode:'payment',status:'complete',payment_status:'paid',currency:'usd',amount_total:3294,
   client_reference_id:O,metadata:{order_id:O,integration:'rack_relic_test'},payment_intent:'pi_shippingJourney'}}};
  const raw=Buffer.from(JSON.stringify(event)),t=Math.floor(Date.now()/1000),signature='t='+t+',v1='+createHmac('sha256','whsec_shippingFixture').update(t+'.').update(raw).digest('hex');
  await repository.acceptStripeEvent({rawBody:raw,signature,webhookSecret:'whsec_shippingFixture'});await risk.assess(SELL);
 }
 return {repository,checkout,costs,labels,tracking,pay,providerCalls,databaseCalls,sqlErrors,
  get shippingQuotes(){return shippingQuotes;},get labelPosts(){return labelPosts;},get labelGets(){return labelGets;},get checkoutPosts(){return checkoutPosts;},
  set freshRateCents(v){freshRateCents=v;},set trackingMetadata(v){trackingMetadata=v;},set trackingStatus(v){currentTracking=v;eventAt+=1000;}};
}
async function preparedAndPaid(h){
 await assert.rejects(h.checkout.start(BUY));assert.match(h.sqlErrors.at(-1),/Seller cost acceptance required/);
 assert.equal(h.checkoutPosts,0);assert.equal(h.shippingQuotes,1);
 const d=await h.costs.prepare(SELL);await h.costs.accept({...SELL,disclosureHash:d.disclosure.hash});
 assert.equal((await h.checkout.start(BUY)).state,'checkout_open');assert.equal(h.checkoutPosts,1);await h.pay();
}
const financialState=()=>db.query("select jsonb_build_object('order',(select to_jsonb(o) from rr_sandbox.orders o where id=$1),'ledger',(select jsonb_agg(l order by kind) from rr_sandbox.ledger_entries l where order_id=$1),'jobs',(select jsonb_agg(j order by kind) from rr_sandbox.jobs j where order_id=$1)) s",[O]).then(r=>r.rows[0].s);

test('local carrier quote, private snapshot, sample-label recovery and tracking stay bound to one paid current-price order',async()=>{
 const h=harness();await assert.rejects(h.checkout.start(BUY));assert.match(h.sqlErrors.at(-1),/Seller cost acceptance required/);
 const stored=(await db.query('select snapshot from rr_sandbox.fulfillment_quotes where order_id=$1',[O])).rows[0].snapshot;
 assert.equal(stored.rateId,ORIGINAL_RATE);assert.deepEqual(stored.destination,TO);assert.equal(stored.amountCents,619);
 assert.equal((await h.repository.fulfillmentStatus(SELL)).snapshotStored,true);
 const attempt=(await db.query('select input,snapshot from rr_sandbox.checkout_attempts where order_id=$1',[O])).rows[0];
 assert.equal(attempt.snapshot.buyerFeeCents,175);assert.equal(attempt.snapshot.totalCents,3294);assert.equal(JSON.stringify(attempt).includes(TO.line1),false);
 await assert.rejects(h.checkout.start({...BUY,to:{...TO,line1:'456 Different Synthetic Street'}}),/Destination differs/);assert.equal(h.shippingQuotes,1);
 const d=await h.costs.prepare(SELL);await h.costs.accept({...SELL,disclosureHash:d.disclosure.hash});await h.checkout.start(BUY);await h.pay();
 const noPrivateAddress=await h.repository.memberOrders({authorization:'Bearer buyer'});assert.equal(JSON.stringify(noPrivateAddress).includes(TO.line1),false);
 const beforeDenied=h.providerCalls.length;await assert.rejects(h.labels.request({...LABEL,authorization:'Bearer buyer'}));assert.equal(h.providerCalls.length,beforeDenied);
 h.freshRateCents=620;await assert.rejects(h.labels.request(LABEL),/budget/);assert.equal(h.labelPosts,0);assert.equal((await h.repository.labelAttempt(LABEL)),null);
 h.freshRateCents=619;const processing=await h.labels.request(LABEL);assert.equal(processing.state,'processing');assert.equal(h.labelPosts,1);
 const ready=await h.labels.status(LABEL);assert.equal(ready.state,'ready');assert.match(ready.labelUrl,/synthetic-sample\.pdf/);assert.equal(h.labelGets,1);
 await h.labels.request(LABEL);assert.equal(h.labelPosts,1);assert.equal(h.labelGets,1);
 const finances=await financialState();
 for(const state of ['PRE_TRANSIT','TRANSIT','DELIVERED']){h.trackingStatus=state;const status=await h.tracking.refresh(SELL);assert.equal(status.status,state);assert.equal(status.payoutAvailable,false);assert.equal(status.labelPurchaseEnabled,false);assert.equal(status.trackingNumber,undefined);}
 assert.deepEqual(await financialState(),finances);
 const observations=(await db.query('select count(*)::int n from rr_sandbox.tracking_observations')).rows[0].n;
 h.trackingMetadata='unbound_label';await assert.rejects(h.tracking.refresh(SELL),/identity/);assert.equal((await db.query('select count(*)::int n from rr_sandbox.tracking_observations')).rows[0].n,observations);h.trackingMetadata=null;
 const review=await h.repository.protectionReview(SELL);assert.equal(review.releaseEnabled,false);assert.ok(review.blockers.includes('sample_tracking_only'));assert.ok(review.blockers.includes('real_delivery_unverified'));
 await assert.rejects(db.query("insert into rr_sandbox.jobs(order_id,kind,state) values($1,'seller_transfer','pending')",[O]),/Seller release disabled/);
 assert.equal(h.labelPosts,1);assert.equal((await db.query('select snapshot from rr_sandbox.orders where id=$1',[O])).rows[0].snapshot.shippingCents,619);
});

test('a lost sample-label creation response remains unknown and never buys a second sample on any retry',async()=>{
 const h=harness({loseLabelResponse:true});await preparedAndPaid(h);await assert.rejects(h.labels.request(LABEL),/outcome unknown/);
 assert.equal(h.labelPosts,1);assert.equal(h.shippingQuotes,2);
 assert.equal((await h.labels.status(LABEL)).state,'outcome_unknown');assert.equal((await h.labels.request(LABEL)).state,'outcome_unknown');
 await assert.rejects(h.labels.request({...LABEL,requestId:OTHER}),/different/);await assert.rejects(h.tracking.refresh(SELL),/Successful saved sample/);
 assert.equal(h.labelPosts,1);assert.equal(h.shippingQuotes,2);assert.equal(h.labelGets,0);
 assert.equal((await h.repository.protectionReview(SELL)).releaseEnabled,false);
 assert.equal((await db.query("select count(*)::int n from rr_sandbox.jobs where kind in ('seller_transfer','seller_payout') and state<>'held'")).rows[0].n,0);
});
