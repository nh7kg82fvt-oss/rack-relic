'use strict';
const {OrderAccessDenied}=require('./test_order_repository.cjs');
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const {RESPONSES,publicIssueThread}=require('./test_issue_thread.cjs');
function createTestIssueThreadHandler({repository,enabled=false}={}){return async(req,res)=>{
 const send=(status,data)=>{res.statusCode=status;for(const [k,v] of Object.entries({'Content-Type':'application/json','Cache-Control':'private, no-store','CDN-Cache-Control':'no-store','Vercel-CDN-Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'}))res.setHeader(k,v);res.end(JSON.stringify(data));};
 if(enabled!==true||!repository){send(404,{error:'Not found'});return;}
 if(!['GET','POST'].includes(req.method)){res.setHeader('Allow','GET, POST');send(405,{error:'Method not allowed'});return;}
 const q=new URL(req.url,'https://example.invalid').searchParams;
 if(q.getAll('action').length!==1||q.get('action')!=='issue-thread'||[...q.keys()].some(k=>!['action','orderId'].includes(k))||q.getAll('orderId').length!==1||!UUID.test(q.get('orderId')||'')){send(400,{error:'Invalid order reference'});return;}
 let response;
 if(req.method==='POST'){
  if((req.headers?.['content-type']||'').split(';')[0].trim()!=='application/json'){send(415,{error:'JSON required'});return;}
  let n=0;const chunks=[];for await(const c of req){const b=Buffer.from(c);n+=b.length;if(n>256){send(413,{error:'Request too large'});return;}chunks.push(b);}
  let b;try{b=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{send(400,{error:'Invalid issue'});return;}
  if(!b||Array.isArray(b)||Object.keys(b).length!==1||!RESPONSES.includes(b.response)){send(400,{error:'Choose a seller response'});return;}response=b.response;
 }
 try{
  const result=await repository.issueThread({authorization:req.headers?.authorization,orderId:q.get('orderId'),response});
  const receipt=publicIssueThread(result,q.get('orderId'));
  if(req.method==='POST'&&(receipt.state!=='review_required'||receipt.sellerResponse?.kind!==response))throw Error('Seller response needs confirmation');
  send(200,receipt);
 }catch(e){send(e instanceof OrderAccessDenied?403:503,{error:e instanceof OrderAccessDenied?'Order participant sign-in required':'Issue status unavailable. Check the same order before retrying.'});}
};}
module.exports={createTestIssueThreadHandler};
