'use strict';
// Private server adapter only. Does not configure registrations, file returns,
// collect money, or expose a public route. All callers need a reserved DB order.
const {createHash}=require('node:crypto');
const {buildTestOrderBase}=require('./marketplace_test_checkout.cjs');
const STATES=new Set('AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY'.split(' '));
const ACCEPTED_REASONS=new Set(['standard_rated','zero_rated','exempt','product_exempt','customer_exempt','not_subject_to_tax']);
class TaxNotReady extends Error{constructor(message){super(message);this.name='TaxNotReady';}}
function usAddress(value){
 const out={};for(const key of ['line1','city','state','postal_code','country']){
  if(typeof value?.[key]!=='string'||!value[key].trim()||value[key].length>150)throw Error('A complete US tax address is required');
  out[key]=value[key].trim();
 }
 if(value.line2!==undefined){if(typeof value.line2!=='string'||value.line2.length>150)throw Error('Invalid address');out.line2=value.line2.trim();}
 if(out.country!=='US'||!STATES.has(out.state)||!/^\d{5}(?:-\d{4})?$/.test(out.postal_code))throw Error('A valid US tax address is required');
 return out;
}
function destinationHash(value){return createHash('sha256').update(JSON.stringify(usAddress(value))).digest('hex');}
function formEncode(body){
 const form=new URLSearchParams();
 function add(key,value){
  if(Array.isArray(value)){value.forEach((v,i)=>add(key+'['+i+']',v));return;}
  if(value&&typeof value==='object'){for(const [k,v] of Object.entries(value))add(key?key+'['+k+']':k,v);return;}
  if(value!==undefined&&value!==null)form.set(key,String(value));
 }
 add('',body);return form;
}
function createStripeTestTaxClient({secretKey,fetchImpl=globalThis.fetch,clock=Date.now}={}){
 if(typeof secretKey!=='string'||!/^sk_test_[A-Za-z0-9]+$/.test(secretKey))throw Error('Stripe test secret key required');
 if(typeof fetchImpl!=='function'||typeof clock!=='function')throw Error('Test transport and clock required');
 async function request(path,method='GET',body){
  let response;try{response=await fetchImpl('https://api.stripe.com'+path,{method,redirect:'error',cache:'no-store',signal:AbortSignal.timeout(20000),headers:{Authorization:'Bearer '+secretKey,'Content-Type':'application/x-www-form-urlencoded','Stripe-Version':'2025-02-24.acacia'},...(body?{body:formEncode(body).toString()}:{})});}catch{throw Error('Stripe test tax service unavailable');}
  if(!response.ok)throw Error('Stripe test tax request rejected');
  let data;try{data=await response.json();}catch{throw Error('Invalid test tax response');}
  return data;
 }
 async function readiness(){
  const settings=await request('/v1/tax/settings');
  if(settings.livemode!==false||settings.status!=='active'||!settings.head_office?.address)throw new TaxNotReady('Sandbox tax settings are incomplete');
  const regs=await request('/v1/tax/registrations?status=active&limit=100');
  if(regs.object!=='list'||!Array.isArray(regs.data)||regs.has_more!==false)throw new TaxNotReady('Tax registrations could not be verified');
  const states=new Set();const now=Math.floor(clock()/1000);
  for(const r of regs.data){
   if(r.livemode!==false||r.status!=='active'||!Number.isSafeInteger(r.active_from)||r.active_from>now||(r.expires_at!==null&&r.expires_at!==undefined&&(!Number.isSafeInteger(r.expires_at)||r.expires_at<=now)))throw new TaxNotReady('Unexpected test registration');
   if(r.country==='US'&&r.country_options?.us?.type==='state_sales_tax'&&STATES.has(r.country_options.us.state))states.add(r.country_options.us.state);
  }
  return Object.freeze({test:true,active:true,registeredStates:Object.freeze([...states].sort())});
 }
 return Object.freeze({readiness,
  async quote(input){
   const now=clock(),base=buildTestOrderBase(input,now),to=usAddress(input.to),from=usAddress(input.from);
   // Buyer fee classification is deliberately required, not guessed from a
   // seller-facing "platform fee" tax code or assumed exempt.
   for(const code of [input.itemTaxCode,input.buyerFeeTaxCode])if(typeof code!=='string'||!/^txcd_\d{8}$/.test(code))throw new TaxNotReady('Explicit item and buyer fee tax codes are required');
   const hash=destinationHash(to);if(input.shippingQuote.destinationHash!==hash)throw Error('Shipping destination does not match the order');
   const ready=await readiness();if(!ready.registeredStates.includes(to.state))throw new TaxNotReady('Destination has no verified sandbox tax registration');
   const body={currency:'usd',customer_details:{address:to,address_source:'shipping'},ship_from_details:{address:from},line_items:[
    {amount:base.itemCents,quantity:1,reference:base.orderId+'_item',tax_code:input.itemTaxCode,tax_behavior:'exclusive'},
    {amount:base.buyerFeeCents,quantity:1,reference:base.orderId+'_buyer_fee',tax_code:input.buyerFeeTaxCode,tax_behavior:'exclusive'}
   ],shipping_cost:{amount:base.shippingCents,tax_behavior:'exclusive'},expand:['line_items']};
   const data=await request('/v1/tax/calculations','POST',body);
   if(data.livemode!==false||typeof data.id!=='string'||!/^taxcalc_[A-Za-z0-9]+$/.test(data.id)||data.currency!=='usd'||!Number.isSafeInteger(data.tax_amount_exclusive)||data.tax_amount_exclusive<0||data.tax_amount_exclusive>10000000||data.tax_amount_inclusive!==0||data.amount_total!==base.baseCents+data.tax_amount_exclusive)throw Error('Test tax amounts do not match the order');
   const lines=data.line_items?.data;
   if(!Array.isArray(lines)||lines.length!==2||data.line_items.has_more!==false)throw Error('Missing test tax line items');
   for(const [i,line] of lines.entries()){
    if(line.reference!==body.line_items[i].reference||line.amount!==body.line_items[i].amount||line.tax_code!==body.line_items[i].tax_code)throw Error('Test tax line item mismatch');
   }
   if(!Array.isArray(data.tax_breakdown)||!data.tax_breakdown.length)throw new TaxNotReady('Taxability evidence is missing');
   let taxSum=0;const reasons=[];
   for(const detail of data.tax_breakdown){
    if(!Number.isSafeInteger(detail.amount)||detail.amount<0||detail.inclusive!==false||detail.tax_rate_details?.country!=='US'||!ACCEPTED_REASONS.has(detail.taxability_reason))throw new TaxNotReady('Tax calculation requires review; checkout remains closed');
    taxSum+=detail.amount;reasons.push(detail.taxability_reason);
   }
   if(taxSum!==data.tax_amount_exclusive)throw Error('Tax breakdown does not reconcile');
   const expiresAt=Math.min(now+600000,data.expires_at*1000);
   if(!Number.isSafeInteger(expiresAt)||expiresAt<=clock())throw Error('Test tax calculation expired');
   return Object.freeze({test:true,status:'calculated',country:'US',currency:'USD',orderId:base.orderId,baseCents:base.baseCents,amountCents:data.tax_amount_exclusive,expiresAt,destinationHash:hash,taxCalculationId:data.id,taxabilityReasons:Object.freeze([...new Set(reasons)])});
  }
 });
}
module.exports={TaxNotReady,createStripeTestTaxClient,usAddress,destinationHash};
