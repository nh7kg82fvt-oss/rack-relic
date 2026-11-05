'use strict';
const {OrderAccessDenied}=require('./test_order_repository.cjs');
function createTestRiskHandler({risk,enabled=false}={}){return async(req,res)=>{
 const send=(status,data)=>{res.statusCode=status;for(const [k,v] of Object.entries({'Content-Type':'application/json','Cache-Control':'private, no-store','CDN-Cache-Control':'no-store','Vercel-CDN-Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}))res.setHeader(k,v);res.end(JSON.stringify(data));};
 if(enabled!==true||!risk){send(404,{error:'Not found'});return;}
 if(req.method!=='POST'){res.setHeader('Allow','POST');send(405,{error:'Method not allowed'});return;}
 const q=new URL(req.url,'https://example.invalid').searchParams;
 if(q.getAll('action').length!==1||q.get('action')!=='risk'||[...q.keys()].some(k=>k!=='action')){send(400,{error:'Invalid risk request'});return;}
 if((req.headers?.['content-type']||'').split(';')[0].trim()!=='application/json'){send(415,{error:'JSON required'});return;}
 let n=0;const chunks=[];try{
  for await(const chunk of req){const b=Buffer.from(chunk);n+=b.length;if(n>1024){send(413,{error:'Request too large'});return;}chunks.push(b);}
  let body;try{body=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{send(400,{error:'Invalid risk request'});return;}
  if(!body||Array.isArray(body)||Object.keys(body).join(',')!=='orderId'){send(400,{error:'One order reference required'});return;}
  send(200,await risk.assess({orderId:body.orderId,authorization:req.headers?.authorization}));
 }catch(e){send(e instanceof OrderAccessDenied?403:503,{error:e instanceof OrderAccessDenied?'Test operator access required':'Risk check needs review. Existing holds remain; no label or payout was created.'});}
};}
module.exports={createTestRiskHandler};
