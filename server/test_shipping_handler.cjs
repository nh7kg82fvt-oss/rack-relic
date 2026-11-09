'use strict';
const {OrderAccessDenied}=require('./test_order_repository.cjs');
// Deliberately separate from checkout: this verifies carrier connectivity only.
// No customer addresses, checkout totals, transactions or labels are accepted here.
const FIXTURE=Object.freeze({
 from:Object.freeze({name:'Rack Relic synthetic sender',street1:'400 Broad St',city:'Seattle',state:'WA',zip:'98109',country:'US'}),
 to:Object.freeze({name:'Rack Relic synthetic recipient',street1:'350 5th Ave',city:'New York',state:'NY',zip:'10118',country:'US'}),
 package:Object.freeze({length:10,width:8,height:2,weight:1})
});
function createTestShippingHandler({repository,shipping,enabled=false}={}){return async(req,res)=>{
 const send=(status,data)=>{res.statusCode=status;res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','private, no-store');res.setHeader('CDN-Cache-Control','no-store');res.setHeader('Vercel-CDN-Cache-Control','no-store');res.end(JSON.stringify(data));};
 if(enabled!==true||!shipping||!repository){send(404,{error:'Not found'});return;}
 if(req.method!=='POST'){res.setHeader('Allow','POST');send(405,{error:'Method not allowed'});return;}
 const query=new URL(req.url,'https://example.invalid').searchParams;
 if(query.getAll('action').length!==1||[...query.keys()].some(k=>k!=='action')){send(400,{error:'Invalid shipping test request'});return;}
 if((req.headers?.['content-type']||'').split(';')[0].trim()!=='application/json'){send(415,{error:'JSON required'});return;}
 try{
  let length=0;const chunks=[];for await(const chunk of req){const bytes=Buffer.from(chunk);length+=bytes.length;if(length>128){send(413,{error:'Request too large'});return;}chunks.push(bytes);}
  let body;try{body=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{send(400,{error:'Invalid shipping test request'});return;}
  if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).length){send(400,{error:'This test accepts no addresses or shipping instructions'});return;}
  await repository.refundAccess({authorization:req.headers?.authorization});
  const quote=await shipping.quote(FIXTURE);
  if(quote?.test!==true||!/^[a-f0-9]{32}$/.test(quote.id||'')||!Array.isArray(quote.rates)||!quote.rates.length||quote.rates.length>100||quote.rates.some(r=>r?.test!==true||!/^[a-f0-9]{32}$/.test(r.id||'')||r.currency!=='USD'||!Number.isSafeInteger(r.amountCents)||r.amountCents<0||r.amountCents>100000||typeof r.carrier!=='string'||r.carrier.length>100||!r.carrier.trim()||typeof r.service!=='string'||r.service.length>150||!r.service.trim()))throw Error('Invalid test rates');
  send(200,{test:true,mode:'carrier_connection_test',postagePurchased:false,checkoutChanged:false,rates:quote.rates.map(r=>({carrier:r.carrier,service:r.service,amountCents:r.amountCents,currency:'USD'})).sort((a,b)=>a.amountCents-b.amountCents)});
 }catch(e){send(e instanceof OrderAccessDenied?403:503,{error:e instanceof OrderAccessDenied?'Test operator access required':'Carrier test prices are unavailable. No postage was purchased; no automatic retry was made.'});}
};}
module.exports={createTestShippingHandler};
