'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const O='11111111-1111-4111-8111-111111111111',M='22222222-2222-4222-8222-222222222222',S='33333333-3333-4333-8333-333333333333',T='44444444-4444-4444-8444-444444444444',P='55555555-5555-4555-8555-555555555555',R='66666666-6666-4666-8666-666666666666';
const KEY='rr-private-test-settlement-'+M+':'+O,tick=()=>new Promise(resolve=>setImmediate(resolve));
const receipt=(kind='transfer',patch={})=>({test:true,simulationOnly:true,orderId:O,requestId:kind==='transfer'?T:kind==='payout'?P:R,kind,amountCents:2000,state:kind==='payout'?'paid':'succeeded',availableCents:kind==='transfer'?2000:null,needsReview:false,recoveryRequired:false,releaseEnabled:false,liveReady:false,...patch});
const review=(patch={})=>({test:true,simulationOnly:true,orderId:O,blockers:[],transferableCents:2000,attempts:[],releaseEnabled:false,liveReady:false,...patch});
function setup({enabled=true,allowed=true,initial=review(),savedLocal=[],waitReview,waitStart,waitReconcile,startError=false,startReply,reconcileReply,uuids=[T,P,R]}={}){
 const nodes=new Map(),calls=[],session=new Map([['rr-private-test-session',JSON.stringify({token:'test-token',member:M,email:'operator@example.invalid'})]]),local=new Map(savedLocal);let latest=initial,readError=false,reviewWait=waitReview,startWait=waitStart,reconcileWait=waitReconcile,n=0;
 const element=tag=>({tag,children:[],textContent:'',value:'',checked:false,hidden:false,disabled:false,events:{},append(...items){this.children.push(...items);},replaceChildren(){this.children=[];},addEventListener(name,fn){this.events[name]=fn;},reportValidity(){return true;},fire(name='click'){return this.events[name]?.({preventDefault(){}});}});
 const get=id=>{if(!nodes.has(id))nodes.set(id,element('div'));return nodes.get(id);},storage=map=>({getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)});
 const fetch=async(url,options)=>{calls.push({url,options});
  if(url.endsWith('config'))return Response.json({settlementSimulationEnabled:enabled==='absent'?undefined:enabled,publishableKey:'test',notice:'Private fixture',listing:{id:O}});
  if(url.endsWith('orders'))return Response.json({orders:[{id:O,buyer_id:M,seller_id:S,state:'paid',total_cents:3175,refund_state:'none',listing_id:O}]});
  if(url.endsWith('refund-access'))return allowed?Response.json({test:true,allowed:true}):Response.json({error:'Operator access required'},{status:403});
  if(url.endsWith('refund-review'))return Response.json({test:true,hasMore:false,requests:[]});
  if(url.includes('action=settlement-sim-review')){if(reviewWait)await reviewWait;return readError?Response.json({error:'Test operator access required'},{status:403}):Response.json(latest);}
  if(url.endsWith('action=settlement-sim-start')){
   if(startWait)await startWait;if(startError)return Response.json({error:'Test simulation needs reconciliation. Keep the same reference.'},{status:409});
   const body=JSON.parse(options.body),a=startReply||receipt(body.kind,{requestId:body.requestId});
   latest=review({...latest,attempts:[...latest.attempts.filter(v=>v.requestId!==a.requestId).map(v=>body.kind!=='transfer'&&v.kind==='transfer'?{...v,availableCents:0}:v),a]});return Response.json(a);
  }
  if(url.endsWith('action=settlement-sim-reconcile')){
   if(reconcileWait)await reconcileWait;const body=JSON.parse(options.body),a=reconcileReply||latest.attempts.find(v=>v.requestId===body.requestId)||receipt('transfer',{requestId:body.requestId});
   latest=review({...latest,attempts:[...latest.attempts.filter(v=>v.requestId!==a.requestId),a]});return Response.json(a);
  }
  throw Error('Unexpected request '+url);
 };
 const context={document:{getElementById:get,createElement:element},location:{search:'',hash:'',pathname:'/api/test-marketplace'},history:{replaceState(){}},sessionStorage:storage(session),localStorage:storage(local),createTestEmailSignin:()=>({}),createTestRefundRequests:()=>({current:()=>null}),crypto:{randomUUID:()=>uuids[n++]},URL,URLSearchParams,Intl,AbortSignal,fetch};
 vm.runInNewContext(fs.readFileSync(require.resolve('../test-marketplace.js'),'utf8'),context);
 const walk=n=>[n,...n.children.flatMap(walk)],all=()=>walk(get('orders')),find=text=>all().find(n=>n.textContent===text),posts=()=>calls.filter(c=>c.options?.method==='POST'&&c.url.includes('settlement-sim'));
 return {get,all,find,calls,posts,local,setReview:v=>latest=v,revoke:()=>readError=true,waitReview:v=>reviewWait=v,waitStart:v=>startWait=v,waitReconcile:v=>reconcileWait=v,uuidCount:()=>n};
}
async function load(ui){await tick();await ui.find('Review payout simulation').fire();await tick();}
const visible=(ui,text)=>{const b=ui.find(text);return !!b&&!b.hidden&&!b.disabled;};
test('payout simulation requires the exact flag and an operator; opening it performs no transaction',async()=>{
 for(const options of [{enabled:false},{enabled:'absent'},{enabled:'true'},{allowed:false}]){const ui=setup(options);await tick();assert.equal(ui.find('Seller payout simulation — test funds only'),undefined);assert.equal(ui.calls.some(c=>c.url.includes('settlement-sim')),false);}
 const ui=setup();await tick();assert.ok(ui.find('Seller payout simulation — test funds only'));assert.equal(ui.calls.some(c=>c.url.includes('settlement-sim')),false);assert.equal(visible(ui,'Simulate transfer to seller'),false);
 await load(ui);assert.equal(ui.posts().length,0);assert.equal(visible(ui,'Simulate transfer to seller'),true);assert.ok(ui.all().some(n=>n.textContent.includes('No real money moves')));assert.equal(ui.all().some(n=>n.tag==='input'&&n.type!=='text'),false);
});
test('a transfer uses only a stable reference after a fresh check, and duplicate clicks dispatch once',async()=>{
 let release;const wait=new Promise(r=>release=r),ui=setup({waitStart:wait});await load(ui);const b=ui.find('Simulate transfer to seller'),work=b.fire();await tick();await b.fire();
 assert.equal(ui.posts().length,1);assert.deepEqual(JSON.parse(ui.posts()[0].options.body),{orderId:O,requestId:T,kind:'transfer'});assert.equal(JSON.parse(ui.local.get(KEY)).transfer.phase,'submitted');assert.equal(ui.uuidCount(),1);
 const actions=ui.calls.filter(c=>c.url.includes('settlement-sim')).map(c=>c.url.split('action=')[1].split('&')[0]);assert.deepEqual(actions,['settlement-sim-review','settlement-sim-review','settlement-sim-start']);
 release();await work;await tick();assert.equal(visible(ui,'Simulate transfer to seller'),false);assert.ok(ui.find('Check saved transfer to the test seller'));assert.equal(ui.posts().length,1);
});
test('only one confirmed transfer can parent a test payout or recovery, and no amounts or bank fields are sent',async()=>{
 for(const [kind,label]of [['payout','Simulate seller bank payout'],['reversal','Simulate transfer recovery']]){
  const ui=setup({initial:review({attempts:[receipt()]}),uuids:[kind==='payout'?P:R]});await load(ui);assert.equal(visible(ui,label),true);await ui.find(label).fire();await tick();
  assert.deepEqual(JSON.parse(ui.posts()[0].options.body),{orderId:O,requestId:kind==='payout'?P:R,kind,parentRequestId:T});assert.equal(visible(ui,label),false);assert.equal(ui.uuidCount(),1);assert.equal(ui.all().some(n=>/Live ready/.test(n.textContent)),false);
 }
 const ambiguous=setup({initial:review({attempts:[receipt(),receipt('transfer',{requestId:R})]})});await load(ambiguous);assert.equal(visible(ambiguous,'Simulate seller bank payout'),false);assert.equal(visible(ambiguous,'Simulate transfer recovery'),false);
});
test('unknown results and reloads reconcile the original reference without starting a replacement',async()=>{
 const ui=setup({startError:true});await load(ui);await ui.find('Simulate transfer to seller').fire();await tick();assert.equal(ui.posts().length,1);assert.equal(ui.uuidCount(),1);
 await ui.find('Review payout simulation').fire();await tick();assert.equal(visible(ui,'Simulate transfer to seller'),false);assert.ok(ui.find('Check saved transfer to the test seller'));
 const reloaded=setup({savedLocal:[...ui.local],reconcileReply:receipt()});await load(reloaded);assert.equal(visible(reloaded,'Simulate transfer to seller'),false);await reloaded.find('Check saved transfer to the test seller').fire();await tick();
 assert.equal(reloaded.uuidCount(),0);assert.equal(reloaded.posts().length,1);assert.ok(reloaded.posts()[0].url.endsWith('settlement-sim-reconcile'));assert.deepEqual(JSON.parse(reloaded.posts()[0].options.body),{orderId:O,requestId:T});
 const known=setup({initial:review({attempts:[receipt('transfer',{state:'outcome_unknown',needsReview:true,recoveryRequired:true})]})});await load(known);assert.equal(visible(known,'Simulate transfer to seller'),false);await known.find('Check saved transfer to the test seller').fire();await tick();assert.ok(known.posts()[0].url.endsWith('settlement-sim-reconcile'));assert.equal(known.uuidCount(),0);
});
test('prepared references resume only their saved operation; submitted unresolved children hold all new work',async()=>{
 const prepared={transfer:{requestId:T,parentRequestId:null,phase:'prepared'}},ui=setup({savedLocal:[[KEY,JSON.stringify(prepared)]],uuids:[]});await load(ui);await ui.find('Simulate transfer to seller').fire();await tick();assert.equal(ui.uuidCount(),0);assert.equal(JSON.parse(ui.posts()[0].options.body).requestId,T);
 const server=setup({initial:review({attempts:[receipt('transfer',{state:'prepared'})]}),uuids:[]});await load(server);await server.find('Simulate transfer to seller').fire();await tick();assert.equal(server.uuidCount(),0);assert.equal(JSON.parse(server.posts()[0].options.body).requestId,T);
 const child=setup({initial:review({attempts:[receipt()]}),savedLocal:[[KEY,JSON.stringify({payout:{requestId:P,parentRequestId:T,phase:'submitted'}})]]});await load(child);for(const text of ['Simulate transfer to seller','Simulate seller bank payout','Simulate transfer recovery'])assert.equal(visible(child,text),false);assert.ok(child.find('Check saved test bank payout'));
});
test('failed, pending or review results stay held and provide checks instead of replacement actions',async()=>{
 for(const a of [receipt('payout',{state:'failed',recoveryRequired:true}),receipt('payout',{state:'canceled',recoveryRequired:true}),receipt('payout',{state:'pending'}),receipt('transfer',{availableCents:0,needsReview:true,recoveryRequired:true})]){
  const ui=setup({initial:review({attempts:a.kind==='transfer'?[a]:[receipt('transfer',{availableCents:0}),a]})});await load(ui);for(const text of ['Simulate transfer to seller','Simulate seller bank payout','Simulate transfer recovery'])assert.equal(visible(ui,text),false);assert.ok(ui.all().some(n=>n.textContent.startsWith('Check saved ')));assert.equal(ui.posts().length,0);
 }
 const held=setup({initial:review({blockers:['delivery_wait_unverified'],transferableCents:null})});await load(held);assert.equal(visible(held,'Simulate transfer to seller'),false);
});
test('malformed, foreign, live, negative or contradictory replies clear previously eligible controls',async()=>{
 const patches=[{test:false},{simulationOnly:false},{orderId:S},{liveReady:true},{releaseEnabled:true},{transferableCents:-1},{transferableCents:'2000'},{blockers:['repeat','repeat'],transferableCents:null},{blockers:['bad field'],transferableCents:null},{attempts:[receipt('transfer',{availableCents:2001})]},{attempts:[receipt('payout',{state:'succeeded'})]},{attempts:[receipt('payout',{state:'failed',recoveryRequired:false})]},{attempts:[receipt(),receipt()]}];
 for(const patch of patches){const ui=setup();await load(ui);ui.setReview(review(patch));await ui.find('Simulate transfer to seller').fire();await tick();assert.equal(ui.posts().length,0,JSON.stringify(patch));assert.equal(visible(ui,'Simulate transfer to seller'),false);assert.match(ui.get('notice').textContent,/confirmation|Repeated/);}
 for(const raw of ['{bad',JSON.stringify({transfer:{requestId:T,parentRequestId:null,phase:'submitted',amountCents:1}})]){const ui=setup({savedLocal:[[KEY,raw]]});await load(ui);assert.equal(visible(ui,'Simulate transfer to seller'),false);assert.equal(ui.posts().length,0);}
});
test('fresh operator access loss blocks mutation, and stale review data never restores signed-out controls',async()=>{
 const ui=setup();await load(ui);ui.revoke();await ui.find('Simulate transfer to seller').fire();await tick();assert.equal(ui.posts().length,0);assert.equal(ui.uuidCount(),0);assert.equal(visible(ui,'Simulate transfer to seller'),false);
 for(const action of ['Review payout simulation','Simulate transfer to seller']){let release;const wait=new Promise(r=>release=r),late=setup();await load(late);late.waitReview(wait);const work=late.find(action).fire();late.get('logout').fire();release();await work;await tick();assert.equal(late.get('orders').children.length,0);assert.equal(late.posts().length,0);assert.match(late.get('notice').textContent,/Signed out/);}
});
test('late start and reconciliation receipts do not trigger reads or restore private data after sign-out',async()=>{
 for(const mode of ['start','reconcile']){let release;const wait=new Promise(r=>release=r),ui=setup({initial:mode==='start'?review():review({attempts:[receipt()]})});await load(ui);mode==='start'?ui.waitStart(wait):ui.waitReconcile(wait);const button=ui.find(mode==='start'?'Simulate transfer to seller':'Check saved transfer to the test seller'),work=button.fire();await tick();await button.fire();const reads=ui.calls.filter(c=>c.url.includes('settlement-sim-review')).length;ui.get('logout').fire();release();await work;await tick();assert.equal(ui.posts().length,1);assert.equal(ui.calls.filter(c=>c.url.includes('settlement-sim-review')).length,reads);assert.equal(ui.get('orders').children.length,0);assert.match(ui.get('notice').textContent,/Signed out/);}
});
test('bad mutation receipts keep references held and cannot claim a completed payout',async()=>{
 for(const startReply of [receipt('transfer',{orderId:S}),receipt('transfer',{requestId:R}),receipt('payout',{requestId:T}),receipt('transfer',{releaseEnabled:true})]){const ui=setup({startReply});await load(ui);await ui.find('Simulate transfer to seller').fire();await tick();assert.equal(ui.posts().length,1);assert.equal(JSON.parse(ui.local.get(KEY)).transfer.requestId,T);assert.equal(visible(ui,'Simulate seller bank payout'),false);assert.equal(ui.all().some(n=>n.textContent==='Test bank payout reported paid'),false);assert.match(ui.get('notice').textContent,/confirmation/);}
});

