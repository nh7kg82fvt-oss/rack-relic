const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const {createTestRefundRequests}=require('../test-refund-requests.js');
const {publicIssueRefundReview}=require('../test-issue-refund-review.js');
const protection=require('../test-protection-review.js');
const MEMBER='22222222-2222-4222-8222-222222222222',ORDER='11111111-1111-4111-8111-111111111111',REQUEST='44444444-4444-4444-8444-444444444444';
const tick=()=>new Promise(r=>setImmediate(r));
function setup({sellerProtectionsEnabled=false,protectionReply,delayedProtection,delayedHold,issueRefundReviewEnabled=false,issueRefundReviewReply,delayedIssueRefundReview,issueResponsesEnabled=false,delayedThreadRead,delayedThreadWrite,threadReply,issueReviewEnabled=false,delayedIssueReview,delayedIssueAck,issueReviewReply,orderIssuesEnabled=false,delayedIssue,issueReply,sellerOnboardingEnabled=false,sellerReply,delayedSeller,allowed=false,trackingEnabled=false,trackingReply,delayedTracking,riskCheckEnabled=false,riskReply,delayedRisk,sampleLabelsEnabled=false,labelReply,delayedLabel,labelError=false,delayedOrders,delayedCheckout,delayedCancel,delayedReview,reviewRequests=[],reviewError=false,delayedFee,feeReply,delayedShipping,shippingReply,shippingMode,delayedFulfillment,fulfillmentReply,hasMore=false,noOrders=false,listingId=ORDER,priorOrders={},orderPatch={}}={}){
 const nodes=new Map(),calls=[],saved=new Map([['rr-private-test-session',JSON.stringify({token:'fixture-token',member:MEMBER,email:'operator@example.com'})]]),local=new Map();for(const [k,v] of Object.entries(priorOrders))saved.set(k,v);
 const element=tag=>({tag,children:[],textContent:'',value:'',hidden:false,disabled:false,events:{},append(...items){this.children.push(...items);},replaceChildren(){this.children=[];},addEventListener(name,fn){this.events[name]=fn;},reportValidity(){return true;},fire(name='click'){return this.events[name]?.({preventDefault(){}});}});
 const get=id=>{if(!nodes.has(id))nodes.set(id,element('div'));return nodes.get(id);};
 const storage=map=>({getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)});
 let threadResponse=null,savedIssue=null,issueAcknowledged=false;let reads=0;const order={id:ORDER,buyer_id:MEMBER,seller_id:'33333333-3333-4333-8333-333333333333',state:'paid',total_cents:3427,refund_state:'none',refunded_cents:0,refund_pending_cents:0,listing_id:listingId,...orderPatch};
 const fetch=async(url,options)=>{
  calls.push({url,options});if(url.endsWith('config'))return Response.json({sellerProtectionsEnabled,issueRefundReviewEnabled,issueResponsesEnabled,issueReviewEnabled,orderIssuesEnabled,sellerOnboardingEnabled,notice:'fixture',publishableKey:'fixture',shippingMode,sampleLabelsEnabled,riskCheckEnabled,trackingEnabled,listing:{id:listingId,title:'Synthetic fixture'}});
  if(url.includes('action=protection-review')){if(delayedProtection)await delayedProtection;return Response.json(protectionReply||{test:true,orderId:ORDER,state:'held',blockers:['live_acceptance_pending','real_delivery_unverified','delivery_wait_unverified','seller_terms_pending','platform_reserve_unconfigured','tax_recovery_unverified','settlement_unavailable'],releaseEnabled:false,transferCreated:false,payoutCreated:false});}
  if(url.includes('action=protection-hold')){if(delayedHold)await delayedHold;return Response.json({test:true,orderId:ORDER,held:true,releaseEnabled:false});}
  if(url.includes('action=issue-refund-review')){if(delayedIssueRefundReview)await delayedIssueRefundReview;return Response.json(issueRefundReviewReply||{test:true,orderId:ORDER,state:'available_for_review',totalCents:3427,confirmedCents:0,pendingCents:0,unconfirmedRequestCount:0,remainingCents:3427,canPrepare:true,fulfillmentReleased:false});}
  if(url.includes('action=issue-thread')){if(options.method==='POST'){if(delayedThreadWrite)await delayedThreadWrite;threadResponse={kind:JSON.parse(options.body).response,submittedAt:'2026-11-02T22:00:00Z'};}else if(delayedThreadRead)await delayedThreadRead;return Response.json(threadReply||{test:true,orderId:ORDER,state:'review_required',reason:'damaged',reportedAt:'2026-11-02T20:00:00Z',acknowledgedAt:null,sellerResponse:threadResponse});}
  if(url.endsWith('action=issue-review')){if(options.method==='POST'){if(delayedIssueAck)await delayedIssueAck;issueAcknowledged=true;return Response.json({test:true,orderId:ORDER,acknowledged:true,acknowledgedAt:'2026-11-02T22:00:00Z'});}if(delayedIssueReview)await delayedIssueReview;return Response.json(issueReviewReply||{test:true,hasMore:false,issues:[{orderId:ORDER,reason:'damaged',reportedAt:'2026-11-02T20:00:00Z',acknowledgedAt:issueAcknowledged?'2026-11-02T22:00:00Z':null}]});}
  if(url.includes('action=order-issue')){if(delayedIssue)await delayedIssue;if(options.method==='POST')savedIssue={test:true,orderId:ORDER,state:'review_required',reason:JSON.parse(options.body).reason,reportedAt:new Date().toISOString()};return Response.json(issueReply||savedIssue||{test:true,orderId:ORDER,state:'not_reported'});}
  if(url.includes('action=seller-onboarding')){if(delayedSeller)await delayedSeller;return Response.json(sellerReply||{test:true,state:'onboarding_required',transfersEnabled:false,payoutsEnabled:false,onboardingUrl:'https://accounts.stripe.com/r/acct_fixture#alu_test_fixtureToken'});}
  if(url.includes('action=tracking')){if(delayedTracking)await delayedTracking;return Response.json(trackingReply||{test:true,orderId:ORDER,state:'not_recorded',status:null,providerStatus:null,eventAt:null,checkedAt:null,needsReview:false,labelPurchaseEnabled:false,payoutAvailable:false});}
  if(url.endsWith('action=risk')){if(delayedRisk)await delayedRisk;const reply=riskReply||{test:true,orderId:ORDER,riskStatus:'review',checkedAt:Date.now(),labelGenerated:false,payoutCreated:false};return Response.json(reply);}
  if(url.includes('action=sample-label')){if(delayedLabel)await delayedLabel;if(labelError)return Response.json({error:'Sample needs review'},{status:503});return Response.json(labelReply||{test:true,orderId:ORDER,requestId:REQUEST,state:'outcome_unknown',labelUrl:null,trackingNumber:null});}
  if(url.endsWith('refund-access'))return allowed?Response.json({test:true,allowed:true}):Response.json({error:'denied'},{status:403});
  if(url.endsWith('refund-review')){if(delayedReview)await delayedReview;return reviewError?Response.json({error:'unavailable'},{status:503}):Response.json({test:true,hasMore,requests:reviewRequests});}
  if(url.includes('action=fulfillment')){if(delayedFulfillment)await delayedFulfillment;return Response.json(fulfillmentReply||{test:true,orderId:ORDER,state:'held',snapshotStored:false,labelPurchaseEnabled:false,holdReasons:['snapshot_missing','refund_hold']});}
  if(url.endsWith('shipping-quote')){if(delayedShipping)await delayedShipping;return Response.json(shippingReply||{test:true,mode:'carrier_connection_test',postagePurchased:false,checkoutChanged:false,rates:[{carrier:'USPS',service:'Ground Advantage',currency:'USD',amountCents:725}]});}
  if(url.includes('action=fee')){if(delayedFee)await delayedFee;return Response.json(feeReply||{test:true,orderId:ORDER,state:'recorded',grossCents:3427,feeCents:129,netCents:3298,payoutAvailable:false});}
  if(url.endsWith('orders')){reads++;if(delayedOrders&&reads>1)await delayedOrders;return Response.json({orders:noOrders?[]:[order]});}
  if(url.endsWith('cancel-preparation')){if(delayedCancel)await delayedCancel;order.state='cancelled';order.can_cancel_preparation=false;return Response.json({test:true,orderId:ORDER,state:'cancelled'});}
  if(url.endsWith('checkout')){if(delayedCheckout)await delayedCheckout;return Response.json({url:'https://checkout.stripe.com/fixture'});}
  if(url.includes('action=refund')){const q=JSON.parse(options.body);return Response.json({test:true,...q,state:'request_recorded'});}
  throw Error('Unexpected URL '+url);
 };
 const context={RackRelicProtectionReview:protection,publicTestIssueRefundReview:publicIssueRefundReview,document:{getElementById:get,createElement:element},location:{search:'',hash:'',pathname:'/api/test-marketplace',assign:url=>calls.push({redirect:url})},history:{replaceState(){}},sessionStorage:storage(saved),localStorage:storage(local),createTestEmailSignin:()=>({}),createTestRefundRequests:args=>createTestRefundRequests({...args,uuid:()=>REQUEST}),crypto:{randomUUID:()=>REQUEST},URL,URLSearchParams,Intl,AbortSignal,fetch};
 vm.runInNewContext(fs.readFileSync(require.resolve('../test-marketplace.js'),'utf8'),context);
 const walk=n=>[n,...n.children.flatMap(walk)];return {get,calls,saved,local,order,setAllowed:value=>allowed=value,issueReviewAll:()=>walk(get('issue-review-rows')),reviewAll:()=>walk(get('refund-review-rows')),all:()=>walk(get('orders'))};
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

