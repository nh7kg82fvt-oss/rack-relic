'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {mount,projectAdminOverview}=require('../test-admin.js');
const {TEST_ENVIRONMENTS}=require('../server/test_environment_registry.cjs');
const ENVIRONMENTS=require('../test-environments.js');
const A=TEST_ENVIRONMENTS.acceptance,L=TEST_ENVIRONMENTS.legacy,OP='11111111-1111-4111-8111-111111111111',O='22222222-2222-4222-8222-222222222222';
const tick=()=>new Promise(r=>setImmediate(r));
const textOf=node=>[node.textContent,...node.children.map(textOf)].join(' ');
function setup({environment=A,configPatch={},origin=environment.previewOrigin,signed=true,onOverview,oldLegacySession=false,workModule,cookieMode=false}={}){
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
 let overviewNumber=0;const fetchImpl=async(url,options)=>{calls.push({url,options});assert.equal(options.method,'GET');assert.equal(options.cache,'no-store');if(url.endsWith('config'))return Response.json({test:true,live:false,environmentId:environment.id,projectUrl:environment.projectUrl,returnUrl:environment.returnUrl,...(cookieMode?{cookieSession:true}:{}),...configPatch});assert.equal(url,(cookieMode?'/api/command-center':'/api/test-admin')+'?action=overview');if(cookieMode)assert.equal(options.headers.Authorization,undefined);else assert.ok(options.headers.Authorization.startsWith('Bearer '));const n=++overviewNumber;if(onOverview)return onOverview(n,valid,options);return Response.json(valid(),{headers:cookieMode?{'X-Rack-Command-Session':O}:{}});};
 const client=mount({document,window,fetchImpl,storage,environments:ENVIRONMENTS,...(cookieMode?{endpoint:'/api/command-center',sessionProvider:()=>saved.has(key)?{member:OP,sessionRef:O}:null,onSessionLost:()=>saved.delete(key)}:{}),workModule,setTimer,clearTimer,clock:()=>now});
 const flatten=node=>[node,...node.children.flatMap(flatten)];
 return {client,get,saved,key,timers,calls,events,docEvents,document,session,valid,storageReads:()=>reads,all:()=>[...nodes.values()].flatMap(flatten),overviewCalls:()=>calls.filter(c=>c.url.endsWith('overview')),advance:n=>now+=n,async timer(){const [id,t]=[...timers][0]||[];assert.ok(t,'scheduled poll');timers.delete(id);now+=t.delay;t.fn();await tick();}};
}
test('private overview reuses scoped session, polls every 30 seconds and performs no financial/provider requests',async()=>{
 const x=setup();await tick();assert.equal(x.overviewCalls().length,1);assert.equal(x.get('overview').hidden,false);assert.equal([...x.timers.values()][0].delay,30000);assert.match(x.get('as-of').textContent,/Records last updated/);assert.ok(x.get('sources').children.some(c=>c.children.some(p=>/more than five minutes/.test(p.textContent))));assert.ok(x.get('sources').children.some(c=>c.children.some(p=>/Website errors and availability are not connected/.test(p.textContent))));assert.equal(JSON.stringify(x.all()).includes('not-rendered@example'),false);
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
 for(const bad of [valid=>{const d=valid();d.sources.stripe.state='healthy';return Response.json(d);},valid=>Response.json(valid(),{headers:{'cf-cache-status':'HIT'}}),valid=>{const d=valid();d.environmentId=L.id;return Response.json(d);}]){const x=setup({onOverview:async(n,valid)=>n===1?Response.json(valid()):bad(valid)});await tick();await x.client.refresh();assert.equal(x.get('overview').hidden,true);assert.equal(x.get('orders').children.length,0);assert.match(x.get('notice').textContent,/current status of Stripe and shipping is unknown/);assert.equal(x.saved.has(x.key),true);x.client.destroy();}
});
test('blur cancels polling and focus performs a fresh non-overlapping read',async()=>{
 const x=setup();await tick();x.events.blur();assert.equal(x.timers.size,0);assert.equal(x.get('overview').hidden,true);await x.client.refresh();assert.equal(x.overviewCalls().length,1);x.events.focus();await tick();assert.equal(x.overviewCalls().length,2);assert.equal(x.timers.size,1);x.client.destroy();
});

