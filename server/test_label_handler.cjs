'use strict';
const {OrderAccessDenied}=require('./test_order_repository.cjs');
function createTestLabelHandler({labels,enabled=false}={}){return async(req,res)=>{
 const send=(status,data)=>{res.statusCode=status;for(const [k,v] of Object.entries({'Content-Type':'application/json','Cache-Control':'private, no-store','CDN-Cache-Control':'no-store','Vercel-CDN-Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}))res.setHeader(k,v);res.end(JSON.stringify(data));};
 if(enabled!==true||!labels){send(404,{error:'Not found'});return;}
 if(!['GET','POST'].includes(req.method)){res.setHeader('Allow','GET, POST');send(405,{error:'Method not allowed'});return;}
 const q=new URL(req.url,'https://example.invalid').searchParams;
 if(q.getAll('action').length!==1||q.get('action')!=='sample-label'){send(400,{error:'Invalid sample request'});return;}
 try{
  let body;
  if(req.method==='GET'){
   if([...q.keys()].some(k=>!['action','orderId','requestId'].includes(k))||q.getAll('orderId').length!==1||q.getAll('requestId').length!==1){send(400,{error:'Saved sample references required'});return;}
   body={orderId:q.get('orderId'),requestId:q.get('requestId')};
  }else{
   if([...q.keys()].some(k=>k!=='action')){send(400,{error:'Invalid sample request'});return;}
   if((req.headers?.['content-type']||'').split(';')[0].trim()!=='application/json'){send(415,{error:'JSON required'});return;}
   let length=0;const chunks=[];for await(const chunk of req){const b=Buffer.from(chunk);length+=b.length;if(length>1024){send(413,{error:'Request too large'});return;}chunks.push(b);}
   try{body=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{send(400,{error:'Invalid sample request'});return;}
   if(!body||Array.isArray(body)||Object.keys(body).sort().join(',')!=='orderId,requestId'){send(400,{error:'Saved sample references required'});return;}
  }
  send(200,await labels[req.method==='POST'?'request':'status']({...body,authorization:req.headers?.authorization}));
 }catch(e){send(e instanceof OrderAccessDenied?403:503,{error:e instanceof OrderAccessDenied?'Test operator access required':'Sample label is held or needs review. Keep the same request reference; do not create another label.'});}
};}
module.exports={createTestLabelHandler};