test('only operators can view processing-fee controls and refresh records no payout',async()=>{
 const ordinary=setup();await tick();assert.equal(ordinary.all().some(n=>n.textContent==='Original payment processing fee'),false);
 const ui=setup({allowed:true});await tick();assert.ok(ui.all().some(n=>n.textContent==='Original payment processing fee'));
 await ui.all().find(n=>n.textContent==='Load recorded fee').fire();await tick();assert.equal(ui.calls.filter(c=>c.url?.includes('action=fee')&&c.options?.method==='POST').length,0);
 await ui.all().find(n=>n.textContent==='Refresh fee from Stripe').fire();await tick();const post=ui.calls.find(c=>c.url?.includes('action=fee')&&c.options?.method==='POST');assert.deepEqual(JSON.parse(post.options.body),{orderId:ORDER});assert.ok(ui.all().some(n=>n.textContent.includes('fee recorded: $1.29')));assert.ok(ui.all().some(n=>n.textContent.includes('not a seller payout balance')));
});
test('late fee results and duplicate clicks cannot restore private data after sign-out',async()=>{
 let release;const delayedFee=new Promise(r=>release=r),ui=setup({allowed:true,delayedFee});await tick();const button=ui.all().find(n=>n.textContent==='Refresh fee from Stripe'),work=button.fire();await tick();await button.fire();ui.get('logout').fire();release();await work;await tick();assert.equal(ui.get('orders').children.length,0);assert.equal(ui.calls.filter(c=>c.url?.includes('action=fee')&&c.options?.method==='POST').length,1);
});
test('contradictory fee totals never appear as a confirmed processing fee',async()=>{
 const ui=setup({allowed:true,feeReply:{test:true,orderId:ORDER,state:'recorded',grossCents:3427,feeCents:129,netCents:3427,payoutAvailable:false}});await tick();await ui.all().find(n=>n.textContent==='Refresh fee from Stripe').fire();await tick();assert.equal(ui.all().some(n=>n.textContent.includes('fee recorded:')),false);assert.match(ui.get('notice').textContent,/needs review/);
});

