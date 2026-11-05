const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createStripeTestTaxClient,destinationHash}=require('../server/stripe_test_tax.cjs');
const {buildTestCheckout}=require('../server/marketplace_test_checkout.cjs');
const NOW=1793380000000,orderId='11111111-1111-4111-8111-111111111111';
const address={line1:'400 Broad St',city:'Seattle',state:'WA',postal_code:'98109',country:'US'};
function input(){return {orderId,buyerId:'22222222-2222-4222-8222-222222222222',listing:{id:'44444444-4444-4444-8444-444444444444',seller_id:'33333333-3333-4333-8333-333333333333',price_cents:2500,status:'published',moderation_status:'active',delivery_mode:'shipping',updated_at:'2026-10-30T00:00:00Z'},shippingQuote:{test:true,orderId,listingId:'44444444-4444-4444-8444-444444444444',listingUpdatedAt:'2026-10-30T00:00:00Z',amountCents:500,expiresAt:NOW+600000,destinationHash:destinationHash(address)},to:address,from:address,itemTaxCode:'txcd_30011000',buyerFeeTaxCode:'txcd_30011000'};}
const settings=()=>({livemode:false,status:'active',head_office:{address}});
const registrations=()=>({object:'list',has_more:false,data:[{livemode:false,status:'active',active_from:Math.floor(NOW/1000)-100,expires_at:null,country:'US',country_options:{us:{type:'state_sales_tax',state:'WA'}}}]});
function calculation(tax=310,reason='standard_rated'){return {livemode:false,id:'taxcalc_fixture',currency:'usd',tax_amount_exclusive:tax,tax_amount_inclusive:0,amount_total:3100+tax,expires_at:Math.floor(NOW/1000)+86400,line_items:{has_more:false,data:[{amount:2500,tax_code:'txcd_30011000',reference:orderId+'_item'},{amount:100,tax_code:'txcd_30011000',reference:orderId+'_buyer_fee'}]},tax_breakdown:[{amount:tax,inclusive:false,tax_rate_details:{country:'US'},taxability_reason:reason}]};}
function client({s=settings(),r=registrations(),c=calculation(),fail}={}){const calls=[];return {calls,c:createStripeTestTaxClient({secretKey:'sk_test_fixture',clock:()=>NOW,fetchImpl:async(url,opts)=>{calls.push({url,opts});if(fail)throw Error('private address and key');return {ok:true,json:async()=>calls.length===1?s:calls.length===2?r:c};}})};}
test('requires test keys and refuses incomplete or live tax configuration',async()=>{
 for(const key of [undefined,'','sk_live_fixture'])assert.throws(()=>createStripeTestTaxClient({secretKey:key}));
 for(const patch of [{status:'pending'},{livemode:true},{head_office:null}]){const t=client({s:{...settings(),...patch}});await assert.rejects(t.c.quote(input()));assert.equal(t.calls.length,1);}
});
test('no registration or an expired, incomplete, live or unregistered-state response blocks calculation',async()=>{
 const fixtures=[{...registrations(),data:[]},{...registrations(),has_more:true}];
 for(const patch of [{livemode:true},{expires_at:Math.floor(NOW/1000)-1},{active_from:Math.floor(NOW/1000)+1},{country_options:{us:{state:'CA',type:'state_sales_tax'}}}])fixtures.push({...registrations(),data:[{...registrations().data[0],...patch}]});
 for(const r of fixtures){const t=client({r});await assert.rejects(t.c.quote(input()));assert.equal(t.calls.length,2);}
});
test('a taxable quote reconciles exact cents and feeds the existing checkout builder',async()=>{
 const t=client(),i=input(),taxQuote=await t.c.quote(i);
 assert.equal(taxQuote.amountCents,310);assert.equal(taxQuote.baseCents,3100);assert.equal(taxQuote.expiresAt,NOW+600000);
 assert.equal(buildTestCheckout({...i,taxQuote},NOW).totalCents,3410);
 const request=t.calls[2];assert.equal(request.url,'https://api.stripe.com/v1/tax/calculations');assert.equal(request.opts.redirect,'error');
 const form=new URLSearchParams(request.opts.body);assert.equal(form.get('line_items[1][amount]'),'100');assert.equal(form.get('shipping_cost[amount]'),'500');assert.equal(form.get('customer_details[address_source]'),'shipping');
 assert.equal(form.get('customer_details[address][email]'),null);assert.equal(form.get('metadata'),null);
});
test('not_collecting zero is blocked while an explicit product exemption is usable',async()=>{
 for(const reason of ['not_collecting','reverse_charge','unknown_reason']){const t=client({c:calculation(0,reason)});await assert.rejects(t.c.quote(input()));}
 const t=client({c:calculation(0,'product_exempt')});assert.equal((await t.c.quote(input())).amountCents,0);
});
test('requires explicit buyer fee classification, valid addresses and matching shipping destination before provider calls',async()=>{
 for(const change of [i=>delete i.buyerFeeTaxCode,i=>i.to={...address,country:'CA'},i=>i.to={...address,state:'XX'},i=>i.shippingQuote.destinationHash='changed',i=>i.listing.price_cents=NaN]){
  const i=input();change(i);const t=client();await assert.rejects(t.c.quote(i));assert.equal(t.calls.length,0);
 }
});
test('rejects tampered totals, currency, mode, codes, breakdown and expired provider calculation',async()=>{
 const patches=[{livemode:true},{currency:'cad'},{amount_total:1},{tax_amount_exclusive:-1},{tax_amount_inclusive:1},{expires_at:0},{tax_breakdown:[]},{tax_breakdown:[{amount:1,inclusive:false,tax_rate_details:{country:'US'},taxability_reason:'standard_rated'}]},{line_items:{has_more:true,data:calculation().line_items.data}},{line_items:{has_more:false,data:[{...calculation().line_items.data[0],amount:1},calculation().line_items.data[1]]}}];
 for(const patch of patches){const t=client({c:{...calculation(),...patch}});await assert.rejects(t.c.quote(input()));}
});
test('provider errors do not expose secrets or retry',async()=>{
 const t=client({fail:true});await assert.rejects(t.c.quote(input()),e=>!e.message.includes('private'));assert.equal(t.calls.length,1);
});
test('checkout refuses taxability and destination mismatches even if amounts balance',()=>{
 const i=input(),q={test:true,status:'calculated',country:'US',currency:'USD',orderId,baseCents:3100,amountCents:0,expiresAt:NOW+100000};
 for(const patch of [{blocked:true},{taxabilityReasons:['not_collecting']},{destinationHash:'wrong'}])assert.throws(()=>buildTestCheckout({...i,taxQuote:{...q,...patch}},NOW));
});
