'use strict';
// NEW focused contract checks only. Actual copied UI/orchestration interfaces;
// synthetic Auth/RPC/carrier responses and a lightweight DOM. No SQL or network.
// DOM mechanics are adapted from the existing private page-review DOM fixture;
// profile/response shapes follow the existing hosted-orchestration fixture.
const {test}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),{Readable}=require('node:stream');
const ROOT=path.resolve(__dirname,'..');
const UI=require(path.join(ROOT,'rack-payment-practice.js')),R=require(path.join(ROOT,'server/private-practice/payment_tax_hosted_orchestration.cjs'));
const fee=require(path.join(ROOT,'server/fee_policy.cjs')),{createSellerCostDisclosure}=require(path.join(ROOT,'server/seller_cost_allocation.cjs'));
const NOW=1795200000000,O='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222',L='73737373-7373-4373-8373-737373737373',ORDER='aaaa1111-aaaa-4aaa-8aaa-aaaaaaaaaaaa',QUOTE='bbbb2222-bbbb-4bbb-8bbb-bbbbbbbbbbbb',REQUEST='cccc3333-cccc-4ccc-8ccc-cccccccccccc',SESSION='dddd4444-dddd-4ddd-8ddd-dddddddddddd',ATTEMPT='eeee5555-eeee-4eee-8eee-eeeeeeeeeeee';
const FLAGS={test:true,liveCheckoutEnabled:false,releaseEnabled:false,refundDispatchEnabled:false,globalClaimEnabled:false};
const ORIGIN=R.ENVIRONMENT.origin,DB='https://tzymapahsfiyhgilsmxl.supabase.co';
const FROM={line1:'100 Synthetic St',city:'Seattle',state:'WA',postal_code:'98109',country:'US'},TO={line1:'200 Synthetic Ave',city:'Seattle',state:'WA',postal_code:'98101',country:'US'};
function profile(itemCents=2500){return{version:'rr-private-practice-profile-v1',ownerId:O,buyerId:B,listingId:L,orderId:ORDER,quoteId:QUOTE,requestId:REQUEST,policyRevision:'3'.repeat(64),title:'Synthetic practice item',itemCents,listingUpdatedAt:'2026-11-08T00:00:00.000Z',listingVersion:2,origin:FROM,destination:TO,shippingFrom:{name:'Fictional sender',street1:FROM.line1,city:FROM.city,state:FROM.state,zip:FROM.postal_code,country:'US'},shippingTo:{name:'Fictional receiver',street1:TO.line1,city:TO.city,state:TO.state,zip:TO.postal_code,country:'US'},parcel:{length:10,width:8,height:2,weight:1},carrier:'Fictional Carrier',service:'Fictional Ground',costPolicy:{maxTotalCents:Math.min(600,itemCents),costCaps:{processing:Math.min(200,itemCents),radar:Math.min(10,itemCents),connect_active_account:Math.min(200,itemCents),payout:Math.min(190,itemCents),insurance:0}},expiresAt:NOW+600000};}
function response(url,value,headers={}){const r=new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json','Cache-Control':'private, no-store, max-age=0',Date:new Date(NOW).toUTCString(),...headers}});Object.defineProperty(r,'url',{value:url});return r;}
function assertClosed(value){for(const[k,v]of Object.entries(FLAGS))assert.equal(value[k],v,k);}
function rig({module=R,itemCents=2500,savedVersion='rr-fees-v3',shippingCents=500,taxCents=0}={}){
 const p=profile(itemCents),calls=[],shippingRecords=[];
 const claims={iss:DB+'/auth/v1',sub:O,aud:'authenticated',role:'authenticated',is_anonymous:false,session_id:SESSION,iat:Math.floor(NOW/1000)-1,exp:Math.floor(NOW/1000)+500};
 const savedFee=fee.buyerFee(itemCents,savedVersion),order={test:true,orderId:ORDER,sellerId:O,currency:'USD',feePolicyVersion:savedVersion,itemCents,buyerFeeCents:savedFee,shippingCents,taxCents,totalCents:itemCents+savedFee+shippingCents+taxCents,settlementPeriod:'2026-11',payoutBatchId:REQUEST};
 const disclosure=createSellerCostDisclosure({order,...p.costPolicy,selectedInsurance:false,createdAt:NOW});
 const state={version:'rr-test-tax-practice-state-v1',orderState:'reserved',shippingAttempted:false,shippingStatus:null,quoteAttempted:false,quoteStatus:null,quoteExpiresAt:null,checkoutPhase:null,checkoutAttached:false,sellerCostAccepted:false};
 const fetchImpl=async(url,init)=>{calls.push({url,method:init.method});const u=new URL(url);if(u.origin===DB&&u.pathname==='/auth/v1/user'){const user=JSON.parse(Buffer.from(init.headers.Authorization.slice(7).split('.')[1],'base64url')).sub;return response(url,{id:user,aud:'authenticated',role:'authenticated',is_anonymous:false});}
  if(u.origin===DB&&u.pathname==='/rest/v1/rpc/'+module.RPC){const a=JSON.parse(init.body);let result;
   if(a.p_operation==='status')result=state;
   else if(a.p_operation==='cost_context')result={orderId:ORDER,order,releaseEnabled:false,disclosure,acceptance:null};
   else if(a.p_operation==='shipping_claim')result={attemptId:ATTEMPT,sendAllowed:true,status:'unknown',fulfillment:null,wireSha256:null,capturedAt:new Date(NOW).toISOString()};
   else if(a.p_operation==='shipping_record'){shippingRecords.push(a.p_arguments);result={attemptId:ATTEMPT,sendAllowed:false,status:a.p_arguments.status,fulfillment:a.p_arguments.fulfillment,wireSha256:a.p_arguments.wireSha256,capturedAt:new Date(NOW).toISOString()};}
   else throw Error('Unplanned synthetic practice operation: '+a.p_operation);
   return response(url,{version:'rr-test-tax-practice-nonce-v1',actorId:a.p_actor,role:a.p_actor===O?'owner':'buyer',operation:a.p_operation,nonce:a.p_nonce,profileSha256:a.p_profile_sha,observedAt:NOW,result,releaseEnabled:false});
  }
  if(u.origin==='https://api.goshippo.com'&&u.pathname==='/shipments/'&&init.method==='POST')return response(url,{test:true,object_id:'1'.repeat(32),rates:[{test:true,object_id:'2'.repeat(32),currency:'USD',amount:(shippingCents/100).toFixed(2),provider:p.carrier,servicelevel:{name:p.service}}]});
  throw Error('Unplanned synthetic request: '+url);
 };
 const cfg={enabled:true,environment:module.ENVIRONMENT,profile:p,publishableKey:'sb_publishable_FICTIONAL',serverKey:'sb_secret_'+'FICTIONAL_'.repeat(4),stripeReadKey:'rk_test_FICTIONALONLY',stripeOriginalKey:'rk_test_FICTIONALONLY',stripeCalculationKey:'rk_test_FICTIONALONLY',stripeCheckoutKey:'rk_test_FICTIONALONLY',shippoTestKey:'shippo_test_FICTIONAL',fetchImpl,clock:()=>NOW,monotonicClock:()=>10};
 const handler=module.createPaymentTaxHostedOrchestration(cfg);
 async function call(action,{role='owner',method='GET',body={}}={}){const claimsForRole={...claims,sub:role==='buyer'?B:O},access='fixture.'+Buffer.from(JSON.stringify(claimsForRole)).toString('base64url')+'.fixture';
  // Auth identity is a synthetic response, not authentication acceptance.
  const req=Readable.from(method==='GET'?[]:[JSON.stringify(body)]);req.url=module.PATH+'?action='+action;req.method=method;req.headers={host:new URL(ORIGIN).host,origin:ORIGIN,'content-type':'application/json',cookie:'__Host-rr-practice-access='+access};
  const headers={},res={writableEnded:false,statusCode:200,setHeader(k,v){headers[k.toLowerCase()]=v;},getHeader(k){return headers[k.toLowerCase()];},end(v){this.body=JSON.parse(v);this.writableEnded=true;}};
  await handler(req,res);return{status:res.statusCode,body:res.body,headers};
 }
 return{p,cfg,handler,call,calls,shippingRecords,disclosure,close:()=>handler.close()};
}
function dom(api,fetchImpl){const nodes=new Map(),events={};function element(tag='div'){return{tag,value:'',hidden:false,checked:false,disabled:false,textContent:'',children:[],attributes:{},events:{},addEventListener(k,v){this.events[k]=v;},removeEventListener(k){delete this.events[k];},fire(k='click'){return this.events[k]?.({preventDefault(){}});},append(...v){this.children.push(...v);},replaceChildren(...v){this.children=[...v];},removeAttribute(k){delete this.attributes[k];delete this[k];},setAttribute(k,v){this.attributes[k]=v;this[k]=v;}};}
 const get=id=>{if(!nodes.has(id))nodes.set(id,element());return nodes.get(id);},document={getElementById:get,createElement:element},window={location:{origin:ORIGIN},addEventListener(k,v){events[k]=v;},removeEventListener(k){delete events[k];}};
 for(const key of ['localStorage','sessionStorage'])Object.defineProperty(window,key,{get(){throw Error('Unexpected browser storage access');}});
 const client=api.mount({document,window,fetchImpl,environments:[{id:'acceptance-v1',projectUrl:DB,previewOrigin:ORIGIN}],clock:()=>NOW});return{client,get};
}
function browser(r,{api=UI,mutateConfig,mutateCosts}={}){const browserCalls=[];const d=dom(api,async(input,init)=>{const url=new URL(input,ORIGIN),action=url.searchParams.get('action');browserCalls.push({action,method:init.method});const out=await r.call(action,{method:init.method,body:init.body?JSON.parse(init.body):{}});const value=structuredClone(out.body);if(action==='config')mutateConfig?.(value);if(action==='cost-review')mutateCosts?.(value);return response(url.href,value,out.headers);});return{...d,browserCalls};}

test('actual candidate server config and mounted browser agree on current $1 fee without changing the envelope',async()=>{
 for(const itemCents of [100,101,109,110,2500,18952]){const r=rig({itemCents}),x=browser(r);try{const c=await r.call('config');assert.equal(c.status,200);assert.deepEqual(Object.keys(c.body).sort(),['actions','fixture','ready',...Object.keys(FLAGS)].sort());assert.deepEqual(Object.keys(c.body.fixture).sort(),['title','currency','itemCents','buyerFeeCents'].sort());assert.equal(c.body.fixture.buyerFeeCents,fee.buyerFee(itemCents,fee.CURRENT_FEE_POLICY));assertClosed(c.body);await x.client.ready;assert.equal(x.get('practice-workspace').hidden,false);assert.match(x.get('practice-fixture-detail').textContent,new RegExp('\\$'+(c.body.fixture.buyerFeeCents/100).toFixed(2).replace('.','\\.')));assert.equal(x.browserCalls.some(c=>c.method==='POST'),false);}finally{x.client.destroy();r.close();}}
});
test('actual mounted seller-cost review accepts saved v2 and v3 amounts and enables consent only for that review',async()=>{
 for(const [savedVersion,expected]of [['rr-fees-v2',175],['rr-fees-v3',225]]){const r=rig({savedVersion}),x=browser(r);try{await x.client.ready;await x.get('practice-cost-review').fire();assert.equal(x.get('practice-cost-document').hidden,false);assert.equal(x.get('practice-cost-accept').disabled,true);assert.match(x.get('practice-cost-note').textContent,new RegExp('\\$'+(expected/100).toFixed(2).replace('.','\\.')));x.get('practice-cost-consent').checked=true;await x.get('practice-cost-consent').fire('change');assert.equal(x.get('practice-cost-accept').disabled,false);assert.equal(x.browserCalls.some(c=>c.action==='cost-accept'),false);}finally{x.client.destroy();r.close();}}
});
test('actual UI rejects old config amounts and unknown, missing or version-swapped cost documents',async()=>{
 const config=rig(),badConfig=browser(config,{mutateConfig:v=>{v.fixture.buyerFeeCents=175;}});try{await badConfig.client.ready;assert.equal(badConfig.get('practice-workspace').hidden,true);assert.equal(badConfig.get('practice-cost-accept').disabled,true);}finally{badConfig.client.destroy();config.close();}
 for(const change of [d=>{d.feePolicyVersion='unknown';},d=>{delete d.feePolicyVersion;},d=>{d.feePolicyVersion='rr-fees-v2';},d=>{d.buyerFeeCents=175;d.totalCents-=50;},d=>{d.buyerFeeCents=0;d.totalCents-=225;}]){const r=rig(),x=browser(r,{mutateCosts:v=>change(v.costReview.document)});try{await x.client.ready;await x.get('practice-cost-review').fire();assert.equal(x.get('practice-cost-document').hidden,true);assert.equal(x.get('practice-cost-accept').disabled,true);assert.equal(x.browserCalls.some(c=>c.action==='cost-accept'),false);}finally{x.client.destroy();r.close();}}
 const r=rig({savedVersion:'rr-fees-v2'}),x=browser(r,{mutateCosts:v=>{v.costReview.document.buyerFeeCents=225;v.costReview.document.totalCents+=50;}});try{await x.client.ready;await x.get('practice-cost-review').fire();assert.equal(x.get('practice-cost-document').hidden,true);assert.equal(x.get('practice-cost-accept').disabled,true);}finally{x.client.destroy();r.close();}
});
test('new-profile and actual shipping-stage minimum checks retain exact $200 one-cent boundaries',async()=>{
 assert.equal(R.profile(profile(18952),NOW).itemCents+fee.buyerFee(18952,fee.CURRENT_FEE_POLICY),20000);assert.throws(()=>R.profile(profile(18953),NOW));
 const over=rig({itemCents:18953});try{assert.equal(over.handler.ready,false);assert.equal((await over.call('config')).status,404);assert.deepEqual(over.calls,[]);}finally{over.close();}
 for(const [shippingCents,expected]of [[1000,'known'],[1001,'unknown']]){const r=rig({itemCents:18000,shippingCents});try{assert.equal(r.handler.ready,true);await r.call('quote',{role:'owner',method:'POST'}); // Owner cannot quote: role denial must stay intact.
  assert.equal(r.shippingRecords.length,0);assert.equal(r.calls.some(c=>c.url.startsWith('https://api.goshippo.com/')),false);
  const result=await r.call('quote',{role:'buyer',method:'POST'});assert.equal(result.status,503);assertClosed(result.body);assert.equal(r.shippingRecords.length,1);assert.equal(r.shippingRecords[0].status,expected);assert.equal(r.calls.filter(c=>c.url.startsWith('https://api.goshippo.com/')).length,1);assert.equal(r.calls.some(c=>c.method==='POST'&&c.url.startsWith('https://api.stripe.com/')),false);
  // A known rate deliberately stops at the next unsupported synthetic Tax port.
  // This checks the actual shipping-stage bound, not a complete hosted journey.
 }finally{r.close();}}
});
test('complete saved-cost $200 boundary and live/release flags remain enforced by the actual mounted UI',async()=>{
 for(const [taxCents,shown]of [[100,true],[101,false]]){const r=rig({itemCents:18000,shippingCents:900,taxCents}),x=browser(r);try{const c=await r.call('config');assertClosed(c.body);await x.client.ready;await x.get('practice-cost-review').fire();assert.equal(x.get('practice-cost-document').hidden,!shown);assert.equal(x.get('practice-cost-accept').disabled,true);}finally{x.client.destroy();r.close();}}
 let calls=0;const closed=R.createPaymentTaxHostedOrchestration({fetchImpl:()=>{calls++;throw Error('Unexpected I/O');}});try{assert.equal(closed.ready,false);const req=Readable.from([]);req.url=R.PATH+'?action=config';req.method='GET';req.headers={};const res={setHeader(){},end(v){this.body=JSON.parse(v);}};await closed(req,res);assert.equal(res.statusCode,404);assertClosed(res.body);assert.equal(calls,0);}finally{closed.close();}
});
