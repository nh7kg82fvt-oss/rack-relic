'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {createHmac}=require('node:crypto');
const {LEGACY_FEE_POLICY:V1,CURRENT_FEE_POLICY:V2,feePolicy,buyerFee}=require('../server/fee_policy.cjs');
const {buildTestOrderBase,buildTestCheckout,createStripeTestCheckoutClient,verifyStripeTestEvent,stripeTestEventRpc}=require('../server/marketplace_test_checkout.cjs');
const {createTestQuoteService,createTestCheckoutService}=require('../server/test_checkout_service.cjs');
const {createStripeTestTaxClient,destinationHash}=require('../server/stripe_test_tax.cjs');
const NOW=Date.now(),O='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222',S='33333333-3333-4333-8333-333333333333',L='44444444-4444-4444-8444-444444444444';
const UPDATED='2026-10-30T00:00:00Z',to={line1:'400 Broad St',city:'Seattle',state:'WA',postal_code:'98109',country:'US'};
function input(version){
 const i={orderId:O,buyerId:B,listing:{id:L,seller_id:S,price_cents:2500,status:'published',moderation_status:'active',delivery_mode:'shipping',updated_at:UPDATED},shippingQuote:{test:true,orderId:O,listingId:L,listingUpdatedAt:UPDATED,amountCents:500,expiresAt:NOW+600000,rateId:'b'.repeat(32),destinationHash:destinationHash(to)},taxQuote:{test:true,orderId:O,status:'calculated',currency:'USD',country:'US',baseCents:version===V2?3175:3100,amountCents:327,expiresAt:NOW+600000,destinationHash:destinationHash(to),taxCalculationId:'taxcalc_fixture'}};
 if(version!==undefined)i.feePolicyVersion=version;return i;
}
function order(version){const o={id:O,buyer_id:B,seller_id:S,listing_id:L,listing_updated_at:UPDATED,item_cents:2500,buyer_fee_cents:version===V2?175:100,state:'reserved'};if(version!==undefined)o.fee_policy_version=version;return o;}
function session(total=3502){return {id:'cs_test_feePolicy',livemode:false,mode:'payment',status:'open',payment_status:'unpaid',currency:'usd',amount_total:total,client_reference_id:O,metadata:{order_id:O,integration:'rack_relic_test'},expires_at:Math.floor(NOW/1000)+1800,url:'https://checkout.stripe.com/c/pay/cs_test_feePolicy'};}
const fulfillment=()=>({test:true,sellerId:S,listingUpdatedAt:UPDATED,from:to,package:{length:10,width:8,height:2,weight:1},itemTaxCode:'txcd_30011000',buyerFeeTaxCode:'txcd_30011000'});
function taxClient(total){
 const calls=[];return {calls,client:createStripeTestTaxClient({secretKey:'sk_test_fixture',clock:()=>NOW,fetchImpl:async(url,opts)=>{
  calls.push({url,opts});
  if(url.endsWith('/tax/settings'))return Response.json({livemode:false,status:'active',head_office:{address:to}});
  if(url.includes('/tax/registrations?'))return Response.json({object:'list',has_more:false,data:[{livemode:false,status:'active',active_from:Math.floor(NOW/1000)-1,country:'US',country_options:{us:{type:'state_sales_tax',state:'WA'}}}]});
  const form=new URLSearchParams(opts.body),lines=[0,1].map(n=>({amount:Number(form.get('line_items['+n+'][amount]')),reference:form.get('line_items['+n+'][reference]'),tax_code:form.get('line_items['+n+'][tax_code]')}));
  return Response.json({id:'taxcalc_feePolicy',livemode:false,currency:'usd',tax_amount_exclusive:327,tax_amount_inclusive:0,amount_total:total,expires_at:Math.floor(NOW/1000)+600,line_items:{has_more:false,data:lines},tax_breakdown:[{amount:327,inclusive:false,tax_rate_details:{country:'US'},taxability_reason:'standard_rated'}]});
 }})};
}

