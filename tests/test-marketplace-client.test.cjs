const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const {createTestRefundRequests}=require('../test-refund-requests.js');
const MEMBER='22222222-2222-4222-8222-222222222222',ORDER='11111111-1111-4111-8111-111111111111',REQUEST='44444444-4444-4444-8444-444444444444';
const tick=()=>new Promise(r=>setImmediate(r));
function setup({allowed=false,delayedOrders,delayedCheckout,delayedCancel,delayedReview,reviewRequests=[],reviewError=false,hasMore=false,noOrders=false,listingId=ORDER,priorOrders={},orderPatch={}}={}){
 const nodes=new Map(),calls=[],saved=new Map([['rr-private-test-session',JSON.stringify({token:'fixture-token',member:MEMBER,email:'operator@example.com'})]]),local=new Map();for(const [k,v] of Object.entries(priorOrders))saved.set(k,v);
 const element=tag=>({tag,children:[],textContent:'',value:'',hidden:false,disabled:false,events:{},append(...items){this.children.push(...items);},replaceChildren(){this.children=[];},addEventListener(name,fn){this.events[name]=fn;},reportValidity(){return true;},fire(name='click'){return this.events[name]?.({preventDefault(){}});}});
 const get=id=>{if(!nodes.has(id))nodes.set(id,element('div'));return nodes.get(id);};
 const storage=map=>({getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)});
 let reads=0;const order={id:ORDER,buyer_id:MEMBER,seller_id:'33333333-3333-4333-8333-333333333333',state:'paid',total_cents:3427,refund_state:'none',refunded_cents:0,refund_pending_cents:0,listing_id:listingId,...orderPatch};
 const fetch=async(url,options)=>{
  calls.push({url,options});if(url.endsWith('config'))return Response.json({notice:'fixture',publishableKey:'fixture',listing:{id:listingId,title:'Synthetic fixture'}});
  if(url.endsWith('refund-access'))return allowed?Response.json({test:true,allowed:true}):Response.json({error:'denied'},{status:403});
  if(url.endsWith('refund-review')){if(delayedReview)await delayedReview;return reviewError?Response.json({error:'unavailable'},{status:503}):Response.json({test:true,hasMore,requests:reviewRequests});}
  if(url.endsWith('orders')){reads++;if(delayedOrders&&reads>1)await delayedOrders;return Response.json({orders:noOrders?[]:[order]});}
  if(url.endsWith('cancel-preparation')){if(delayedCancel)await delayedCancel;order.state='cancelled';order.can_cancel_preparation=false;return Response.json({test:true,orderId:ORDER,state:'cancelled'});}
  if(url.endsWith('checkout')){if(delayedCheckout)await delayedCheckout;return Response.json({url:'https://checkout.stripe.com/fixture'});}
  if(url.includes('action=refund')){const q=JSON.parse(options.body);return Response.json({test:true,...q,state:'request_recorded'});}
  throw Error('Unexpected URL '+url);
 };
 const context={document:{getElementById:get,createElement:element},location:{search:'',hash:'',pathname:'/api/test-marketplace',assign:url=>calls.push({redirect:url})},history:{replaceState(){}},sessionStorage:storage(saved),localStorage:storage(local),createTestEmailSignin:()=>({}),createTestRefundRequests:args=>createTestRefundRequests({...args,uuid:()=>REQUEST}),crypto:{randomUUID:()=>REQUEST},URL,URLSearchParams,Intl,AbortSignal,fetch};
 vm.runInNewContext(fs.readFileSync(require.resolve('../test-marketplace.js'),'utf8'),context);
 const walk=n=>[n,...n.children.flatMap(walk)];return {get,calls,saved,local,order,setAllowed:value=>allowed=value,reviewAll:()=>walk(get('refund-review-rows')),all:()=>walk(get('orders'))};
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
 let release;const pending=new Promise(r=>release=r),ui=setup({delayedCheckout:pending});await tick();const checkout=ui.get('checkout').fire();assert.ok(ui.calls.some(c=>c.url?.endsWith('checkout')&&c.options?.method==='POST'));ui.get('logout').fire();release();await checkout;await tick();assert.equal(ui.calls.some(c=>c.redirect),false);assert.equal(ui.get('orders').children.length,0);
});
test('invalid or excessive refund amounts never dispatch a request',async()=>{
 const ui=setup({allowed:true});await tick();for(const value of ['0','10.001','1e2','34.28']){const form=ui.all().find(n=>n.tag==='form');form.children.find(n=>n.tag==='input').value=value;await form.fire('submit');await tick();}assert.equal(ui.calls.filter(c=>c.options?.method==='POST').length,0);assert.equal(ui.local.size,0);
});
test('checkout references stay separate per fixture and preserve the original legacy order',async()=>{
 const original='73737373-7373-4373-8373-737373737373',fixture='84848484-8484-4484-8484-848484848484',legacy='55555555-5555-4555-8555-555555555555',key='rr-private-test-order-'+MEMBER;
 const old=setup({listingId:original,priorOrders:{[key]:legacy}});await tick();await old.get('checkout').fire();const oldPost=old.calls.find(c=>c.url?.endsWith('checkout'));assert.equal(JSON.parse(oldPost.options.body).orderId,legacy);assert.equal(old.saved.get(key+':'+original),legacy);
 const fresh=setup({listingId:fixture,priorOrders:{[key]:legacy}});await tick();await fresh.get('checkout').fire();const post=fresh.calls.find(c=>c.url?.endsWith('checkout'));assert.equal(JSON.parse(post.options.body).orderId,REQUEST);assert.equal(JSON.parse(post.options.body).listingId,fixture);assert.equal(fresh.saved.get(key),legacy);
});
test('a signed expired or failed order can prepare a new reference without creating a payment',async()=>{
 const key='rr-private-test-order-'+MEMBER+':'+ORDER;
 for(const state of ['expired','payment_failed']){
  const ui=setup({orderPatch:{state},priorOrders:{[key]:ORDER}});await tick();
  const next=ui.all().find(n=>n.textContent==='Prepare a new test checkout');assert.ok(next);await next.fire();await tick();
  assert.equal(ui.saved.get(key),REQUEST);assert.equal(ui.calls.filter(c=>c.options?.method==='POST').length,0);
  assert.ok(ui.all().some(n=>n.textContent==='Order '+ORDER));
  await ui.get('checkout').fire();assert.equal(JSON.parse(ui.calls.find(c=>c.url?.endsWith('checkout')).options.body).orderId,REQUEST);
 }
});
test('open, processing, paid and unknown orders never offer a new checkout reference',async()=>{
 const key='rr-private-test-order-'+MEMBER+':'+ORDER;
 for(const state of ['reserved','checkout_open','payment_pending','paid','review','unknown']){
  const ui=setup({orderPatch:{state},priorOrders:{[key]:ORDER}});await tick();assert.equal(ui.all().some(n=>n.textContent==='Prepare a new test checkout'),false);assert.equal(ui.saved.get(key),ORDER);
 }
});
test('a changed financial state on the fresh read keeps the existing checkout reference',async()=>{
 const key='rr-private-test-order-'+MEMBER+':'+ORDER,ui=setup({orderPatch:{state:'expired'},priorOrders:{[key]:ORDER}});await tick();
 const next=ui.all().find(n=>n.textContent==='Prepare a new test checkout');ui.order.state='paid';await next.fire();await tick();
 assert.equal(ui.saved.get(key),ORDER);assert.equal(ui.calls.filter(c=>c.options?.method==='POST').length,0);assert.match(ui.get('notice').textContent,/needs confirmation/);
});
test('sign-out during closed-order verification cannot replace the saved reference',async()=>{
 let release;const pending=new Promise(r=>release=r),key='rr-private-test-order-'+MEMBER+':'+ORDER;
 const ui=setup({orderPatch:{state:'expired'},priorOrders:{[key]:ORDER},delayedOrders:pending});await tick();
 const work=ui.all().find(n=>n.textContent==='Prepare a new test checkout').fire();ui.get('logout').fire();release();await work;await tick();
 assert.equal(ui.saved.get(key),ORDER);assert.equal(ui.get('orders').children.length,0);
});
test('sale cards cannot replace a buyer checkout reference',async()=>{
 const ui=setup({orderPatch:{state:'expired',buyer_id:'55555555-5555-4555-8555-555555555555',seller_id:MEMBER},priorOrders:{['rr-private-test-order-'+MEMBER+':'+ORDER]:ORDER}});await tick();assert.equal(ui.all().some(n=>n.textContent==='Prepare a new test checkout'),false);
});
test('cancelling a prepared checkout preserves its reference and history without a payment request',async()=>{
 const key='rr-private-test-order-'+MEMBER+':'+ORDER,ui=setup({orderPatch:{state:'reserved',can_cancel_preparation:true,total_cents:null},priorOrders:{[key]:ORDER}});await tick();
 await ui.all().find(n=>n.textContent==='Cancel checkout preparation').fire();await tick();
 const posts=ui.calls.filter(c=>c.options?.method==='POST');assert.equal(posts.length,1);assert.ok(posts[0].url.endsWith('cancel-preparation'));assert.deepEqual(JSON.parse(posts[0].options.body),{orderId:ORDER});
 assert.equal(ui.saved.get(key),ORDER);assert.ok(ui.all().some(n=>n.textContent==='Preparation cancelled — no payment session created'));
 assert.equal(ui.get('orders').children[0].children[2].hidden,true);
 assert.ok(ui.all().some(n=>n.textContent==='Prepare a new test checkout'));assert.equal(ui.calls.some(c=>c.url?.endsWith('checkout')),false);
});
test('missing capability, non-buyer and dispatched states never offer preparation cancellation',async()=>{
 for(const orderPatch of [{state:'reserved'},{state:'reserved',can_cancel_preparation:'true'},{state:'checkout_open',can_cancel_preparation:true},{state:'paid',can_cancel_preparation:true},{state:'reserved',can_cancel_preparation:true,buyer_id:REQUEST,seller_id:MEMBER}]){
  const ui=setup({orderPatch});await tick();assert.equal(ui.all().some(n=>n.textContent==='Cancel checkout preparation'),false);
 }
});
test('a fresh loss of cancellation capability prevents the cancellation request',async()=>{
 const ui=setup({orderPatch:{state:'reserved',can_cancel_preparation:true}});await tick();const cancel=ui.all().find(n=>n.textContent==='Cancel checkout preparation');ui.order.can_cancel_preparation=false;
 await cancel.fire();await tick();assert.equal(ui.calls.filter(c=>c.options?.method==='POST').length,0);assert.match(ui.get('notice').textContent,/may have started/);
});
test('sign-out while checking cancellation eligibility prevents a late cancellation POST',async()=>{
 let release;const pending=new Promise(r=>release=r),ui=setup({delayedOrders:pending,orderPatch:{state:'reserved',can_cancel_preparation:true}});await tick();
 const work=ui.all().find(n=>n.textContent==='Cancel checkout preparation').fire();ui.get('logout').fire();release();await work;await tick();assert.equal(ui.calls.filter(c=>c.options?.method==='POST').length,0);assert.equal(ui.get('orders').children.length,0);
});
test('duplicate cancellation clicks send one request and a late response after sign-out stays private',async()=>{
 let release;const pending=new Promise(r=>release=r),key='rr-private-test-order-'+MEMBER+':'+ORDER;
 const ui=setup({delayedCancel:pending,orderPatch:{state:'reserved',can_cancel_preparation:true},priorOrders:{[key]:ORDER}});await tick();const button=ui.all().find(n=>n.textContent==='Cancel checkout preparation');
 const work=button.fire();await tick();await button.fire();ui.get('logout').fire();release();await work;await tick();
 assert.equal(ui.calls.filter(c=>c.options?.method==='POST').length,1);assert.equal(ui.saved.get(key),ORDER);assert.equal(ui.get('orders').children.length,0);assert.match(ui.get('notice').textContent,/Signed out/);
});