test('carrier connection check is operator-only, manual and accepts no user addresses',async()=>{
 const ordinary=setup();await tick();assert.equal(ordinary.get('shipping-test').hidden,true);assert.equal(ordinary.get('shipping-test-controls').children.length,0);
 const ui=setup({allowed:true,noOrders:true});await tick();assert.equal(ui.get('shipping-test').hidden,false);assert.equal(ui.calls.some(c=>c.url?.endsWith('shipping-quote')),false);
 await ui.get('shipping-test-controls').children[0].fire();await tick();const posts=ui.calls.filter(c=>c.options?.method==='POST');assert.equal(posts.length,1);assert.deepEqual(JSON.parse(posts[0].options.body),{});assert.ok(ui.get('shipping-test-results').children.some(p=>p.textContent==='USPS · Ground Advantage · $7.25'));assert.ok(ui.get('shipping-test-results').children.some(p=>p.textContent.includes('Checkout still uses simulated shipping')));
 ui.setAllowed(false);await ui.get('refresh').fire();assert.equal(ui.get('shipping-test').hidden,true);assert.equal(ui.get('shipping-test-results').children.length,0);
});
test('duplicate carrier checks and late results after sign-out cannot reveal prices or make another request',async()=>{
 let release;const delayedShipping=new Promise(r=>release=r),ui=setup({allowed:true,delayedShipping});await tick();const button=ui.get('shipping-test-controls').children[0],pending=button.fire();await button.fire();ui.get('logout').fire();release();await pending;await tick();assert.equal(ui.calls.filter(c=>c.url?.endsWith('shipping-quote')).length,1);assert.equal(ui.get('shipping-test').hidden,true);assert.equal(ui.get('shipping-test-results').children.length,0);
});
test('malformed carrier replies cannot show successful prices',async()=>{
 for(const patch of [{test:false},{postagePurchased:true},{checkoutChanged:true},{rates:[]},{rates:[{carrier:'USPS',service:'Ground',currency:'USD',amountCents:-1}]}]){
  const ui=setup({allowed:true,shippingReply:{test:true,mode:'carrier_connection_test',postagePurchased:false,checkoutChanged:false,rates:[{carrier:'USPS',service:'Ground',currency:'USD',amountCents:725}],...patch}});await tick();await ui.get('shipping-test-controls').children[0].fire();assert.equal(ui.get('shipping-test-results').children.length,0);assert.match(ui.get('notice').textContent,/need review/);
 }
});
test('carrier checkout mode describes test prices accurately without changing saved orders',async()=>{
 const ui=setup({allowed:true,shippingMode:'shippo_test'});await tick();assert.match(ui.get('shipping-caption').textContent,/Shipping calculated by Shippo/);assert.equal(ui.get('shipping-caption').textContent.includes('$5'),false);assert.match(ui.get('test-intro').textContent,/Shippo test shipping/);assert.match(ui.get('shipping-test-description').textContent,/separate synthetic/);await ui.get('shipping-test-controls').children[0].fire();assert.ok(ui.get('shipping-test-results').children.some(p=>p.textContent.includes('destination')));assert.equal(ui.order.total_cents,3427);
});
test('shipping readiness is manual, operator-only, read-only and never enables a label',async()=>{
 const ordinary=setup();await tick();assert.equal(ordinary.all().some(n=>n.textContent==='Check shipping readiness'),false);
 const ui=setup({allowed:true});await tick();assert.equal(ui.calls.some(c=>c.url?.includes('action=fulfillment')),false);await ui.all().find(n=>n.textContent==='Check shipping readiness').fire();assert.ok(ui.all().some(n=>n.textContent.includes('original private shipping snapshot is missing')));assert.ok(ui.all().some(n=>n.textContent.includes('Label purchase remains disabled')));assert.equal(ui.calls.filter(c=>c.options?.method==='POST').length,0);
});
test('shipping readiness rejects malformed results and cannot restore private state after sign-out',async()=>{
 const ui=setup({allowed:true,fulfillmentReply:{test:true,orderId:ORDER,state:'ready_for_review',snapshotStored:true,labelPurchaseEnabled:true,holdReasons:[]}});await tick();await ui.all().find(n=>n.textContent==='Check shipping readiness').fire();assert.match(ui.get('notice').textContent,/needs review/);
 let release;const pending=new Promise(r=>release=r),late=setup({allowed:true,delayedFulfillment:pending});await tick();const button=late.all().find(n=>n.textContent==='Check shipping readiness'),work=button.fire();await button.fire();late.get('logout').fire();release();await work;assert.equal(late.all().some(n=>n.textContent.includes('Private shipping snapshot')),false);assert.equal(late.calls.filter(c=>c.url?.includes('action=fulfillment')).length,1);
});
test('sample controls require explicit enablement and operator access; prepared reference survives an uncertain dispatch',async()=>{
 for(const options of [{allowed:true},{sampleLabelsEnabled:true}]){const ui=setup(options);await tick();assert.equal(ui.all().some(n=>n.textContent==='Operator sample shipping label'),false);}
 const ui=setup({allowed:true,sampleLabelsEnabled:true,orderPatch:{risk_status:'clear'},labelError:true});await tick();await ui.all().find(n=>n.textContent==='Prepare free sample label').fire();await tick();assert.equal(ui.calls.filter(c=>c.options?.method==='POST').length,0);assert.equal(ui.local.size,1);
 await ui.all().find(n=>n.textContent==='Generate one free sample label').fire();await tick();assert.equal(ui.calls.filter(c=>c.url?.includes('sample-label')&&c.options?.method==='POST').length,1);assert.equal(JSON.parse([...ui.local.values()][0]).phase,'dispatched');
 await ui.get('refresh').fire();await ui.all().find(n=>n.textContent==='Check saved sample label').fire();assert.equal(ui.calls.filter(c=>c.url?.includes('sample-label')&&c.options?.method==='POST').length,1);assert.equal(ui.all().some(n=>n.textContent==='Generate one free sample label'),false);
});
test('unpaid, risk-held and refunded orders cannot prepare sample labels',async()=>{
 for(const patch of [{state:'checkout_open',risk_status:'clear'},{risk_status:'review'},{risk_status:'clear',refund_pending_cents:100},{risk_status:'clear',refund_state:'refunded'}]){const ui=setup({allowed:true,sampleLabelsEnabled:true,orderPatch:patch});await tick();assert.equal(ui.all().some(n=>n.textContent==='Prepare free sample label'),false);}
});
test('late sample replies and duplicate clicks cannot reveal documents after sign-out',async()=>{
 let release;const delayedLabel=new Promise(r=>release=r),ui=setup({allowed:true,sampleLabelsEnabled:true,orderPatch:{risk_status:'clear'},delayedLabel,labelReply:{test:true,orderId:ORDER,requestId:REQUEST,state:'ready',labelUrl:'https://shippo-delivery.s3.amazonaws.com/sample.pdf',trackingNumber:'TEST123'}});await tick();await ui.all().find(n=>n.textContent==='Prepare free sample label').fire();await tick();const button=ui.all().find(n=>n.textContent==='Generate one free sample label'),work=button.fire();await button.fire();ui.get('logout').fire();release();await work;await tick();assert.equal(ui.all().length,1);assert.equal(ui.calls.filter(c=>c.url?.includes('sample-label')&&c.options?.method==='POST').length,1);assert.equal(JSON.parse([...ui.local.values()][0]).requestId,REQUEST);
});
test('a foreign sample URL never appears as a confirmed label',async()=>{
 const ui=setup({allowed:true,sampleLabelsEnabled:true,orderPatch:{risk_status:'clear'},labelReply:{test:true,orderId:ORDER,requestId:REQUEST,state:'ready',labelUrl:'https://attacker.example/sample.pdf',trackingNumber:'TEST123'}});await tick();await ui.all().find(n=>n.textContent==='Prepare free sample label').fire();await tick();await ui.all().find(n=>n.textContent==='Generate one free sample label').fire();await tick();assert.equal(ui.all().some(n=>n.tag==='a'),false);assert.equal(ui.all().some(n=>n.textContent.includes('Sample label confirmed')),false);assert.match(ui.get('notice').textContent,/Invalid sample/);
});
test('test risk controls require explicit activation, paid orders and operator access; browser supplies only the order',async()=>{
 for(const options of [{allowed:true},{riskCheckEnabled:true},{allowed:true,riskCheckEnabled:true,orderPatch:{state:'checkout_open'}}]){const ui=setup(options);await tick();assert.equal(ui.all().some(n=>n.textContent==='Refresh test payment risk'),false);}
 const ui=setup({allowed:true,riskCheckEnabled:true,orderPatch:{risk_status:'review'}});await tick();await ui.all().find(n=>n.textContent==='Refresh test payment risk').fire();await tick();const posts=ui.calls.filter(c=>c.url?.endsWith('action=risk'));assert.equal(posts.length,1);assert.deepEqual(JSON.parse(posts[0].options.body),{orderId:ORDER});assert.match(ui.get('notice').textContent,/held for review/);assert.match(ui.get('notice').textContent,/No label or payout/);
});
test('duplicate risk checks and late sign-out responses cannot restore private results',async()=>{
 let release;const delayedRisk=new Promise(r=>release=r),ui=setup({allowed:true,riskCheckEnabled:true,delayedRisk});await tick();const b=ui.all().find(n=>n.textContent==='Refresh test payment risk'),work=b.fire();await b.fire();ui.get('logout').fire();release();await work;await tick();assert.equal(ui.get('orders').children.length,0);assert.equal(ui.calls.filter(c=>c.url?.endsWith('action=risk')).length,1);assert.match(ui.get('notice').textContent,/Signed out/);
});
test('malformed or stale risk responses never appear as a cleared payment',async()=>{
 for(const patch of [{riskStatus:'toString'},{riskStatus:'clear',labelGenerated:true},{riskStatus:'clear',payoutCreated:true},{riskStatus:'clear',checkedAt:Date.now()-600000},{riskStatus:'clear',orderId:REQUEST}]){const ui=setup({allowed:true,riskCheckEnabled:true,riskReply:{test:true,orderId:ORDER,riskStatus:'clear',checkedAt:Date.now(),labelGenerated:false,payoutCreated:false,...patch}});await tick();await ui.all().find(n=>n.textContent==='Refresh test payment risk').fire();await tick();assert.match(ui.get('notice').textContent,/needs review/);assert.equal(ui.get('notice').textContent.includes('clear for label'),false);}
});