test('current policy is 5% plus fifty cents per order while legacy evidence remains 4%',()=>{
 assert.equal(V1,'rr-fees-v1');assert.equal(V2,'rr-fees-v2');
 assert.deepEqual(feePolicy(V2),{version:V2,percent:5,fixedCents:50});assert.deepEqual(feePolicy(V1),{version:V1,percent:4,fixedCents:0});assert.deepEqual(feePolicy(),feePolicy(V1));assert.ok(Object.isFrozen(feePolicy(V2)));
 for(const [price,legacy,current] of [[100,4,55],[101,4,55],[109,4,55],[110,4,56],[112,4,56],[113,5,56],[2500,100,175],[10000000,400000,500050]]){
  assert.equal(buyerFee(price,V1),legacy);assert.equal(buyerFee(price,V2),current);assert.equal(buyerFee(price),legacy);
 }
 for(const bad of [null,'','rr-fees-v3',4,5,{},false])assert.throws(()=>feePolicy(bad),/Unknown saved fee policy/);
 for(const price of [null,99,10000001,100.5,NaN,Infinity,'2500'])assert.throws(()=>buyerFee(price,V2),/Invalid item price/);
});

test('an aggregate order subtotal receives one fixed charge regardless of its future item count',()=>{
 const items=[1000,2000],subtotal=items.reduce((sum,item)=>sum+item,0);
 assert.equal(buyerFee(subtotal,V2),200);assert.equal(items.reduce((sum,item)=>sum+buyerFee(item,V2),0),250);
 const aggregate=input(V2);aggregate.listing.price_cents=subtotal;assert.equal(buildTestOrderBase(aggregate,NOW).buyerFeeCents,200);
});

test('versioned checkout snapshots calculate fee on item alone and retain legacy snapshot shape',()=>{
 const missing=buildTestCheckout(input(),NOW),legacy=buildTestCheckout(input(V1),NOW),current=buildTestCheckout(input(V2),NOW);
 assert.deepEqual(missing,legacy);assert.equal(Object.hasOwn(legacy,'feePolicyVersion'),false);assert.equal(legacy.buyerFeeCents,100);assert.equal(legacy.baseCents,3100);assert.equal(legacy.totalCents,3427);
 assert.equal(current.feePolicyVersion,V2);assert.equal(current.buyerFeeCents,175);assert.equal(current.baseCents,3175);assert.equal(current.totalCents,3502);assert.ok(Object.isFrozen(current));
 const higherShipping=input(V2);higherShipping.shippingQuote.amountCents=700;higherShipping.taxQuote.baseCents=3375;assert.equal(buildTestCheckout(higherShipping,NOW).buyerFeeCents,175);
 for(const version of [null,'rr-fees-v3',2])assert.throws(()=>buildTestOrderBase(input(version),NOW),/Unknown saved fee policy/);
 for(const [version,wrongBase] of [[V2,3100],[V1,3175],[undefined,3175]]){
  const i=input(version);i.taxQuote.baseCents=wrongBase;assert.throws(()=>buildTestCheckout(i,NOW),/Tax quote does not match/);
 }
});

test('Stripe line-item labels and amounts disclose the saved policy with no per-item surcharge',async()=>{
 for(const [version,fee,total] of [[V2,175,3502],[V1,100,3427],[undefined,100,3427]]){
  const calls=[],client=createStripeTestCheckoutClient({secretKey:'rk_test_fixture',fetchImpl:async(url,opts)=>{calls.push({url,opts});return Response.json(session(total));}});
  const result=await client.createCheckout(input(version));assert.equal(result.snapshot.buyerFeeCents,fee);
  const form=new URLSearchParams(calls[0].opts.body),lines=[...form].filter(([k])=>k.endsWith('[product_data][name]')).map(([,v])=>v);
  assert.deepEqual(lines,['Test item',version===V2?'Buyer platform fee (5% + $0.50 per order)':'Buyer platform fee (4%)','US test shipping','Test tax']);assert.equal(form.get('line_items[1][price_data][unit_amount]'),String(fee));
  assert.equal(form.get('line_items[1][quantity]'),'1');
  assert.equal([...form].filter(([k])=>k.endsWith('[price_data][unit_amount]')).reduce((sum,[,v])=>sum+Number(v),0),total);
  assert.equal(form.get('payment_intent_data[transfer_data][destination]'),null);
 }
});