test('refund review is operator-only and read-only with explicit evidence states',async()=>{
 const ordinary=setup();await tick();assert.equal(ordinary.get('refund-review').hidden,true);assert.equal(ordinary.calls.some(c=>c.url?.endsWith('refund-review')),false);
 const states=['needs_review','not_dispatched','outcome_unknown','awaiting_notice','processing','confirmed','failed'];
 const ui=setup({allowed:true,reviewRequests:states.map(reviewState=>({requestId:REQUEST,orderId:ORDER,amountCents:1000,reviewState})),hasMore:true});await tick();
 assert.equal(ui.get('refund-review').hidden,false);assert.equal(ui.reviewAll().filter(n=>n.tag==='article').length,7);assert.equal(ui.reviewAll().some(n=>n.tag==='button'||n.tag==='form'),false);
 assert.ok(ui.reviewAll().some(n=>n.textContent.includes('Outcome unknown')));assert.ok(ui.reviewAll().some(n=>n.textContent.includes('first 100')));assert.equal(ui.calls.filter(c=>c.options?.method==='POST').length,0);
});
test('late review responses cannot restore private information after sign-out',async()=>{
 let release;const delayedReview=new Promise(r=>release=r),ui=setup({allowed:true,delayedReview,reviewRequests:[{requestId:REQUEST,orderId:ORDER,amountCents:1000,reviewState:'confirmed'}]});await tick();ui.get('logout').fire();release();await tick();
 assert.equal(ui.get('refund-review').hidden,true);assert.equal(ui.get('refund-review-rows').children.length,0);
});
test('operator permission loss clears the previous review and missing review schema preserves orders',async()=>{
 const ui=setup({allowed:true});await tick();assert.equal(ui.get('refund-review').hidden,false);ui.setAllowed(false);await ui.get('refresh').fire();await tick();assert.equal(ui.get('refund-review').hidden,true);assert.equal(ui.get('refund-review-rows').children.length,0);
 const unavailable=setup({allowed:true,reviewError:true});await tick();assert.ok(unavailable.reviewAll().some(n=>n.textContent.includes('temporarily unavailable')));assert.ok(unavailable.all().some(n=>n.textContent==='Order '+ORDER));assert.equal(unavailable.saved.has('rr-private-test-session'),true);
});
test('empty order lists still load review and inherited status labels are rejected',async()=>{
 const empty=setup({allowed:true,noOrders:true});await tick();assert.equal(empty.get('refund-review').hidden,false);assert.ok(empty.reviewAll().some(n=>n.textContent.includes('No saved refund requests')));
 const malformed=setup({allowed:true,reviewRequests:[{requestId:REQUEST,orderId:ORDER,amountCents:1000,reviewState:'toString'}]});await tick();assert.ok(malformed.reviewAll().some(n=>n.textContent.includes('temporarily unavailable')));assert.equal(malformed.reviewAll().some(n=>n.tag==='article'),false);
});
