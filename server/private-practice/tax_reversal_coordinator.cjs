'use strict';
// SOURCE ONLY. No runtime import, constructor I/O or financial refund dispatch.
const U=require('../private-tax/quote_buyer_transport.cjs');
const P=require('../private-tax/tax_reversal_provider.cjs');
const ENV=Object.freeze({kind:'preview',projectRef:'tzymapahsfiyhgilsmxl',branch:'codex/prelaunch-seller-protections',accountId:P.ACCOUNT});
const hold=()=>{throw new P.TaxReversalHeld();},millis=v=>{const n=Date.parse(v);if(!Number.isSafeInteger(n)||n<1)hold();return n;};
function expiry(auth){try{const c=U.plain(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.from(auth.slice(7).split('.')[1],'base64url'))));if(!Number.isSafeInteger(c.exp)||!Number.isSafeInteger(c.exp*1000)||c.exp<1)hold();return c.exp*1000;}catch{hold();}}
const STATE=['version','requestId','orderId','refundId','kind','policyHash','attemptId','bodySha256','body','components','parentLineItemIds','recordBefore','status','transactionId','resultRecorded','sendAllowed','receipt','bookedAt','refund','releaseEnabled','checkoutEnabled','refundDispatchEnabled'];
function receipt(raw,s,now,fresh=false){const r=U.exact(U.plain(raw),['test','accountId','source','transactionId','parentTransactionId','reference','currency','type','itemCents','buyerFeeCents','shippingCents','taxCents','totalCents','observedAt']),c=s.components,sign=s.kind==='refund_reversal'?-1:1,tax=c.item.taxCents+c.buyerFee.taxCents+c.shipping.taxCents;if(r.test!==true||r.accountId!==P.ACCOUNT||r.source!=='verified_test_tax_receipt'||r.transactionId!==s.transactionId||r.parentTransactionId!==s.body.original_transaction||r.reference!==s.body.reference||r.currency!=='USD'||r.type!=='reversal'||r.itemCents!==sign*c.item.amountCents||r.buyerFeeCents!==sign*c.buyerFee.amountCents||r.shippingCents!==sign*c.shipping.amountCents||r.taxCents!==sign*tax||r.totalCents!==r.itemCents+r.buyerFeeCents+r.shippingCents+r.taxCents||!Number.isSafeInteger(r.observedAt)||fresh&&(r.observedAt<now-60000||r.observedAt>now+30000))hold();return U.freeze(r);}
function state(raw,request,now){if(raw===null)return null;const s=U.exact(U.plain(raw),STATE);if(s.version!=='rr-test-tax-reversal-state-v1'||s.requestId!==request||!/^re_[A-Za-z0-9]{1,100}$/.test(s.refundId||'')||!['refund_reversal','refund_undo'].includes(s.kind)||!['known','unknown'].includes(s.status)||typeof s.resultRecorded!=='boolean'||typeof s.sendAllowed!=='boolean'||s.releaseEnabled!==false||s.checkoutEnabled!==false||s.refundDispatchEnabled!==false)hold();for(const k of ['requestId','orderId','attemptId'])U.id(s[k]);U.sha(s.policyHash);U.sha(s.bodySha256);P.command({version:'rr-test-tax-reversal-command-v1',requestId:s.requestId,orderId:s.orderId,refundId:s.refundId,kind:s.kind,attemptId:s.attemptId,bodySha256:s.bodySha256,notAfter:millis(s.recordBefore),body:s.body,components:s.components,parentLineItemIds:s.parentLineItemIds});const f=U.exact(s.refund,['id','status','needsReview','eventCreated']);if(f.id!==s.refundId||typeof f.needsReview!=='boolean'||!Number.isSafeInteger(f.eventCreated)||f.eventCreated<1)hold();if(s.status==='known'){if(!s.resultRecorded||!/^tax_[A-Za-z0-9]{1,100}$/.test(s.transactionId||'')||s.sendAllowed)hold();}else if(s.transactionId!==null)hold();if(s.receipt!==null){if(s.status!=='known'||!Number.isSafeInteger(s.bookedAt)||s.bookedAt>now+1000)hold();receipt(s.receipt,s,now);if(s.receipt.observedAt<s.bookedAt-60000||s.receipt.observedAt>s.bookedAt+30000)hold();}else if(s.bookedAt!==null)hold();return U.freeze(s);}
const summary=s=>Object.freeze({test:true,requestId:s.requestId,orderId:s.orderId,status:s.receipt?'booked':s.status==='known'?'known_unbooked':'unknown',transactionId:s.transactionId,holdRequired:true,releaseEnabled:false,checkoutEnabled:false,refundDispatchEnabled:false,closeGlobalClaim:false,taxAccountingAccepted:false});
function createTaxReversalCoordinator({enabled=false,environment=null,ownerId=null,authenticateOwner=null,ports=null,createProviderPair=null,createCustodyProducer=null,clock=Date.now,monotonicClock=()=>performance.now()}={}){
 if(enabled!==true||!environment||U.canonical(U.plain(environment))!==U.canonical(ENV)||typeof authenticateOwner!=='function'||!ports||!['claim','record','inspect','binding','book','custodyRecord','ancestry'].every(k=>typeof ports[k]==='function')||typeof clock!=='function'||typeof monotonicClock!=='function')return Object.freeze({ready:false});try{U.id(ownerId);}catch{return Object.freeze({ready:false});}
 let closed=false,busy=false,active=null;const runReady=typeof createProviderPair==='function'&&typeof createCustodyProducer==='function',writePoison=new Set();
 async function operation(raw,full,outer,fn){const i=U.exact(U.plain(raw),full?['authorization','orderId','requestId','refundId','kind','policyHash']:['authorization','orderId','requestId']);if(closed||busy||!(outer instanceof AbortSignal)||outer.aborted||typeof i.authorization!=='string'||!/^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(i.authorization))hold();U.id(i.requestId);U.id(i.orderId);if(full){U.sha(i.policyHash);if(!/^re_[A-Za-z0-9]{1,100}$/.test(i.refundId||'')||!['refund_reversal','refund_undo'].includes(i.kind))hold();}
  const wall=clock(),mono=monotonicClock();let lastW=wall,lastM=mono;if(!Number.isSafeInteger(wall)||wall<1||!Number.isFinite(mono)||mono<0)hold();busy=true;const root=new AbortController(),signal=AbortSignal.any([root.signal,outer]),timer=setTimeout(()=>root.abort(),30000);active=root;
  function check(){const w=clock(),m=monotonicClock();if(closed||signal.aborted||!Number.isSafeInteger(w)||!Number.isFinite(m)||w<lastW||m<lastM||w-wall>=30000||m-mono>=30000)hold();lastW=w;lastM=m;return w;}
  async function call(callback,limit=5000){check();const local=new AbortController(),s=AbortSignal.any([signal,local.signal]),timeout=setTimeout(()=>local.abort(),limit);let abort;try{return await Promise.race([Promise.resolve().then(()=>{check();return callback(s);}),new Promise((_,reject)=>{abort=()=>reject(new P.TaxReversalHeld());s.addEventListener('abort',abort,{once:true});if(s.aborted)abort();})]);}finally{clearTimeout(timeout);if(abort)s.removeEventListener('abort',abort);check();}}
  async function owner(){if(await call(s=>authenticateOwner({authorization:i.authorization},s))!==ownerId)hold();}
  const context=()=>({ownerId,actorId:ownerId,orderId:i.orderId,requestId:i.requestId});
  async function port(name,extra={}){await owner();const v=await call(s=>ports[name](U.freeze({...context(),...extra}),s));await owner();return v;}
  function readState(raw){
   const value=state(raw,i.requestId,check());
   if(value===null)return null;
   if(value.orderId!==i.orderId)hold();
   if(full&&(value.refundId!==i.refundId||value.kind!==i.kind||value.policyHash!==i.policyHash))hold();
   return value;
  }
  async function inspect(){
   const value=readState(await port('inspect'));
   if(value?.sendAllowed)hold();
   return value;
  }
  try{await owner();return await fn({i,check,call,owner,port,inspect,readState,signal});}catch{hold();}finally{clearTimeout(timer);root.abort();if(active===root)active=null;busy=false;}
 }
 return Object.freeze({ready:true,runReady,async run(input,signal){if(!runReady)hold();return operation(input,true,signal,async o=>{
  let s=await o.inspect();
  if(s?.receipt)return summary(s);
  if(s===null){
   if(writePoison.has(o.i.requestId))hold();
   writePoison.add(o.i.requestId);
   try{
    s=o.readState(await o.port('claim',{orderId:o.i.orderId,refundId:o.i.refundId,kind:o.i.kind,policyHash:o.i.policyHash}));
    if(!s||(s.sendAllowed&&s.resultRecorded))hold();
    writePoison.delete(o.i.requestId);
   }catch{
    const saved=await o.inspect();
    if(saved)return summary(saved);
    hold();
   }
  }
  if(s.sendAllowed){const initial=s;const refundReady=x=>{if(x.refund.needsReview||x.kind==='refund_reversal'&&x.refund.status!=='succeeded'||x.kind==='refund_undo'&&!['failed','canceled'].includes(x.refund.status)||x.refund.eventCreated<initial.refund.eventCreated)hold();};refundReady(s);await o.owner();const notAfter=Math.min(expiry(o.i.authorization),millis(s.recordBefore));if(o.check()>=notAfter)hold();const command=U.freeze({version:'rr-test-tax-reversal-command-v1',requestId:s.requestId,orderId:s.orderId,refundId:s.refundId,kind:s.kind,attemptId:s.attemptId,bodySha256:s.bodySha256,notAfter,body:s.body,components:s.components,parentLineItemIds:s.parentLineItemIds});let result=null,pair;
   try{pair=createProviderPair({beforePost:async({command:bound},signal)=>{if(signal.aborted||U.canonical(bound)!==U.canonical(command))hold();const fresh=await o.inspect();if(!fresh||fresh.attemptId!==initial.attemptId||fresh.bodySha256!==initial.bodySha256||fresh.policyHash!==initial.policyHash||fresh.kind!==initial.kind||fresh.refundId!==initial.refundId||fresh.status!=='unknown'||fresh.resultRecorded||fresh.receipt!==null)hold();refundReady(fresh);if(o.check()>=notAfter||expiry(o.i.authorization)<=o.check())hold();}});if(pair?.ready!==true||typeof pair.send!=='function'||typeof pair.accept!=='function'||typeof pair.close!=='function')hold();const token=await o.call(x=>pair.send(command,x));result=pair.accept(command,token,o.signal);if(!result||result.version!=='rr-test-tax-reversal-result-v1'||result.requestId!==s.requestId||result.attemptId!==s.attemptId||result.bodySha256!==s.bodySha256)hold();}catch{result=null;}finally{pair?.close?.();}
   if(writePoison.has(s.requestId))hold();writePoison.add(s.requestId);try{await o.port('record',{attemptId:s.attemptId,bodySha256:s.bodySha256,status:result?'known':'unknown',transactionId:result?.transactionId??null,responseSha256:result?.responseSha256??null});writePoison.delete(s.requestId);}catch{const saved=await o.inspect();if(saved)return summary(saved);hold();}s=await o.inspect();if(!s)hold();
  }
  if(s.status!=='known')return summary(s);if(s.receipt)return summary(s);if(writePoison.has(s.requestId))return summary(s);
  const producer=createCustodyProducer({loadSavedBinding:async({requestId},signal)=>{if(requestId!==s.requestId||signal.aborted)hold();return o.port('binding');},loadBookedAncestry:async({requestId},signal)=>{if(requestId!==s.requestId||signal.aborted)hold();return o.port('ancestry');},recordCustody:async(inventory,signal)=>{if(inventory?.actionId!==s.requestId||signal.aborted)hold();return o.port('custodyRecord',{inventory});}});if(producer?.ready!==true||typeof producer.capture!=='function'||typeof producer.persist!=='function'||typeof producer.close!=='function')hold();
  let observed;try{const token=await o.call(x=>producer.capture({requestId:s.requestId},x),20000),saved=await o.call(x=>producer.persist({requestId:s.requestId},token,x)),immutable=receipt(saved?.receipt,s,o.check());observed=receipt(saved?.freshObservationReceipt,s,o.check(),true);const prior={...immutable},fresh={...observed};delete prior.observedAt;delete fresh.observedAt;if(U.canonical(prior)!==U.canonical(fresh))hold();}finally{producer.close();}
  await o.owner();writePoison.add(s.requestId);try{await o.port('book',{receipt:observed});writePoison.delete(s.requestId);}catch{const saved=await o.inspect();if(saved)return summary(saved);hold();}const booked=await o.inspect();if(!booked||booked.receipt===null)hold();return summary(booked);
 });},async reconcile(input,signal){return operation(input,false,signal,async o=>{const s=await o.inspect();return s?summary(s):Object.freeze({test:true,requestId:o.i.requestId,status:'not_prepared',holdRequired:true,releaseEnabled:false,checkoutEnabled:false,refundDispatchEnabled:false,closeGlobalClaim:false,taxAccountingAccepted:false});});},close(){closed=true;active?.abort();}});
}
module.exports=Object.freeze({createTaxReversalCoordinator,ENVIRONMENT:ENV,TaxReversalHeld:P.TaxReversalHeld,PROFILE:Object.freeze({sourceOnly:true,defaultEnabled:false,installed:false,parentCustodyRequired:true,actualHostedAcceptance:false,financialRefundDispatch:false,automaticRetries:false,releaseEnabled:false})});
