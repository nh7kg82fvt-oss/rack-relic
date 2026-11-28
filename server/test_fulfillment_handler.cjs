'use strict';
const {OrderAccessDenied}=require('./test_order_repository.cjs');
function createTestFulfillmentHandler({repository,enabled=false}={}){return async(req,res)=>{
 const send=(status,data)=>{res.statusCode=status;res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','private, no-store');res.setHeader('CDN-Cache-Control','no-store');res.setHeader('Vercel-CDN-Cache-Control','no-store');res.end(JSON.stringify(data));};
 if(enabled!==true){send(404,{error:'Not found'});return;}
 if(req.method!=='GET'){res.setHeader('Allow','GET');send(405,{error:'Method not allowed'});return;}
 const q=new URL(req.url,'https://example.invalid').searchParams;
 if(q.getAll('action').length!==1||q.getAll('orderId').length!==1||[...q.keys()].some(k=>!['action','orderId'].includes(k))){send(400,{error:'One order reference required'});return;}
 try{send(200,await repository.fulfillmentStatus({authorization:req.headers?.authorization,orderId:q.get('orderId')}));}
 catch(e){send(e instanceof OrderAccessDenied?403:503,{error:e instanceof OrderAccessDenied?'Test operator access required':'Shipping readiness unavailable. Label purchase remains disabled.'});}
};}
module.exports={createTestFulfillmentHandler};
