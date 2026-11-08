'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const M=require('../server/stripe_test_tax_receipt_verifier.cjs');
const {make,NOW,IDS}=require('./tax-receipt-verifier-fixture.cjs');
const KEYS=['test','accountId','source','transactionId','parentTransactionId','reference','currency','type','itemCents','buyerFeeCents','shippingCents','taxCents','totalCents','observedAt'].sort();
for(const kind of ['original','refund_reversal','refund_undo'])test('complete '+kind+' known chain returns exact14-key private accounting receipt and preserves GET-only scope',async()=>{const z=make(kind);try{const r=await z.run();assert.deepEqual(Object.keys(r).sort(),KEYS);assert.equal(r.accountId,M.ACCOUNT);assert.equal(r.source,'verified_test_tax_receipt');assert.equal(r.observedAt,NOW);assert.equal(r.type,kind==='original'?'transaction':'reversal');assert.equal(r.totalCents,kind==='original'?3493:kind==='refund_reversal'?-1100:1100);assert.equal(r.taxCents,kind==='original'?318:kind==='refund_reversal'?-100:100);assert.equal(z.loads(),2);assert(z.calls.length>=12);for(const c of z.calls){assert(c.url.startsWith('https://api.stripe.com/v1/'));assert.equal(c.init.method,'GET');assert.equal(c.init.redirect,'manual');assert.equal(c.init.cache,'no-store');assert.equal(c.init.headers['Stripe-Version'],'2026-10-28.endive');assert.equal(c.init.body,undefined);}assert(!JSON.stringify(r).includes('DO_NOT_COPY'));assert(!JSON.stringify(r).includes('Fictional private'));assert(!JSON.stringify(r).includes('192.0.2.7'));assert(!JSON.stringify(r).includes('sk_test'));assert(!Object.hasOwn(z.paths['/v1/tax/transactions/tax_Original'],'calculation'));}finally{z.v.close();}});
test('bounded complete pagination is read independently of misleading inline arrays',async()=>{const z=make('original',{pagination:true});try{assert.equal((await z.run()).totalCents,3493);assert.equal(z.calls.filter(c=>c.url.includes('starting_after=')).length,4);}finally{z.v.close();}});
test('default OFF, invalid/live keys and missing private loader have no usable verifier',()=>{for(const options of [{},{enabled:true},{enabled:true,secretKey:'sk_live_FICTIONAL',loadSavedBinding:async()=>null},{enabled:true,secretKey:'rk_test_FICTIONAL'}])assert.equal(M.createStripeTestTaxReceiptVerifier(options).ready,false);});
test('unknown request/transaction/dispatch binding and untrusted browser fields fail before provider I/O',async()=>{for(const load of [()=>null,b=>({...b,chain:[{...b.chain[0],transactionId:null}]}),b=>({...b,originalDispatch:{...b.originalDispatch,status:'unknown'}}),b=>({...b,originalDispatch:{...b.originalDispatch,requestBodySha256:'a'.repeat(64)}}),b=>({...b,verified:true})]){const z=make('original',{load});try{await assert.rejects(z.run(),M.TaxReceiptHeld);assert.equal(z.calls.length,0);}finally{z.v.close();}}const z=make();try{await assert.rejects(z.v.verify({...z.input,verified:true}),M.TaxReceiptHeld);assert.equal(z.calls.length,0);let called=false;const evil={get requestId(){called=true;return IDS[0];}};await assert.rejects(z.v.verify(evil),M.TaxReceiptHeld);assert.equal(called,false);}finally{z.v.close();}});
const mutations=[
 ['foreign account',(v,{u})=>{if(u.pathname==='/v1/account')v.id='acct_FOREIGN';}],
 ['live balance',(v,{u})=>{if(u.pathname==='/v1/balance')v.livemode=true;}],
 ['live account optional mode',(v,{u})=>{if(u.pathname==='/v1/account')v.livemode=true;}],
 ['wrong transaction reference',(v,{u})=>{if(u.pathname.endsWith('/tax_Original'))v.reference='another_order';}],
 ['live transaction',(v,{u})=>{if(u.pathname.endsWith('/tax_Original'))v.livemode=true;}],
 ['wrong currency',(v,{u})=>{if(u.pathname.endsWith('/tax_Original'))v.currency='eur';}],
 ['inclusive shipping',(v,{u})=>{if(u.pathname.endsWith('/tax_Original'))v.shipping_cost.tax_behavior='inclusive';}],
 ['missing shipping',(v,{u})=>{if(u.pathname.endsWith('/tax_Original'))v.shipping_cost=null;}],
 ['wrong calculation total',(v,{u})=>{if(u.pathname.includes('/calculations/')&&!u.pathname.endsWith('/line_items'))v.amount_total++;}],
 ['original committed after calculation expiry',(v,{u})=>{if(u.pathname.includes('/calculations/')&&!u.pathname.endsWith('/line_items'))v.expires_at=Math.floor(NOW/1000)-1;}],
 ['inclusive calculation',(v,{u})=>{if(u.pathname.includes('/calculations/')&&!u.pathname.endsWith('/line_items'))v.tax_amount_inclusive=1;}],
 ['wrong line amount',(v,{u})=>{if(u.pathname.endsWith('/line_items'))v.data[0].amount++;}],
 ['wrong line tax',(v,{u})=>{if(u.pathname.endsWith('/line_items'))v.data[0].amount_tax++;}],
 ['wrong line code',(v,{u})=>{if(u.pathname.endsWith('/line_items'))v.data[0].tax_code='txcd_00000000';}],
 ['missing line',(v,{u})=>{if(u.pathname.endsWith('/line_items'))v.data.pop();}],
 ['duplicate line',(v,{u})=>{if(u.pathname.endsWith('/line_items'))v.data[1]=v.data[0];}],
 ['extra line',(v,{u})=>{if(u.pathname.endsWith('/line_items'))v.data.push({...v.data[0],id:'tax_li_Extra',reference:'extra'});}],
 ['unrelated list URL',(v,{u})=>{if(u.pathname.endsWith('/line_items'))v.url='/v1/tax/transactions/tax_OTHER/line_items';}],
 ['incomplete pagination',(v,{u})=>{if(u.pathname.endsWith('/line_items'))v.has_more=true;}],
 ['empty pagination loop',(v,{u})=>{if(u.pathname.endsWith('/line_items')){v.data=[];v.has_more=true;}}],
 ['live line',(v,{u})=>{if(u.pathname.endsWith('/line_items'))v.data[0].livemode=true;}],
 ['changed metadata between observations',(v,{u,n})=>{if(u.pathname.endsWith('/tax_Original')&&n===2)v.metadata={changed:true};}],
 ['changed second account',(v,{u,n})=>{if(u.pathname==='/v1/account'&&n===2)v.id='acct_CHANGED';}]
];
for(const [name,mutate] of mutations)test(name+' retains hold',async()=>{const z=make('original',{mutate});try{await assert.rejects(z.run(),M.TaxReceiptHeld);}finally{z.v.close();}});
test('reverse parent/line substitutions, positive refund and incorrect positive undo are held',async()=>{for(const [kind,mutate] of [
 ['refund_reversal',(v,{u})=>{if(u.pathname.endsWith('/tax_Refund'))v.reversal.original_transaction='tax_FOREIGN';}],
 ['refund_reversal',(v,{u})=>{if(u.pathname.includes('/tax_Refund/')&&v.data?.length)v.data[0].reversal.original_line_item='tax_li_Substituted';}],
 ['refund_reversal',(v,{u})=>{if(u.pathname.includes('/tax_Refund/')&&v.data?.length)v.data[0].amount=1000;}],
 ['refund_undo',(v,{u})=>{if(u.pathname.endsWith('/tax_Undo'))v.reversal.original_transaction='tax_Original';}],
 ['refund_undo',(v,{u})=>{if(u.pathname.includes('/tax_Undo/')&&v.data?.length)v.data[0].amount=-1000;}],
 ['refund_undo',(v,{u})=>{if(u.pathname.includes('/tax_Undo/')&&v.data?.length)v.data[0].reversal.original_line_item='tax_li_OriginalItem';}]
 ]){const z=make(kind,{mutate});try{await assert.rejects(z.run(),M.TaxReceiptHeld);}finally{z.v.close();}}});