test('tracking is operator-only, manually loaded and refreshes only the current order',async()=>{
 for(const options of [{trackingEnabled:true},{allowed:true}]){const ui=setup(options);await tick();assert.equal(ui.all().some(n=>n.textContent==='Sample shipment tracking'),false);}
 const ui=setup({allowed:true,trackingEnabled:true});await tick();assert.equal(ui.calls.some(c=>c.url.includes('action=tracking')),false);
 await ui.all().find(n=>n.textContent==='Load saved sample tracking').fire();await tick();assert.equal(ui.calls.filter(c=>c.options?.method==='POST').length,0);assert.ok(ui.all().some(n=>n.textContent==='No sample tracking check has been saved.'));
 await ui.all().find(n=>n.textContent==='Refresh sample tracking').fire();await tick();const posts=ui.calls.filter(c=>c.options?.method==='POST');assert.equal(posts.length,1);assert.deepEqual(JSON.parse(posts[0].options.body),{orderId:ORDER});
});
test('tracking duplicate clicks and stale sign-out responses cannot expose results',async()=>{
 let release;const pending=new Promise(r=>release=r),ui=setup({allowed:true,trackingEnabled:true,delayedTracking:pending});await tick();const button=ui.all().find(n=>n.textContent==='Refresh sample tracking'),work=button.fire();await button.fire();ui.get('logout').fire();release();await work;await tick();assert.equal(ui.calls.filter(c=>c.url.includes('action=tracking')).length,1);assert.equal(ui.all().length,1);assert.match(ui.get('notice').textContent,/Signed out/);
});
test('tracking reports bounded conflicts and rejects unknown status or financial authority',async()=>{
 const reply={test:true,orderId:ORDER,state:'recorded',status:'DELIVERED',providerStatus:'TRANSIT',checkedAt:Date.now(),eventAt:null,needsReview:true,labelPurchaseEnabled:false,payoutAvailable:false};
 const ui=setup({allowed:true,trackingEnabled:true,trackingReply:reply});await tick();await ui.all().find(n=>n.textContent==='Refresh sample tracking').fire();assert.ok(ui.all().some(n=>n.textContent.includes('Last accepted test status: Delivered. Latest provider test status: In transit.')));
 for(const patch of [{status:'<foreign>'},{payoutAvailable:true},{labelPurchaseEnabled:true},{orderId:REQUEST},{checkedAt:'today'}]){const bad=setup({allowed:true,trackingEnabled:true,trackingReply:{...reply,...patch}});await tick();await bad.all().find(n=>n.textContent==='Refresh sample tracking').fire();assert.match(bad.get('notice').textContent,/needs review/);assert.equal(bad.all().some(n=>n.textContent.startsWith('Carrier test status:')),false);}
});

