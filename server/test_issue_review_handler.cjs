'use strict';
const {OrderAccessDenied}=require('./test_order_repository.cjs');
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
function createTestIssueReviewHandler({repository,enabled=false}={}){return async(req,res)=>{
 const send=(code,value)=>{res.statusCode=code;for(const [k,v] of Object.entries({'Content-Type':'application/json','Cache-Control':'private, no-store','CDN-Cache-Control':'no-store','Vercel-CDN-Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'}))res.setHeader(k,v);res.end(JSON.stringify(value));};
 if(enabled!==true||!repository){send(404,{error:'Not found'});return;}
 if(!['GET','POST'].includes(req.method)){res.setHeader('Allow','GET, POST');send(405,{error:'Method not allowed'});return;}
 const q=new URL(req.url,'https://example.invalid').searchParams;
 if(q.getAll('action').length!==1||q.get('action')!=='issue-review'||[...q.keys()].some(k=>k!=='action')){send(400,{error:'Invalid review request'});return;}
 try{
  if(req.method==='GET'){send(200,await repository.reviewOrderIssues({authorization:req.headers?.authorization}));return;}
  if((req.headers?.['content-type']||'').split(';')[0].trim()!=='application/json'){send(415,{error:'JSON required'});return;}
  let n=0;const chunks=[];for await(const c of req){const b=Buffer.from(c);n+=b.length;if(n>256){send(413,{error:'Request too large'});return;}chunks.push(b);}
  let b;try{b=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{send(400,{error:'Invalid review request'});return;}
  if(!b||Array.isArray(b)||Object.keys(b).length!==1||!UUID.test(b.orderId||'')){send(400,{error:'A saved report order is required'});return;}
  send(200,await repository.acknowledgeOrderIssue({authorization:req.headers?.authorization,orderId:b.orderId}));
 }catch(e){send(e instanceof OrderAccessDenied?403:503,{error:e instanceof OrderAccessDenied?'Test operator access required':'Report review unavailable. Refresh the queue before retrying.'});}
};}
module.exports={createTestIssueReviewHandler};
