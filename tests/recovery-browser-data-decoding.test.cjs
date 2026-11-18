'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {mount,PROJECT,PATH}=require('../public/recovery-readonly-view.js');
const ORIGIN='https://rack-relic-git-codex-recovery-fixture-rack-relic.vercel.app';
const OWNER='11111111-1111-4111-8111-111111111111',SESSION='22222222-2222-4222-8222-222222222222';
const START=Date.UTC(2026,10,17,20,0,0),tick=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(options={}){
 let now=START,mono=0,enteredRead,releaseBody,cancelCount=0,sessionCount=0;
 const calls=[],reachedRead=new Promise(resolve=>enteredRead=resolve);
 const element=()=>Object.assign(new EventTarget(),{hidden:false,disabled:false,textContent:'',children:[],replaceChildren(){this.children=[];},appendChild(node){this.children.push(node);}});
 const names=['records','observed-at','stored-orders','stored-paid','stored-held','stored-sellers','stored-open-cases','stored-delivery-gaps','orders','cases','record-limit','status','open-records','clear-records'];
 const nodes=new Map(names.map(name=>[name,element()]));
 const document=Object.assign(new EventTarget(),{getElementById:name=>nodes.get(name),createElement:element,hidden:false,visibilityState:'visible',hasFocus:()=>true});
 const window=Object.assign(new EventTarget(),{location:{origin:ORIGIN}});
 const claims={iss:'https://'+PROJECT+'.supabase.co/auth/v1',sub:OWNER,aud:'authenticated',role:'authenticated',is_anonymous:false,session_id:SESSION,iat:START/1000,exp:START/1000+3600,...options.claims};
 const token='eyJhbGciOiJIUzI1NiJ9.'+Buffer.from(JSON.stringify(claims)).toString('base64url')+'.FICTIONALSIGNATURE';
 const snapshot={test:true,live:false,releaseEnabled:false,observedAt:new Date(START).toISOString(),counts:{orders:0,paidOrders:0,heldOrders:0,sellers:0,openCases:0,alertDeliveryGaps:0},orders:[],cases:[],hasMoreOrders:false,hasMoreCases:false,sources:{stripeObservedAt:null,sellerObservedAt:null,shippingObservedAt:null},...options.snapshot};
 const envelope={version:'rr-recovery-readonly-observation-v1',projectRef:PROJECT,recoveryOnly:true,applicationWritesEnabled:false,providerWritesEnabled:false,liveClearance:false,providerFreshness:'unverified_stored_records_only',sessionRef:SESSION,snapshot,...options.envelope};
 const text=options.body===undefined?JSON.stringify(envelope):options.body;
 async function fetchImpl(url,init){
  calls.push({url,init});assert.equal(url,ORIGIN+PATH);assert.equal(init.method,'GET');assert.equal(init.credentials,'omit');assert.equal(init.redirect,'error');assert.equal(init.cache,'no-store');assert.equal(init.body,undefined);assert.equal(init.headers.Accept,'application/json');assert.equal(init.headers.Authorization,'Bearer '+token);
  const headers=new Headers({'content-type':'application/json','cache-control':'private, no-store, max-age=0',date:new Date(now).toUTCString(),...(options.headers||{})});
  for(const name of options.removeHeaders||[])headers.delete(name);
  const response=new Response(text,{status:options.status||200,headers});
  Object.defineProperty(response,'url',{value:options.url||url});
  if(options.redirected)Object.defineProperty(response,'redirected',{value:true});
  const bytes=new TextEncoder().encode(text);let sent=false;
  Object.defineProperty(response,'body',{value:{getReader(){return {async read(){if(sent)return {done:true};enteredRead();if(options.stallBody)await new Promise(resolve=>releaseBody=resolve);sent=true;return {done:false,value:bytes};},cancel(){cancelCount++;return Promise.resolve();}};}}});
  return response;
 }
 const view=mount({document,window,fetchImpl,enabled:true,enrollment:{version:'rr-recovery-view-enrollment-v1',projectRef:PROJECT,ownerId:OWNER,origin:ORIGIN},sessionProvider:async()=>{sessionCount++;return {accessToken:token};},clock:()=>now,monotonicClock:()=>mono});
 return {view,calls,nodes,window,document,reachedRead,get cancelCount(){return cancelCount;},get sessionCount(){return sessionCount;},releaseBody(){releaseBody?.();},setClock(value,elapsed=value-START){now=value;mono=elapsed;},destroy(){view.destroy();}};
}
test('native decoded gzip/br JSON with differing wire length preserves Date/no-store and renders sanitized snapshot',async()=>{
 for(const encoding of ['gzip','br']){const x=fixture({snapshot:{padding:'fictional'.repeat(1000)},headers:{'content-encoding':encoding,'content-length':'41'}});try{await x.view.read();assert.equal(x.nodes.get('records').hidden,false);assert.equal(x.nodes.get('stored-orders').textContent,'0');assert.equal(x.calls.length,1);assert.equal(x.sessionCount,1);assert.equal(x.cancelCount,1);assert.match(x.nodes.get('status').textContent,/live readiness are unverified/);}finally{x.destroy();}}
});
test('decoded cap rejects an oversized snapshot despite a tiny compressed wire length and cancels reader',async()=>{
 const x=fixture({snapshot:{padding:'x'.repeat(262144)},headers:{'content-encoding':'gzip','content-length':'41'}});try{await x.view.read();assert.equal(x.nodes.get('records').hidden,true);assert.equal(x.calls.length,1);assert.equal(x.cancelCount,1);assert.match(x.nodes.get('status').textContent,/on hold/);}finally{x.destroy();}
});
test('typed wire-size ceiling still rejects invalid and oversized Content-Length',async()=>{
 for(const length of ['invalid','-1','262145']){const x=fixture({headers:{'content-length':length}});try{await x.view.read();assert.equal(x.nodes.get('records').hidden,true);assert.equal(x.calls.length,1);assert.equal(x.cancelCount,0);}finally{x.destroy();}}
});
test('same-origin response Date remains mandatory and bounded',async()=>{
 for(const options of [{removeHeaders:['date']},{headers:{date:'invalid'}},{headers:{date:new Date(START-31000).toUTCString()}},{headers:{date:new Date(START+31000).toUTCString()}}]){const x=fixture(options);try{await x.view.read();assert.equal(x.nodes.get('records').hidden,true);assert.equal(x.cancelCount,0);}finally{x.destroy();}}
});
test('mandatory no-store and visible cache evidence remain strict',async()=>{
 for(const options of [{removeHeaders:['cache-control']},{headers:{'cache-control':'private, no-cache'}},{headers:{'cache-control':'public, no-store'}},{headers:{'cache-control':'no-store, max-age=1'}},{headers:{age:'1'}},{headers:{'x-vercel-cache':'HIT'}},{headers:{'cf-cache-status':'HIT'}}]){const x=fixture(options);try{await x.view.read();assert.equal(x.nodes.get('records').hidden,true);assert.equal(x.cancelCount,0);}finally{x.destroy();}}
});
test('response URL, redirects and body/envelope freshness retain their denial behavior',async()=>{
 for(const options of [{url:ORIGIN+PATH+'?other=1'},{url:'https://other.invalid'+PATH},{redirected:true},{status:401},{headers:{'content-type':'text/html'}},{body:'malformed JSON'},{envelope:{applicationWritesEnabled:true}},{envelope:{liveClearance:true}},{envelope:{sessionRef:'33333333-3333-4333-8333-333333333333'}},{snapshot:{observedAt:new Date(START-1).toISOString()}},{snapshot:{observedAt:new Date(START+1001).toISOString()}}]){const x=fixture(options);try{await x.view.read();assert.equal(x.nodes.get('records').hidden,true);assert.match(x.nodes.get('status').textContent,/on hold/);assert.equal(x.calls.length,1);}finally{x.destroy();}}
});
test('token issuer and owner still restrict use before the single data fetch',async()=>{
 for(const claims of [{iss:'https://other.invalid/auth/v1'},{sub:'33333333-3333-4333-8333-333333333333'},{is_anonymous:true},{exp:START/1000}]){const x=fixture({claims});try{await x.view.read();assert.equal(x.calls.length,0);assert.equal(x.nodes.get('records').hidden,true);}finally{x.destroy();}}
});
test('concurrent reads issue one fetch and clearing an in-flight body prevents late rendering or extra fetches',async()=>{
 const x=fixture({stallBody:true,headers:{'content-encoding':'gzip','content-length':'41'}});try{const first=x.view.read();await x.reachedRead;await x.view.read();assert.equal(x.calls.length,1);assert.equal(x.sessionCount,1);x.view.clear();await first;assert.equal(x.nodes.get('records').hidden,true);assert.equal(x.calls[0].init.signal.aborted,true);assert.equal(x.cancelCount,1);x.releaseBody();await tick();assert.equal(x.nodes.get('records').hidden,true);assert.equal(x.calls.length,1);}finally{x.destroy();}
});