test('changed private mapping, signed refund state, policy and component limits remain held',async()=>{for(const load of [
 (b,n)=>n===1?b:{...b,policyHash:'b'.repeat(64)},
 b=>({...b,refund:{...b.refund,status:'pending'}}),
 b=>({...b,refund:{...b.refund,needsReview:true}}),
 b=>({...b,policyHash:'0'.repeat(64)}),
 b=>({...b,chain:b.chain.map((a,i)=>i===1?{...a,components:{...a.components,item:{...a.components.item,amountCents:3000}}}:a)})
 ]){const z=make('refund_reversal',{load});try{await assert.rejects(z.run(),M.TaxReceiptHeld);}finally{z.v.close();}}});
for(const headers of [{age:'1'},{'x-cache':'HIT'},{'cf-cache-status':'HIT'},{date:new Date(NOW-61000).toUTCString()},{date:new Date(NOW+31000).toUTCString()},{'content-type':'text/html'},{'content-length':'99999999'},{'content-encoding':'gzip'},{location:'https://example.invalid'}])test('cached/stale/hostile response headers '+JSON.stringify(headers)+' hold',async()=>{const z=make('original',{headers});try{await assert.rejects(z.run(),M.TaxReceiptHeld);}finally{z.v.close();}});
test('a known committed receipt before expiry is not invalidated merely because its retrievable calculation later expires',async()=>{const z=make('original',{mutate:(v,{u})=>{if(u.pathname.endsWith('/taxcalc_Known'))v.expires_at=Math.floor(NOW/1000)-1800;if(u.pathname.endsWith('/tax_Original'))v.created=Math.floor(NOW/1000)-3600;}});try{assert.equal((await z.run()).totalCents,3493);assert(z.calls.every(c=>c.init.headers['Accept-Encoding']==='identity'));}finally{z.v.close();}});
test('optional exact list totals support partial reversal and reject inconsistent counts',async()=>{const z=make('refund_reversal',{mutate:(v,{u})=>{if(u.pathname.endsWith('/line_items'))v.total_count=v.data.length;}});try{assert.equal((await z.run()).totalCents,-1100);}finally{z.v.close();}const bad=make('original',{mutate:(v,{u})=>{if(u.pathname.endsWith('/line_items'))v.total_count=1;}});try{await assert.rejects(bad.run(),M.TaxReceiptHeld);}finally{bad.v.close();}});
test('shipping-only partial reversal and undo support exact zero-item inventories without fabricating line parents',async()=>{for(const kind of ['refund_reversal','refund_undo']){const z=make(kind,{mutate:(v,{u})=>{if(u.pathname.endsWith('/line_items'))v.total_count=v.data.length;}});try{for(let i=1;i<z.binding.chain.length;i++){const a=z.binding.chain[i];for(const k of ['item','buyerFee']){a.components[k].amountCents=0;a.components[k].taxCents=0;}a.components.shipping.amountCents=100;a.components.shipping.taxCents=10;if(i===2)a.parentLineItemIds={item:null,buyerFee:null};const p='/v1/tax/transactions/'+a.transactionId;z.paths[p].shipping_cost={amount:i===1?-100:100,amount_tax:i===1?-10:10,tax_behavior:'exclusive',tax_code:a.components.shipping.taxCode};z.paths[p+'/line_items'].data=[];}assert.equal((await z.run()).totalCents,kind==='refund_reversal'?-110:110);}finally{z.v.close();}}});
test('transaction line IDs cannot reuse cross-component or older ancestor IDs',async()=>{for(const kind of ['refund_reversal','refund_undo'])for(const reused of ['tax_li_OriginalItem','tax_li_OriginalFee']){const target=kind==='refund_reversal'?'tax_Refund':'tax_Undo',z=make(kind,{mutate:(v,{u})=>{if(u.pathname.includes('/'+target+'/'))v.data[0].id=reused;}});try{await assert.rejects(z.run(),M.TaxReceiptHeld);}finally{z.v.close();}}});
test('present zero-value reversal lines need a real observed parent line; null is for omitted components only',async()=>{const z=make('refund_undo',{mutate:(v,{u})=>{if(u.pathname.includes('/tax_Undo/'))v.data.push({...v.data[0],id:'tax_li_UnboundZero',reference:z.binding.chain[2].components.buyerFee.reference,amount:0,amount_tax:0,tax_code:z.binding.chain[2].components.buyerFee.taxCode,reversal:{original_line_item:null}});}});try{await assert.rejects(z.run(),M.TaxReceiptHeld);}finally{z.v.close();}});
test('redirect, wrong final URL, oversized and malformed bodies hold without exposing provider errors',async()=>{for(const f of [
 ({url,response})=>response(url,{error:{message:'secret-in-provider-error'}},{},302),
 ({response})=>response('https://foreign.invalid/',{}),
 ({url,response})=>response(url,'x'.repeat(262145)),
 ({url,response})=>response(url,'{"broken":'),
 ({url,response})=>response(url,'{"__proto__":{"x":true}}')
 ]){const z=make('original',{fetch:f});try{await assert.rejects(z.run(),e=>e instanceof M.TaxReceiptHeld&&!e.message.includes('secret-in-provider-error'));}finally{z.v.close();}}});
