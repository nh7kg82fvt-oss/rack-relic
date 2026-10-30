const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const {createTestRefundRequests}=require('../test-refund-requests.js');
const MEMBER='22222222-2222-4222-8222-222222222222',ORDER='11111111-1111-4111-8111-111111111111',REQUEST='44444444-4444-4444-8444-444444444444';
const tick=()=>new Promise(r=>setImmediate(r));
function setup({allowed=false,delayedOrders,delayedCheckout}={}){
 const nodes=new Map(),calls=[],saved=new Map([['rr-private-test-session',JSON.stringify({token:'fixture-token',member:MEMBER,email:'operator@example.com'})]]),local=new Map();
 const element=tag=>({tag,children:[],textContent:'',value:'',hidden:false,disabled:false,events:{},append(...items){this.children.push(...items);},replaceChildren(){this.children=[];},addEventListener(name,fn){this.events[name]=fn;},reportValidity(){return true;},fire(name='click'){return this.events[name]?.({preventDefault(){}});}});
 const get=id=>{if(!nodes.has(id))nodes.set(id,element('div'));return nodes.get(id);};
 const storage=map=>({getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)});
 let reads=0;const order={id:ORDER,buyer_id:MEMBER,seller_id:'33333333-3333-4333-8333-333333333333',state:'paid',total_cents:3427,refund_state:'none',refunded_cents:0,refund_pending_cents:0};
 const fetch=async(url,options)=>{
  calls.push({url,options});if(url.endsWith('config'))return Response.json({notice:'fixture',publishableKey:'fixture'});
  if(url.endsWith('refund-access'))return allowed?Response.json({test:true,allowed:true}):Response.json({error:'denied'},{status:403});
  if(url.endsWith('orders')){reads++;if(delayedOrders&&reads>1)await delayedOrders;return Response.json({orders:[order]});}
  if(url.endsWith('checkout')){if(delayedCheckout)await delayedCheckout;return Response.json({url:'https://checkout.stripe.com/fixture'});}
  if(url.includes('action=refund')){const q=JSON.parse(options.body);return Response.json({test:true,...q,state:'request_recorded'});}
  throw Error('Unexpected URL '+url);
 };
 const context={document:{getElementById:get,createElement:element},location:{search:'',hash:'',pathname:'/api/test-marketplace',assign:url=>calls.push({redirect:url})},history:{replaceState(){}},sessionStorage:storage(saved),localStorage:storage(local),createTestEmailSignin:()=>({}),createTestRefundRequests:args=>createTestRefundRequests({...args,uuid:()=>REQUEST}),crypto:{randomUUID:()=>REQUEST},URL,URLSearchParams,Intl,AbortSignal,fetch};
 vm.runInNewContext(fs.readFileSync(require.resolve('../test-marketplace.js'),'utf8'),context);
 const walk=n=>[n,...n.children.flatMap(walk)];return {get,calls,saved,local,all:()=>walk(get('orders'))};
}
test('ordinary members never see operator controls; configured operators review before dispatch',async()=>{
 const ordinary=setup();await tick();assert.equal(ordinary.all().some(n=>n.textContent==='Operator test refund'),false);
 const operator=setup({allowed:true});await tick();assert.ok(operator.all().some(n=>n.textContent==='Operator test refund'));
 let form=operator.all().find(n=>n.tag==='form');form.children.find(n=>n.tag==='input').value='10.00';await form.fire('submit');await tick();
 assert.equal(operator.calls.filter(c=>c.options?.method==='POST').length,0);const issue=operator.all().find(n=>n.textContent==='Issue $10.00 test refund');assert.ok(issue);await issue.fire();await tick();
 const posts=operator.calls.filter(c=>c.options?.method==='POST');assert.equal(posts.length,1);assert.deepEqual(JSON.parse(posts[0].options.body),{requestId:REQUEST,orderId:ORDER,amountCents:1000});assert.ok(operator.all().some(n=>n.textContent==='Check saved refund request'));assert.equal(operator.all().some(n=>n.textContent==='Full test refund confirmed'),false);
});
test('stale order responses cannot restore private orders after sign-out',async()=>{
 let release;const pending=new Promise(r=>release=r),ui=setup({delayedOrders:pending});await tick();const refresh=ui.get('refresh').fire();ui.get('logout').fire();release();await refresh;await tick();assert.equal(ui.get('orders').children.length,0);assert.equal(ui.saved.has('rr-private-test-session'),false);assert.equal(ui.get('signed-in').hidden,true);
});
test('signing out while checkout is pending prevents a later redirect',async()=>{
 let release;const pending=new Promise(r=>release=r),ui=setup({delayedCheckout:pending});await tick();const checkout=ui.get('checkout').fire();ui.get('logout').fire();release();await checkout;await tick();assert.equal(ui.calls.some(c=>c.redirect),false);assert.equal(ui.get('orders').children.length,0);
});
test('invalid or excessive refund amounts never dispatch a request',async()=>{
 const ui=setup({allowed:true});await tick();for(const value of ['0','10.001','1e2','34.28']){const form=ui.all().find(n=>n.tag==='form');form.children.find(n=>n.tag==='input').value=value;await form.fire('submit');await tick();}assert.equal(ui.calls.filter(c=>c.options?.method==='POST').length,0);assert.equal(ui.local.size,0);
});
