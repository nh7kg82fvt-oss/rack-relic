'use strict';
const {OrderAccessDenied}=require('./test_order_repository.cjs');
function createTestFeeHandler({fees,enabled=false}={}){return async(req,res)=>{
 const send=(status,data)=>{res.statusCode=status;for(const [k,v] of Object.entries({'Content-Type':'application/json','Cache-Control':'private, no-store','CDN-Cache-Control':'no-store','Vercel-CDN-Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}))res.setHeader(k,v);res.end(JSON.stringify(data));};
 if(enabled!==true||!fees){send(404,{error:'Not found'});return;}
 if(!['GET','POST'].includes(req.method)){res.setHeader('Allow','GET, POST');send(405,{error:'Method not allowed'});return;}
 const query=new URL(req.url,'https://example.invalid').searchParams;
 try{
  if(query.getAll('action').length!==1){send(400,{error:'Invalid fee request'});return;}
  let orderId;
  if(req.method==='GET'){
   if([...query.keys()].some(k=>!['action','orderId'].includes(k))||query.getAll('orderId').length!==1){send(400,{error:'One order reference required'});return;}
   orderId=query.get('orderId');
  }else{
   if([...query.keys()].some(k=>k!=='action')){send(400,{error:'Invalid fee request'});return;}
   if((req.headers?.['content-type']||'').split(';')[0].trim()!=='application/json'){send(415,{error:'JSON required'});return;}
   let length=0;const chunks=[];for await(const chunk of req){const bytes=Buffer.from(chunk);length+=bytes.length;if(length>1024){send(413,{error:'Request too large'});return;}chunks.push(bytes);}
   let body;try{body=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{send(400,{error:'Invalid fee request'});return;}
   if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).length!==1||!Object.hasOwn(body,'orderId')){send(400,{error:'One order reference required'});return;}orderId=body.orderId;
  }
  send(200,await fees[req.method==='POST'?'reconcile':'status']({authorization:req.headers?.authorization,orderId}));
 }catch(e){send(e instanceof OrderAccessDenied?403:503,{error:e instanceof OrderAccessDenied?'Test operator access required':'Processing fee needs review. No payout or financial adjustment was made.'});}
};}
module.exports={createTestFeeHandler};
