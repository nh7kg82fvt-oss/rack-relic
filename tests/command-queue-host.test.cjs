'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {mount,projectAdminOverview}=require('../test-admin.js');
const {TEST_ENVIRONMENTS}=require('../server/test_environment_registry.cjs');
const ENVIRONMENTS=require('../test-environments.js');
const A=TEST_ENVIRONMENTS.acceptance,L=TEST_ENVIRONMENTS.legacy,OP='11111111-1111-4111-8111-111111111111',O='22222222-2222-4222-8222-222222222222';
const tick=()=>new Promise(r=>setImmediate(r));
const textOf=node=>[node.textContent,...node.children.map(textOf)].join(' ');
function setup({environment=A,configPatch={},origin=environment.previewOrigin,signed=true,onOverview,oldLegacySession=false,workModule,cookieMode=false,onSignOut,signalWriteFails=false,queueModule}={}){
 let now=Date.now(),next=0,reads=0;const nodes=new Map(),timers=new Map(),calls=[],events={},docEvents={},key='rr-private-test-session'+(environment.id==='acceptance-v1'?':acceptance-v1':''),saved=new Map();
 const session=JSON.stringify({token:'test-operator-token',member:OP,email:'not-rendered@example.invalid'});if(signed)saved.set(key,session);if(oldLegacySession)saved.set('rr-private-test-session',session);
 const element=tag=>({set id(value){nodes.set(value,this);},tag,textContent:'',children:[],hidden:false,disabled:false,events:{},append(...items){this.children.push(...items);},replaceChildren(){this.children=[];},addEventListener(k,fn){this.events[k]=fn;},fire(k='click'){return this.events[k]?.({});}});
 const get=id=>{if(!nodes.has(id))nodes.set(id,element('div'));return nodes.get(id);};
 for(const id of ['overview','notice','as-of','page-title','signin-link','refresh','logout'])get(id);
 const document={hidden:false,visibilityState:'visible',getElementById:id=>nodes.get(id)||null,createElement:element,addEventListener(k,fn){docEvents[k]=fn;},removeEventListener(k){delete docEvents[k];}};
 const setTimer=(fn,delay)=>{const id=++next;timers.set(id,{fn,delay});return id;},clearTimer=id=>timers.delete(id);
 const signalValues=new Map(),notifications=[];let nonce=0;const window={location:{origin},setTimeout:setTimer,clearTimeout:clearTimer,addEventListener(k,fn){events[k]=fn;},removeEventListener(k){delete events[k];},localStorage:{setItem(k,v){if(signalWriteFails)throw Error('storage blocked');signalValues.set(k,v);}},crypto:{randomUUID:()=>String(++nonce).padStart(8,'0')+'-0000-4000-8000-000000000000'},CustomEvent:class extends Event{constructor(type,{detail}){super(type);this.detail=detail;}},dispatchEvent(event){notifications.push(event);return true;}};
 const storage={getItem:k=>{reads++;return saved.get(k)??null;},setItem:(k,v)=>saved.set(k,v),removeItem:k=>saved.delete(k)};
 const valid=()=>projectAdminOverview({test:true,live:false,releaseEnabled:false,observedAt:new Date(now).toISOString(),counts:{orders:1,paidOrders:1,heldOrders:1,sellers:1,openCases:0,alertDeliveryGaps:0},orders:[{orderRef:O,state:'paid',riskStatus:'review',refundState:'none',totalCents:3502,observedAt:new Date(now-10000).toISOString(),holdRequired:true}],cases:[],hasMoreOrders:false,hasMoreCases:false,sources:{stripeObservedAt:new Date(now-600000).toISOString(),sellerObservedAt:null,shippingObservedAt:null}},{environmentId:environment.id,now});
 let overviewNumber=0;const fetchImpl=async(url,options)=>{calls.push({url,options});assert.equal(options.method,'GET');assert.equal(options.cache,'no-store');if(url.endsWith('config'))return Response.json({test:true,live:false,environmentId:environment.id,projectUrl:environment.projectUrl,returnUrl:environment.returnUrl,...(cookieMode?{cookieSession:true}:{}),...configPatch});assert.equal(url,(cookieMode?'/api/command-center':'/api/test-admin')+'?action=overview');if(cookieMode)assert.equal(options.headers.Authorization,undefined);else assert.ok(options.headers.Authorization.startsWith('Bearer '));const n=++overviewNumber;if(onOverview)return onOverview(n,valid,options);return Response.json(valid(),{headers:cookieMode?{'X-Rack-Command-Session':O}:{}});};
 const client=mount({document,window,fetchImpl,storage,environments:ENVIRONMENTS,...(cookieMode?{endpoint:'/api/command-center',sessionProvider:()=>saved.has(key)?{member:OP,sessionRef:O}:null,onSessionLost:()=>saved.delete(key)}:{}),onSignOut,workModule,queueModule,setTimer,clearTimer,clock:()=>now});
 const flatten=node=>[node,...node.children.flatMap(flatten)];
 return {client,get,saved,key,timers,calls,events,docEvents,document,session,valid,window,signalValues,notifications,storageReads:()=>reads,all:()=>[...nodes.values()].flatMap(flatten),overviewCalls:()=>calls.filter(c=>c.url.endsWith('overview')),advance:n=>now+=n,async timer(){const [id,t]=[...timers][0]||[];assert.ok(t,'scheduled poll');timers.delete(id);now+=t.delay;t.fn();await tick();}};
}

test('dedicated queue capability mounts only for cookie owner and is destroyed by pause/signout',async()=>{
 let mounted=0,destroyed=0,privateRoot;
 const queueModule={mount({root,document,session}){mounted++;privateRoot=root;assert.equal(session().member,OP);root.append(Object.assign(document.createElement('p'),{textContent:'private case sentinel'}));return {lookup(){},destroy(){destroyed++;root.replaceChildren();}};}};
 const x=setup({cookieMode:true,configPatch:{queueAckEnabled:true},queueModule});await tick();assert.equal(mounted,1);assert.match(textOf(privateRoot),/private case/);x.events.blur();assert.equal(destroyed,1);assert.equal(textOf(privateRoot).includes('private case'),false);assert.equal(x.get('overview').hidden,true);x.events.focus();await tick();assert.equal(mounted,2);x.get('logout').fire();assert.equal(destroyed,2);x.client.destroy();
 const off=setup({cookieMode:true,queueModule});await tick();assert.equal(mounted,2);off.client.destroy();
 const wrong=setup({configPatch:{queueAckEnabled:true},queueModule});await tick();assert.equal(wrong.overviewCalls().length,0);wrong.client.destroy();
});
test('summary related case can request an exact older order that was not loaded',async()=>{
 let looked=null;const hiddenOrder='33333333-3333-4333-8333-333333333333';const x=setup({cookieMode:true,configPatch:{queueAckEnabled:true},queueModule:{mount(){return {lookup(k,v){looked={k,v};},destroy(){}};}},onOverview:async(n,valid)=>{const v=valid();v.cases=[{caseRef:'case_'+'a'.repeat(32),orderRef:hiddenOrder,kind:'dispute',status:'needs_response',requiresResponse:true,dueBy:null,observedAt:v.observedAt,holdRequired:true}];v.counts.openCases=1;return Response.json(v,{headers:{'X-Rack-Command-Session':O}});}});await tick();const b=x.all().find(n=>n.tag==='button'&&n.textContent==='View related order');assert.ok(b);b.fire();assert.deepEqual(looked,{k:'orders',v:hiddenOrder});assert.equal(x.window.location.hash,'queue-heading');x.client.destroy();
});
