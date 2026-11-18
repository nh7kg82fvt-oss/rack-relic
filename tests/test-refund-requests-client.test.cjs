const {test}=require('node:test'),assert=require('node:assert/strict');
const {createTestRefundRequests}=require('../test-refund-requests.js');
const MEMBER='22222222-2222-4222-8222-222222222222',ORDER='11111111-1111-4111-8111-111111111111',REQUEST='44444444-4444-4444-8444-444444444444';
function setup(request){const data=new Map(),storage={getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v)};const client=()=>createTestRefundRequests({storage,memberId:MEMBER,uuid:()=>REQUEST,request});return {data,storage,client};}
const result={test:true,requestId:REQUEST,orderId:ORDER,amountCents:1000,state:'request_recorded'};
test('refund reference and dispatch marker survive a lost response; reload uses GET only',async()=>{
 let posts=0,gets=0;const s=setup(async(action,options)=>{if(options?.method==='POST'){posts++;assert.equal(s.client().current(ORDER).phase,'dispatched');assert.deepEqual(JSON.parse(options.body),{requestId:REQUEST,orderId:ORDER,amountCents:1000});throw Error('Lost response');}gets++;assert.equal(action,'refund&requestId='+REQUEST);return result;});
 const first=s.client();first.prepare({orderId:ORDER,amountCents:1000});await assert.rejects(first.submit(ORDER),/Lost response/);
 const reloaded=s.client();await reloaded.submit(ORDER);await reloaded.recover(ORDER);assert.equal(posts,1);assert.equal(gets,2);assert.equal(reloaded.current(ORDER).phase,'known');
});
test('two simultaneous submit clicks cannot dispatch a second POST',async()=>{
 let posts=0,release;const pending=new Promise(r=>release=r),s=setup(async(action,options)=>{if(options?.method==='POST'){posts++;await pending;}return result;});const client=s.client();client.prepare({orderId:ORDER,amountCents:1000});
 const one=client.submit(ORDER),two=client.submit(ORDER);release();await Promise.all([one,two]);assert.equal(posts,1);
});
test('storage failure prevents dispatch and corrupted saved references cannot be replaced',async()=>{
 let calls=0;const s=setup(async()=>{calls++;});const c=s.client();c.prepare({orderId:ORDER,amountCents:1000});s.storage.setItem=()=>{throw Error('Storage full');};await assert.rejects(c.submit(ORDER),/Storage full/);assert.equal(calls,0);
 const bad=setup(async()=>{calls++;});bad.data.set('rr-private-test-refunds-v1:'+MEMBER+':'+ORDER,'broken');assert.throws(()=>bad.client().prepare({orderId:ORDER,amountCents:1000}),/review/);assert.equal(calls,0);
});
test('mismatched responses retain the dispatched hold and immutable amount',async()=>{
 const s=setup(async()=>({...result,amountCents:2000})),c=s.client();c.prepare({orderId:ORDER,amountCents:1000});await assert.rejects(c.submit(ORDER),/review/);assert.equal(c.current(ORDER).phase,'dispatched');assert.throws(()=>c.prepare({orderId:ORDER,amountCents:2000}),/saved refund amount/);
});
test('another request requires the known reference and signed cumulative confirmation',async()=>{
 const s=setup(async()=>result),c=s.client();c.prepare({orderId:ORDER,amountCents:1000,baselineCents:0});
 const order={id:ORDER,refund_state:'partial',refunded_cents:1000,refund_pending_cents:0};assert.throws(()=>c.finish(order),/signed/);await c.submit(ORDER);
 for(const patch of [{refund_state:'review'},{refund_pending_cents:100},{refunded_cents:999}])assert.throws(()=>c.finish({...order,...patch}),/signed/);
 c.finish(order);assert.equal(c.current(ORDER),null);const record=JSON.parse([...s.data.values()][0]);assert.equal(record.history[0].requestId,REQUEST);assert.equal(record.history[0].phase,'confirmed');
});
test('saved refund references are scoped to the authenticated operator',()=>{
 const s=setup(async()=>result);s.client().prepare({orderId:ORDER,amountCents:1000});const other=createTestRefundRequests({storage:s.storage,memberId:'33333333-3333-4333-8333-333333333333',request:async()=>result});assert.equal(other.current(ORDER),null);
});
test('amount can change before dispatch, while a lost response cannot be discarded',async()=>{
 const s=setup(async()=>{throw Error('Lost response');}),c=s.client();c.prepare({orderId:ORDER,amountCents:1000});c.discardPrepared(ORDER);assert.equal(c.current(ORDER),null);c.prepare({orderId:ORDER,amountCents:2000});await assert.rejects(c.submit(ORDER),/Lost response/);assert.throws(()=>c.discardPrepared(ORDER),/dispatched/);assert.equal(c.current(ORDER).amountCents,2000);
});
