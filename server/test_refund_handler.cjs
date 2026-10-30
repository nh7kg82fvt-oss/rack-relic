'use strict';
const {RefundPending}=require('./test_refund_service.cjs');
const {OrderAccessDenied}=require('./test_order_repository.cjs');
function createTestRefundHandler({refunds,enabled=false}={}){
 return async(req,res)=>{
  const send=(status,data)=>{for(const [k,v] of Object.entries({'Cache-Control':'private, no-store, max-age=0','CDN-Cache-Control':'no-store','Vercel-CDN-Cache-Control':'no-store','Content-Type':'application/json; charset=utf-8','X-Content-Type-Options':'nosniff'}))res.setHeader(k,v);res.statusCode=status;res.end(JSON.stringify(data));};
  if(enabled!==true||!refunds){send(404,{error:'Not found'});return;}
  if(!['GET','POST'].includes(req.method)){res.setHeader('Allow','GET, POST');send(405,{error:'Method not allowed'});return;}
  try{
   if(req.method==='GET'){
    const url=new URL(req.url,'https://example.invalid');
    if([...url.searchParams.keys()].some(k=>!['action','requestId'].includes(k))||url.searchParams.getAll('requestId').length!==1){send(400,{error:'A saved refund request is required'});return;}
    send(200,await refunds.status({authorization:req.headers?.authorization,requestId:url.searchParams.get('requestId')}));return;
   }
   if((req.headers?.['content-type']||'').split(';')[0].trim()!=='application/json'){send(415,{error:'JSON required'});return;}
   let length=0;const chunks=[];
   for await(const chunk of req){const bytes=Buffer.from(chunk);length+=bytes.length;if(length>2048){send(413,{error:'Request too large'});return;}chunks.push(bytes);}
   let body;try{body=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{send(400,{error:'Invalid refund request'});return;}
   if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>!['requestId','orderId','amountCents'].includes(k))){send(400,{error:'Invalid refund request'});return;}
   send(200,await refunds.start({authorization:req.headers?.authorization,requestId:body.requestId,orderId:body.orderId,amountCents:body.amountCents}));
  }catch(e){
   const status=e instanceof OrderAccessDenied?403:e instanceof RefundPending?409:503;
   send(status,{error:status===403?'Refund operator access required':status===409?'Refund pending reconciliation; keep the same request reference':'Test refund unavailable; keep the same request reference'});
  }
 };
}
module.exports={createTestRefundHandler};
