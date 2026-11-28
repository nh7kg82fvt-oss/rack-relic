'use strict';
const {OrderAccessDenied}=require('./test_order_repository.cjs');
const {publicProtectionReview}=require('../test-protection-review.js');
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
function createTestProtectionHandler({repository,enabled=false}={}){return async(req,res)=>{
 const send=(status,value)=>{res.statusCode=status;for(const [k,v] of Object.entries({'Content-Type':'application/json','Cache-Control':'private, no-store','CDN-Cache-Control':'no-store','Vercel-CDN-Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'}))res.setHeader(k,v);res.end(JSON.stringify(value));};
 if(enabled!==true||!repository){send(404,{error:'Not found'});return;}
 const q=new URL(req.url,'https://example.invalid').searchParams;
 if(q.get('action')==='protection-hold'){
  if(req.method!=='POST'){res.setHeader('Allow','POST');send(405,{error:'Method not allowed'});return;}
  if(q.getAll('action').length!==1||[...q.keys()].some(k=>k!=='action')){send(400,{error:'Invalid hold request'});return;}
  if((req.headers?.['content-type']||'').split(';')[0].trim()!=='application/json'){send(415,{error:'JSON required'});return;}
  try{
   let size=0;const chunks=[];for await(const chunk of req){const b=Buffer.from(chunk);size+=b.length;if(size>1024){send(413,{error:'Request too large'});return;}chunks.push(b);}
   let body;try{body=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{send(400,{error:'Invalid hold request'});return;}
   if(!body||Array.isArray(body)||Object.keys(body).length!==2||!UUID.test(body.orderId||'')||!['suspicious_activity','delivery_problem','verification_problem'].includes(body.reason)||Object.keys(body).some(k=>!['orderId','reason'].includes(k))){send(400,{error:'Invalid hold request'});return;}
   const r=await repository.holdSeller({authorization:req.headers?.authorization,orderId:body.orderId,reason:body.reason});
   if(r?.test!==true||r.orderId!==body.orderId||r.held!==true||r.releaseEnabled!==false)throw Error('Hold unconfirmed');
   send(200,{test:true,orderId:body.orderId,held:true,releaseEnabled:false});
  }catch(e){send(e instanceof OrderAccessDenied?403:503,{error:e instanceof OrderAccessDenied?'Test operator access required':'Hold not confirmed. Keep seller funds on hold and review before retrying.'});}
  return;
 }
 if(req.method!=='GET'){res.setHeader('Allow','GET');send(405,{error:'Method not allowed'});return;}
 if(q.getAll('action').length!==1||q.get('action')!=='protection-review'||q.getAll('orderId').length!==1||!UUID.test(q.get('orderId')||'')||[...q.keys()].some(k=>!['action','orderId'].includes(k))){send(400,{error:'Invalid order reference'});return;}
 try{const orderId=q.get('orderId');send(200,publicProtectionReview(await repository.protectionReview({authorization:req.headers?.authorization,orderId}),orderId));}
 catch(e){send(e instanceof OrderAccessDenied?403:503,{error:e instanceof OrderAccessDenied?'Test operator access required':'Protection review unavailable. Seller funds remain held.'});}
};}
module.exports={createTestProtectionHandler};