test('a provider observation aging past five minutes in flight becomes stale without losing the authorized database snapshot',async()=>{
 let finish;const blocked=new Promise(r=>finish=r);const x=setup({onOverview:async(n,valid)=>n===2?blocked:Response.json(valid())});await tick();const work=x.client.refresh();await tick();const data=x.valid();data.sources.stripe.observedAt=new Date(Date.parse(data.observedAt)-299999).toISOString();data.sources.stripe.state='stored_evidence';x.advance(1000);finish(Response.json(data));await work;assert.equal(x.get('overview').hidden,false);assert.ok(x.get('sources').children.some(c=>c.children.some(p=>/more than five minutes/.test(p.textContent))));x.client.destroy();
});

test('owner attention follows the refreshed deadline and clears its private case on hide and sign-out',async()=>{
 let dueBy;const caseRef='case_'+'a'.repeat(32);
 const x=setup({onOverview:async(n,valid)=>{const data=valid();dueBy||=new Date(Date.parse(data.observedAt)+10000).toISOString();data.cases=[{caseRef,orderRef:O,kind:'dispute',status:'needs_response',requiresResponse:true,dueBy,observedAt:data.observedAt,holdRequired:true}];data.counts.openCases=1;return Response.json(data);}});
 await tick();assert.match(textOf(x.get('attention').children[0]),/Response due within 24 hours/);
 assert.match(textOf(x.get('attention').children[0]),new RegExp(caseRef));
 await x.timer();assert.match(textOf(x.get('attention').children[0]),/deadline reached or overdue/);
 x.document.hidden=true;x.document.visibilityState='hidden';x.docEvents.visibilitychange();
 assert.equal(x.get('attention').children.length,0);assert.equal(x.get('overview').hidden,true);
 x.document.hidden=false;x.document.visibilityState='visible';x.docEvents.visibilitychange();await tick();
 assert.match(textOf(x.get('attention').children[0]),/deadline reached or overdue/);
 x.get('logout').fire();assert.equal(x.get('attention').children.length,0);assert.equal(x.get('overview').hidden,true);
 assert.ok(x.calls.every(c=>c.options.method==='GET'&&c.url.startsWith('/api/test-admin?')));x.client.destroy();
});

test('control center explains next steps and saved payment states without suggesting release authority',async()=>{
 const x=setup();await tick();const view=textOf(x.get('overview'));
 assert.equal(x.get('page-title').textContent,'Rack Command');
 assert.match(view,/view-only/);assert.match(view,/cannot approve payments, issue refunds or pay sellers/);
 assert.match(view,/Practice payment recorded/);assert.match(view,/Payment review needed/);assert.match(view,/No refund recorded/);assert.match(view,/Seller money stays on hold/);
 assert.ok(x.get('attention').children.every(item=>/Next step:/.test(textOf(item))));
 assert.equal(x.all().some(n=>n.tag==='a'&&n.href?.includes('action=release')),false);
 assert.ok(x.calls.every(c=>c.options.method==='GET'));x.client.destroy();
});

test('private task tools preserve unsaved inputs during polling and lose access with the owner view',async()=>{
 const mounted=[];const workModule={mount(options){const state={...options,refreshes:0,destroyed:false};mounted.push(state);options.root.append({tag:'p',textContent:'unsaved private note',children:[]});return {refresh(){state.refreshes++;},destroy(){state.destroyed=true;options.root.replaceChildren();}};}};
 const x=setup({configPatch:{workEnabled:true},workModule});await tick();assert.equal(mounted.length,1);const original=mounted[0],root=original.root;assert.equal(original.session().member,OP);
 await x.timer();assert.equal(mounted.length,1);assert.equal(original.refreshes,2);assert.match(textOf(root),/unsaved private note/);
 x.events.blur();assert.equal(original.destroyed,true);assert.equal(original.session(),null);assert.equal(root.children.length,0);
 x.events.focus();await tick();assert.equal(mounted.length,2);original.onAccessLost();assert.equal(x.saved.has(x.key),true);assert.equal(x.get('overview').hidden,false);
 x.get('logout').fire();assert.equal(mounted[1].destroyed,true);assert.equal(mounted[1].session(),null);x.client.destroy();
});
test('task tools stay unavailable unless their explicit boolean flag is enabled',async()=>{
 let mounts=0;const workModule={mount(){mounts++;throw Error('must not mount');}};
 const x=setup({workModule});await tick();assert.equal(mounts,0);assert.match(textOf(x.get('work-tools')),/not connected/);x.client.destroy();
 const invalid=setup({configPatch:{workEnabled:'true'},workModule});await tick();assert.equal(invalid.storageReads(),0);assert.equal(invalid.get('overview').hidden,true);assert.equal(mounts,0);invalid.client.destroy();
});