test('test seller setup is feature-gated and never sends caller-selected seller identifiers',async()=>{const off=setup();await tick();assert.equal(off.get('seller-onboarding').hidden,true);const ui=setup({sellerOnboardingEnabled:true});await tick();assert.equal(ui.get('seller-onboarding').hidden,false);await ui.get('seller-start').fire();await tick();const post=ui.calls.find(c=>c.url?.includes('action=seller-onboarding'));assert.equal(post.options.method,'POST');assert.deepEqual(JSON.parse(post.options.body),{});assert.ok(ui.calls.some(c=>c.redirect==='https://accounts.stripe.com/r/acct_fixture#alu_test_fixtureToken'));});
test('seller setup duplicate clicks and a late response after sign-out cannot redirect or restore status',async()=>{let release;const wait=new Promise(r=>release=r);const ui=setup({sellerOnboardingEnabled:true,delayedSeller:wait});await tick();ui.get('seller-start').fire();ui.get('seller-start').fire();ui.get('logout').fire();release();await tick();await tick();assert.equal(ui.calls.filter(c=>c.url?.includes('action=seller-onboarding')).length,1);assert.equal(ui.calls.some(c=>c.redirect),false);assert.equal(ui.get('seller-result').textContent,'');assert.equal(ui.get('seller-onboarding').hidden,true);});
test('seller setup rejects foreign redirect destinations before navigation',async()=>{const ui=setup({sellerOnboardingEnabled:true,sellerReply:{test:true,state:'onboarding_required',transfersEnabled:false,payoutsEnabled:false,onboardingUrl:'https://foreign.invalid/setup/x'}});await tick();ui.get('seller-start').fire();await tick();assert.equal(ui.calls.some(c=>c.redirect),false);});

