'use strict';
const {OrderAccessDenied,OrderServiceUnavailable}=require('./test_order_repository.cjs');
const HEADERS={'Cache-Control':'private, no-store, max-age=0','CDN-Cache-Control':'no-store','Vercel-CDN-Cache-Control':'no-store','Content-Type':'application/json; charset=utf-8','X-Content-Type-Options':'nosniff'};
function send(res,status,data){for(const [k,v] of Object.entries(HEADERS))res.setHeader(k,v);res.statusCode=status;res.end(JSON.stringify(data));}
// No public Vercel routes are added by these factories. Explicit enablement is
// possible only after selecting a separate test DB and testing the deployment.
function createTestWebhookHandler({repository,webhookSecret,enabled=false}={}){
 return async(req,res)=>{
  if(enabled!==true||!repository||typeof webhookSecret!=='string'){send(res,503,{error:'Test checkout unavailable'});return;}
  if(req.method!=='POST'){res.setHeader('Allow','POST');send(res,405,{error:'Method not allowed'});return;}
  const signature=req.headers?.['stripe-signature'];
  if(typeof signature!=='string'||signature.length>4096){send(res,400,{error:'Invalid test notification'});return;}
  try{
   let length=0;const chunks=[];
   for await(const chunk of req){const bytes=Buffer.from(chunk);length+=bytes.length;if(length>1048576){send(res,413,{error:'Notification too large'});return;}chunks.push(bytes);}
   await repository.acceptStripeEvent({rawBody:Buffer.concat(chunks,length),signature,webhookSecret});
   send(res,200,{received:true});
  }catch(e){send(res,e instanceof OrderServiceUnavailable?503:400,{error:e instanceof OrderServiceUnavailable?'Test order service unavailable':'Invalid test notification'});}
 };
}
function createTestOrdersHandler({repository,enabled=false}={}){
 return async(req,res)=>{
  if(enabled!==true||!repository){send(res,503,{error:'Test checkout unavailable'});return;}
  if(req.method!=='GET'){res.setHeader('Allow','GET');send(res,405,{error:'Method not allowed'});return;}
  try{const orders=await repository.memberOrders({authorization:req.headers?.authorization});send(res,200,{orders});}
  catch(e){send(res,e instanceof OrderAccessDenied?401:503,{error:e instanceof OrderAccessDenied?'Sign in required':'Test order service unavailable'});}
 };
}
module.exports={createTestWebhookHandler,createTestOrdersHandler};
