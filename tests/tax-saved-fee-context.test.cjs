'use strict';
// NEW source-only checks of actual modules through injected synthetic ports.
// Every key/token/actor/address below is fictional. No SQL or real transport.
const {test}=require('node:test'),assert=require('node:assert/strict'),{createHash}=require('node:crypto');
const A=require('../server/private-tax/tax_original_action_coordinator.cjs');
const Q=require('../server/private-tax/tax_explicit_shipping_quote_reader_v2.cjs');
const P=require('../server/private-tax/tax_private_transport.cjs');
const H=require('../server/private-tax/tax_hosted_bridge.cjs');
const TRANSPORTS=[require('../server/private-tax/tax_action_http_transport.cjs'),require('../server/private-practice/tax_action_http_transport.cjs')];
const {buyerFee}=require('../server/fee_policy.cjs');
const NOW=1795200000000,OWNER='11111111-1111-4111-8111-111111111111',BUYER='22222222-2222-4222-8222-222222222222';
const ORDER='33333333-3333-4333-8333-333333333333',REQUEST='44444444-4444-4444-8444-444444444444',QUOTE='55555555-5555-4555-8555-555555555555',ATTEMPT='66666666-6666-4666-8666-666666666666',SESSION='77777777-7777-4777-8777-777777777777',OTHER='88888888-8888-4888-8888-888888888888',LISTING='99999999-9999-4999-8999-999999999999';
const ACCOUNT='acct_1UXdWBGppSOhWnq8',DB='https://tzymapahsfiyhgilsmxl.supabase.co',CALC='taxcalc_FictionalFeeContext',TX='tax_FictionalFeeContext',TAX_CODE='txcd_30011000';
const ADDRESS={line1:'100 Synthetic Street',city:'Seattle',state:'WA',postal_code:'98109',country:'US'};
const canon=v=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?'['+v.map(canon).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canon(v[k])).join(',')+'}';
const hash=v=>createHash('sha256').update(typeof v==='string'?v:canon(v)).digest('hex'),clone=v=>JSON.parse(JSON.stringify(v));
const ref='rrTax_'+ORDER.replaceAll('-','');
const identity={ownerId:OWNER,actorId:OWNER,orderId:ORDER,requestId:REQUEST};
const args={p_owner:OWNER,p_actor:OWNER,p_order:ORDER,p_request:REQUEST};
function fixture(version='rr-fees-v3'){
 const amounts={itemCents:2500,buyerFeeCents:buyerFee(2500,version),shippingCents:500,taxCents:300};amounts.totalCents=Object.values(amounts).reduce((a,b)=>a+b,0);
 const components={item:{reference:ORDER+'_item',amountCents:2500,taxCents:250,taxCode:TAX_CODE},buyerFee:{reference:ORDER+'_buyer_fee',amountCents:amounts.buyerFeeCents,taxCents:30,taxCode:TAX_CODE},shipping:{amountCents:500,taxCents:20,taxCode:TAX_CODE}};
 const receipt={test:true,accountId:ACCOUNT,source:'verified_test_tax_receipt',transactionId:TX,parentTransactionId:null,reference:ref,currency:'USD',type:'transaction',...amounts,observedAt:NOW};
 const state={version:'rr-test-tax-original-action-state-v1',requestId:REQUEST,orderId:ORDER,ownerId:OWNER,cutoverAt:NOW-10000,orderCreatedAt:NOW-9000,calculationId:CALC,feePolicyVersion:version,amounts:clone(amounts),job:{state:'uncertain',attempts:1,providerReference:null},action:{requestId:REQUEST,reference:ref,createdAt:NOW-8000},refundRequestCount:0,observedAt:NOW};
 const booked={version:'rr-test-tax-booked-original-v1',requestId:REQUEST,orderId:ORDER,accountId:ACCOUNT,calculationId:CALC,transactionId:TX,reference:ref,requestBodySha256:hash({calculation:CALC,reference:ref}),components:clone(components),receipt:clone(receipt),bookedAt:NOW-100};
 const expected={feePolicyVersion:version,listingId:LISTING,listingUpdatedAt:'2026-11-01T00:00:00.000Z',listingVersion:1,destinationHash:hash(JSON.stringify(ADDRESS)),shippingRateId:'a'.repeat(32),item:{reference:ORDER+'_item',amountCents:2500,taxCode:TAX_CODE},buyerFee:{reference:ORDER+'_buyer_fee',amountCents:amounts.buyerFeeCents,taxCode:TAX_CODE},shipping:{amountCents:500,taxCode:TAX_CODE}};
 const context={version:'rr-test-tax-saved-quote-context-v1',requestId:REQUEST,orderId:ORDER,buyerId:BUYER,accountId:ACCOUNT,quoteId:QUOTE,attemptId:ATTEMPT,policyRevision:'1'.repeat(64),requestBodySha256:'2'.repeat(64),creationResponseSha256:'3'.repeat(64),calculationId:CALC,expected,capturedAt:new Date(NOW-2000).toISOString(),quoteExpiresAt:new Date(NOW+500000).toISOString(),savedTaxCents:300,savedTotalCents:amounts.totalCents};
 const detail={version:'rr-test-tax-quote-detail-v1',requestId:REQUEST,orderId:ORDER,accountId:ACCOUNT,calculationId:CALC,quoteRevision:'4'.repeat(64),components:clone(components)};
 return{version,amounts,components,receipt,state,booked,context,detail};
}
function savedBinding(f){return{version:'rr-test-tax-saved-binding-v1',requestId:REQUEST,orderId:ORDER,accountId:ACCOUNT,kind:'original',calculationId:CALC,originalDispatch:{version:'rr-test-tax-original-dispatch-v1',requestId:REQUEST,status:'known',transactionId:TX,calculationId:CALC,reference:ref,requestBodySha256:hash({calculation:CALC,reference:ref})},chain:[{kind:'original',requestId:REQUEST,transactionId:TX,reference:ref,parentTransactionId:null,parentLineItemIds:null,components:clone(f.components)}],policyHash:null,refund:null};}
function originalProjection({sendAllowed=false,status='known',transactionId=TX}={}){return{test:true,requestId:REQUEST,orderId:ORDER,accountId:ACCOUNT,attemptId:ATTEMPT,calculationId:CALC,reference:ref,requestBodySha256:hash({calculation:CALC,reference:ref}),status,transactionId,sendAllowed,releaseEnabled:false};}
function response(url,value,now=NOW,extra={}){const r=new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json','Cache-Control':'private, no-store, max-age=0','Date':new Date(now).toUTCString(),...extra}});Object.defineProperty(r,'url',{value:url});return r;}
function coordinator(f,{mutateState,booked=f.booked}={}){
 const calls=[],s=clone(f.state);mutateState?.(s);
 const c=A.createOriginalTaxActionCoordinator({enabled:true,environment:A.ENVIRONMENT,ownerId:OWNER,clock:()=>NOW,monotonicClock:()=>10,
  privateTransport:{authenticateOwner:async()=>OWNER,rpc:async()=>{calls.push('binding');return null;}},
  actionPorts:{inspect:async()=>{calls.push('inspect');return clone(s);},receipt:async()=>{calls.push('receipt');return clone(booked);},prepare:async()=>{throw Error('Unexpected preparation');},book:async()=>{throw Error('Unexpected booking');}}});
 return{c,calls,input:{authorization:'Bearer FICTIONAL_ONLY',orderId:ORDER,requestId:REQUEST}};
}
function quoteRig(f,{mutateContext,expired=false}={}){
 const calls=[],rpcCalls=[],context=clone(f.context);mutateContext?.(context);
 const calculation={id:CALC,object:'tax.calculation',livemode:false,currency:'usd',tax_amount_inclusive:0,tax_amount_exclusive:300,amount_total:f.amounts.totalCents,expires_at:Math.floor((expired?NOW-1000:NOW+500000)/1000),customer_details:{address_source:'shipping',address:ADDRESS},tax_breakdown:[{amount:300,inclusive:false,tax_rate_details:{country:'US'},taxability_reason:'standard_rated'}],shipping_cost:{amount:500,tax_code:TAX_CODE,tax_behavior:'exclusive',amount_tax:20}};
 const lines={object:'list',url:'/v1/tax/calculations/'+CALC+'/line_items',has_more:false,total_count:2,data:[['item',250],['buyerFee',30]].map(([k,tax])=>({id:'tax_li_Fictional'+k,object:'tax.calculation_line_item',livemode:false,reference:f.components[k].reference,amount:f.components[k].amountCents,tax_code:TAX_CODE,quantity:1,tax_behavior:'exclusive',amount_tax:tax}))};
 const reader=Q.createTaxExplicitShippingQuoteReaderV2({enabled:true,ownerId:OWNER,secretKey:'rk_test_FICTIONALONLY',clock:()=>NOW,monotonicClock:()=>10,
  rpc:async(name,a)=>{rpcCalls.push({name,args:clone(a)});if(name===Q.RPC.load)return clone(context);if(name===Q.RPC.store){assert.deepEqual(a.p_components,f.components);return clone(f.detail);}throw Error('Unexpected synthetic quote RPC');},
  fetchImpl:async(url,init)=>{calls.push({url,method:init.method});assert.equal(init.method,'GET');assert.equal(init.headers['Stripe-Version'],Q.VERSION);const p=new URL(url).pathname;
   if(p==='/v1/account')return response(url,{object:'account',id:ACCOUNT,livemode:false});
   if(p==='/v1/balance')return response(url,{object:'balance',livemode:false});
   if(p==='/v1/tax/calculations/'+CALC)return response(url,calculation);
   if(p==='/v1/tax/calculations/'+CALC+'/line_items')return response(url,lines);
   throw Error('Unexpected synthetic provider path');
  }});
 return{reader,calls,rpcCalls};
}
function partialCustody(){return{version:'rr-test-tax-line-custody-v1',actionId:REQUEST,orderId:ORDER,accountId:ACCOUNT,apiVersion:'2026-10-28.endive',kind:'refund_reversal',calculationId:CALC,transactionId:'tax_FictionalPartial',parentTransactionId:TX,reference:'FictionalPartial',components:{item:{reference:ORDER+'_item',amountCents:100,taxCents:3,taxCode:TAX_CODE},buyerFee:{reference:ORDER+'_buyer_fee',amountCents:7,taxCents:0,taxCode:TAX_CODE},shipping:{amountCents:0,taxCents:0,taxCode:TAX_CODE}},lineItemIds:{item:'tax_li_FictionalItem',buyerFee:'tax_li_FictionalFee'},lines:[],shipping:{},receipt:{},observedAt:NOW,bindingSha256:'5'.repeat(64),wireSha256:'6'.repeat(64),custodyHash:'7'.repeat(64)};}
function transportRig(M,f,{mutateState,mutateContext,contextNull=false,sessionMismatch=false,failBook=false,expireDuringContext=false,mutateEnvelope,mutateBooked}={}){
 let now=NOW,auths=0;const calls=[],operations=[],nonces=new Set(),savedState=clone(f.state),savedContext=clone(f.context),savedBooked=clone(f.booked);mutateState?.(savedState);mutateContext?.(savedContext);mutateBooked?.(savedBooked);
 const claims={iss:DB+'/auth/v1',sub:OWNER,aud:'authenticated',role:'authenticated',is_anonymous:false,session_id:SESSION,iat:Math.floor(NOW/1000)-1,exp:Math.floor(NOW/1000)+600};
 const authorization='Bearer fixture.'+Buffer.from(JSON.stringify(claims)).toString('base64url')+'.fixture';
 const transport=M.createTaxActionHttpTransport({enabled:true,environment:M.ENVIRONMENT,ownerId:OWNER,serverKey:'sb_secret_'+'FICTIONAL_'.repeat(4),getAuthorization:()=>authorization,stripeReadKey:'rk_test_FICTIONALONLY',fetchImpl:async(url,init)=>{
  calls.push({url,method:init.method});const u=new URL(url);
  if(u.origin!==DB)throw Error('Unexpected non-database synthetic transport');
  if(u.pathname==='/auth/v1/user'){assert.equal(init.method,'GET');assert.equal(init.headers.Authorization,authorization);return response(url,{id:OWNER,aud:'authenticated',role:'authenticated',is_anonymous:false},now);}
  if(u.pathname==='/rest/v1/rpc/'+M.RPC.session){const a=JSON.parse(init.body);auths++;assert.equal(a.p_owner,OWNER);assert.equal(a.p_actor,OWNER);assert.equal(a.p_session,SESSION);assert(!nonces.has(a.p_nonce));nonces.add(a.p_nonce);return response(url,{version:'rr-test-tax-owner-session-v1',ownerId:OWNER,sessionId:sessionMismatch&&auths===2?OTHER:SESSION,accepted:true,nonce:a.p_nonce,observedAt:now},now);}
  if(u.pathname==='/rest/v1/rpc/'+M.WIRE.dispatcher){const a=JSON.parse(init.body),op=a.p_operation;operations.push(op);assert.equal(a.p_owner,OWNER);assert.equal(a.p_actor,OWNER);assert.equal(a.p_session,SESSION);assert(!nonces.has(a.p_nonce));nonces.add(a.p_nonce);let result;
   if(op==='inspect')result=contextNull?null:clone(savedState);
   else if(op==='context')result=contextNull?null:clone(savedContext);
   else if(op==='receipt'||op==='book'){if(op==='book'){assert.deepEqual(Object.keys(a.p_arguments).sort(),['p_owner','p_actor','p_order','p_request','p_receipt'].sort());assert.deepEqual(a.p_arguments.p_receipt,f.receipt);if(failBook)throw Error('Synthetic dropped write acknowledgement');}result=clone(savedBooked);}
   else if(op==='evidence'){assert.deepEqual(a.p_arguments.p_components,f.components);result=clone(f.detail);}
   else if(op==='custody_load')result=partialCustody();
   else throw Error('Unexpected synthetic operation '+op);
   if(expireDuringContext&&(op==='inspect'||op==='context'))now+=5000;
   const envelope={version:'rr-test-tax-action-nonce-v1',ownerId:OWNER,orderId:ORDER,requestId:REQUEST,operation:op,nonce:a.p_nonce,observedAt:now,result};mutateEnvelope?.(envelope,op);return response(url,envelope,now);
  }
  throw Error('Unexpected synthetic database path');
 },clock:()=>now,monotonicClock:()=>now-NOW+10});
 const signal=new AbortController().signal;
 return{transport,calls,operations,signal,auths:()=>auths,book:()=>transport.actionPorts.book({...identity,receipt:clone(f.receipt)},signal),receipt:()=>transport.actionPorts.receipt(identity,signal),evidence:()=>transport.rpc(M.RPC.evidence,{...args,p_quote:QUOTE,p_components:clone(f.components),p_provider_read_sha:'8'.repeat(64),p_observed:NOW},signal)};
}

function privateRig(f,{mutateState,dropClaim=false,lateClaimAuth=false,invalidClaim=false,wrongClaimNonce=false,wrongClaimOperation=false}={}){
 let auths=0;const calls=[],operations=[],state=clone(f.state);state.job={state:'pending',attempts:0,providerReference:null};mutateState?.(state);
 const claims={iss:DB+'/auth/v1',sub:OWNER,aud:'authenticated',role:'authenticated',is_anonymous:false,session_id:SESSION,iat:Math.floor(NOW/1000)-1,exp:Math.floor(NOW/1000)+600},authorization='Bearer fixture.'+Buffer.from(JSON.stringify(claims)).toString('base64url')+'.fixture';
 const transport=P.createTaxPrivateTransport({enabled:true,environment:P.ENVIRONMENT,ownerId:OWNER,serverKey:'sb_secret_'+'FICTIONAL_'.repeat(4),getAuthorization:()=>authorization,clock:()=>NOW,monotonicClock:()=>10,fetchImpl:async(url,init)=>{
  calls.push({url,method:init.method});const u=new URL(url);if(u.origin!==DB)throw Error('Unexpected synthetic private origin');
  if(u.pathname==='/auth/v1/user')return response(url,{id:OWNER,aud:'authenticated',role:'authenticated',is_anonymous:false});
  const a=JSON.parse(init.body);
  if(u.pathname==='/rest/v1/rpc/'+P.RPC.session){auths++;return response(url,{version:'rr-test-tax-owner-session-v1',ownerId:OWNER,sessionId:lateClaimAuth&&auths===3?OTHER:SESSION,accepted:true,nonce:a.p_nonce,observedAt:NOW});}
  assert.equal(a.p_owner,OWNER);assert.equal(a.p_actor,OWNER);assert.equal(a.p_session,SESSION);
  if(u.pathname==='/rest/v1/rpc/rr_test_tax_action_nonce_dispatch'){assert.equal(a.p_operation,'inspect');assert.deepEqual(Object.keys(a.p_arguments).sort(),['p_owner','p_actor','p_order','p_request'].sort());operations.push('action:inspect');return response(url,{version:'rr-test-tax-action-nonce-v1',ownerId:OWNER,orderId:ORDER,requestId:REQUEST,operation:'inspect',nonce:a.p_nonce,observedAt:NOW,result:clone(state)});}
  if(u.pathname==='/rest/v1/rpc/'+P.WIRE.dispatcher){operations.push('original:'+a.p_operation);let result;
   if(a.p_operation==='load'){assert.deepEqual(Object.keys(a.p_arguments).sort(),['p_owner','p_actor','p_request'].sort());result=savedBinding(f);}
   else if(a.p_operation==='claim'){assert.deepEqual(Object.keys(a.p_arguments).sort(),['p_owner','p_actor','p_request','p_calculation','p_body_sha','p_components'].sort());assert.deepEqual(a.p_arguments.p_components,f.components);if(dropClaim)throw Error('Synthetic dropped claim ACK');result=originalProjection({sendAllowed:true,status:'unknown',transactionId:null});if(invalidClaim)result.requestBodySha256='f'.repeat(64);}
   else if(a.p_operation==='record'){assert.deepEqual(Object.keys(a.p_arguments).sort(),['p_owner','p_actor','p_request','p_attempt','p_calculation','p_body_sha','p_status','p_transaction','p_response_sha'].sort());result=originalProjection({status:a.p_arguments.p_status,transactionId:a.p_arguments.p_transaction});}
   else throw Error('Unexpected synthetic original operation');
   return response(url,{version:'rr-test-tax-original-nonce-v1',ownerId:OWNER,requestId:REQUEST,operation:wrongClaimOperation&&a.p_operation==='claim'?'load':a.p_operation,nonce:wrongClaimNonce&&a.p_operation==='claim'?'wrong':a.p_nonce,observedAt:NOW,result});
  }
  throw Error('Unexpected synthetic private path');
 }}),signal=new AbortController().signal,common={p_owner:OWNER,p_actor:OWNER,p_request:REQUEST};
 return{transport,calls,operations,signal,claim:()=>transport.rpc(P.RPC.claim,{...common,p_calculation:CALC,p_body_sha:hash({calculation:CALC,reference:ref}),p_components:clone(f.components)},signal),load:()=>transport.rpc(P.RPC.load,common,signal),inspect:()=>transport.rpc(P.RPC.inspect,{...common,p_order:ORDER},signal),repair:()=>{for(const k of Object.keys(state))delete state[k];Object.assign(state,clone(f.state));state.job={state:'pending',attempts:0,providerReference:null};},recordUnknown:()=>transport.rpc(P.RPC.record,{...common,p_attempt:ATTEMPT,p_calculation:CALC,p_body_sha:hash({calculation:CALC,reference:ref}),p_status:'unknown',p_transaction:null,p_response_sha:null},signal)};
}
function bridgeRig(f,{mutateState,unknown=false,agedReceipt=false}={}){
 const calls=[],state=clone(f.state);mutateState?.(state);let sends=0,quotes=0;
 const bridge=H.createTaxHostedBridge({enabled:true,environment:A.ENVIRONMENT,ownerId:OWNER,authenticateOwner:async()=>OWNER,clock:()=>NOW,monotonicClock:()=>10,
  rpc:async(name,a)=>{calls.push(name);assert.equal(a.p_owner,OWNER);assert.equal(a.p_actor,OWNER);assert.equal(a.p_request,REQUEST);
   if(name===H.RPC.inspect){assert.equal(a.p_order,ORDER);return clone(state);}
   if(name===H.RPC.load)return savedBinding(f);
   if(name===H.RPC.claim)return originalProjection({sendAllowed:!unknown,status:'unknown',transactionId:null});
   if(name===H.RPC.record)return originalProjection({status:a.p_status,transactionId:a.p_transaction});
   throw Error('Unexpected synthetic bridge operation');
  },loadTrustedQuoteDetail:async()=>{quotes++;return clone(f.detail);},sendOriginal:async command=>{sends++;assert.equal(command.body.calculation,CALC);assert.equal(command.body.reference,ref);return Object.freeze({fictionalOneUseResult:true});},
  acceptTrustedDispatchResult:async({command})=>({version:'rr-test-tax-original-result-v1',requestId:REQUEST,attemptId:ATTEMPT,accountId:ACCOUNT,calculationId:CALC,reference:ref,requestBodySha256:command.requestBodySha256,transactionId:TX,responseSha256:'a'.repeat(64)}),
  createReceiptVerifier:({loadSavedBinding})=>({ready:true,verify:async input=>{await loadSavedBinding(input);await loadSavedBinding(input);return{...clone(f.receipt),observedAt:agedReceipt?NOW-60001:NOW};},close(){}})
 });
 return{bridge,calls,sends:()=>sends,quotes:()=>quotes,input:{authorization:'Bearer FICTIONAL_ONLY',requestId:REQUEST,orderId:ORDER},readInput:{authorization:'Bearer FICTIONAL_ONLY',requestId:REQUEST}};
}

test('actual original coordinator preserves saved v2/v3 booked evidence and rejects absent, unknown or relabelled policy',async()=>{
 for(const version of ['rr-fees-v2','rr-fees-v3']){const f=fixture(version),r=coordinator(f);try{assert.equal(r.c.ready,true);assert.deepEqual(await r.c.loadBookedOriginal(r.input),f.booked);const s=await r.c.reconcileOriginal(r.input);assert.equal(s.status,'booked');assert.equal(s.releaseEnabled,false);assert.equal(s.closeGlobalClaim,false);}finally{r.c.close();}}
 for(const change of [s=>{delete s.feePolicyVersion;},s=>{s.feePolicyVersion='unknown';},s=>{s.feePolicyVersion='rr-fees-v2';},s=>{s.orderId=OTHER;},s=>{s.observedAt=NOW-5001;},s=>{s.amounts.totalCents=20001;}]){const r=coordinator(fixture(),{mutateState:change});try{await assert.rejects(r.c.loadBookedOriginal(r.input));assert(!r.calls.includes('receipt'));}finally{r.c.close();}}
});

test('actual explicit quote reader accepts authoritative v2/v3 context and rejects policy swaps before synthetic provider reads',async()=>{
 for(const version of ['rr-fees-v2','rr-fees-v3']){const f=fixture(version),r=quoteRig(f);try{assert.deepEqual(await r.reader.loadTrustedQuoteDetail(identity),f.detail);assert.equal(r.rpcCalls.filter(x=>x.name===Q.RPC.store).length,1);assert(r.calls.every(x=>x.method==='GET'));assert.equal(r.rpcCalls[0].args.p_order,ORDER);assert(!Object.hasOwn(r.rpcCalls.at(-1).args.p_components,'feePolicyVersion'));}finally{r.reader.close();}}
 for(const change of [c=>{delete c.expected.feePolicyVersion;},c=>{c.expected.feePolicyVersion='unknown';},c=>{c.expected.feePolicyVersion='rr-fees-v2';},c=>{c.orderId=OTHER;}]){const r=quoteRig(fixture(),{mutateContext:change});try{await assert.rejects(r.reader.loadTrustedQuoteDetail(identity));assert.equal(r.calls.length,0);assert.equal(r.rpcCalls.length,1);}finally{r.reader.close();}}
 const expired=quoteRig(fixture(),{expired:true});try{await assert.rejects(expired.reader.loadTrustedQuoteDetail(identity));assert.equal(expired.rpcCalls.some(c=>c.name===Q.RPC.store),false);}finally{expired.reader.close();}
});

test('both actual transport mirrors fresh-bind original book and receipt to saved v2/v3 amounts without wire changes',async()=>{
 for(const M of TRANSPORTS)for(const version of ['rr-fees-v2','rr-fees-v3']){const f=fixture(version),r=transportRig(M,f);try{assert.equal(r.transport.ready,true);assert.deepEqual(await r.book(),f.booked);assert.deepEqual(r.operations,['inspect','book']);assert.equal(r.auths(),3);assert.deepEqual(await r.receipt(),f.booked);assert.deepEqual(r.operations,['inspect','book','inspect','receipt']);assert.equal(r.auths(),6);assert(!Object.hasOwn(f.receipt,'feePolicyVersion'));assert(!Object.hasOwn(f.components,'feePolicyVersion'));}finally{r.transport.close();}}
});

test('both transports bind quote evidence to fresh saved context and reject missing, unknown or swapped fee authority',async()=>{
 for(const M of TRANSPORTS)for(const version of ['rr-fees-v2','rr-fees-v3']){const f=fixture(version),r=transportRig(M,f);try{assert.deepEqual(await r.evidence(),f.detail);assert.deepEqual(r.operations,['context','evidence']);assert.equal(r.auths(),3);}finally{r.transport.close();}}
 for(const M of TRANSPORTS)for(const options of [{contextNull:true},{mutateContext:c=>{delete c.expected.feePolicyVersion;}},{mutateContext:c=>{c.expected.feePolicyVersion='unknown';}},{mutateContext:c=>{c.expected.feePolicyVersion='rr-fees-v2';}},{mutateContext:c=>{c.requestId=OTHER;}}]){const r=transportRig(M,fixture(),options);try{await assert.rejects(r.evidence());assert.equal(r.operations.includes('evidence'),false);}finally{r.transport.close();}}
});

test('both transports reject absent or conflicting original context, cross-order/request/session and stale observations',async()=>{
 for(const M of TRANSPORTS)for(const options of [{contextNull:true},{mutateState:s=>{delete s.feePolicyVersion;}},{mutateState:s=>{s.feePolicyVersion='unknown';}},{mutateState:s=>{s.feePolicyVersion='rr-fees-v2';}},{mutateState:s=>{s.orderId=OTHER;}},{mutateState:s=>{s.requestId=OTHER;}},{mutateState:s=>{s.ownerId=OTHER;}},{mutateState:s=>{s.observedAt=NOW-5001;}},{sessionMismatch:true},{mutateEnvelope:(e,op)=>{if(op==='inspect')e.orderId=OTHER;}}]){const r=transportRig(M,fixture(),options);try{await assert.rejects(r.book());assert.equal(r.operations.includes('book'),false);}finally{r.transport.close();}}
 for(const M of TRANSPORTS){const r=transportRig(M,fixture(),{mutateBooked:b=>{b.components.buyerFee.amountCents-=50;b.receipt.buyerFeeCents-=50;b.receipt.totalCents-=50;}});try{await assert.rejects(r.receipt());assert.deepEqual(r.operations,['inspect','receipt']);}finally{r.transport.close();}}
});

test('same five-second transport budget holds before dispatch and dropped booking acknowledgements remain poisoned',async()=>{
 for(const M of TRANSPORTS){const late=transportRig(M,fixture(),{expireDuringContext:true});try{await assert.rejects(late.book());assert.equal(late.operations.includes('book'),false);}finally{late.transport.close();}
  const lost=transportRig(M,fixture(),{failBook:true});try{await assert.rejects(lost.book());assert.deepEqual(lost.operations,['inspect','book']);const count=lost.calls.length;await assert.rejects(lost.book());assert.equal(lost.calls.length,count);assert.equal(lost.operations.filter(x=>x==='book').length,1);}finally{lost.transport.close();}
 }
});

test('partial custody components are not reinterpreted as a full buyer fee and default transport stays off',async()=>{
 for(const M of TRANSPORTS){const r=transportRig(M,fixture());try{const partial=await r.transport.custody.load(identity,r.signal);assert.equal(partial.components.buyerFee.amountCents,7);assert.deepEqual(r.operations,['custody_load']);}finally{r.transport.close();}const closed=M.createTaxActionHttpTransport();assert.equal(closed.ready,false);assert.equal(closed.rpcReady,false);}
});

test('missing fields, self-supplied fee context and altered receipt wire schemas never create authority',async()=>{
 for(const M of TRANSPORTS){const r=transportRig(M,fixture());try{await assert.rejects(r.transport.rpc(M.RPC.book,{...args,p_receipt:{...fixture().receipt,feePolicyVersion:'rr-fees-v3'}},r.signal));assert.equal(r.operations.includes('book'),false);await assert.rejects(r.transport.rpc(M.RPC.book,{...args,p_receipt:fixture().receipt,feeContext:{feePolicyVersion:'rr-fees-v3'}},r.signal));assert.equal(r.operations.includes('book'),false);}finally{r.transport.close();}}
});

test('actual private original transport fresh-binds v2/v3 claim, load and explicit read-only inspect with original wire shapes',async()=>{
 for(const version of ['rr-fees-v2','rr-fees-v3']){const f=fixture(version),r=privateRig(f);try{assert.equal(r.transport.ready,true);const claimed=await r.claim();assert.equal(claimed.sendAllowed,true);assert.deepEqual(r.operations,['action:inspect','original:claim']);const grantCalls=r.calls.length;await assert.rejects(r.claim());assert.equal(r.calls.length,grantCalls);await r.inspect();const afterRead=r.calls.length;await assert.rejects(r.claim());assert.equal(r.calls.length,afterRead);assert.deepEqual(await r.load(),savedBinding(f));assert.deepEqual(r.operations.slice(-2),['original:load','action:inspect']);}finally{r.transport.close();}}
 const record=privateRig(fixture());try{assert.equal((await record.recordUnknown()).status,'unknown');assert.deepEqual(record.operations,['original:record']);}finally{record.transport.close();}
});

test('private original pre-context failures allow a corrected unsent claim, but target ACK/auth/output/nonce failures stay poisoned across inspect',async()=>{
 for(const change of [s=>{s.feePolicyVersion='unknown';},s=>{delete s.feePolicyVersion;},s=>{s.feePolicyVersion='rr-fees-v2';},s=>{s.orderId=OTHER;},s=>{s.requestId=OTHER;},s=>{s.ownerId=OTHER;},s=>{s.calculationId='taxcalc_FictionalOther';},s=>{s.action=null;},s=>{s.observedAt=NOW-5001;}]){const r=privateRig(fixture(),{mutateState:change});try{await assert.rejects(r.claim());assert.equal(r.operations.includes('original:claim'),false);r.repair();assert.equal((await r.claim()).sendAllowed,true);assert.equal(r.operations.filter(x=>x==='original:claim').length,1);}finally{r.transport.close();}}
 for(const options of [{dropClaim:true},{lateClaimAuth:true},{invalidClaim:true},{wrongClaimNonce:true},{wrongClaimOperation:true}]){const r=privateRig(fixture(),options);try{await assert.rejects(r.claim());assert.equal(r.operations.filter(x=>x==='original:claim').length,1);await r.inspect();const count=r.calls.length;await assert.rejects(r.claim());assert.equal(r.calls.length,count);assert.equal(r.operations.filter(x=>x==='original:claim').length,1);}finally{r.transport.close();}}
 const closed=P.createTaxPrivateTransport();assert.equal(closed.ready,false);assert.equal(closed.rpcReady,false);
});

test('actual bridge uses saved inspect for v2/v3 quote and binding, preserves UNKNOWN and never loads quote evidence for aged bound originals',async()=>{
 for(const version of ['rr-fees-v2','rr-fees-v3']){const f=fixture(version),r=bridgeRig(f);try{const sent=await r.bridge.dispatchOriginal(r.input);assert.equal(sent.status,'known');assert.equal(sent.releaseEnabled,false);assert.equal(r.sends(),1);assert.equal(r.calls.filter(n=>n===H.RPC.inspect).length,2);const beforeQuotes=r.quotes();assert.deepEqual(await r.bridge.loadOriginalBinding(r.readInput),savedBinding(f));assert.equal(r.quotes(),beforeQuotes);assert.deepEqual(await r.bridge.verifyOriginal(r.readInput),f.receipt);assert.equal(r.quotes(),beforeQuotes);}finally{r.bridge.close();}}
 const unknown=bridgeRig(fixture(),{unknown:true});try{assert.equal((await unknown.bridge.dispatchOriginal(unknown.input)).status,'unknown');assert.equal(unknown.sends(),0);}finally{unknown.bridge.close();}
 const aged=bridgeRig(fixture(),{agedReceipt:true});try{assert.deepEqual(await aged.bridge.loadOriginalBinding(aged.readInput),savedBinding(fixture()));assert.equal(aged.quotes(),0);await assert.rejects(aged.bridge.verifyOriginal(aged.readInput));assert.equal(aged.quotes(),0);}finally{aged.bridge.close();}
});

test('bridge and transport receipt reads preserve historical booked/held/done states after refunds, while context conflicts still hold',async()=>{
 for(const version of ['rr-fees-v2','rr-fees-v3'])for(const jobState of ['held','done']){const f=fixture(version);f.state.cutoverAt=NOW-3*86400000;f.state.orderCreatedAt=NOW-2*86400000;f.state.action.createdAt=f.state.orderCreatedAt+1000;f.booked.bookedAt=NOW-86400000;f.receipt.observedAt=f.booked.bookedAt;f.booked.receipt.observedAt=f.booked.bookedAt;f.context.capturedAt=new Date(NOW-2*86400000).toISOString();f.context.quoteExpiresAt=new Date(NOW-2*86400000+500000).toISOString();const change=s=>{s.refundRequestCount=2;s.job={state:jobState,attempts:1,providerReference:TX};};
  const bridge=bridgeRig(f,{mutateState:change});try{assert.deepEqual(await bridge.bridge.loadOriginalBinding(bridge.readInput),savedBinding(f));assert.equal(bridge.quotes(),0);}finally{bridge.bridge.close();}
  const original=privateRig(f,{mutateState:change});try{assert.deepEqual(await original.load(),savedBinding(f));assert.deepEqual(original.operations,['original:load','action:inspect']);}finally{original.transport.close();}
  for(const M of TRANSPORTS){const r=transportRig(M,f,{mutateState:change});try{assert.deepEqual(await r.receipt(),f.booked);assert.deepEqual(r.operations,['inspect','receipt']);}finally{r.transport.close();}}
 }
 for(const change of [s=>{s.feePolicyVersion='rr-fees-v2';},s=>{s.calculationId='taxcalc_FictionalOther';},s=>{s.ownerId=OTHER;},s=>{s.requestId=OTHER;},s=>{s.action.reference='rrTax_wrong';},s=>{s.amounts.shippingCents++;s.amounts.totalCents++;}]){const r=bridgeRig(fixture(),{mutateState:change});try{await assert.rejects(r.bridge.dispatchOriginal(r.input));assert.equal(r.sends(),0);assert.equal(r.calls.some(n=>n===H.RPC.claim),false);await assert.rejects(r.bridge.loadOriginalBinding(r.readInput));}finally{r.bridge.close();}}
});

test('both action transports reject a different valid calculation on evidence output and retain its attempted-write hold',async()=>{
 for(const M of TRANSPORTS){const r=transportRig(M,fixture(),{mutateEnvelope:(e,op)=>{if(op==='evidence')e.result.calculationId='taxcalc_FictionalOther';}});try{await assert.rejects(r.evidence());assert.deepEqual(r.operations,['context','evidence']);const count=r.calls.length;await assert.rejects(r.evidence());assert.equal(r.calls.length,count);assert.equal(r.operations.filter(x=>x==='evidence').length,1);}finally{r.transport.close();}}
});

test('each original amount stays bound and different outer/inner booking transactions remain poisoned after an inspect read',async()=>{
 for(const M of TRANSPORTS)for(const key of ['itemCents','buyerFeeCents','shippingCents','taxCents','totalCents']){const r=transportRig(M,fixture(),{mutateState:s=>{s.amounts[key]++;if(key!=='totalCents')s.amounts.totalCents++;}});try{await assert.rejects(r.book());assert.equal(r.operations.includes('book'),false);}finally{r.transport.close();}}
 for(const M of TRANSPORTS){const r=transportRig(M,fixture(),{mutateBooked:b=>{b.transactionId='tax_FictionalOther';}});try{await assert.rejects(r.book());assert.deepEqual(r.operations,['inspect','book']);await r.transport.rpc(M.RPC.inspect,args,r.signal);const count=r.calls.length;await assert.rejects(r.book());assert.equal(r.calls.length,count);assert.equal(r.operations.filter(x=>x==='book').length,1);}finally{r.transport.close();}}
});

// Appended focused groups: actual saved-policy quote producer/calculation transport.
function calculationFixture(version='rr-fees-v3'){
 const P=require('../server/private-tax/quote_calculation_transport.cjs'),C=require('../server/private-tax/tax_quote_create.cjs'),T=require('../server/private-tax/quote_buyer_transport.cjs');
 const fee=buyerFee(2500,version),expiry=NOW+500000,shipping={rateId:'a'.repeat(32),amountCents:500,destinationHash:createHash('sha256').update(JSON.stringify(ADDRESS)).digest('hex'),expiresAt:expiry};
 const reservation={orderId:ORDER,buyerId:BUYER,sellerId:OWNER,listingId:LISTING,listingUpdatedAt:'2026-11-08T00:00:00.000Z',listingVersion:1,feePolicyVersion:version,itemCents:2500,buyerFeeCents:fee};
 const policy={version:'rr-test-tax-policy-context-v1',orderId:ORDER,buyerId:BUYER,policyRevision:'b'.repeat(64),listingId:LISTING,listingUpdatedAt:reservation.listingUpdatedAt,listingVersion:1,feePolicyVersion:version,itemCents:2500,buyerFeeCents:fee,itemTaxCode:TAX_CODE,buyerFeeTaxCode:TAX_CODE,shippingTaxCode:TAX_CODE,shippingMode:'explicit_code'};
 const expected={feePolicyVersion:version,listingId:LISTING,listingUpdatedAt:reservation.listingUpdatedAt,listingVersion:1,destinationHash:shipping.destinationHash,shippingRateId:shipping.rateId,item:{reference:ORDER+'_item',amountCents:2500,taxCode:TAX_CODE},buyerFee:{reference:ORDER+'_buyer_fee',amountCents:fee,taxCode:TAX_CODE},shipping:{amountCents:500,taxCode:TAX_CODE}};
 const body={currency:'usd',customer_details:{address:ADDRESS,address_source:'shipping'},ship_from_details:{address:ADDRESS},line_items:[{amount:2500,quantity:1,reference:ORDER+'_item',tax_code:TAX_CODE,tax_behavior:'exclusive'},{amount:fee,quantity:1,reference:ORDER+'_buyer_fee',tax_code:TAX_CODE,tax_behavior:'exclusive'}],shipping_cost:{amount:500,tax_code:TAX_CODE,tax_behavior:'exclusive'},expand:['line_items']};
 const command={version:'rr-test-tax-calculation-command-v3',feePolicyVersion:version,quoteId:QUOTE,orderId:ORDER,buyerId:BUYER,attemptId:ATTEMPT,requestBodySha256:P.hash(body),notAfter:expiry,body};
 const calls=[],posts=[];let capture=null,result=null;
 const response=(url,value)=>{const r=new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json','Cache-Control':'private, no-store, max-age=0',Date:new Date(NOW).toUTCString()}});Object.defineProperty(r,'url',{value:url});return r;};
 const inspect=()=>capture===null?null:{version:'rr-test-tax-quote-inspection-v1',quoteId:QUOTE,orderId:ORDER,buyerId:BUYER,attemptId:ATTEMPT,policyRevision:policy.policyRevision,requestBodySha256:command.requestBodySha256,expected,capturedAt:new Date(NOW).toISOString(),expiresAt:new Date(expiry).toISOString(),resultRecorded:result!==null,status:result?.p_status??'unknown',calculationId:result?.p_calculation??null,responseSha256:result?.p_response_sha??null,sendAllowed:false,checkoutEnabled:false,releaseEnabled:false};
 const fetchImpl=async(url,init)=>{calls.push({url,method:init.method});const u=new URL(url);
  if(url===DB+'/auth/v1/user')return response(url,{id:BUYER,aud:'authenticated',role:'authenticated',is_anonymous:false});
  if(url===DB+'/rest/v1/rpc/'+T.DISPATCH){const a=JSON.parse(init.body);let value;
   if(a.p_operation==='inspect')value=inspect();
   else if(a.p_operation==='policy')value={version:'rr-test-tax-quote-policy-v2',policy,reservation};
   else if(a.p_operation==='capture'){assert.equal(a.p_arguments.p_body_sha,command.requestBodySha256);capture={version:'rr-test-tax-quote-capture-v1',quoteId:QUOTE,orderId:ORDER,buyerId:BUYER,attemptId:ATTEMPT,policyRevision:policy.policyRevision,requestBodySha256:command.requestBodySha256,expected,capturedAt:new Date(NOW).toISOString(),expiresAt:new Date(expiry).toISOString(),sendAllowed:true,releaseEnabled:false};value=capture;}
   else if(a.p_operation==='record'){result=a.p_arguments;value={version:'rr-test-tax-quote-result-v1',quoteId:QUOTE,attemptId:ATTEMPT,requestBodySha256:command.requestBodySha256,status:a.p_arguments.p_status,calculationId:a.p_arguments.p_calculation,responseSha256:a.p_arguments.p_response_sha,sendAllowed:false};}
   else throw Error('Unexpected synthetic quote operation');
   return response(url,{version:'rr-test-tax-quote-nonce-v1',buyerId:BUYER,orderId:ORDER,quoteId:QUOTE,operation:a.p_operation,nonce:a.p_nonce,observedAt:NOW,result:value,checkoutEnabled:false,releaseEnabled:false});
  }
  if(u.origin==='https://api.stripe.com'){
   if(u.pathname==='/v1/account')return response(url,{object:'account',id:ACCOUNT});
   if(u.pathname==='/v1/balance')return response(url,{object:'balance',livemode:false});
   if(u.pathname==='/v1/tax/settings')return response(url,{object:'tax.settings',livemode:false,status:'active',head_office:{address:ADDRESS}});
   if(u.pathname==='/v1/tax/registrations')return response(url,{object:'list',has_more:false,data:[{object:'tax.registration',livemode:false,status:'active',active_from:Math.floor(NOW/1000)-1,country:'US',country_options:{us:{type:'state_sales_tax',state:'WA'}}}]});
   if(u.pathname==='/v1/tax/calculations'&&init.method==='POST'){const f=new URLSearchParams(init.body);posts.push(f);assert.equal([...f.keys()].some(k=>/feePolicyVersion|command/.test(k)),false);assert.equal(f.get('line_items[1][amount]'),String(fee));assert.equal(init.headers['Idempotency-Key'],'rr-tax-quote-v1_'+QUOTE);return response(url,{object:'tax.calculation',id:CALC,livemode:false,currency:'usd',expires_at:Math.floor((NOW+300000)/1000),tax_amount_inclusive:0,tax_amount_exclusive:0,amount_total:3000+fee,line_items:{object:'list',has_more:false,data:[0,1].map(i=>({object:'tax.calculation_line_item',id:'tax_li_Fictional'+i,livemode:false,reference:body.line_items[i].reference,amount:body.line_items[i].amount,tax_code:TAX_CODE,quantity:1,tax_behavior:'exclusive',amount_tax:0}))},shipping_cost:{amount:500,tax_code:TAX_CODE,tax_behavior:'exclusive',amount_tax:0},tax_breakdown:[{amount:0,inclusive:false,tax_rate_details:{country:'US'},taxability_reason:'standard_rated'}]});}
  }
  throw Error('Unexpected synthetic quote request');
 };
 const claims={iss:DB+'/auth/v1',sub:BUYER,aud:'authenticated',role:'authenticated',is_anonymous:false,session_id:SESSION,iat:Math.floor(NOW/1000)-1,exp:Math.floor(NOW/1000)+1000},authorization='Bearer fixture.'+Buffer.from(JSON.stringify(claims)).toString('base64url')+'.fixture';
 return{P,C,T,command,calls,posts,fetchImpl,authorization,loadFulfillment:async()=>({version:'rr-private-tax-fulfillment-v1',listingId:LISTING,listingUpdatedAt:reservation.listingUpdatedAt,listingVersion:1,sellerId:OWNER,revisionSha256:'c'.repeat(64),origin:ADDRESS,shipping})};
}
test('actual quote producer carries authenticated capture policy into command-v3 without provider-wire changes',async()=>{
 for(const version of ['rr-fees-v2','rr-fees-v3']){const f=calculationFixture(version),q=f.C.createTaxQuoteCreationCoordinator({enabled:true,environment:f.T.ENVIRONMENT,serverKey:'sb_secret_'+'FICTIONAL_'.repeat(4),stripeSecretKey:'rk_test_FICTIONALONLY',fetchImpl:f.fetchImpl,clock:()=>NOW,monotonicClock:()=>10,loadFulfillment:f.loadFulfillment});try{assert(q.ready);const r=await q.createQuote({authorization:f.authorization,orderId:ORDER,quoteId:QUOTE,to:ADDRESS},new AbortController().signal);assert.equal(r.status,'known');assert.equal(r.totalCents,3000+buyerFee(2500,version));assert.equal(r.checkoutEnabled,false);assert.equal(r.releaseEnabled,false);assert.equal(f.posts.length,1);assert.equal(Object.hasOwn(r,'feePolicyVersion'),false);}finally{q.close();}}
});
test('calculation command-v3 rejects absent/relabelled policy before I/O and binds one-use custody to whole command',async()=>{
 const changes=[c=>{delete c.feePolicyVersion;},c=>{c.version='rr-test-tax-calculation-command-v2';delete c.feePolicyVersion;},c=>{c.feePolicyVersion='unknown';},c=>{c.feePolicyVersion='rr-fees-v2';},c=>{c.requestBodySha256='d'.repeat(64);},c=>{c.notAfter=NOW;}];
 for(const change of changes){const f=calculationFixture(),p=f.P.createQuoteCalculationTransport({enabled:true,secretKey:'rk_test_FICTIONALONLY',fetchImpl:f.fetchImpl,clock:()=>NOW,monotonicClock:()=>10});try{const c=structuredClone(f.command);change(c);await assert.rejects(p.sendCalculation(c,new AbortController().signal));assert.equal(f.calls.length,0);}finally{p.close();}}
 for(const version of ['rr-fees-v2','rr-fees-v3']){const f=calculationFixture(version),p=f.P.createQuoteCalculationTransport({enabled:true,secretKey:'rk_test_FICTIONALONLY',fetchImpl:f.fetchImpl,clock:()=>NOW,monotonicClock:()=>10});try{const signal=new AbortController().signal,token=await p.sendCalculation(f.command,signal),c=structuredClone(f.command);c.feePolicyVersion=version==='rr-fees-v2'?'rr-fees-v3':'rr-fees-v2';c.body.line_items[1].amount=buyerFee(c.body.line_items[0].amount,c.feePolicyVersion);c.requestBodySha256=f.P.hash(c.body);await assert.rejects(async()=>p.acceptCalculation(c,token,signal));assert.equal(p.acceptCalculation(f.command,token,signal),null);assert.equal(f.posts.length,1);assert.equal(Object.hasOwn(f.command.body,'feePolicyVersion'),false);}finally{p.close();}}
});