test('buyer reports check existing record first and never duplicate a saved report',async()=>{
 const ui=setup({orderIssuesEnabled:true});await tick();const b=ui.all().find(n=>n.textContent==='Item arrived damaged');assert.ok(b);await b.fire();await tick();assert.ok(ui.all().some(n=>n.textContent.includes('Test report saved: Item arrived damaged')));assert.equal(b.disabled,true);assert.equal(ui.calls.filter(c=>c.url?.includes('order-issue')&&c.options.method==='POST').length,1);await b.fire();await tick();assert.equal(ui.calls.filter(c=>c.url?.includes('order-issue')&&c.options.method==='POST').length,1);
});
test('order reporting defaults off and seller cannot see buyer report controls',async()=>{
 for(const options of [{},{orderIssuesEnabled:true,orderPatch:{buyer_id:'33333333-3333-4333-8333-333333333333',seller_id:MEMBER}}]){const ui=setup(options);await tick();assert.equal(ui.all().some(n=>n.textContent==='Report a test order problem'),false);}
});
test('signing out during issue status read prevents a report dispatch and private status restoration',async()=>{
 let release;const ui=setup({orderIssuesEnabled:true,delayedIssue:new Promise(r=>release=r)});await tick();const b=ui.all().find(n=>n.textContent==='Item arrived damaged');const pending=b.fire();ui.get('logout').fire();release();await pending;await tick();assert.equal(ui.calls.some(c=>c.url?.includes('order-issue')&&c.options.method==='POST'),false);assert.equal(ui.get('orders').children.length,0);
});

test('only activated test operators see report queue and acknowledgment retains open status',async()=>{
 const ordinary=setup({issueReviewEnabled:true});await tick();assert.equal(ordinary.get('issue-review').hidden,true);assert.equal(ordinary.calls.some(c=>c.url?.endsWith('issue-review')),false);
 const disabled=setup({allowed:true});await tick();assert.equal(disabled.get('issue-review').hidden,true);
 const ui=setup({allowed:true,issueReviewEnabled:true});await tick();assert.equal(ui.get('issue-review').hidden,false);const button=ui.issueReviewAll().find(n=>n.textContent==='Acknowledge for follow-up');assert.ok(button);await button.fire();await tick();assert.ok(ui.issueReviewAll().some(n=>n.textContent==='Acknowledged for follow-up — issue remains open.'));assert.equal(ui.issueReviewAll().some(n=>n.textContent==='Acknowledge for follow-up'),false);const posts=ui.calls.filter(c=>c.options?.method==='POST');assert.equal(posts.length,1);assert.deepEqual(JSON.parse(posts[0].options.body),{orderId:ORDER});
});
test('late issue queue and acknowledgment responses cannot restore private reports after sign-out',async()=>{
 for(const kind of ['read','ack']){let release;const pending=new Promise(r=>release=r),ui=setup({allowed:true,issueReviewEnabled:true,...(kind==='read'?{delayedIssueReview:pending}:{delayedIssueAck:pending})});await tick();let action;if(kind==='ack')action=ui.issueReviewAll().find(n=>n.textContent==='Acknowledge for follow-up').fire();ui.get('logout').fire();release();if(action)await action;await tick();assert.equal(ui.get('issue-review').hidden,true);assert.equal(ui.get('issue-review-rows').children.length,0);assert.equal(ui.get('notice').textContent,'Signed out of the private test area.');}
});
test('malformed report queue never displays an acknowledgment button',async()=>{
 const ui=setup({allowed:true,issueReviewEnabled:true,issueReviewReply:{test:true,hasMore:false,issues:[{orderId:ORDER,reason:'forged',reportedAt:'2026-11-02T20:00:00Z',acknowledgedAt:null}]}});await tick();assert.equal(ui.issueReviewAll().some(n=>n.textContent==='Acknowledge for follow-up'),false);assert.ok(ui.issueReviewAll().some(n=>n.textContent.includes('temporarily unavailable')));
});

