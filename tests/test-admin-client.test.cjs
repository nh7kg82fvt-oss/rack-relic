'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {mount,projectAdminOverview}=require('../test-admin.js');
const {TEST_ENVIRONMENTS}=require('../server/test_environment_registry.cjs');
const ENVIRONMENTS=require('../test-environments.js');
const A=TEST_ENVIRONMENTS.acceptance,L=TEST_ENVIRONMENTS.legacy,OP='11111111-1111-4111-8111-111111111111',O='22222222-2222-4222-8222-222222222222';
const tick=()=>new Promise(r=>setImmediate(r));
function setup({environment=A,configPatch={},origin=environment.previewOrigin,signed=true,onOverview,oldLegacySession=false}={}){
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
 const client=mount({document,window,fetchImpl,storage,environments:ENVIRONMENTS,setTimer,clearTimer,clock:()=>now});
 const flatten=node=>[node,...node.children.flatMap(flatten)];
 return {client,get,saved,key,timers,calls,events,docEvents,document,session,valid,storageReads:()=>reads,all:()=>[...nodes.values()].flatMap(flatten),overviewCalls:()=>calls.filter(c=>c.url.endsWith('overview')),advance:n=>now+=n,async timer(){const [id,t]=[...timers][0]||[];assert.ok(t,'scheduled poll');timers.delete(id);now+=t.delay;t.fn();await tick();}};
}
test('private overview reuses scoped session, polls every 30 seconds and performs no financial/provider requests',async()=>{
 const x=setup();await tick();assert.equal(x.overviewCalls().length,1);assert.equal(x.get('overview').hidden,false);assert.equal([...x.timers.values()][0].delay,30000);assert.match(x.get('as-of').textContent,/Database snapshot/);assert.ok(x.get('sources').children.some(c=>c.children.some(p=>/older than five minutes/.test(p.textContent))));assert.ok(x.get('sources').children.some(c=>c.children.some(p=>/Vercel service status and logs unavailable/.test(p.textContent))));assert.equal(JSON.stringify(x.all()).includes('not-rendered@example'),false);
 await x.timer();assert.equal(x.overviewCalls().length,2);assert.equal(x.timers.size,1);assert.ok(x.calls.every(c=>c.options.method==='GET'&&c.url.startsWith('/api/test-admin?')));x.client.destroy();assert.equal(x.timers.size,0);
});
test('manual refresh cannot overlap an existing request and hidden pages cancel/clear until focus returns',async()=>{
 let finish;const blocked=new Promise(r=>finish=r);const x=setup({onOverview:async(n,valid)=>n===2?blocked:Response.json(valid())});await tick();const work=x.client.refresh();await tick();assert.equal(x.overviewCalls().length,2);await x.client.refresh();assert.equal(x.overviewCalls().length,2);
 const pendingSignal=x.overviewCalls()[1].options.signal;x.document.hidden=true;x.document.visibilityState='hidden';x.docEvents.visibilitychange();assert.equal(pendingSignal.aborted,true);assert.equal(x.get('overview').hidden,true);assert.equal(x.timers.size,0);finish(Response.json(x.valid()));await work;assert.equal(x.get('overview').hidden,true);assert.equal(x.get('orders').children.length,0);
 x.document.hidden=false;x.document.visibilityState='visible';x.docEvents.visibilitychange();await tick();assert.equal(x.overviewCalls().length,3);assert.equal(x.get('overview').hidden,false);x.client.destroy();
});
test('401/403 revoke the current session and clear private records without repeating polls',async()=>{
 for(const status of [401,403]){const x=setup({onOverview:async(n,valid)=>n===1?Response.json(valid()):Response.json({error:'denied'},{status})});await tick();await x.client.refresh();assert.equal(x.saved.has(x.key),false);assert.equal(x.get('overview').hidden,true);assert.equal(x.get('orders').children.length,0);assert.equal(x.timers.size,0);assert.match(x.get('notice').textContent,/Sign in again/);x.events.focus();await tick();assert.equal(x.overviewCalls().length,2);x.client.destroy();}
});
test('logout aborts pending work and a late response cannot restore the private overview',async()=>{
 let finish;const blocked=new Promise(r=>finish=r);const x=setup({oldLegacySession:true,onOverview:async(n,valid)=>n===2?blocked:Response.json(valid())});await tick();const work=x.client.refresh();await tick();x.get('logout').fire();assert.equal(x.overviewCalls()[1].options.signal.aborted,true);assert.equal(x.saved.has(x.key),false);assert.equal(x.saved.has('rr-private-test-session'),true);finish(Response.json(x.valid()));await work;assert.equal(x.get('orders').children.length,0);assert.equal(x.get('overview').hidden,true);assert.equal(x.timers.size,0);x.client.destroy();
});
test('changed-session late denial does not erase a newer sign-in or render its predecessor data',async()=>{
 let finish;const blocked=new Promise(r=>finish=r);const x=setup({onOverview:async(n,valid)=>n===2?blocked:Response.json(valid())});await tick();const work=x.client.refresh();await tick();const replacement=JSON.stringify({token:'new-owner-token',member:OP});x.saved.set(x.key,replacement);finish(Response.json({error:'old denial'},{status:403}));await work;assert.equal(x.saved.get(x.key),replacement);assert.equal(x.get('overview').hidden,true);assert.equal(x.get('orders').children.length,0);x.events.focus();await tick();assert.equal(x.overviewCalls()[2].options.headers.Authorization,'Bearer new-owner-token');assert.equal(x.get('overview').hidden,false);x.client.destroy();
});
test('mixed environment configuration fails before any session read and legacy sessions never authorize acceptance',async()=>{
 for(const options of [{configPatch:{projectUrl:L.projectUrl}},{configPatch:{returnUrl:L.returnUrl}},{origin:L.previewOrigin}]){const x=setup(options);await tick();assert.equal(x.calls.length,1);assert.equal(x.storageReads(),0);assert.equal(x.get('overview').hidden,true);x.client.destroy();}
 const missing=setup({signed:false,oldLegacySession:true});await tick();assert.equal(missing.overviewCalls().length,0);assert.equal(missing.saved.has('rr-private-test-session'),true);assert.match(missing.get('notice').textContent,/Sign in/);missing.client.destroy();
});
test('malformed or cached responses clear stale data and remain unavailable instead of looking healthy',async()=>{
 for(const bad of [valid=>{const d=valid();d.sources.stripe.state='healthy';return Response.json(d);},valid=>Response.json(valid(),{headers:{'cf-cache-status':'HIT'}}),valid=>{const d=valid();d.environmentId=L.id;return Response.json(d);}]){const x=setup({onOverview:async(n,valid)=>n===1?Response.json(valid()):bad(valid)});await tick();await x.client.refresh();assert.equal(x.get('overview').hidden,true);assert.equal(x.get('orders').children.length,0);assert.match(x.get('notice').textContent,/provider health is unknown/);assert.equal(x.saved.has(x.key),true);x.client.destroy();}
});
test('blur cancels polling and focus performs a fresh non-overlapping read',async()=>{
 const x=setup();await tick();x.events.blur();assert.equal(x.timers.size,0);assert.equal(x.get('overview').hidden,true);await x.client.refresh();assert.equal(x.overviewCalls().length,1);x.events.focus();await tick();assert.equal(x.overviewCalls().length,2);assert.equal(x.timers.size,1);x.client.destroy();
});

test('a provider observation aging past five minutes in flight becomes stale without losing the authorized database snapshot',async()=>{
 let finish;const blocked=new Promise(r=>finish=r);const x=setup({onOverview:async(n,valid)=>n===2?blocked:Response.json(valid())});await tick();const work=x.client.refresh();await tick();const data=x.valid();data.sources.stripe.observedAt=new Date(Date.parse(data.observedAt)-299999).toISOString();data.sources.stripe.state='stored_evidence';x.advance(1000);finish(Response.json(data));await work;assert.equal(x.get('overview').hidden,false);assert.ok(x.get('sources').children.some(c=>c.children.some(p=>/older than five minutes/.test(p.textContent))));x.client.destroy();
});
