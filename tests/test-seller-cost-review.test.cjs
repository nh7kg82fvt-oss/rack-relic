const ENV_ROWS=require('../test-environments.js');
const LEGACY_CONFIG={environmentId:ENV_ROWS[0].id,projectUrl:ENV_ROWS[0].projectUrl,returnUrl:ENV_ROWS[0].returnUrl};
'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const review=require('../test-seller-cost-review.js');
const O='11111111-1111-4111-8111-111111111111',S='22222222-2222-4222-8222-222222222222',B='33333333-3333-4333-8333-333333333333';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const quote=()=>({hash:'a'.repeat(64),maxTotalCents:500,costCaps:{processing:200,radar:10,connect_active_account:200,payout:90,insurance:0},selectedInsurance:false});
const result=(patch={})=>({test:true,orderId:O,feePolicyVersion:'rr-fees-v2',state:'held',blockers:['cost_disclosure_required'],itemCents:2500,buyerFeeCents:175,confirmedCostCents:0,reservedCostCents:0,sellerNetCents:null,sellerNetAfterReserveCents:null,disclosure:null,accepted:false,releaseEnabled:false,...patch});
const quoted=(patch={})=>result({blockers:['seller_cost_acceptance_required'],confirmedCostCents:358,sellerNetCents:2142,sellerNetAfterReserveCents:2142,disclosure:quote(),...patch});
test('public projection retains bounded totals and disclosure while discarding private evidence and authority',()=>{
 const value=quoted({providerReceipt:'private',allocationPlan:[{source:'private'}],sellerId:S,payoutCreated:true}),r=review.publicSellerCostReview(value,O);
 assert.equal(r.buyerFeeCents,175);assert.equal(r.confirmedCostCents,358);assert.equal(r.sellerNetCents,2142);assert.equal(r.releaseEnabled,false);assert.equal(r.providerReceipt,undefined);assert.equal(r.payoutCreated,undefined);assert.equal(r.allocationPlan,undefined);assert.ok(Object.isFrozen(r));assert.ok(Object.isFrozen(r.disclosure.costCaps));
});
test('malformed, foreign, live or contradictory costs never become a reviewable projection',()=>{
 for(const patch of [{test:false},{releaseEnabled:true},{orderId:B},{feePolicyVersion:'rr-fees-v1'},{blockers:['toString']},{blockers:['seller_cost_acceptance_required','seller_cost_acceptance_required']},{state:'reconciled_for_review'},{itemCents:'2500'},{buyerFeeCents:125},{buyerFeeCents:174},{confirmedCostCents:-1},{reservedCostCents:null},{sellerNetCents:2500},{sellerNetAfterReserveCents:2500},{accepted:true,disclosure:null},{disclosure:{...quote(),hash:'<script>'}},{disclosure:{...quote(),maxTotalCents:2501}},{disclosure:{...quote(),costCaps:{...quote().costCaps,insurance:1}}}])assert.throws(()=>review.publicSellerCostReview(quoted(patch),O),undefined,JSON.stringify(patch));
});
test('reserved and unknown costs do not imply a final seller balance',()=>{
 const r=review.publicSellerCostReview(quoted({blockers:['provider_costs_unconfirmed'],confirmedCostCents:327,reservedCostCents:50,sellerNetCents:null,sellerNetAfterReserveCents:2123}),O);assert.equal(r.sellerNetCents,null);assert.equal(r.sellerNetAfterReserveCents,2123);
 const unknown=review.publicSellerCostReview(result({blockers:['provider_cost_schedule_incomplete','cost_inventory_incomplete']}),O);assert.equal(unknown.sellerNetAfterReserveCents,null);assert.equal(unknown.confirmedCostCents,0);
 assert.throws(()=>review.publicSellerCostReview(quoted({reservedCostCents:50}),O));
});
test('unsupported historical orders remain unavailable without repricing their saved cents',()=>{
 const historical=result({feePolicyVersion:'rr-fees-v1',blockers:['unsupported_fee_policy'],buyerFeeCents:100});assert.equal(review.publicSellerCostReview(historical,O).buyerFeeCents,100);
 assert.throws(()=>review.sellerCostAction('seller-cost-prepare',historical,O));assert.throws(()=>review.sellerCostAction('seller-cost-accept',historical,O));
 const missing=result({blockers:['invalid_order_snapshot'],itemCents:null,buyerFeeCents:null});assert.equal(review.publicSellerCostReview(missing,O).itemCents,null);
});
test('action payloads send only the order and exact reviewed hash, never browser costs or evidence',()=>{
 const p=review.sellerCostAction('seller-cost-prepare',result(),O);assert.equal(p.action,'seller-cost-prepare');assert.deepEqual(JSON.parse(p.options.body),{orderId:O});
 const a=review.sellerCostAction('seller-cost-accept',quoted(),O);assert.deepEqual(JSON.parse(a.options.body),{orderId:O,disclosureHash:'a'.repeat(64)});
 assert.throws(()=>review.sellerCostAction('seller-cost-accept',result(),O));assert.throws(()=>review.sellerCostAction('seller-cost-prepare',quoted(),O));assert.throws(()=>review.sellerCostAction('seller-cost-accept',quoted({accepted:true,blockers:['provider_costs_unconfirmed']}),O));
});
function setup({enabled=true,seller=true,replies=[],prepareReply=quoted(),acceptReply=quoted({accepted:true,blockers:[],state:'reconciled_for_review'}),waitRead,waitPrepare,waitAccept,prepareError=false}={}){
 const nodes=new Map(),calls=[],saved=new Map([['rr-private-test-session',JSON.stringify({token:'test-token',member:S,email:'seller@example.invalid'})]]);let reads=0;
 const element=tag=>({tag,children:[],textContent:'',value:'',checked:false,hidden:false,disabled:false,events:{},append(...items){this.children.push(...items);},replaceChildren(){this.children=[];},addEventListener(name,fn){this.events[name]=fn;},reportValidity(){return true;},fire(name='click'){return this.events[name]?.({preventDefault(){}});}});
 const get=id=>{if(!nodes.has(id))nodes.set(id,element('div'));return nodes.get(id);},storage={getItem:k=>saved.get(k)??null,setItem:(k,v)=>saved.set(k,v),removeItem:k=>saved.delete(k)};
 const fetch=async(url,options)=>{calls.push({url,options});
  if(url.endsWith('config'))return Response.json({...LEGACY_CONFIG,sellerCostsEnabled:enabled==='absent'?undefined:enabled,publishableKey:'test',notice:'Private fixture',listing:{id:O}});
  if(url.endsWith('orders'))return Response.json({orders:[{id:O,buyer_id:seller?B:S,seller_id:seller?S:B,state:'paid',total_cents:3175,refund_state:'none',listing_id:O}]});
  if(url.endsWith('refund-access'))return Response.json({error:'not an operator'},{status:403});
  if(url.includes('action=seller-cost-review')){if(waitRead)await waitRead;return Response.json(replies[Math.min(reads++,replies.length-1)]||result());}
  if(url.endsWith('action=seller-cost-prepare')){if(waitPrepare)await waitPrepare;return prepareError?Response.json({error:'Verified cost quote is not configured'},{status:503}):Response.json(prepareReply);}
  if(url.endsWith('action=seller-cost-accept')){if(waitAccept)await waitAccept;return Response.json(acceptReply);}
  throw Error('Unexpected request '+url);
 };
 const context={RackRelicSellerCostReview:review,document:{getElementById:get,createElement:element},location:{search:'',hash:'',pathname:'/api/test-marketplace'},history:{replaceState(){}},sessionStorage:storage,localStorage:storage,createTestEmailSignin:()=>({}),crypto:{randomUUID:()=>B},URL,URLSearchParams,Intl,AbortSignal,fetch};
 context.RackRelicTestEnvironments=ENV_ROWS;
 vm.runInNewContext(fs.readFileSync(require.resolve('../test-marketplace.js'),'utf8'),context);
 const walk=n=>[n,...n.children.flatMap(walk)],all=()=>walk(get('orders')),find=text=>all().find(n=>n.textContent===text),posts=()=>calls.filter(c=>c.options?.method==='POST');
 return {get,all,find,calls,posts,consent:()=>all().find(n=>n.tag==='input'&&n.type==='checkbox')};
}
async function load(ui){await tick();await ui.find('Review payment costs').fire();await tick();}
test('private cost controls require explicit activation and the signed-in order seller',async()=>{
 for(const options of [{enabled:false},{enabled:'absent'},{enabled:'true'},{seller:false}]){const ui=setup(options);await tick();assert.equal(ui.find('Review payment costs'),undefined);assert.equal(ui.calls.some(c=>c.url.includes('seller-cost')),false);}
 const ui=setup();await tick();assert.ok(ui.find('Review payment costs'));assert.equal(ui.calls.some(c=>c.url.includes('seller-cost')),false);assert.equal(ui.find('Prepare test cost quote').hidden,true);assert.equal(ui.find('Accept maximum test payment costs').hidden,true);
});
test('a server cost quote is prepared separately and cannot accept itself or submit browser caps',async()=>{
 const ui=setup();await load(ui);assert.ok(ui.all().some(n=>n.textContent==='Estimated payout: pending confirmation — seller funds remain held'));assert.equal(ui.find('Prepare test cost quote').hidden,false);
 await ui.find('Prepare test cost quote').fire();await tick();assert.equal(ui.posts().length,1);assert.deepEqual(JSON.parse(ui.posts()[0].options.body),{orderId:O});assert.equal(ui.consent().checked,false);assert.equal(ui.find('Accept maximum test payment costs').disabled,true);assert.ok(ui.all().some(n=>n.textContent.includes('Maximum payment processing and handling for this test order: $5.00')));
 assert.ok(ui.all().some(n=>n.textContent==='Payment processing and handling: $3.58 (confirmed costs)'));assert.ok(ui.all().some(n=>n.textContent.includes('Estimated payout: $21.42')));
});
test('missing quote configuration stays held without zero-cost or acceptance claims',async()=>{
 const ui=setup({prepareError:true});await load(ui);await ui.find('Prepare test cost quote').fire();await tick();assert.equal(ui.posts().length,1);assert.match(ui.get('notice').textContent,/not configured/);assert.equal(ui.find('Accept maximum test payment costs').hidden,true);assert.ok(ui.all().some(n=>n.textContent.includes('Pending costs are not treated as zero')));
});
test('seller explicitly accepts the exact current disclosure once, with no provider data from the browser',async()=>{
 const ui=setup({replies:[quoted()]});await load(ui);const b=ui.find('Accept maximum test payment costs');await b.fire();assert.equal(ui.posts().length,0);ui.consent().checked=true;ui.consent().fire('change');assert.equal(b.disabled,false);const work=b.fire();await b.fire();await work;await tick();assert.equal(ui.posts().length,1);assert.deepEqual(JSON.parse(ui.posts()[0].options.body),{orderId:O,disclosureHash:'a'.repeat(64)});assert.equal(b.hidden,true);assert.ok(ui.all().some(n=>n.textContent.startsWith('Private test cost consent is recorded.')));
});
test('a changed quote requires another review and explicit checkbox before any acceptance POST',async()=>{
 const changed=quoted({disclosure:{...quote(),hash:'b'.repeat(64),maxTotalCents:450}}),ui=setup({replies:[quoted(),changed]});await load(ui);ui.consent().checked=true;await ui.find('Accept maximum test payment costs').fire();await tick();assert.equal(ui.posts().length,0);assert.match(ui.get('notice').textContent,/details changed/);assert.equal(ui.consent().checked,false);assert.ok(ui.all().some(n=>n.textContent.includes('test order: $4.50')));
});
test('historical orders expose a safe review result with no new-policy quote or acceptance',async()=>{
 const ui=setup({replies:[result({feePolicyVersion:'rr-fees-v1',blockers:['unsupported_fee_policy'],buyerFeeCents:100})]});await load(ui);assert.ok(ui.all().some(n=>n.textContent.includes('unavailable for this historical')));assert.equal(ui.find('Prepare test cost quote').hidden,true);assert.equal(ui.find('Accept maximum test payment costs').hidden,true);await ui.find('Prepare test cost quote').fire();assert.equal(ui.posts().length,0);
});
test('partial reservations are labeled while a missing provider schedule never promises an estimated payout',async()=>{
 const reserved=quoted({blockers:['provider_costs_unconfirmed'],confirmedCostCents:327,reservedCostCents:50,sellerNetCents:null,sellerNetAfterReserveCents:2123});const ui=setup({replies:[reserved]});await load(ui);assert.ok(ui.all().some(n=>n.textContent.includes('$3.77 (includes reserved costs; actual costs pending)')));
 const unknown=setup({replies:[{...reserved,blockers:['provider_cost_schedule_incomplete']}]});await load(unknown);assert.ok(unknown.all().some(n=>n.textContent==='Estimated payout: pending confirmation — seller funds remain held'));
});
test('late reads, preparations and acceptance responses cannot restore private state after sign-out',async()=>{
 for(const kind of ['read','prepare','accept']){let release;const pending=new Promise(r=>release=r),ui=setup({replies:kind==='accept'?[quoted()]:[],...(kind==='read'?{waitRead:pending}:kind==='prepare'?{waitPrepare:pending}:{waitAccept:pending})});await tick();let work;
  if(kind==='read')work=ui.find('Review payment costs').fire();else{await ui.find('Review payment costs').fire();if(kind==='accept'){ui.consent().checked=true;work=ui.find('Accept maximum test payment costs').fire();}else work=ui.find('Prepare test cost quote').fire();await tick();}
  ui.get('logout').fire();release();await work;await tick();assert.equal(ui.get('orders').children.length,0);assert.equal(ui.get('notice').textContent,'Signed out of the private test area.');if(kind==='read')assert.equal(ui.posts().length,0);else assert.equal(ui.posts().length,1);
 }
});
test('malformed fresh review clears prior quote consent and cannot dispatch acceptance',async()=>{
 const ui=setup({replies:[quoted(),quoted({releaseEnabled:true})]});await load(ui);ui.consent().checked=true;await ui.find('Accept maximum test payment costs').fire();await tick();assert.equal(ui.posts().length,0);assert.equal(ui.find('Accept maximum test payment costs').hidden,true);assert.equal(ui.consent().checked,false);assert.match(ui.get('notice').textContent,/unavailable/);
});