test('buyers read shared issue updates without seller response controls',async()=>{
 const ui=setup({issueResponsesEnabled:true});await tick();assert.ok(ui.all().some(n=>n.textContent==='Test order issue updates'));assert.equal(ui.all().some(n=>n.textContent==='I am checking this issue'),false);const check=ui.all().find(n=>n.textContent==='Check order issue updates');await check.fire();await tick();assert.ok(ui.all().some(n=>n.textContent.includes('Awaiting seller response.')));assert.equal(ui.calls.filter(c=>c.options?.method==='POST').length,0);
});
test('seller checks saved issue then responds once without changing its open status',async()=>{
 const ui=setup({issueResponsesEnabled:true,orderPatch:{buyer_id:'33333333-3333-4333-8333-333333333333',seller_id:MEMBER}});await tick();const button=ui.all().find(n=>n.textContent==='Propose a return for review');assert.equal(button.disabled,true);await ui.all().find(n=>n.textContent==='Check order issue updates').fire();await tick();assert.equal(button.disabled,false);await button.fire();await tick();assert.equal(button.disabled,true);assert.ok(ui.all().some(n=>n.textContent.includes('Seller proposes a return for review.')));assert.ok(ui.all().some(n=>n.textContent.includes('The issue remains open. No refund or fulfillment release.')));await button.fire();await tick();const posts=ui.calls.filter(c=>c.options?.method==='POST');assert.equal(posts.length,1);assert.deepEqual(JSON.parse(posts[0].options.body),{response:'propose_return'});
});
test('late thread reads or seller replies cannot restore private issue details after sign-out',async()=>{
 for(const kind of ['read','write']){let release;const pending=new Promise(r=>release=r),ui=setup({issueResponsesEnabled:true,orderPatch:{buyer_id:'33333333-3333-4333-8333-333333333333',seller_id:MEMBER},...(kind==='read'?{delayedThreadRead:pending}:{delayedThreadWrite:pending})});await tick();const check=ui.all().find(n=>n.textContent==='Check order issue updates');let action;if(kind==='read')action=check.fire();else{await check.fire();await tick();action=ui.all().find(n=>n.textContent==='I am checking this issue').fire();await tick();}ui.get('logout').fire();release();await action;await tick();assert.equal(ui.get('orders').children.length,0);assert.equal(ui.get('notice').textContent,'Signed out of the private test area.');if(kind==='read')assert.equal(ui.calls.some(c=>c.url?.includes('issue-thread')&&c.options.method==='POST'),false);}
});
test('malformed thread status cannot enable seller reply controls',async()=>{
 const ui=setup({issueResponsesEnabled:true,orderPatch:{buyer_id:'33333333-3333-4333-8333-333333333333',seller_id:MEMBER},threadReply:{test:true,orderId:ORDER,state:'review_required',reason:'damaged',reportedAt:'2026-11-02T20:00:00Z',acknowledgedAt:null,sellerResponse:{kind:'refund_approved',submittedAt:'2026-11-02T21:00:00Z'}}});await tick();await ui.all().find(n=>n.textContent==='Check order issue updates').fire();await tick();assert.equal(ui.all().find(n=>n.textContent==='I am checking this issue').disabled,true);assert.equal(ui.calls.some(c=>c.options.method==='POST'),false);
});

