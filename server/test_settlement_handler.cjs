'use strict';
const {OrderAccessDenied}=require('./test_order_repository.cjs');
const {SettlementPending}=require('./test_settlement_service.cjs');
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const cents=v=>Number.isSafeInteger(v)&&v>=0&&v<=30000000;
const KINDS=['transfer','payout','reversal'];
function publicSettlementAttempt(v,orderId,requestId){
 if(!UUID.test(orderId||'')||v?.test!==true||v.simulationOnly!==true||v.orderId!==orderId||!UUID.test(v.requestId||'')||requestId&&v.requestId!==requestId
  ||!KINDS.includes(v.kind)||!cents(v.amountCents)||v.amountCents<1||typeof v.needsReview!=='boolean'||typeof v.recoveryRequired!=='boolean'
  ||v.releaseEnabled!==false||v.liveReady!==false)throw Error('Invalid simulation receipt');
 const states=v.kind==='payout'?['prepared','outcome_unknown','pending','in_transit','paid','failed','canceled']:['prepared','outcome_unknown','succeeded'];
 if(!states.includes(v.state))throw Error('Invalid simulation state');
 if(v.kind==='transfer'?(!cents(v.availableCents)||v.availableCents>v.amountCents):v.availableCents!==null)throw Error('Invalid simulation amount');
 if(v.recoveryRequired!==(v.needsReview||['failed','canceled'].includes(v.state)))throw Error('Invalid simulation hold');
 return {test:true,simulationOnly:true,orderId,requestId:v.requestId,kind:v.kind,amountCents:v.amountCents,state:v.state,
  availableCents:v.kind==='transfer'?v.availableCents:null,needsReview:v.needsReview,recoveryRequired:v.recoveryRequired,releaseEnabled:false,liveReady:false};
}
function publicSettlementReview(v,orderId){
 if(!UUID.test(orderId||'')||v?.test!==true||v.simulationOnly!==true||v.orderId!==orderId||v.releaseEnabled!==false||v.liveReady!==false
  ||!Array.isArray(v.blockers)||v.blockers.length>30||new Set(v.blockers).size!==v.blockers.length
  ||v.blockers.some(k=>typeof k!=='string'||!/^[a-z][a-z0-9_]{0,99}$/.test(k))||!Array.isArray(v.attempts)||v.attempts.length>100
  ||(v.blockers.length?v.transferableCents!==null:!cents(v.transferableCents)))throw Error('Invalid simulation review');
 const attempts=v.attempts.map(a=>publicSettlementAttempt(a,orderId));
 if(new Set(attempts.map(a=>a.requestId)).size!==attempts.length)throw Error('Repeated simulation reference');
 return {test:true,simulationOnly:true,orderId,blockers:[...v.blockers],transferableCents:v.transferableCents,attempts,releaseEnabled:false,liveReady:false};
}
function createTestSettlementHandler({settlement,enabled=false}={}){return async(req,res)=>{
 const send=(status,body)=>{res.statusCode=status;for(const [k,v]of Object.entries({'Content-Type':'application/json; charset=utf-8','Cache-Control':'private, no-store, max-age=0','CDN-Cache-Control':'no-store','Vercel-CDN-Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'}))res.setHeader(k,v);res.end(JSON.stringify(body));};
 if(enabled!==true||!settlement){send(404,{error:'Not found'});return;}
 try{
  const q=new URL(req.url,'https://example.invalid').searchParams,action=q.get('action'),read=action==='settlement-sim-review';
  if(q.getAll('action').length!==1||!['settlement-sim-review','settlement-sim-start','settlement-sim-reconcile'].includes(action))throw Error('Invalid request');
  if(req.method!==(read?'GET':'POST')){res.setHeader('Allow',read?'GET':'POST');send(405,{error:'Method not allowed'});return;}
  let body;
  if(read){
   if(q.getAll('orderId').length!==1||[...q.keys()].some(k=>!['action','orderId'].includes(k)))throw Error('Invalid request');
   body={orderId:q.get('orderId')};
  }else{
   if([...q.keys()].some(k=>k!=='action'))throw Error('Invalid request');
   if(typeof req.headers?.['content-type']!=='string'||req.headers['content-type'].split(';')[0].trim()!=='application/json'){send(415,{error:'JSON required'});return;}
   let size=0;const chunks=[];for await(const chunk of req){const b=Buffer.from(chunk);size+=b.length;if(size>1024){send(413,{error:'Request too large'});return;}chunks.push(b);}
   try{body=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw Error('Invalid request');}
   if(!body||typeof body!=='object'||Array.isArray(body))throw Error('Invalid request');
   const fields=action==='settlement-sim-reconcile'?['orderId','requestId']:['orderId','requestId','kind',...(body.kind==='transfer'?[]:['parentRequestId'])];
   if(Object.keys(body).length!==fields.length||Object.keys(body).some(k=>!fields.includes(k))||!UUID.test(body.requestId||'')
    ||action==='settlement-sim-start'&&(!KINDS.includes(body.kind)||body.kind!=='transfer'&&(!UUID.test(body.parentRequestId||'')||body.parentRequestId===body.requestId)))throw Error('Invalid request');
  }
  if(!UUID.test(body.orderId||''))throw Error('Invalid request');
  const input={authorization:req.headers?.authorization,...body};
  if(read){send(200,publicSettlementReview(await settlement.review(input),body.orderId));return;}
  const r=await settlement[action==='settlement-sim-start'?'start':'reconcile'](input),result=publicSettlementAttempt(r,body.orderId,body.requestId);
  if(action==='settlement-sim-start'&&result.kind!==body.kind)throw Error('Wrong simulation operation');
  send(200,result);
 }catch(e){
  const invalid=e.message==='Invalid request',status=e instanceof OrderAccessDenied?403:e instanceof SettlementPending?409:invalid?400:503;
  send(status,{error:status===403?'Test operator access required':status===400?'Invalid payout simulation request':status===409?'Test payout simulation needs reconciliation. Keep the same request reference. Real seller payouts remain closed.':'Test payout simulation is unavailable. Keep the same request reference. Real seller payouts remain closed.'});
 }
};}
module.exports={createTestSettlementHandler,publicSettlementAttempt,publicSettlementReview};
