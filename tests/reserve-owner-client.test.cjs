'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {mount,projectAdminOverview}=require('../test-admin.js');
const view=require('../test-reserve-read.js');
const {TEST_ENVIRONMENTS}=require('../server/test_environment_registry.cjs');
const ENVIRONMENTS=require('../test-environments.js');
const A=TEST_ENVIRONMENTS.acceptance,L=TEST_ENVIRONMENTS.legacy,OP='11111111-1111-4111-8111-111111111111',O='22222222-2222-4222-8222-222222222222';
const tick=()=>new Promise(r=>setImmediate(r));
const textOf=node=>[node.textContent,...node.children.map(textOf)].join(' ');
function setup({environment=A,configPatch={},origin=environment.previewOrigin,signed=true,onOverview,oldLegacySession=false,workModule}={}){
 let now=Date.now(),next=0,reads=0;const nodes=new Map(),timers=new Map(),calls=[],events={},docEvents={},key='rr-private-test-session'+(environment.id==='acceptance-v1'?':acceptance-v1':''),saved=new Map();
 const session=JSON.stringify({token:'test-operator-token',member:OP,email:'not-rendered@example.invalid'});if(signed)saved.set(key,session);if(oldLegacySession)saved.set('rr-private-test-session',session);
 const element=tag=>({set id(value){nodes.set(value,this);},tag,textContent:'',children:[],hidden:false,disabled:false,events:{},append(...items){this.children.push(...items);},replaceChildren(){this.children=[];},addEventListener(k,fn){this.events[k]=fn;},fire(k='click'){return this.events[k]?.({});}});
 const get=id=>{if(!nodes.has(id))nodes.set(id,element('div'));return nodes.get(id);};
 for(const id of ['overview','notice','as-of','page-title','signin-link','refresh','logout'])get(id);
 const document={hidden:false,visibilityState:'visible',getElementById:id=>nodes.get(id)||null,createElement:element,addEventListener(k,fn){docEvents[k]=fn;},removeEventListener(k){delete docEvents[k];}};
 const setTimer=(fn,delay)=>{const id=++next;timers.set(id,{fn,delay});return id;},clearTimer=id=>timers.delete(id);
 const window={location:{origin},setTimeout:setTimer,clearTimeout:clearTimer,addEventListener(k,fn){events[k]=fn;},removeEventListener(k){delete events[k];}};
 const storage={getItem:k=>{reads++;return saved.get(k)??null;},setItem:(k,v)=>saved.set(k,v),removeItem:k=>saved.delete(k)};
 const valid=()=>projectAdminOverview({test:true,live:false,releaseEnabled:false,observedAt:new Date(now).toISOString(),counts:{orders:1,paidOrders:1,heldOrders:1,sellers:1,openCases:0,alertDeliveryGaps:0},orders:[{orderRef:O,state:'paid',riskStatus:'review',refundState:'none',totalCents:3502,observedAt:new Date(now-10000).toISOString(),holdRequired:true}],cases:[],hasMoreOrders:false,hasMoreCases:false,sources:{stripeObservedAt:new Date(now-600000).toISOString(),sellerObservedAt:null,shippingObservedAt:null}},{environmentId:environment.id,now});
 let overviewNumber=0;const fetchImpl=async(url,options)=>{calls.push({url,options});assert.equal(options.method,'GET');assert.equal(options.cache,'no-store');if(url.endsWith('config'))return Response.json({test:true,live:false,environmentId:environment.id,projectUrl:environment.projectUrl,returnUrl:environment.returnUrl,...configPatch});assert.equal(url,'/api/test-admin?action=overview');assert.ok(options.headers.Authorization.startsWith('Bearer '));const n=++overviewNumber;if(onOverview)return onOverview(n,valid,options);return Response.json(valid());};
 const client=mount({document,window,fetchImpl,storage,environments:ENVIRONMENTS,workModule,setTimer,clearTimer,clock:()=>now});
 const flatten=node=>[node,...node.children.flatMap(flatten)];
 return {client,get,saved,key,timers,calls,events,docEvents,document,session,valid,storageReads:()=>reads,all:()=>[...nodes.values()].flatMap(flatten),overviewCalls:()=>calls.filter(c=>c.url.endsWith('overview')),advance:n=>now+=n,async timer(){const [id,t]=[...timers][0]||[];assert.ok(t,'scheduled poll');timers.delete(id);now+=t.delay;t.fn();await tick();}};
}
function projected({current=true,empty=false,state}={}){
 if(state)return view.coverage(state);
 const now=Date.now();return view.fromRpc({version:view.VERSION,test:true,live:false,holdRequired:true,releaseEnabled:false,refundDispatchEnabled:false,closeGlobalClaim:false,taxAccountingAccepted:false,funding:'unverified',observedAt:new Date(now).toISOString(),schemaState:'available',hasMore:false,rows:empty?[]:[{orderRef:O,booked:true,current,recordedAt:new Date(now-1000).toISOString(),acceptedReserveCents:600,actualCostCents:285,unusedReserveOwedCents:315}]},{now});
}
const configPatch={reserveReadEnabled:true,reserveReadVersion:view.VERSION};
const ownerSetup=(opts={})=>setup({configPatch,onOverview:async(n,valid)=>Response.json({...valid(),reserve:projected()}),...opts});
test('owner control center displays recorded money owed as held and unfunded, with no reserve mutation control',async()=>{
 const x=ownerSetup();await tick();const text=textOf(x.get('reserve-read'));assert.match(text,/\$3\.15/);assert.match(text,/not proof of available cash or funded reserves/);assert.match(text,/cannot book entries/);assert.ok(!x.get('reserve-read').children.some(c=>['button','input','form'].includes(c.tag)));assert.ok(x.calls.every(c=>c.options.method==='GET'));x.client.destroy();
});
test('changed facts render historical owed amount with reconciliation warning rather than a current payable',async()=>{
 const x=ownerSetup({onOverview:async(n,valid)=>Response.json({...valid(),reserve:projected({current:false})})});await tick();const text=textOf(x.get('reserve-read'));assert.match(text,/Previously recorded/);assert.match(text,/not a current payable balance/);assert.match(text,/Money remains held/);x.client.destroy();
});
test('off flag, old source and absent schema give explicit coverage without showing injected money',async()=>{
 for(const [cfg,reserve,expected]of [[{reserveReadEnabled:false,reserveReadVersion:view.VERSION},projected(),/reserve view is off/],[{},projected(),/does not provide the reserve view/],[configPatch,undefined,/does not provide the reserve view/],[configPatch,projected({state:'not_installed'}),/not installed/],[configPatch,projected({state:'schema_missing'}),/schema is unavailable/]]){
  const x=setup({configPatch:cfg,onOverview:async(n,valid)=>Response.json({...valid(),...(reserve?{reserve}:{})})});await tick();assert.match(textOf(x.get('reserve-read')),expected);assert.ok(!textOf(x.get('reserve-read')).includes('$3.15'));x.client.destroy();
 }
});
test('zero orders and notes never imply zero liability or funded reserves',async()=>{
 const x=ownerSetup({onOverview:async(n,valid)=>Response.json({...valid(),reserve:projected({empty:true})})});await tick();assert.match(textOf(x.get('reserve-read')),/Zero orders or notes does not prove/);x.client.destroy();
});
test('sign-out and hidden/blur states clear reserve content and suppress a late response',async()=>{
 for(const lose of [x=>x.get('logout').fire(),x=>{x.document.hidden=true;x.docEvents.visibilitychange();},x=>x.events.blur()]){
  let finish;const pending=new Promise(r=>finish=r);const x=ownerSetup({onOverview:async(n,valid)=>n===2?pending:Response.json({...valid(),reserve:projected()})});await tick();assert.match(textOf(x.get('reserve-read')),/3\.15/);const refresh=x.client.refresh();await tick();lose(x);assert.equal(x.get('reserve-read').children.length,0);finish(Response.json({...x.valid(),reserve:projected()}));await refresh;assert.equal(x.get('reserve-read').children.length,0);assert.equal(x.get('overview').hidden,true);x.client.destroy();
 }
});
test('a changed owner session cannot inherit a late response or restore previous reserve amounts',async()=>{
 let finish;const pending=new Promise(r=>finish=r);const x=ownerSetup({onOverview:async(n,valid)=>n===2?pending:Response.json({...valid(),reserve:projected()})});await tick();const refresh=x.client.refresh();await tick();x.saved.set(x.key,JSON.stringify({token:'different-owner-session',member:OP}));finish(Response.json({...x.valid(),reserve:projected()}));await refresh;assert.equal(x.get('overview').hidden,true);assert.equal(x.get('reserve-read').children.length,0);x.client.destroy();
});
test('stale or fabricated financial authority hides private data; arbitrary strings cannot render HTML',async()=>{
 for(const patch of [{observedAt:new Date(Date.now()-61000).toISOString()},{releaseEnabled:true},{funding:'verified'},{rows:[{...projected().rows[0],state:'ready_to_pay'}]}]){
  const x=ownerSetup({onOverview:async(n,valid)=>Response.json({...valid(),reserve:{...projected(),...patch}})});await tick();assert.equal(x.get('overview').hidden,true);assert.equal(x.get('reserve-read').children.length,0);x.client.destroy();
 }
 const x=ownerSetup({onOverview:async(n,valid)=>Response.json({...valid(),reserve:{...projected(),bank:'<img src=x onerror=alert(1)>',providerSecret:'NEVER_RENDER'}})});await tick();assert.ok(!textOf(x.get('reserve-read')).includes('NEVER_RENDER'));assert.ok(!textOf(x.get('reserve-read')).includes('<img'));x.client.destroy();
});
test('invalid reserve flag or acceptance/source version fails before session storage or private requests',async()=>{
 for(const cfg of [{reserveReadEnabled:'true'},{reserveReadEnabled:true,reserveReadVersion:'old'}]){const x=setup({configPatch:cfg});await tick();assert.equal(x.storageReads(),0);assert.equal(x.overviewCalls().length,0);x.client.destroy();}
 const x=setup({environment:L,configPatch});await tick();assert.equal(x.storageReads(),0);x.client.destroy();
});