test('fresh server-prepared requests resume the exact locally submitted UUID without replacement',async()=>{
 for(const kind of ['transfer','payout','reversal']){
  const id=kind==='transfer'?T:kind==='payout'?P:R,prepared=receipt(kind,{state:'prepared'}),attempts=kind==='transfer'?[prepared]:[receipt('transfer',{availableCents:0}),prepared];
  const ui=setup({initial:review({attempts}),savedLocal:[[KEY,JSON.stringify({[kind]:{requestId:id,parentRequestId:kind==='transfer'?null:T,phase:'submitted'}})]],uuids:[]});await load(ui);
  const label=kind==='transfer'?'Simulate transfer to seller':kind==='payout'?'Simulate seller bank payout':'Simulate transfer recovery';assert.equal(visible(ui,label),true,kind);
  await ui.find(label).fire();await tick();assert.equal(ui.posts().length,1,kind);assert.deepEqual(JSON.parse(ui.posts()[0].options.body),{orderId:O,requestId:id,kind,...(kind==='transfer'?{}:{parentRequestId:T})});assert.equal(ui.uuidCount(),0,kind);
 }
});
test('server-verified returned funds permit recovery while failed payout and refund holds remain',async()=>{
 for(const state of ['failed','canceled']){
  const failed=receipt('payout',{state,needsReview:true,recoveryRequired:true}),parent=receipt('transfer',{needsReview:true,recoveryRequired:true});
  const ui=setup({initial:review({blockers:['refund_hold'],transferableCents:null,attempts:[parent,failed]}),uuids:[R],startReply:receipt('reversal',{needsReview:true,recoveryRequired:true})});await load(ui);
  assert.equal(visible(ui,'Simulate transfer recovery'),true);assert.equal(visible(ui,'Simulate seller bank payout'),false);assert.equal(visible(ui,'Simulate transfer to seller'),false);assert.ok(ui.all().some(n=>n.textContent.startsWith('Test funds remain held.')));
  await ui.find('Simulate transfer recovery').fire();await tick();assert.deepEqual(JSON.parse(ui.posts()[0].options.body),{orderId:O,requestId:R,kind:'reversal',parentRequestId:T});assert.equal(ui.uuidCount(),1);assert.equal(visible(ui,'Simulate seller bank payout'),false);assert.equal(visible(ui,'Simulate transfer recovery'),false);assert.ok(ui.find('Check saved test transfer recovery'));assert.ok(ui.all().some(n=>n.textContent.startsWith('Test funds remain held.')));assert.ok(ui.all().some(n=>n.textContent.includes('Follow-up review required.')));
 }
});
test('a held prepared recovery resumes its reserved UUID even when available parent funds are zero',async()=>{
 for(const savedLocal of [[],[[KEY,JSON.stringify({reversal:{requestId:R,parentRequestId:T,phase:'submitted'}})]]]){
  const held=receipt('reversal',{state:'prepared',needsReview:true,recoveryRequired:true}),ui=setup({initial:review({blockers:['refund_hold'],transferableCents:null,attempts:[receipt('transfer',{availableCents:0,needsReview:true,recoveryRequired:true}),held]}),savedLocal,uuids:[],startReply:receipt('reversal',{needsReview:true,recoveryRequired:true})});await load(ui);
  assert.equal(visible(ui,'Simulate transfer recovery'),true);assert.equal(visible(ui,'Simulate seller bank payout'),false);await ui.find('Simulate transfer recovery').fire();await tick();assert.deepEqual(JSON.parse(ui.posts()[0].options.body),{orderId:O,requestId:R,kind:'reversal',parentRequestId:T});assert.equal(ui.uuidCount(),0);assert.ok(ui.all().some(n=>n.textContent.startsWith('Test funds remain held.')));
 }
});
test('new recovery needs fresh available funds; unknown recovery or unrelated pending reservations stay check-only',async()=>{
 const heldParent=receipt('transfer',{needsReview:true,recoveryRequired:true});
 for(const attempts of [[{...heldParent,availableCents:0},receipt('payout',{state:'failed',needsReview:true,recoveryRequired:true})],[heldParent,receipt('reversal',{state:'outcome_unknown',needsReview:true,recoveryRequired:true})],[heldParent,receipt('reversal')],[heldParent,receipt('payout',{state:'pending'})],[heldParent,receipt('payout',{state:'prepared'})]]){
  const ui=setup({initial:review({blockers:['refund_hold'],transferableCents:null,attempts})});await load(ui);assert.equal(visible(ui,'Simulate transfer recovery'),false);assert.equal(ui.posts().length,0);assert.equal(ui.uuidCount(),0);
 }
 const changed=setup({initial:review({attempts:[heldParent]})});await load(changed);assert.equal(visible(changed,'Simulate transfer recovery'),true);changed.setReview(review({attempts:[{...heldParent,availableCents:0}]}));await changed.find('Simulate transfer recovery').fire();await tick();assert.equal(changed.posts().length,0);assert.equal(changed.uuidCount(),0);
});
test('a prepared payout with new holds and a prepared child with a foreign saved parent cannot resume',async()=>{
 const parent=receipt('transfer',{availableCents:0}),prepared=receipt('payout',{state:'prepared'});
 for(const opts of [{initial:review({blockers:['refund_hold'],transferableCents:null,attempts:[parent,prepared]})},{initial:review({attempts:[{...parent,needsReview:true,recoveryRequired:true},prepared]})},{initial:review({attempts:[parent,prepared]}),savedLocal:[[KEY,JSON.stringify({payout:{requestId:P,parentRequestId:R,phase:'submitted'}})]]}]){
  const ui=setup({...opts,uuids:[]});await load(ui);assert.equal(visible(ui,'Simulate seller bank payout'),false);assert.equal(ui.posts().length,0);assert.equal(ui.uuidCount(),0);
 }
});
