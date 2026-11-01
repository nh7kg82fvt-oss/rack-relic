'use strict';
const {createShippoTestClient}=require('./shippo_test_client.cjs');
const ID=/^[a-f0-9]{32}$/,UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
function safeLabelUrl(value){
 let u;try{u=new URL(value);}catch{throw Error('Invalid sample label URL');}
 if(u.protocol!=='https:'||u.username||u.password||u.port||!(/^shippo-delivery(?:-[a-z0-9-]+)?\.s3(?:[.-][a-z0-9-]+)?\.amazonaws\.com$/.test(u.hostname)||u.hostname==='deliver.goshippo.com'))throw Error('Unexpected sample label host');return u.href;
}
function createShippoTestLabelClient({token,fetchImpl=globalThis.fetch,clock=Date.now}={}){
 const shipping=createShippoTestClient({token,fetchImpl});
 const marker=(o,r)=>{if(!UUID.test(o||'')||!UUID.test(r||''))throw Error('Test label references required');return 'rr_test_label_'+o+'_'+r;};
 async function request(path,body){
  let r;try{r=await fetchImpl('https://api.goshippo.com'+path,{method:body?'POST':'GET',redirect:'error',cache:'no-store',signal:AbortSignal.timeout(20000),headers:{Authorization:'ShippoToken '+token,'Content-Type':'application/json','SHIPPO-API-VERSION':'2018-02-08'},...(body?{body:JSON.stringify(body)}:{})});}catch{throw Error('Sample label outcome unknown; keep the same request reference');}
  const age=r.headers?.get('age');if(!r.ok||age!=null&&(!/^\d+$/.test(age)||Number(age)>0)||['x-vercel-cache','cf-cache-status'].some(k=>['HIT','STALE','UPDATING'].includes((r.headers?.get(k)||'').toUpperCase())))throw Error('Fresh sample label evidence required');
  let d;try{d=await r.json();}catch{throw Error('Invalid sample label evidence');}return d;
 }
 function evidence(d,{orderId,requestId,quote,transactionId}){
  if(d?.test!==true||!ID.test(d.object_id||'')||transactionId&&d.object_id!==transactionId||d.metadata!==marker(orderId,requestId)||(typeof d.rate==='string'?d.rate:d.rate?.object_id)!==quote.rateId||!['SUCCESS','WAITING','QUEUED','ERROR'].includes(d.status))throw Error('Sample label identity mismatch');
  let labelUrl=null,trackingNumber=null;
  if(d.status==='SUCCESS'){labelUrl=safeLabelUrl(d.label_url);if(typeof d.tracking_number!=='string'||!d.tracking_number||d.tracking_number.length>100)throw Error('Sample tracking evidence required');trackingNumber=d.tracking_number;}
  return {test:true,orderId,requestId,transactionId:d.object_id,rateId:quote.rateId,status:d.status,labelUrl,trackingNumber,checkedAt:clock()};
 }
 return Object.freeze({
  async quote(context){
   const s=context?.snapshot;if(context?.test!==true||!UUID.test(context.orderId||'')||!s||!ID.test(s.rateId||'')||!Number.isSafeInteger(context.shippingCents)||context.shippingCents<0)throw Error('Trusted private shipping context required');
   const addr=(a,name)=>({name,street1:a.line1,street2:a.line2,city:a.city,state:a.state,zip:a.postal_code,country:a.country});
   const q=await shipping.quote({from:addr(s.origin,'Rack Relic synthetic sender'),to:addr(s.destination,'Rack Relic synthetic recipient'),package:s.parcel});
   const r=q.rates.filter(r=>r.test===true&&r.currency==='USD'&&Number.isSafeInteger(r.amountCents)&&r.amountCents>=0&&r.amountCents<=context.shippingCents&&r.carrier&&r.service).sort((a,b)=>a.amountCents-b.amountCents||a.id.localeCompare(b.id))[0];
   if(!r)throw Error('Fresh test postage exceeds the saved shipping budget or is unavailable');
   return {test:true,shipmentId:q.id,sourceRateId:s.rateId,rateId:r.id,currency:'USD',amountCents:r.amountCents,carrier:r.carrier,service:r.service,expiresAt:clock()+300000};
  },
  async create({orderId,requestId,quote}){
   const metadata=marker(orderId,requestId);if(quote?.test!==true||!ID.test(quote.rateId||'')||quote.expiresAt<=clock())throw Error('Fresh claimed test rate required');
   return evidence(await request('/transactions/',{rate:quote.rateId,label_file_type:'PDF_4x6',async:false,metadata}),{orderId,requestId,quote});
  },
  async retrieve({orderId,requestId,quote,transactionId}){
   marker(orderId,requestId);if(!ID.test(transactionId||''))throw Error('Saved sample transaction required');
   return evidence(await request('/transactions/'+transactionId+'/'),{orderId,requestId,quote,transactionId});
  }
 });
}
module.exports={createShippoTestLabelClient,safeLabelUrl};
