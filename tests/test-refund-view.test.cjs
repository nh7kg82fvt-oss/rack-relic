const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
async function render(order){
 const el=()=>({children:[],textContent:'',addEventListener(){},append(...nodes){this.children.push(...nodes);},replaceChildren(){this.children=[];}});
 const nodes=new Map(),get=id=>{if(!nodes.has(id))nodes.set(id,el());return nodes.get(id);};
 const context={document:{getElementById:get,createElement:el},location:{search:'',hash:'',pathname:'/api/test-marketplace'},history:{replaceState(){}},sessionStorage:{getItem:()=>JSON.stringify({token:'fixture',member:'buyer'}),removeItem(){}},localStorage:{},createTestEmailSignin:()=>({}),URLSearchParams,Intl,AbortSignal,fetch:async url=>({ok:true,json:async()=>url.endsWith('config')?{notice:'fixture',publishableKey:'fixture'}:{orders:[{id:'fixture',buyer_id:'buyer',state:'paid',total_cents:3427,...order}]}})};
 vm.runInNewContext(fs.readFileSync(require.resolve('../test-marketplace.js'),'utf8'),context);
 await new Promise(resolve=>setImmediate(resolve));
 return get('orders').children[0].children.map(n=>n.textContent).join('\n');
}
test('buyer order view distinguishes returned money from pending refunds and tolerates old staging schema',async()=>{
 const pending=await render({refund_state:'pending',refunded_cents:1000,refund_pending_cents:2427});assert.match(pending,/Refunded \$10\.00/);assert.match(pending,/Pending \$24\.27/);assert.doesNotMatch(pending,/Full test refund confirmed/);
 const old=await render({});assert.match(old,/Payment confirmed/);assert.doesNotMatch(old,/refund/i);
 const full=await render({refund_state:'refunded',refunded_cents:3427,refund_pending_cents:0});assert.match(full,/Full test refund confirmed/);assert.match(full,/fulfillment on hold/);
});
test('ambiguous refund evidence shows review without asserting a returned amount',async()=>{
 const review=await render({refund_state:'review',refunded_cents:3427,refund_pending_cents:0});assert.match(review,/amounts await reconciliation/);assert.doesNotMatch(review,/Refunded \$/);
 const failed=await render({refund_state:'failed',refunded_cents:0,refund_pending_cents:0});assert.match(failed,/refund failed or cancelled/);assert.doesNotMatch(failed,/refund confirmed/);
});
