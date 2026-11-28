const {test}=require('node:test');
const assert=require('node:assert/strict');
const {evaluateTestCharge}=require('../server/stripe_test_risk.cjs');
const {createTestOrderRepository}=require('../server/test_order_repository.cjs');
const {createTestWebhookHandler}=require('../server/test_order_handlers.cjs');
const now=Date.now(),order={test:true,orderId:'11111111-1111-4111-8111-111111111111',totalCents:3427};
function charge(){return {id:'ch_fixture',livemode:false,metadata:{order_id:order.orderId},amount:3427,currency:'usd',paid:true,captured:true,refunded:false,amount_refunded:0,disputed:false,outcome:{type:'authorized',risk_level:'normal'},payment_method_details:{type:'card',card:{checks:{cvc_check:'pass',address_postal_code_check:'pass',address_line1_check:'pass'},three_d_secure:{result:'authenticated'}}}};}
const assess=(c,extra={})=>evaluateTestCharge({charge:c,order,checkedAt:now,...extra},now);
test('only matching fresh, captured, low-risk and authenticated test evidence clears fulfillment',()=>{
 assert.equal(assess(charge()).decision,'clear');
 for(const patch of [{livemode:true},{amount:1},{metadata:{}},{currency:'cad'}])assert.throws(()=>assess({...charge(),...patch}));
 for(const checkedAt of [now-300001,now+30001])assert.throws(()=>assess(charge(),{checkedAt}));
});
test('issuer approval never overrides failed CVC/AVS, missing 3DS, an open review or changed shipping',()=>{
 for(const field of ['cvc_check','address_postal_code_check','address_line1_check'])for(const value of ['fail','unavailable','unchecked',undefined]){const c=charge();c.payment_method_details.card.checks[field]=value;assert.equal(assess(c).decision,'review');}
 for(const result of ['failed','attempt_acknowledged','exempted','not_supported',undefined]){const c=charge();c.payment_method_details.card.three_d_secure.result=result;assert.equal(assess(c).decision,'review');}
 assert.equal(assess({...charge(),review:'prv_fixture'}).decision,'review');
 assert.equal(assess(charge(),{shippingAddressChanged:true}).decision,'review');
 assert.equal(assess({...charge(),outcome:{type:'authorized',risk_level:'elevated'}}).decision,'review');
 assert.equal(assess({...charge(),amount_refunded:1}).decision,'review');
});
test('fraud, dispute and highest risk block fulfillment even when payment is successful',()=>{
 for(const patch of [{disputed:true},{fraud_details:{user_report:'fraudulent'}},{outcome:{type:'authorized',risk_level:'highest'}},{outcome:{type:'blocked',risk_level:'normal'}}])assert.equal(assess({...charge(),...patch}).decision,'blocked');
});
test('server repository rejects production project, non-service keys, origin substitutions and cached authority',async()=>{
 const key='sb_secret_fixture';
 for(const projectUrl of ['https://zrfztnbyynrdzfeblkeq.supabase.co','http://abcdefghijklmnopqrst.supabase.co','https://abcdefghijklmnopqrst.supabase.co.evil.example','https://abcdefghijklmnopqrst.supabase.co/path'])assert.throws(()=>createTestOrderRepository({projectUrl,serviceKey:key}));
 assert.throws(()=>createTestOrderRepository({projectUrl:'https://abcdefghijklmnopqrst.supabase.co',serviceKey:'sb_publishable_fixture'}));
 const r=createTestOrderRepository({projectUrl:'https://abcdefghijklmnopqrst.supabase.co',serviceKey:key,fetchImpl:async()=>Response.json({id:order.orderId},{headers:{'x-vercel-cache':'MISS','cf-cache-status':'HIT'}})});
 await assert.rejects(r.memberOrders({authorization:'Bearer fixture'}),/Cached/);
});
test('webhook factory defaults closed and never reads a body when disabled',async()=>{
 const response={setHeader(){},end(body){this.body=JSON.parse(body);}};
 await createTestWebhookHandler()({method:'POST'},response);assert.equal(response.statusCode,503);
});
