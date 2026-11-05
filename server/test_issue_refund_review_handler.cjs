'use strict';
const {OrderAccessDenied}=require('./test_order_repository.cjs');
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
function createTestIssueRefundReviewHandler({repository,enabled=false}={}){return async(req,res)=>{
 const send=(code,value)=>{res.statusCode=code;for(const [k,v] of Object.entries({'Content-Type':'application/json','Cache-Control':'private, no-store','CDN-Cache-Control':'no-store','Vercel-CDN-Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'}))res.setHeader(k,v);res.end(JSON.stringify(value));};
 if(enabled!==true||!repository){send(404,{error:'Not found'});return;}
 if(req.method!=='GET'){res.setHeader('Allow','GET');send(405,{error:'Method not allowed'});return;}
 const q=new URL(req.url,'https://example.invalid').searchParams;
 if(q.getAll('action').length!==1||q.get('action')!=='issue-refund-review'||[...q.keys()].some(k=>!['action','orderId'].includes(k))||q.getAll('orderId').length!==1||!UUID.test(q.get('orderId')||'')){send(400,{error:'Invalid order reference'});return;}
 try{send(200,await repository.issueRefundReview({authorization:req.headers?.authorization,orderId:q.get('orderId')}));}
 catch(e){send(e instanceof OrderAccessDenied?403:503,{error:e instanceof OrderAccessDenied?'Test operator access required':'Issue refund review unavailable. Keep existing request references.'});}
};}
module.exports={createTestIssueRefundReviewHandler};