test('monotonic expiry, wall rollback and closed verifier deny late output',async()=>{for(const move of [(set)=>set(NOW,25000),(set)=>set(NOW-1,0)]){const z=make('original',{fetch:({url,u,paths,response,setTime})=>{move(setTime);return response(url,paths[u.pathname]);}});try{await assert.rejects(z.run(),M.TaxReceiptHeld);}finally{z.v.close();}}const z=make();z.v.close();await assert.rejects(z.run(),M.TaxReceiptHeld);assert.equal(z.calls.length,0);});
test('concurrent request and source closure while in flight do not admit a second provider stream',async()=>{let resolve;const z=make('original',{fetch:()=>new Promise(r=>{resolve=r;})});const first=z.run();while(!resolve)await new Promise(r=>setImmediate(r));await assert.rejects(z.run(),M.TaxReceiptHeld);assert.equal(z.calls.length,1);z.v.close();resolve(z.response(z.calls[0].url,z.paths['/v1/account']));await assert.rejects(first,M.TaxReceiptHeld);});
test('ignored provider AbortSignal is still bounded by the five-second request timeout',async()=>{const z=make('original',{fetch:()=>new Promise(()=>{})});const start=performance.now();try{await assert.rejects(z.run(),M.TaxReceiptHeld);const elapsed=performance.now()-start;assert(elapsed>=4500&&elapsed<8000);}finally{z.v.close();}});
