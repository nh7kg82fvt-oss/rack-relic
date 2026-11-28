'use strict';
const {OrderAccessDenied}=require('./test_order_repository.cjs');
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const REASONS=['not_received','damaged','not_as_described'];
function createTestIssueHandler({repository,enabled=false}={}){return async(req,res)=>{
 const send=(status,data)=>{res.statusCode=status;for(const [k,v] of Object.entries({'Content-Type':'application/json','Cache-Control':'private, no-store','CDN-Cache-Control':'no-store','Vercel-CDN-Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'}))res.setHeader(k,v);res.end(JSON.stringify(data));};
 if(enabled!==true||!repository){send(404,{error:'Not found'});return;}
 if(!['GET','POST'].includes(req.method)){res.setHeader('Allow','GET, POST');send(405,{error:'Method not allowed'});return;}
 const q=new URL(req.url,'https://example.invalid').searchParams;
 if(q.getAll('action').length!==1||q.get('action')!=='order-issue'||[...q.keys()].some(k=>!['action','orderId'].includes(k))||q.getAll('orderId').length!==1||!UUID.test(q.get('orderId')||'')){send(400,{error:'Invalid order reference'});return;}
 let reason;
 if(req.method==='POST'){
  if((req.headers?.['content-type']||'').split(';')[0].trim()!=='application/json'){send(415,{error:'JSON required'});return;}
  let n=0;const chunks=[];for await(const c of req){const b=Buffer.from(c);n+=b.length;if(n>256){send(413,{error:'Request too large'});return;}chunks.push(b);}
  let b;try{b=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{send(400,{error:'Invalid issue'});return;}
  if(!b||Array.isArray(b)||Object.keys(b).length!==1||!REASONS.includes(b.reason)){send(400,{error:'Choose an order issue category'});return;}reason=b.reason;
 }
 try{
  const result=await repository.orderIssue({authorization:req.headers?.authorization,orderId:q.get('orderId'),reason});
  if(result?.test!==true||result.orderId!==q.get('orderId')||!['not_reported','review_required'].includes(result.state)||req.method==='POST'&&result.state!=='review_required'||result.state==='review_required'&&(!REASONS.includes(result.reason)||!Number.isFinite(Date.parse(result.reportedAt))))throw Error('Invalid issue receipt');
  send(200,{test:true,orderId:result.orderId,state:result.state,...(result.state==='review_required'?{reason:result.reason,reportedAt:result.reportedAt}:{})});
 }catch(e){send(e instanceof OrderAccessDenied?403:503,{error:e instanceof OrderAccessDenied?'Buyer sign-in required':'Report status unavailable. Check the same order before retrying.'});}
};}
module.exports={createTestIssueHandler};