test('retrieval accepts historical 4% and tagged 5% plus fixed-fee snapshots without repricing them',async()=>{
 for(const [version,total] of [[undefined,3427],[V1,3427],[V2,3502]]){
  const saved={...buildTestCheckout(input(version),NOW)};if(version===V1)saved.feePolicyVersion=V1;
  const copy=structuredClone(saved),calls=[];const client=createStripeTestCheckoutClient({secretKey:'rk_test_fixture',fetchImpl:async(url,opts)=>{calls.push({url,opts});return Response.json(session(total));}});
  assert.equal((await client.retrieveCheckout({sessionId:'cs_test_feePolicy',snapshot:saved})).state,'open');assert.deepEqual(saved,copy);assert.equal(calls.length,1);assert.equal(calls[0].opts.method,'GET');assert.equal(calls[0].opts.body,undefined);
 }
});

test('saved version, fee and total mismatches fail before a reconciliation request',async()=>{
 let calls=0;const client=createStripeTestCheckoutClient({secretKey:'rk_test_fixture',fetchImpl:async()=>{calls++;return Response.json(session());}});
 const legacy=buildTestCheckout(input(),NOW),current=buildTestCheckout(input(V2),NOW);
 for(const bad of [{...legacy,feePolicyVersion:null},{...legacy,feePolicyVersion:'rr-fees-v3'},{...legacy,feePolicyVersion:V2},{...current,feePolicyVersion:V1},{...current,feePolicyVersion:undefined},{...current,buyerFeeCents:176,totalCents:3503},{...current,buyerFeeCents:125,baseCents:3125,totalCents:3452}])await assert.rejects(client.retrieveCheckout({sessionId:'cs_test_feePolicy',snapshot:bad}));
 assert.equal(calls,0);
});

test('quote service and Stripe Tax use the reservation policy in item, fee, tax base and persisted input',async()=>{
 for(const [version,fee,base,total] of [[V2,175,3175,3502],[V1,100,3100,3427],[undefined,100,3100,3427]]){
  const tax=taxClient(total),quotes=createTestQuoteService({clock:()=>NOW,loadFulfillment:async()=>fulfillment(),shipping:{quote:async()=>({test:true,rates:[{test:true,currency:'USD',id:'c'.repeat(32),amountCents:700},{test:true,currency:'USD',id:'b'.repeat(32),amountCents:500}]})},tax:tax.client});
  const q=await quotes.quote({order:order(version),to});assert.equal(q.taxQuote.baseCents,base);assert.equal(q.shippingQuote.amountCents,500);assert.equal(q.feePolicyVersion,version===V2?V2:undefined);
  const snapshot=buildTestCheckout(q,NOW);assert.equal(snapshot.buyerFeeCents,fee);assert.equal(snapshot.totalCents,total);
  const form=new URLSearchParams(tax.calls[2].opts.body);assert.equal(form.get('line_items[0][amount]'),'2500');assert.equal(form.get('line_items[1][amount]'),String(fee));assert.equal(form.get('shipping_cost[amount]'),'500');assert.equal(JSON.stringify(q).includes('400 Broad St'),false);
 }
});

test('explicit null and unknown reservation policies cannot obtain a quote',async()=>{
 for(const version of [null,'rr-fees-v3',2]){
  let taxCalls=0;const quotes=createTestQuoteService({clock:()=>NOW,loadFulfillment:async()=>fulfillment(),shipping:{quote:async()=>({test:true,rates:[{test:true,currency:'USD',id:'b'.repeat(32),amountCents:500}]})},tax:{quote:async()=>{taxCalls++;return input().taxQuote;}}});
  await assert.rejects(quotes.quote({order:order(version),to}),/Unknown saved fee policy/);assert.equal(taxCalls,0);
 }
});

