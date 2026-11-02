'use strict';
const fs=require('node:fs'),path=require('node:path');
const {createTestOrderRepository,OrderAccessDenied}=require('./test_order_repository.cjs');
const {createTestQuoteService,createTestCheckoutService}=require('./test_checkout_service.cjs');
const {createStripeTestCheckoutClient}=require('./marketplace_test_checkout.cjs');
const {createStripeTestTaxClient}=require('./stripe_test_tax.cjs');
const {createTestCheckoutHandler,createTestOrdersHandler,createTestCancelPreparationHandler}=require('./test_order_handlers.cjs');
const {createStripeTestRefundClient}=require('./stripe_test_refunds.cjs');
const {createTestRefundService}=require('./test_refund_service.cjs');
const {createTestRefundHandler}=require('./test_refund_handler.cjs');
const {createStripeTestFeeClient}=require('./stripe_test_fees.cjs');
const {createTestFeeService}=require('./test_fee_service.cjs');
const {createTestFeeHandler}=require('./test_fee_handler.cjs');
const {createShippoTestClient}=require('./shippo_test_client.cjs');
const {createTestShippingHandler}=require('./test_shipping_handler.cjs');
const {createTestFulfillmentHandler}=require('./test_fulfillment_handler.cjs');
const {createShippoTestLabelClient}=require('./shippo_test_labels.cjs');
const {createTestLabelService}=require('./test_label_service.cjs');
const {createTestLabelHandler}=require('./test_label_handler.cjs');
const {createStripeTestRiskClient}=require('./stripe_test_risk_client.cjs');
const {createTestRiskService}=require('./test_risk_service.cjs');
const {createTestRiskHandler}=require('./test_risk_handler.cjs');
const {createTestTrackingService}=require('./test_tracking_service.cjs');
const {createTestTrackingHandler}=require('./test_tracking_handler.cjs');
const {createTestSellerOnboarding}=require('./test_seller_onboarding.cjs');
const {createTestSellerHandler}=require('./test_seller_handler.cjs');
const ORIGIN='https://zvtaqzcqfdjpuwnlpzln.supabase.co';
const RETURN='https://rack-relic-git-test-only-marketplace-foundation-rack-relic.vercel.app';
const LISTING='73737373-7373-4373-8373-737373737373';
const LISTINGS=Object.freeze({
 [LISTING]:Object.freeze({id:LISTING,title:'Synthetic test jacket',priceCents:2500}),
 '84848484-8484-4484-8484-848484848484':Object.freeze({id:'84848484-8484-4484-8484-848484848484',title:'Synthetic operator refund jacket',priceCents:2500}),
 '95959595-9595-4595-8595-959595959595':Object.freeze({id:'95959595-9595-4595-8595-959595959595',title:'Synthetic carrier quote jacket',priceCents:2500}),
 'a6a6a6a6-a6a6-46a6-86a6-a6a6a6a6a6a6':Object.freeze({id:'a6a6a6a6-a6a6-46a6-86a6-a6a6a6a6a6a6',title:'Synthetic sender contact jacket',priceCents:2500})
});
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
function createTestMarketplaceRuntime({env=process.env,fetchImpl=globalThis.fetch}={}){
 return async(req,res)=>{
  for(const [k,v] of Object.entries({'Cache-Control':'private, no-store, max-age=0','CDN-Cache-Control':'no-store','Vercel-CDN-Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'}))res.setHeader(k,v);
  const send=(status,body)=>{res.statusCode=status;res.setHeader('Content-Type','application/json');res.end(JSON.stringify(body));};
  if(env.VERCEL_ENV!=='preview'||env.VERCEL_GIT_COMMIT_REF!=='test-only-marketplace-foundation'){send(404,{error:'Not found'});return;}
  const action=new URL(req.url,'https://example.invalid').searchParams.get('action');
  if(!action&&req.method==='GET'){
   res.setHeader('Content-Type','text/html; charset=utf-8');res.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self' "+ORIGIN+"; base-uri 'none'; frame-ancestors 'none'; form-action 'none'");res.statusCode=200;res.end(fs.readFileSync(path.join(__dirname,'test-marketplace.html'),'utf8'));return;
  }
  const members=(env.RACK_RELIC_TEST_MEMBER_IDS||'').split(',').map(x=>x.trim()).filter(Boolean);
  const selected=env.RACK_RELIC_TEST_LISTING_ID||LISTING;
  const listing=Object.hasOwn(LISTINGS,selected)?LISTINGS[selected]:null;
  const shippingMode=env.RACK_RELIC_TEST_SHIPPING_MODE||'simulated';
  const shippingReady=shippingMode==='simulated'||shippingMode==='shippo_test'&&/^shippo_test_[A-Za-z0-9]+$/.test(env.RACK_RELIC_TEST_SHIPPO_KEY||'')&&env.RACK_RELIC_TEST_QUOTE_LIMITS_ENABLED==='true';
  const configured=shippingReady&&!!listing&&env.RACK_RELIC_TEST_CHECKOUT_ENABLED==='true'&&env.RACK_RELIC_TEST_SUPABASE_URL===ORIGIN&&members.length===2&&members.every(x=>UUID.test(x))&&/^sb_secret_[A-Za-z0-9_-]+$/.test(env.RACK_RELIC_TEST_SUPABASE_SERVER_KEY||'')&&/^(sk|rk)_test_[A-Za-z0-9]+$/.test(env.RACK_RELIC_TEST_STRIPE_KEY||'')&&env.RACK_RELIC_TEST_STRIPE_ACCOUNT==='acct_1UWJZuGVbz9Pnhxd';
  if(action==='config'&&req.method==='GET'){
   const publishable=env.RACK_RELIC_TEST_SUPABASE_PUBLISHABLE_KEY;
   if(!configured||!/^sb_publishable_[A-Za-z0-9_-]+$/.test(publishable||'')){send(503,{test:true,error:'Private test checkout is being prepared'});return;}
   send(200,{test:true,sellerOnboardingEnabled:env.RACK_RELIC_TEST_SELLER_ONBOARDING_ENABLED==='true',projectUrl:ORIGIN,publishableKey:publishable,listing,shippingMode,sampleLabelsEnabled:env.RACK_RELIC_TEST_LABEL_REQUESTS_ENABLED==='true'&&shippingMode==='shippo_test',riskCheckEnabled:env.RACK_RELIC_TEST_RISK_CHECK_ENABLED==='true',trackingEnabled:env.RACK_RELIC_TEST_TRACKING_ENABLED==='true'&&shippingMode==='shippo_test',notice:shippingMode==='shippo_test'?'Test funds only. Shipping prices come from Shippo test mode and may differ from live prices. Stripe calculates tax in test mode. No real postage is purchased.':'Test funds only. Shipping is a $5 simulation; tax is calculated by Stripe in test mode.'});return;
  }
  if(!configured){send(503,{error:'Private test checkout unavailable'});return;}
  try{
   const operators=(env.RACK_RELIC_TEST_REFUND_OPERATOR_IDS||'').split(',').map(x=>x.trim()).filter(Boolean);
   const refundReady=env.RACK_RELIC_TEST_REFUNDS_ENABLED==='true'&&env.RACK_RELIC_TEST_REFUND_REQUESTS_ENABLED==='true'&&operators.length>0&&operators.length<=2&&operators.every(x=>UUID.test(x)&&members.includes(x));
   if(['refund','refund-access','refund-review','fee','shipping-quote','fulfillment','sample-label','risk','tracking'].includes(action)&&!refundReady){send(404,{error:'Not found'});return;}
   const repository=createTestOrderRepository({projectUrl:ORIGIN,serviceKey:env.RACK_RELIC_TEST_SUPABASE_SERVER_KEY,fetchImpl,allowedMemberIds:members,refundsEnabled:refundReady,refundRequestsEnabled:refundReady,allowedRefundOperatorIds:operators});
   if(action==='seller-onboarding'){
    if(env.RACK_RELIC_TEST_SELLER_ONBOARDING_ENABLED!=='true'){send(404,{error:'Not found'});return;}
    const sellers=createTestSellerOnboarding({repository,secretKey:env.RACK_RELIC_TEST_STRIPE_KEY,accountId:env.RACK_RELIC_TEST_STRIPE_ACCOUNT,fetchImpl});
    await createTestSellerHandler({sellers,enabled:true})(req,res);return;
   }
   if(action==='tracking'){
    if(env.RACK_RELIC_TEST_TRACKING_ENABLED!=='true'||shippingMode!=='shippo_test'){send(404,{error:'Not found'});return;}
    const shipping=createShippoTestLabelClient({token:env.RACK_RELIC_TEST_SHIPPO_KEY,fetchImpl});
    await createTestTrackingHandler({tracking:createTestTrackingService({repository,shipping}),enabled:true})(req,res);return;
   }
   if(action==='risk'){
    if(env.RACK_RELIC_TEST_RISK_CHECK_ENABLED!=='true'){send(404,{error:'Not found'});return;}
    const stripe=createStripeTestRiskClient({secretKey:env.RACK_RELIC_TEST_STRIPE_KEY,accountId:env.RACK_RELIC_TEST_STRIPE_ACCOUNT,fetchImpl});
    await createTestRiskHandler({risk:createTestRiskService({repository,stripe}),enabled:true})(req,res);return;
   }
   if(action==='sample-label'){
    if(env.RACK_RELIC_TEST_LABEL_REQUESTS_ENABLED!=='true'||shippingMode!=='shippo_test'){send(404,{error:'Not found'});return;}
    const shipping=createShippoTestLabelClient({token:env.RACK_RELIC_TEST_SHIPPO_KEY,fetchImpl});
    await createTestLabelHandler({labels:createTestLabelService({repository,shipping}),enabled:true})(req,res);return;
   }
   if(action==='fulfillment'){
    await createTestFulfillmentHandler({repository,enabled:true})(req,res);return;
   }
   if(action==='shipping-quote'){
    if(!/^shippo_test_[A-Za-z0-9]+$/.test(env.RACK_RELIC_TEST_SHIPPO_KEY||'')){send(404,{error:'Not found'});return;}
    const shipping=createShippoTestClient({token:env.RACK_RELIC_TEST_SHIPPO_KEY,fetchImpl});
    await createTestShippingHandler({repository,shipping,enabled:true})(req,res);return;
   }
   if(['refund-access','refund-review'].includes(action)){
    if(req.method!=='GET'){res.setHeader('Allow','GET');send(405,{error:'Method not allowed'});return;}
    const query=new URL(req.url,'https://example.invalid').searchParams;
    if([...query.keys()].some(k=>k!=='action')||query.getAll('action').length!==1){send(400,{error:'Invalid access check'});return;}
    try{send(200,await repository[action==='refund-review'?'refundReview':'refundAccess']({authorization:req.headers?.authorization}));}
    catch(e){send(e instanceof OrderAccessDenied?403:503,{error:e instanceof OrderAccessDenied?'Refund operator access required':'Test refund access unavailable'});}
    return;
   }
   if(action==='fee'){
    const stripe=createStripeTestFeeClient({secretKey:env.RACK_RELIC_TEST_STRIPE_KEY,accountId:env.RACK_RELIC_TEST_STRIPE_ACCOUNT,fetchImpl});
    await createTestFeeHandler({fees:createTestFeeService({repository,stripe}),enabled:true})(req,res);return;
   }
   if(action==='refund'){
    const stripe=createStripeTestRefundClient({secretKey:env.RACK_RELIC_TEST_STRIPE_KEY,accountId:env.RACK_RELIC_TEST_STRIPE_ACCOUNT,fetchImpl});
    await createTestRefundHandler({refunds:createTestRefundService({repository,stripe}),enabled:true})(req,res);return;
   }
   if(action==='orders'){await createTestOrdersHandler({repository,enabled:true})(req,res);return;}
   if(action==='cancel-preparation'){await createTestCancelPreparationHandler({repository,enabled:true})(req,res);return;}
   if(action!=='checkout'){send(404,{error:'Not found'});return;}
   const base=createStripeTestCheckoutClient({secretKey:env.RACK_RELIC_TEST_STRIPE_KEY,fetchImpl,returnOrigin:RETURN});
   async function verifyAccount(){
    const results=await Promise.all(['/v1/account','/v1/balance'].map(async p=>{
     const r=await fetchImpl('https://api.stripe.com'+p,{method:'GET',cache:'no-store',redirect:'error',signal:AbortSignal.timeout(10000),headers:{Authorization:'Bearer '+env.RACK_RELIC_TEST_STRIPE_KEY,'Stripe-Version':'2026-10-28.endive'}});
     const age=r.headers.get('age');if(!r.ok||age!==null&&(!/^\d+$/.test(age)||Number(age)>0))throw Error('Stripe identity unavailable');return r.json();
    }));if(results[0].id!==env.RACK_RELIC_TEST_STRIPE_ACCOUNT||results[1].livemode!==false)throw Error('Unexpected Stripe account');
   }
   const stripe={createCheckout:async input=>{await verifyAccount();return base.createCheckout(input);},retrieveCheckout:async input=>{await verifyAccount();return base.retrieveCheckout(input);}};
   const tax=createStripeTestTaxClient({secretKey:env.RACK_RELIC_TEST_STRIPE_KEY,fetchImpl});
   const shipping=shippingMode==='shippo_test'?createShippoTestClient({token:env.RACK_RELIC_TEST_SHIPPO_KEY,fetchImpl}):{async quote(){return {test:true,rates:[{id:'c'.repeat(32),test:true,currency:'USD',amountCents:500}]};}};
   const quotes=createTestQuoteService({tax,shipping,captureFulfillment:shippingMode==='shippo_test',loadFulfillment:async(id,order)=>{
    if(id!==listing.id||!members.includes(order.seller_id))throw Error('Synthetic listing required');
    return {test:true,sellerId:order.seller_id,listingUpdatedAt:order.listing_updated_at,from:{line1:'400 Broad St',city:'Seattle',state:'WA',postal_code:'98109',country:'US'},package:{length:10,width:8,height:2,weight:1},itemTaxCode:'txcd_30011000',buyerFeeTaxCode:'txcd_30011000'};
   }});
   const checkout=createTestCheckoutService({repository,quotes,stripe,quoteLimitsEnabled:env.RACK_RELIC_TEST_QUOTE_LIMITS_ENABLED==='true'});
   await createTestCheckoutHandler({checkout,enabled:true})(req,res);
  }catch{send(503,{error:'Private test checkout unavailable; check this order before retrying'});}
 };
}
module.exports={createTestMarketplaceRuntime};
