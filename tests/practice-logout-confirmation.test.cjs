'use strict';
// New local confirmation checks only. All Auth/RPC responses and identities are fictional.
const assert=require('node:assert/strict');
const {Readable}=require('node:stream');
const R=require('../server/private-practice/payment_tax_hosted_orchestration.cjs');
const UI=require('../rack-payment-practice.js');
const {PREFIX}=require('../server/private-practice/practice_session.cjs');
const NOW=Date.UTC(2026,10,21,21),DB='https://tzymapahsfiyhgilsmxl.supabase.co',ORIGIN=R.ENVIRONMENT.origin;
const OWNER='11111111-1111-4111-8111-111111111111',BUYER='22222222-2222-4222-8222-222222222222';
const SESSION='33333333-3333-4333-8333-333333333333',LISTING='44444444-4444-4444-8444-444444444444';
const ORDER='55555555-5555-4555-8555-555555555555',QUOTE='66666666-6666-4666-8666-666666666666',REQUEST='77777777-7777-4777-8777-777777777777';
const PUBLISHABLE=['sb','publishable','FictionalLogoutOnly'].join('_'),SERVER=['sb','secret','FictionalLogoutServerOnly20261121'].join('_');
const STRIPE=['rk','test','FictionalLogoutOnly'].join('_'),SHIPPO=['shippo','test','FictionalLogoutOnly'].join('_');
const FLAGS={test:true,liveCheckoutEnabled:false,releaseEnabled:false,refundDispatchEnabled:false,globalClaimEnabled:false};
function profile(){
 const from={line1:'100 Fictional St',city:'Seattle',state:'WA',postal_code:'98109',country:'US'};
 const to={line1:'200 Fictional Ave',city:'Seattle',state:'WA',postal_code:'98101',country:'US'};
 return{version:'rr-private-practice-profile-v1',ownerId:OWNER,buyerId:BUYER,listingId:LISTING,orderId:ORDER,quoteId:QUOTE,requestId:REQUEST,
  policyRevision:'3'.repeat(64),title:'Fictional logout practice item',itemCents:2500,listingUpdatedAt:'2026-11-08T00:00:00.000Z',listingVersion:2,
  origin:from,destination:to,shippingFrom:{name:'Fictional sender',street1:from.line1,city:from.city,state:from.state,zip:from.postal_code,country:'US'},
  shippingTo:{name:'Fictional receiver',street1:to.line1,city:to.city,state:to.state,zip:to.postal_code,country:'US'},parcel:{length:10,width:8,height:2,weight:1},
  carrier:'Fictional Carrier',service:'Fictional Ground',costPolicy:{maxTotalCents:600,costCaps:{processing:200,radar:10,connect_active_account:200,payout:190,insurance:0}},expiresAt:NOW+600000};
}
function jwt(patch={}){return'fixture.'+Buffer.from(JSON.stringify({iss:DB+'/auth/v1',sub:OWNER,aud:'authenticated',role:'authenticated',is_anonymous:false,
 session_id:SESSION,iat:NOW/1000-1,exp:NOW/1000+500,...patch})).toString('base64url')+'.fixture';}