test('issue refund readiness stages the existing recovery reference without a refund POST',async()=>{
 const ui=setup({allowed:true,issueRefundReviewEnabled:true});await tick();const stage=ui.all().find(n=>n.textContent==='Prepare remaining test refund for review');assert.equal(stage.hidden,true);await ui.all().find(n=>n.textContent==='Check issue refund readiness').fire();await tick();assert.equal(stage.hidden,false);await stage.fire();await tick();assert.ok(ui.all().some(n=>n.textContent==='Issue $34.27 test refund'));assert.equal(ui.calls.filter(c=>c.options?.method==='POST').length,0);const saved=JSON.parse([...ui.local.values()].find(v=>v.includes('baselineCents')));assert.equal(saved.current.amountCents,3427);assert.equal(saved.current.phase,'prepared');assert.equal(ui.calls.filter(c=>c.url?.includes('issue-refund-review')).length,2);
});
test('pending or contradictory issue refund evidence never offers another preparation',async()=>{
 for(const reply of [{state:'pending',pendingCents:1000,canPrepare:false},{state:'needs_reconciliation',confirmedCents:1,remainingCents:3426,canPrepare:false},{state:'available_for_review',pendingCents:1}]){const ui=setup({allowed:true,issueRefundReviewEnabled:true,issueRefundReviewReply:{test:true,orderId:ORDER,state:'available_for_review',totalCents:3427,confirmedCents:0,pendingCents:0,unconfirmedRequestCount:0,remainingCents:3427,canPrepare:true,fulfillmentReleased:false,...reply}});await tick();await ui.all().find(n=>n.textContent==='Check issue refund readiness').fire();await tick();assert.equal(ui.all().find(n=>n.textContent==='Prepare remaining test refund for review').hidden,true);assert.equal(ui.local.size,0);assert.equal(ui.calls.filter(c=>c.options?.method==='POST').length,0);}
});
test('ordinary members cannot see refund readiness controls and sign-out discards late readiness',async()=>{
 const member=setup({issueRefundReviewEnabled:true});await tick();assert.equal(member.all().some(n=>n.textContent==='Check issue refund readiness'),false);
 let release;const ui=setup({allowed:true,issueRefundReviewEnabled:true,delayedIssueRefundReview:new Promise(r=>release=r)});await tick();const pending=ui.all().find(n=>n.textContent==='Check issue refund readiness').fire();ui.get('logout').fire();release();await pending;await tick();assert.equal(ui.get('orders').children.length,0);assert.equal(ui.local.size,0);assert.equal(ui.get('notice').textContent,'Signed out of the private test area.');
});


test('seller protection review is operator-only, read-only and never offers release',async()=>{
 for(const options of [{allowed:true},{sellerProtectionsEnabled:true}]){const ui=setup(options);await tick();assert.equal(ui.all().some(n=>n.textContent==='Check protection holds'),false);}
 const ui=setup({allowed:true,sellerProtectionsEnabled:true});await tick();await ui.all().find(n=>n.textContent==='Check protection holds').fire();await tick();assert.ok(ui.all().some(n=>n.textContent==='Real carrier delivery has not been verified.'));assert.ok(ui.all().some(n=>n.textContent==='Seller money is held. No transfer or bank payout was created.'));assert.equal(ui.calls.some(c=>c.options?.method==='POST'),false);
});
test('seller hold accepts only order and structured reason; sign-out suppresses late review and hold results',async()=>{
 const ui=setup({allowed:true,sellerProtectionsEnabled:true});await tick();ui.all().find(n=>n.tag==='select').value='delivery_problem';await ui.all().find(n=>n.textContent==='Hold seller for review').fire();await tick();const post=ui.calls.find(c=>c.url?.includes('protection-hold'));assert.deepEqual(JSON.parse(post.options.body),{orderId:ORDER,reason:'delivery_problem'});assert.ok(ui.all().some(n=>n.textContent.includes('Further test sales are blocked')));
 for(const hold of [false,true]){let release;const pending=new Promise(r=>release=r),late=setup({allowed:true,sellerProtectionsEnabled:true,...(hold?{delayedHold:pending}:{delayedProtection:pending})});await tick();if(hold)late.all().find(n=>n.tag==='select').value='suspicious_activity';const button=late.all().find(n=>n.textContent===(hold?'Hold seller for review':'Check protection holds')),work=button.fire();await button.fire();late.get('logout').fire();release();await work;await tick();assert.equal(late.get('orders').children.length,0);assert.equal(late.calls.filter(c=>c.url?.includes(hold?'protection-hold':'protection-review')).length,1);assert.match(late.get('notice').textContent,/Signed out/);}
});
test('a forged ready response never appears as release permission',async()=>{const ui=setup({allowed:true,sellerProtectionsEnabled:true,protectionReply:{test:true,orderId:ORDER,state:'ready',blockers:[],releaseEnabled:true,transferCreated:false,payoutCreated:false}});await tick();await ui.all().find(n=>n.textContent==='Check protection holds').fire();await tick();assert.match(ui.get('notice').textContent,/funds remain held/);assert.equal(ui.all().some(n=>n.textContent==='Seller money is held. No transfer or bank payout was created.'),false);});

test('seller setup rejects substituted v2 onboarding links including live, query, credentials and foreign paths',async()=>{for(const onboardingUrl of ['https://accounts.stripe.com/r/acct_fixture#alu_live_fixture','https://accounts.stripe.com/r/acct_fixture?next=foreign#alu_test_fixture','https://user@accounts.stripe.com/r/acct_fixture#alu_test_fixture','https://accounts.stripe.com/setup/acct_fixture#alu_test_fixture','https://accounts.stripe.com.foreign.invalid/r/acct_fixture#alu_test_fixture']){const ui=setup({sellerOnboardingEnabled:true,sellerReply:{test:true,state:'onboarding_required',transfersEnabled:false,payoutsEnabled:false,onboardingUrl}});await tick();ui.get('seller-start').fire();await tick();assert.equal(ui.calls.some(c=>c.redirect),false,onboardingUrl);}});