test('attention opens its visible case, case opens its matching order, and drafts stay behind the owner work gate',async()=>{
 const received=[],caseRef='case_'+'a'.repeat(32),workModule={mount(){return {refresh(){},destroy(){},startFromRecord(record){received.push(record);return true;}};}};
 const x=setup({configPatch:{workEnabled:true},workModule,onOverview:async(n,valid)=>{const v=valid();v.cases=[{caseRef,orderRef:O,kind:'dispute',status:'needs_response',requiresResponse:true,dueBy:null,observedAt:v.observedAt,holdRequired:true}];v.counts.openCases=1;return Response.json(v);}});await tick();
 const alert=x.get('attention').children.find(n=>n.children.some(c=>c.tag==='a'&&c.href==='#case-'+caseRef));assert.ok(alert);
 const row=x.get('case-'+caseRef),cell=row.children[0];assert.ok(cell.children.some(n=>n.tag==='a'&&n.href==='#order-'+O));
 const draft=cell.children.find(n=>n.tag==='button'&&n.textContent==='Draft follow-up');assert.ok(draft);draft.fire();assert.deepEqual(received,[{kind:'case',ref:caseRef,orderRef:O}]);
 x.get('logout').fire();draft.fire();assert.equal(received.length,1);assert.equal(x.get('overview').children.length,0);assert.equal(x.get('signin-link').hidden,false);assert.ok(x.calls.every(c=>c.options.method==='GET'));x.client.destroy();
 const closed=setup({workModule});await tick();assert.equal(closed.all().some(n=>n.tag==='button'&&n.textContent==='Draft follow-up'),false);closed.client.destroy();
});
test('provider shortcuts are fixed Rack resources and do not mark unknown coverage connected',async()=>{
 const x=setup();await tick();const links=x.get('sources').children.flatMap(c=>c.children.filter(n=>n.tag==='a'));
 assert.deepEqual(links.map(n=>n.href).sort(),['https://dash.cloudflare.com/7a3ed4f82692abebebc6447e5f5e217c/r2/default/buckets/rack-relic-private-photo-archive','https://supabase.com/dashboard/project/tzymapahsfiyhgilsmxl'].sort());
 assert.ok(links.every(n=>n.target==='_blank'&&n.rel==='noopener noreferrer'));assert.match(textOf(x.get('sources')),/Not verified yet/);assert.ok(x.calls.every(c=>c.url.startsWith('/api/test-admin?')));x.client.destroy();
});

test('cookie owner overview avoids credential storage, preserves polling and clears changed-session responses',async()=>{
 const x=setup({cookieMode:true});await tick();assert.equal(x.get('overview').hidden,false);assert.equal(x.storageReads(),0);assert.ok(x.overviewCalls().every(c=>c.options.headers.Authorization===undefined&&c.options.credentials==='same-origin'));await x.timer();assert.equal(x.get('overview').hidden,false);x.client.destroy();
 const y=setup({cookieMode:true,onOverview:async(n,valid)=>Response.json(valid(),{headers:{'X-Rack-Command-Session':OP}})});await tick();assert.equal(y.get('overview').hidden,true);assert.equal(y.saved.has(y.key),false);assert.equal(y.get('orders').children.length,0);y.client.destroy();
});
