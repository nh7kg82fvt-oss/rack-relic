'use strict';
const {OrderAccessDenied}=require('./test_order_repository.cjs');
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
function createTestSellerCostHandler({costs,enabled=false}={}){return async(req,res)=>{
 const send=(status,body)=>{res.statusCode=status;for(const [k,v] of Object.entries({'Content-Type':'application/json','Cache-Control':'private, no-store','CDN-Cache-Control':'no-store','Vercel-CDN-Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'}))res.setHeader(k,v);res.end(JSON.stringify(body));};
 if(enabled!==true||!costs){send(404,{error:'Not found'});return;}
 const q=new URL(req.url,'https://example.invalid').searchParams,action=q.get('action'),read=action==='seller-cost-review';
 if(!['seller-cost-review','seller-cost-prepare','seller-cost-accept'].includes(action)||q.getAll('action').length!==1){send(400,{error:'Invalid payment cost request'});return;}
 if(req.method!==(read?'GET':'POST')){res.setHeader('Allow',read?'GET':'POST');send(405,{error:'Method not allowed'});return;}
 try{
  let body;
  if(read){
   if(q.getAll('orderId').length!==1||[...q.keys()].some(k=>!['action','orderId'].includes(k)))throw Error('Invalid request');
   body={orderId:q.get('orderId')};
  }else{
   if([...q.keys()].some(k=>k!=='action'))throw Error('Invalid request');
   if((req.headers?.['content-type']||'').split(';')[0].trim()!=='application/json'){send(415,{error:'JSON required'});return;}
   let size=0;const chunks=[];for await(const chunk of req){const b=Buffer.from(chunk);size+=b.length;if(size>1024){send(413,{error:'Request too large'});return;}chunks.push(b);}
   try{body=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw Error('Invalid request');}
   const fields=action==='seller-cost-accept'?['orderId','disclosureHash']:['orderId'];
   if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).length!==fields.length||Object.keys(body).some(k=>!fields.includes(k)))throw Error('Invalid request');
  }
  if(!UUID.test(body.orderId||'')||action==='seller-cost-accept'&&!/^[a-f0-9]{64}$/.test(body.disclosureHash||''))throw Error('Invalid request');
  const method=read?'status':action==='seller-cost-prepare'?'prepare':'accept';
  send(200,await costs[method]({authorization:req.headers?.authorization,...body}));
 }catch(e){const invalid=e.message==='Invalid request';send(e instanceof OrderAccessDenied?403:invalid?400:503,{error:e instanceof OrderAccessDenied?'Seller access required':invalid?'Invalid payment cost request':'Payment costs need review. Checkout and seller payouts remain held.'});}
};}
module.exports={createTestSellerCostHandler};
