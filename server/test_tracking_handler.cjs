'use strict';
const {OrderAccessDenied}=require('./test_order_repository.cjs');
function createTestTrackingHandler({tracking,enabled=false}={}){return async(req,res)=>{
 const send=(status,data)=>{res.statusCode=status;for(const [k,v] of Object.entries({'Content-Type':'application/json','Cache-Control':'private, no-store','CDN-Cache-Control':'no-store','Vercel-CDN-Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}))res.setHeader(k,v);res.end(JSON.stringify(data));};
 if(enabled!==true||!tracking){send(404,{error:'Not found'});return;}
 if(!['GET','POST'].includes(req.method)){res.setHeader('Allow','GET, POST');send(405,{error:'Method not allowed'});return;}
 const q=new URL(req.url,'https://example.invalid').searchParams;
 if(q.getAll('action').length!==1||q.get('action')!=='tracking'){send(400,{error:'Invalid tracking request'});return;}
 try{
  let orderId;
  if(req.method==='GET'){
   if(q.getAll('orderId').length!==1||[...q.keys()].some(k=>!['action','orderId'].includes(k))){send(400,{error:'One order reference required'});return;}orderId=q.get('orderId');
  }else{
   if([...q.keys()].some(k=>k!=='action')){send(400,{error:'Invalid tracking request'});return;}
   if((req.headers?.['content-type']||'').split(';')[0].trim()!=='application/json'){send(415,{error:'JSON required'});return;}
   let size=0;const chunks=[];for await(const chunk of req){const b=Buffer.from(chunk);size+=b.length;if(size>1024){send(413,{error:'Request too large'});return;}chunks.push(b);}
   let body;try{body=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{send(400,{error:'Invalid tracking request'});return;}
   if(!body||Array.isArray(body)||Object.keys(body).join(',')!=='orderId'){send(400,{error:'One order reference required'});return;}orderId=body.orderId;
  }
  send(200,await tracking[req.method==='POST'?'refresh':'status']({authorization:req.headers?.authorization,orderId}));
 }catch(e){send(e instanceof OrderAccessDenied?403:503,{error:e instanceof OrderAccessDenied?'Test operator access required':'Sample tracking needs review. No delivery decision, label or payout was created.'});}
};}
module.exports={createTestTrackingHandler};