function jsonResponse(url,value,now=NOW,headers={},status=200){
 const response=new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json','Cache-Control':'private, no-store, max-age=0',Date:new Date(now).toUTCString(),...headers}});
 Object.defineProperty(response,'url',{value:url});return response;
}
function rig({implementation=R,logout='confirmed',cookie=PREFIX+'access='+jwt(),headers:requestHeaders={}}={}){
 let wall=NOW,mono=100,lastReq=null,lastLogout=null;
 const calls=[];
 const state={version:'rr-test-tax-practice-state-v1',orderState:null,shippingAttempted:false,shippingStatus:null,quoteAttempted:false,quoteStatus:null,
  quoteExpiresAt:null,checkoutPhase:null,checkoutAttached:false,sellerCostAccepted:false};
 const fetchImpl=async(url,init)=>{
  const u=new URL(url);calls.push({path:u.pathname,query:u.search,method:init.method});
  assert.equal(u.origin,DB,'No external provider or other project is allowed');
  if(u.pathname==='/auth/v1/logout'){
   assert.equal(url,DB+'/auth/v1/logout?scope=local');assert.equal(init.method,'POST');assert.equal(init.redirect,'error');assert.equal(init.cache,'no-store');
   assert.equal(init.headers.apikey,PUBLISHABLE);assert.equal(init.headers.Authorization,'Bearer '+jwt());assert.equal(Object.hasOwn(init,'body'),false);
   if(logout==='throw'||logout==='lost-reply')throw Error('Fictional private logout detail '+STRIPE);
   if(logout==='late204'){wall+=60000;mono+=60000;}
   if(logout==='aborted204')lastReq.emit('aborted');
   return{status:typeof logout==='number'?logout:logout==='non204'?500:204};
  }
  if(u.pathname==='/auth/v1/user')return jsonResponse(url,{id:OWNER,aud:'authenticated',role:'authenticated',is_anonymous:false},wall);
  if(u.pathname==='/rest/v1/rpc/'+implementation.RPC){
   const a=JSON.parse(init.body);assert.equal(a.p_operation,'status','No setup or financial operation is allowed');
   return jsonResponse(url,{version:'rr-test-tax-practice-nonce-v1',actorId:a.p_actor,role:'owner',operation:a.p_operation,nonce:a.p_nonce,
    profileSha256:a.p_profile_sha,observedAt:wall,result:state,releaseEnabled:false},wall);
  }
  assert.fail('Unexpected fictional request path');
 };
 const handler=implementation.createPaymentTaxHostedOrchestration({enabled:true,environment:implementation.ENVIRONMENT,profile:profile(),publishableKey:PUBLISHABLE,
  serverKey:SERVER,stripeReadKey:STRIPE,stripeOriginalKey:STRIPE,stripeCalculationKey:STRIPE,stripeCheckoutKey:STRIPE,shippoTestKey:SHIPPO,
  fetchImpl,clock:()=>wall,monotonicClock:()=>mono});
 assert.equal(handler.ready,true,'Synthetic configuration must reach the actual orchestration');
 async function call(action,{method='GET',body={}}={}){
  const req=Readable.from(method==='GET'?[]:[JSON.stringify(body)]);req.url=implementation.PATH+'?action='+action;req.method=method;
  req.headers={host:new URL(ORIGIN).host,origin:ORIGIN,'sec-fetch-site':'same-origin','content-type':'application/json',cookie,...requestHeaders};lastReq=req;
  const headers={},res={statusCode:200,writableEnded:false,setHeader(k,v){headers[k.toLowerCase()]=v;},getHeader(k){return headers[k.toLowerCase()];},
   end(v){this.body=JSON.parse(v);this.writableEnded=true;}};
  await handler(req,res);const result={status:res.statusCode,body:res.body,headers};if(action==='logout')lastLogout=result;return result;
 }
 return{handler,call,calls,get now(){return wall;},get lastLogout(){return lastLogout;},close:()=>handler.close()};
}
function assertCleared(res){
 const cookies=res.headers['set-cookie'];assert.equal(cookies.length,3);
 for(const name of ['access','refresh','remember'])assert(cookies.some(v=>v.startsWith(PREFIX+name+'=;')&&v.includes('; Max-Age=0')&&v.includes('; HttpOnly; SameSite=Strict')));
 for(const[k,v]of Object.entries(FLAGS))assert.equal(res.body[k],v);
 for(const secret of [PUBLISHABLE,SERVER,STRIPE,SHIPPO,jwt()])assert.equal(JSON.stringify(res.body).includes(secret),false);
}
function logoutCount(t){return t.calls.filter(c=>c.path==='/auth/v1/logout').length;}
function dom(fetchImpl,clock){
 const nodes=new Map();
 function element(){return{value:'',hidden:false,checked:false,disabled:false,textContent:'',children:[],attributes:{},events:{},
  addEventListener(k,v){this.events[k]=v;},removeEventListener(k){delete this.events[k];},append(...v){this.children.push(...v);},replaceChildren(...v){this.children=[...v];},
  removeAttribute(k){delete this.attributes[k];delete this[k];},setAttribute(k,v){this.attributes[k]=v;this[k]=v;}};}
 const get=id=>{if(!nodes.has(id))nodes.set(id,element());return nodes.get(id);};
 const document={getElementById:get,createElement:element},window={location:{origin:ORIGIN},addEventListener(){},removeEventListener(){}};
 for(const key of ['localStorage','sessionStorage'])Object.defineProperty(window,key,{get(){throw Error('Unexpected browser storage access');}});
 const client=UI.mount({document,window,fetchImpl,environments:[{id:'acceptance-v1',projectUrl:DB,previewOrigin:ORIGIN}],clock});
 return{client,get};
}
function browser(t){return dom(async(input,init)=>{
 const url=new URL(input,ORIGIN),action=url.searchParams.get('action');
 const out=await t.call(action,{method:init.method,body:init.body?JSON.parse(init.body):{}});
 const headers={...out.headers};delete headers['set-cookie'];return jsonResponse(url.href,out.body,t.now,headers,out.status);
},()=>t.now);}
async function runReproduction({implementation=R}={}){
 const t=rig({implementation,logout:'non204'}),ui=browser(t);
 try{await ui.client.ready;await ui.client.signOut();return{status:t.lastLogout.status,notice:ui.get('practice-status').textContent,logoutRequests:logoutCount(t),localCookieClearCount:t.lastLogout.headers['set-cookie'].length};}
 finally{ui.client.destroy();t.close();}
}
const checks=[
 ['only an actual strict204 logout acknowledgement receives success while local practice cookies clear',async()=>{
  const t=rig();try{const out=await t.call('logout',{method:'POST'});assert.equal(out.status,200);assert.equal(out.body.signedIn,false);assert.equal(out.body.role,null);assert.equal(out.body.expiresAt,null);assertCleared(out);assert.equal(logoutCount(t),1);assert.equal(t.calls.length,1);}finally{t.close();}
 }],
 ['non204 statuses never become a successful signout acknowledgement or retry, including401 and403',async()=>{
  for(const logout of [200,400,401,403,500]){const t=rig({logout});try{const out=await t.call('logout',{method:'POST'});assert.equal(out.status,503);assertCleared(out);assert.equal(logoutCount(t),1);assert.equal(t.calls.length,1);}finally{t.close();}}
 }],
 ['transport errors and lost replies clear local cookies but keep remote signout unconfirmed without private error leakage',async()=>{
  for(const logout of ['throw','lost-reply']){const t=rig({logout});try{const out=await t.call('logout',{method:'POST'});assert.equal(out.status,503);assertCleared(out);assert.equal(JSON.stringify(out.body).includes('Fictional private logout detail'),false);assert.equal(logoutCount(t),1);}finally{t.close();}}
 }],
 ['missing, malformed, expired and foreign-actor access cannot falsely confirm server revocation',async()=>{
  for(const cookie of ['',PREFIX+'access=not-a-token',PREFIX+'access='+jwt({exp:NOW/1000-1}),PREFIX+'access='+jwt({sub:'99999999-9999-4999-8999-999999999999'})]){
   const t=rig({cookie});try{const out=await t.call('logout',{method:'POST'});assert.equal(out.status,503);assertCleared(out);assert.equal(logoutCount(t),0);assert.equal(t.calls.length,0);}finally{t.close();}
  }
 }],
 ['late or canceled204 results cannot acknowledge success after the existing operation boundary',async()=>{
  for(const logout of ['late204','aborted204']){const t=rig({logout});try{const out=await t.call('logout',{method:'POST'});assert.equal(out.status,503);assertCleared(out);assert.equal(logoutCount(t),1);assert.equal(t.calls.length,1);}finally{t.close();}}
 }],
 ['existing browser success copy is reached only by a confirmed local-scope logout',async()=>{
  const t=rig(),ui=browser(t);try{await ui.client.ready;assert.equal(ui.get('practice-workspace').hidden,false);await ui.client.signOut();assert.equal(t.lastLogout.status,200);
   assert.equal(ui.get('practice-status').textContent,'Signed out of the private practice area.');assert.equal(ui.get('practice-workspace').hidden,true);assert.equal(ui.get('practice-account-bar').hidden,true);assertCleared(t.lastLogout);assert.equal(logoutCount(t),1);
  }finally{ui.client.destroy();t.close();}
 }],
 ['existing browser retains its unconfirmed-signout notice after rejection, lost response or a late acknowledgement',async()=>{
  for(const logout of ['non204','lost-reply','late204']){const t=rig({logout}),ui=browser(t);try{await ui.client.ready;await ui.client.signOut();assert.equal(t.lastLogout.status,503);
    assert.equal(ui.get('practice-status').textContent,'Sign-out was not confirmed. Close this practice tab on a shared device, or reload and try again.');assert.equal(ui.get('practice-workspace').hidden,true);assert.equal(ui.get('practice-account-bar').hidden,true);assert.equal(logoutCount(t),1);assertCleared(t.lastLogout);
   }finally{ui.client.destroy();t.close();}}
 }],
 ['the logout result gate does not bypass the existing same-origin or JSON-content checks',async()=>{
  for(const headers of [{origin:'https://foreign.example.invalid'},{origin:undefined},{'sec-fetch-site':'cross-site'},{'content-type':'text/plain'}]){
   const t=rig({headers});try{const out=await t.call('logout',{method:'POST'});assert.equal(out.status,503);assert.equal(logoutCount(t),0);assert.equal(t.calls.length,0);assert.equal(out.headers['set-cookie'],undefined);}finally{t.close();}
  }
 }]
];
async function isolated(run){const original=globalThis.fetch;let unexpected=0;globalThis.fetch=()=>{unexpected++;throw Error('Real networking is forbidden in these checks');};try{return await run();}finally{globalThis.fetch=original;assert.equal(unexpected,0);}}
async function runFocused(){const results=[];for(const[name,run]of checks){await isolated(run);results.push({name,passed:true});}return{kind:'new-practice-logout-confirmation-synthetic-checks',pass:results.length,fail:0,realProviderRequests:0,results};}
if(require.main===module){const{test}=require('node:test');for(const[name,run]of checks)test(name,()=>isolated(run));}
module.exports={runFocused,runReproduction};