test('checkout rejects a quote policy different from its reservation before preparation or Stripe dispatch',async()=>{
 for(const [reserved,quoted] of [[V2,undefined],[V2,V1],[V1,V2],[undefined,V2],[V2,null],[V2,'rr-fees-v3'],[null,undefined]]){
  let writes=0;const service=createTestCheckoutService({clock:()=>NOW,repository:{reserve:async()=>order(reserved),checkoutAttempt:async()=>({order:order(reserved),attempt:null}),prepareCheckout:async()=>{writes++;throw Error('must not prepare');},dispatchCheckout:async()=>{writes++;throw Error('must not dispatch');}},quotes:{quote:async()=>input(quoted)},stripe:{createCheckout:async()=>{writes++;throw Error('must not create');},retrieveCheckout:async()=>{writes++;throw Error('must not retrieve');}}});
  await assert.rejects(service.start({authorization:'Bearer fixture',orderId:O,listingId:L,to}),/fee policy|Unknown saved fee policy/);assert.equal(writes,0);
 }
});

test('old dispatched checkout recovery uses the saved 4% snapshot and only retrieves its existing session',async()=>{
 for(const version of [undefined,V1]){
  const savedInput=input(),snapshot=buildTestCheckout(savedInput,NOW),reserved=order(version),calls=[];
  const stripe=createStripeTestCheckoutClient({secretKey:'rk_test_fixture',fetchImpl:async(url,opts)=>{calls.push({url,opts});return Response.json(session(3427));}});
  const service=createTestCheckoutService({clock:()=>NOW,repository:{reserve:async()=>reserved,checkoutAttempt:async()=>({order:reserved,attempt:{phase:'dispatched',session_id:'cs_test_feePolicy',input:savedInput,snapshot}}),finishCheckout:async()=>({...reserved,state:'checkout_open',snapshot})},quotes:{quote:async()=>{throw Error('must not reprice');}},stripe});
  const result=await service.start({authorization:'Bearer fixture',orderId:O,listingId:L,to});assert.equal(result.totalCents,3427);assert.equal(result.state,'checkout_open');assert.equal(snapshot.buyerFeeCents,100);assert.equal(calls.length,1);assert.equal(calls[0].opts.method,'GET');
 }
});

test('generated Edge receiver and Node routing preserve both frozen fee totals without pricing dependencies',async()=>{
 const {createTestEdgeWebhook}=await import('../supabase/functions/stripe-test-events/index.mjs');
 for(const total of [3427,3502]){
  const event={id:'evt_feePolicy'+total,livemode:false,type:'checkout.session.completed',data:{object:{...session(total),status:'complete',payment_status:'paid',payment_intent:'pi_feePolicy'}}},raw=Buffer.from(JSON.stringify(event)),t=Math.floor(Date.now()/1000),signature='t='+t+',v1='+createHmac('sha256','whsec_fixture').update(t+'.').update(raw).digest('hex');
  const verified=verifyStripeTestEvent(raw,signature,{secret:'whsec_fixture'}),expected=stripeTestEventRpc(verified,raw,{refundsEnabled:true}),calls=[];
  const edge=createTestEdgeWebhook({projectUrl:'https://zvtaqzcqfdjpuwnlpzln.supabase.co',serviceKey:'sb_secret_fixture',webhookSecret:'whsec_fixture',refundsEnabled:true,fetchImpl:async(url,opts)=>{calls.push({url,opts});return Response.json({duplicate:false,state:'paid'});}});
  const response=await edge(new Request('https://example.test',{method:'POST',body:raw,headers:{'stripe-signature':signature}}));assert.equal(response.status,200);assert.equal(calls.length,1);assert.equal(calls[0].url.split('/').pop(),expected.name);assert.deepEqual(JSON.parse(calls[0].opts.body),expected.payload);assert.equal(expected.payload.p_amount,total);
  const changed=Buffer.from(raw.toString().replace('"amount_total":'+total,'"amount_total":1'));assert.throws(()=>verifyStripeTestEvent(changed,signature,{secret:'whsec_fixture'}));assert.equal((await edge(new Request('https://example.test',{method:'POST',body:changed,headers:{'stripe-signature':signature}}))).status,400);assert.equal(calls.length,1);
 }
});
