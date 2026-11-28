'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),{Readable}=require('node:stream');
const {createTestSettlementHandler,publicSettlementAttempt,publicSettlementReview}=require('../server/test_settlement_handler.cjs');
const {OrderAccessDenied}=require('../server/test_order_repository.cjs');
const {SettlementPending}=require('../server/test_settlement_service.cjs');
const O='11111111-1111-4111-8111-111111111111',R='22222222-2222-4222-8222-222222222222',P='33333333-3333-4333-8333-333333333333';
const attempt=(patch={})=>({test:true,simulationOnly:true,orderId:O,requestId:R,kind:'transfer',amountCents:2000,state:'succeeded',availableCents:2000,needsReview:false,recoveryRequired:false,releaseEnabled:false,liveReady:false,...patch});
const review=(patch={})=>({test:true,simulationOnly:true,orderId:O,blockers:[],transferableCents:2000,attempts:[],releaseEnabled:false,liveReady:false,...patch});
const response=()=>({headers:{},setHeader(k,v){this.headers[k]=v;},end(v){this.body=JSON.parse(v);}});
function request(action,body={orderId:O,requestId:R,kind:'transfer'},method='POST',extra=''){
 return Object.assign(Readable.from([typeof body==='string'?body:JSON.stringify(body)]),{method,url:'/api/test-marketplace?action='+action+extra,headers:{authorization:'Bearer operator','content-type':'application/json'}});
}
function setup({result=attempt(),read=review(),failure}={}){
 const calls=[],settlement={};for(const method of ['review','start','reconcile'])settlement[method]=async input=>{calls.push({method,input});if(failure)throw failure;return method==='review'?read:result;};
 return {calls,handler:createTestSettlementHandler({settlement,enabled:true}),settlement};
}
test('HTTP requires explicit activation and enforces operation methods before any service access',async()=>{
 const x=setup();for(const enabled of [false,undefined,'true',1]){const res=response();await createTestSettlementHandler({settlement:x.settlement,enabled})(request('settlement-sim-start'),res);assert.equal(res.statusCode,404);}
 for(const [action,method]of [['settlement-sim-review','POST'],['settlement-sim-start','GET'],['settlement-sim-reconcile','DELETE']]){const res=response();await x.handler(request(action,{},method),res);assert.equal(res.statusCode,405);assert.equal(res.headers.Allow,action==='settlement-sim-review'?'GET':'POST');}
 assert.equal(x.calls.length,0);
});
test('review exposes only bounded test amounts and saved references, with private evidence discarded',async()=>{
 const x=setup({read:review({attempts:[{...attempt(),accountId:'acct_private',providerId:'tr_private',raw:{bank:'private'}}],privateAddress:'private',evidence:'private'})}),res=response();
 await x.handler(request('settlement-sim-review',{},'GET','&orderId='+O),res);assert.equal(res.statusCode,200);assert.equal(res.body.liveReady,false);assert.equal(res.body.releaseEnabled,false);assert.equal(res.body.attempts[0].amountCents,2000);
 for(const value of ['acct_private','tr_private','privateAddress','evidence','bank'])assert.equal(JSON.stringify(res.body).includes(value),false);
 assert.deepEqual(x.calls,[{method:'review',input:{authorization:'Bearer operator',orderId:O}}]);for(const key of ['Cache-Control','CDN-Cache-Control','Vercel-CDN-Cache-Control'])assert.match(res.headers[key],/no-store/);
});
test('start and reconciliation send references only; transfer parent is absent and payout/recovery parent is required',async()=>{
 for(const kind of ['transfer','payout','reversal']){
  const x=setup({result:attempt({kind,availableCents:kind==='transfer'?2000:null,state:kind==='payout'?'pending':'succeeded'})}),res=response(),body={orderId:O,requestId:R,kind,...(kind==='transfer'?{}:{parentRequestId:P})};
  await x.handler(request('settlement-sim-start',body),res);assert.equal(res.statusCode,200);assert.deepEqual(x.calls[0],{method:'start',input:{authorization:'Bearer operator',...body}});
 }
 const x=setup(),res=response();await x.handler(request('settlement-sim-reconcile',{orderId:O,requestId:R}),res);assert.equal(res.statusCode,200);assert.deepEqual(x.calls[0],{method:'reconcile',input:{authorization:'Bearer operator',orderId:O,requestId:R}});
});
test('caller amounts, bank fields, provider evidence, actor selection and ambiguous queries are rejected',async()=>{
 const x=setup();
 for(const body of [null,[],{orderId:O,requestId:R,kind:'transfer',amountCents:1},{orderId:O,requestId:R,kind:'transfer',parentRequestId:P},
  {orderId:O,requestId:R,kind:'transfer',actor:P},{orderId:O,requestId:R,kind:'transfer',bankAccountId:'ba_private'},
  {orderId:O,requestId:R,kind:'payout'},{orderId:O,requestId:R,kind:'payout',parentRequestId:R},
  {orderId:O,requestId:R,kind:'reversal',parentRequestId:'bad'},{orderId:O,requestId:R,kind:'allow'}]){
  const res=response();await x.handler(request('settlement-sim-start',body),res);assert.equal(res.statusCode,400,JSON.stringify(body));
 }
 for(const [action,body,method,suffix]of [
  ['settlement-sim-review',{},'GET','&orderId='+O+'&orderId='+O],['settlement-sim-review',{},'GET','&orderId='+O+'&amountCents=1'],
  ['settlement-sim-review',{},'GET','&orderId=bad'],['settlement-sim-start',{},'POST','&orderId='+O],
  ['settlement-sim-reconcile',{orderId:O,requestId:R,providerId:'po_private'},'POST',''],
  ['settlement-sim-start',{},'POST','&action=settlement-sim-start'],['settlement-sim-release',{},'POST','']]){
  const res=response();await x.handler(request(action,body,method,suffix),res);assert.equal(res.statusCode,400);
 }
 assert.equal(x.calls.length,0);
});
test('bounded JSON and content type guards precede financial simulation services',async()=>{
 const x=setup();const big=response();await x.handler(request('settlement-sim-start',{orderId:O,requestId:R,kind:'transfer',padding:'x'.repeat(1024)}),big);assert.equal(big.statusCode,413);
 for(const type of ['text/plain',undefined,['application/json']]){const req=request('settlement-sim-start');req.headers['content-type']=type;const res=response();await x.handler(req,res);assert.equal(res.statusCode,415);}
 const malformed=response();await x.handler(request('settlement-sim-start','{'),malformed);assert.equal(malformed.statusCode,400);assert.equal(x.calls.length,0);
});
test('access denial, uncertain outcomes and private failures keep the request held with generic errors',async()=>{
 for(const [failure,status]of [[new OrderAccessDenied('private actor'),403],[new SettlementPending('private receipt'),409],[new Error('sk_test_private account bank details'),503]]){
  const x=setup({failure}),res=response();await x.handler(request('settlement-sim-start'),res);assert.equal(res.statusCode,status);assert.equal(JSON.stringify(res.body).includes('private'),false);if(status!==403)assert.match(res.body.error,/same request reference/);
 }
});
test('foreign, malformed or falsely ready service evidence never reaches a successful HTTP response',async()=>{
 for(const patch of [{test:false},{simulationOnly:false},{orderId:P},{requestId:P},{kind:'payout',state:'pending',availableCents:null},{releaseEnabled:true},{liveReady:true},{amountCents:'2000'},{state:'paid'},{availableCents:2001},{needsReview:true,recoveryRequired:false}]){
  const x=setup({result:attempt(patch)}),res=response();await x.handler(request('settlement-sim-start'),res);assert.equal(res.statusCode,503,JSON.stringify(patch));
 }
 for(const patch of [{test:false},{orderId:P},{liveReady:true},{blockers:['provider_unknown'],transferableCents:2000},{blockers:[''],transferableCents:null},{attempts:[attempt(),attempt()]},{attempts:[attempt({orderId:P})]}]){
  const x=setup({read:review(patch)}),res=response();await x.handler(request('settlement-sim-review',{},'GET','&orderId='+O),res);assert.equal(res.statusCode,503,JSON.stringify(patch));
 }
});
test('projection permits failed test payouts only as recovery-required and refuses impossible balances or states',()=>{
 const failed=attempt({kind:'payout',state:'failed',availableCents:null,recoveryRequired:true});assert.equal(publicSettlementAttempt(failed,O).recoveryRequired,true);
 assert.throws(()=>publicSettlementAttempt({...failed,recoveryRequired:false},O));assert.throws(()=>publicSettlementAttempt({...failed,state:'succeeded'},O));assert.throws(()=>publicSettlementAttempt({...failed,availableCents:0},O));
 const held=review({blockers:['seller_verification_required'],transferableCents:null,attempts:[failed]});assert.equal(publicSettlementReview(held,O).transferableCents,null);
});
