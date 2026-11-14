'use strict';
// In-process DOM and fictional overview responses only; no browser/Auth/provider.
const test=require('node:test'),assert=require('node:assert/strict');
const {mount,projectAdminOverview}=require('../test-admin.js');
const ENVIRONMENTS=require('../test-environments.js');
const {TEST_ENVIRONMENTS}=require('../server/test_environment_registry.cjs');
const OWNER='11111111-1111-4111-8111-111111111111',SESSION='22222222-2222-4222-8222-222222222222';
const OTHER='33333333-3333-4333-8333-333333333333',BEGIN='/api/closed-practice-seller/begin';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const flatten=node=>[node,...node.children.flatMap(flatten)];
const textOf=node=>[node.textContent,...node.children.map(textOf)].join(' ');
function rig(options={}){
 const environment=options.environment||TEST_ENVIRONMENTS.acceptance,cookie=options.cookie!==false;
 const availability=Object.hasOwn(options,'availability')?options.availability:true;
 let now=Date.UTC(2026,10,14,5,0,0),currentSession={member:OWNER,sessionRef:SESSION},nextTimer=0,overviewNumber=0;
 const nodes=new Map(),events={},docEvents={},timers=new Map(),calls=[],work={mounts:0,refreshes:0,destroys:0};
 function element(tag){return {tag,textContent:'',children:[],hidden:false,disabled:false,events:{},
  set id(value){nodes.set(value,this);},append(...children){this.children.push(...children);},replaceChildren(...children){this.children=children;},
  setAttribute(){},addEventListener(name,fn){this.events[name]=fn;},
  fire(name='click'){const event={defaultPrevented:false,preventDefault(){this.defaultPrevented=true;}};this.events[name]?.(event);return event;}};}
 for(const id of ['overview','notice','as-of','page-title','signin-link','refresh','logout'])nodes.set(id,element('div'));
 const document={hidden:false,visibilityState:'visible',hasFocus:()=>true,getElementById:id=>nodes.get(id)||null,createElement:element,
  addEventListener(name,fn){docEvents[name]=fn;},removeEventListener(name){delete docEvents[name];}};
 const setTimer=(fn,delay)=>{const id=++nextTimer;timers.set(id,{fn,delay});return id;},clearTimer=id=>timers.delete(id);
 const window={location:{origin:environment.previewOrigin},setTimeout:setTimer,clearTimeout:clearTimer,
  addEventListener(name,fn){events[name]=fn;},removeEventListener(name){delete events[name];},
  localStorage:{setItem(){}},crypto:{randomUUID:()=>OTHER},CustomEvent:class{constructor(type,init){this.type=type;this.detail=init.detail;}},dispatchEvent(){return true;}};
 const storage={getItem(){assert.equal(cookie,false,'cookie overview must not read credential storage');return currentSession?JSON.stringify({token:'fictional-session-only',member:currentSession.member}):null;},removeItem(){currentSession=null;}};
 function valid(){
  const value=projectAdminOverview({test:true,live:false,releaseEnabled:false,observedAt:new Date(now).toISOString(),
   counts:{orders:0,paidOrders:0,heldOrders:0,sellers:0,openCases:0,alertDeliveryGaps:0},orders:[],cases:[],hasMoreOrders:false,hasMoreCases:false,
   sources:{stripeObservedAt:null,sellerObservedAt:null,shippingObservedAt:null}},{environmentId:environment.id,now});
  if(availability!==undefined)value.ownerFixtureSetupAvailable=availability;return value;
 }
 const reply=(value,status=200,sessionRef=SESSION)=>Response.json(value,{status,headers:cookie?{'X-Rack-Command-Session':sessionRef}:{}});
 const endpoint=cookie?'/api/command-center':'/api/test-admin';
 const fetchImpl=async(url,init)=>{
  calls.push({url,init});assert.equal(init.method,'GET');assert.equal(init.cache,'no-store');assert.equal(init.redirect,'error');
  if(url===endpoint+'?action=config')return Response.json({test:true,live:false,environmentId:environment.id,projectUrl:environment.projectUrl,
   returnUrl:environment.returnUrl,...(cookie?{cookieSession:true}:{}),workEnabled:true,...options.configPatch});
  assert.equal(url,endpoint+'?action=overview');
  return options.onOverview?options.onOverview(++overviewNumber,valid,reply):reply(valid());
 };
 const workModule={mount(){work.mounts++;return {refresh(){work.refreshes++;},destroy(){work.destroys++;}};}};
 const client=mount({document,window,fetchImpl,storage,environments:ENVIRONMENTS,workModule,clock:()=>now,setTimer,clearTimer,
  ...(cookie?{endpoint,sessionProvider:()=>currentSession,onSessionLost:()=>{currentSession=null;}}:{})});
 return {client,document,events,docEvents,calls,timers,work,valid,reply,get:id=>nodes.get(id),
  links:()=>flatten(nodes.get('overview')).filter(node=>node.tag==='a'&&node.href===BEGIN),
  all:()=>flatten(nodes.get('overview')),setSession(value){currentSession=value;},advance(value){now+=value;}};
}
test('fresh authenticated cookie-owner overview offers only the fixed confirmation link and preserves existing cards',async()=>{
 const x=rig();await tick();const links=x.links();assert.equal(links.length,1);assert.equal(links[0].href,BEGIN);
 assert.equal(links[0].fire().defaultPrevented,false);assert.equal(x.all().some(node=>node.tag==='form'),false);
 const copy=textOf(x.get('owner-fixture-setup'));assert.match(copy,/Fictional seller rehearsal/);assert.match(copy,/Owner-operated practice only/);
 assert.match(copy,/Payments stay closed/);assert.match(copy,/setup has not been verified/);
 assert(!copy.includes(OWNER)&&!copy.includes(SESSION)&&!copy.includes('fictional-session-only'));
 assert.match(textOf(x.get('sources')),/Email alerts · Resend/);assert.match(textOf(x.get('sources')),/Source code · GitHub/);
 assert.match(textOf(x.get('sources')),/Not verified here/);assert.equal(x.work.mounts,1);
 assert(x.calls.every(call=>call.init.method==='GET'&&call.url.startsWith('/api/command-center?')));x.client.destroy();
});
test('availability is a strict fresh overview boolean; config alone, legacy/bearer views and nonowner responses show no link',async()=>{
 const cases=[{availability:undefined},{availability:false},{availability:'true'},{availability:undefined,configPatch:{ownerFixtureSetupAvailable:true}},
  {cookie:false},{cookie:false,environment:TEST_ENVIRONMENTS.legacy},
  {onOverview:(_n,valid,reply)=>reply({...valid(),ownerFixtureSetupAvailable:true},403)}];
 for(const options of cases){const x=rig(options);await tick();assert.equal(x.links().length,0);
  if(options.cookie===false)assert.equal(x.get('owner-fixture-setup'),undefined);x.client.destroy();}
});
test('refresh immediately removes setup availability while preserving task inputs; false availability cannot retain an old link',async()=>{
 let release;const pending=new Promise(resolve=>{release=resolve;});
 const x=rig({onOverview:(n,valid,reply)=>n===2?pending:reply(valid())});await tick();const retained=x.links()[0];
 const request=x.client.refresh();await tick();assert.equal(x.links().length,0);assert.equal(x.work.mounts,1);assert.equal(x.work.destroys,0);
 assert.match(textOf(x.get('sources')),/Email alerts · Resend/);assert.equal(retained.fire().defaultPrevented,true);
 release(x.reply({...x.valid(),ownerFixtureSetupAvailable:false}));await request;
 assert.equal(x.links().length,0);assert.equal(x.get('overview').hidden,false);assert.equal(x.work.mounts,1);x.client.destroy();
});
test('failed, stale, revoked and mismatched-session overview responses remove the link and private view',async()=>{
 for(const kind of ['failed','stale','revoked','signed-out','session-mismatch']){
  const x=rig({onOverview:(n,valid,reply)=>{
   const value=valid();if(n===1)return reply(value);
   if(kind==='stale')value.observedAt=new Date(Date.parse(value.observedAt)-61000).toISOString();
   return reply(value,kind==='failed'?500:kind==='revoked'?403:kind==='signed-out'?401:200,kind==='session-mismatch'?OTHER:SESSION);
  }});await tick();assert.equal(x.links().length,1);await x.client.refresh();
  assert.equal(x.links().length,0);assert.equal(x.get('overview').hidden,true);x.client.destroy();
 }
});
test('hidden, signed-out, changed and stale identities cannot activate a retained setup link',async()=>{
 const hidden=rig();await tick();const first=hidden.links()[0];hidden.document.hidden=true;hidden.document.visibilityState='hidden';hidden.docEvents.visibilitychange();
 assert.equal(hidden.links().length,0);assert.equal(first.fire().defaultPrevented,true);hidden.client.destroy();
 const inactive=rig();await tick();const blurred=inactive.links()[0];inactive.events.blur();assert.equal(inactive.links().length,0);assert.equal(blurred.fire().defaultPrevented,true);inactive.client.destroy();
 const signedOut=rig();await tick();const second=signedOut.links()[0];signedOut.get('logout').fire();assert.equal(signedOut.links().length,0);assert.equal(second.fire().defaultPrevented,true);signedOut.client.destroy();
 const changed=rig();await tick();const third=changed.links()[0];changed.setSession({member:OTHER,sessionRef:OTHER});assert.equal(third.fire().defaultPrevented,true);assert.equal(changed.links().length,0);changed.client.destroy();
 const stale=rig();await tick();const fourth=stale.links()[0];stale.advance(61001);assert.equal(fourth.fire().defaultPrevented,true);assert.equal(stale.links().length,0);stale.client.destroy();
});
test('a late successful response after sign-out cannot restore the setup link',async()=>{
 let release;const pending=new Promise(resolve=>{release=resolve;});
 const x=rig({onOverview:(n,valid,reply)=>n===2?pending:reply(valid())});await tick();assert.equal(x.links().length,1);
 const request=x.client.refresh();await tick();x.get('logout').fire();release(x.reply(x.valid()));await request;
 assert.equal(x.links().length,0);assert.equal(x.get('overview').hidden,true);assert.equal(x.timers.size,0);x.client.destroy();
});
