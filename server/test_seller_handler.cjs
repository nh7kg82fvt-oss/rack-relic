'use strict';
const {OrderAccessDenied}=require('./test_order_repository.cjs');
function createTestSellerHandler({sellers,enabled=false}={}){return async(req,res)=>{
 const send=(code,value)=>{res.statusCode=code;for(const [k,v] of Object.entries({'Content-Type':'application/json','Cache-Control':'private, no-store','CDN-Cache-Control':'no-store','Vercel-CDN-Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'}))res.setHeader(k,v);res.end(JSON.stringify(value));};
 if(enabled!==true||!sellers){send(404,{error:'Not found'});return;}
 if(!['GET','POST'].includes(req.method)){res.setHeader('Allow','GET, POST');send(405,{error:'Method not allowed'});return;}
 const q=new URL(req.url,'https://example.invalid').searchParams;if(q.getAll('action').length!==1||q.get('action')!=='seller-onboarding'||[...q.keys()].some(k=>k!=='action')){send(400,{error:'Invalid seller request'});return;}
 try{
  if(req.method==='GET'){send(200,await sellers.status({authorization:req.headers?.authorization}));return;}
  if((req.headers?.['content-type']||'').split(';')[0].trim()!=='application/json'){send(415,{error:'JSON required'});return;}
  let n=0;const chunks=[];for await(const c of req){const b=Buffer.from(c);n+=b.length;if(n>128){send(413,{error:'Request too large'});return;}chunks.push(b);}
  let b;try{b=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{send(400,{error:'Invalid seller request'});return;}
  if(!b||Array.isArray(b)||Object.keys(b).length){send(400,{error:'Seller identity comes from sign-in'});return;}
  send(200,await sellers.start({authorization:req.headers?.authorization}));
 }catch(e){send(e instanceof OrderAccessDenied?403:503,{error:e instanceof OrderAccessDenied?'Test seller sign-in required':'Seller onboarding is held. Reload status; do not create a replacement account. No transfers or payouts were enabled.'});}
};}
module.exports={createTestSellerHandler};
