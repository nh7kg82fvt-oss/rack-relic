'use strict';
const fs=require('node:fs');
const {createShippoTestClient}=require('../server/shippo_test_client.cjs');
// Pass a private token-file path, never a token on the command line.
(async()=>{
 const tokenPath=process.argv[2];
 const token=fs.readFileSync(tokenPath,'utf8').trim();
 const client=createShippoTestClient({token,fetchImpl:async(...args)=>{
  const response=await fetch(...args);
  if(!response.ok) { const detail=await response.clone().text(); console.error('Sample-only diagnostic: '+detail.replaceAll(token,'[redacted]').slice(0,1500)); }
  return response;
 }});
 const sample={name:'Rack Relic TEST ONLY',street1:'215 Clayton St.',city:'San Francisco',state:'CA',zip:'94117',country:'US',email:'sender@example.com',phone:'4155550123'};
 try {
  const quote=await client.quote({from:sample,to:{...sample,street1:'1 Market St',zip:'94105'},package:{length:10,width:8,height:2,weight:1}});
  const selected=quote.rates.find(r=>r.carrier==='USPS')||quote.rates[0];
  console.log(JSON.stringify({step:'quote',shipmentId:quote.id,test:quote.test,rateCount:quote.rates.length,carriers:[...new Set(quote.rates.map(r=>r.carrier))]}));
  if(!selected) throw Error('No test rates returned; carrier setup is required');
  const label=await client.label(selected.id);
  console.log(JSON.stringify({step:'label',transactionId:label.id,test:label.test,hasLabel:!!label.labelUrl,hasTracking:!!label.trackingNumber,carrier:selected.carrier}));
 } finally { fs.unlinkSync(tokenPath); }
})().catch(e=>{console.error(e.message);process.exitCode=1;});
