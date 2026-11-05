const {test}=require('node:test'),assert=require('node:assert/strict'),{Readable}=require('node:stream');
const {createTestShippingHandler}=require('../server/test_shipping_handler.cjs');
const {OrderAccessDenied}=require('../server/test_order_repository.cjs');
const good={test:true,id:'a'.repeat(32),rates:[{test:true,id:'b'.repeat(32),carrier:'USPS',service:'Ground Advantage',currency:'USD',amountCents:725}]};
function request({method='POST',url='/api/test-marketplace?action=shipping-quote',body='{}',type='application/json'}={}){return Object.assign(Readable.from([body]),{method,url,headers:{authorization:'Bearer fixture','content-type':type}});}
const response=()=>({headers:{},setHeader(k,v){this.headers[k]=v;},end(body){this.body=body;}});
test('shipping connection accepts only authenticated operator and server-owned synthetic addresses',async()=>{
 const calls=[],r=response();await createTestShippingHandler({enabled:true,repository:{refundAccess:async args=>{calls.push('auth');assert.deepEqual(args,{authorization:'Bearer fixture'});}},shipping:{quote:async input=>{calls.push('quote');assert.equal(input.from.street1,'400 Broad St');assert.equal(input.to.street1,'350 5th Ave');assert.equal(input.package.weight,1);assert.equal(input.from.email,undefined);return good;},label:()=>assert.fail('label forbidden')}})(request(),r);
 assert.deepEqual(calls,['auth','quote']);assert.equal(r.statusCode,200);assert.deepEqual(JSON.parse(r.body),{test:true,mode:'carrier_connection_test',postagePurchased:false,checkoutChanged:false,rates:[{carrier:'USPS',service:'Ground Advantage',currency:'USD',amountCents:725}]});assert.equal(r.body.includes(good.id),false);assert.match(r.headers['Cache-Control'],/no-store/);
});
test('shipping connection rejects changed methods, query and body before operator or provider work',async()=>{
 for(const [patch,status] of [[{method:'GET'},405],[{url:'/api/test-marketplace?action=shipping-quote&action=shipping-quote'},400],[{url:'/api/test-marketplace?action=shipping-quote&to=other'},400],[{body:'{"to":{}}'},400],[{body:'{"rate":"b"}'},400],[{body:'null'},400],[{body:'[]'},400],[{body:'invalid'},400],[{body:' '.repeat(129)},413],[{type:'text/plain'},415]]){
  const r=response();await createTestShippingHandler({enabled:true,repository:{refundAccess:()=>assert.fail('auth')},shipping:{quote:()=>assert.fail('quote')}})(request(patch),r);assert.equal(r.statusCode,status);
 }
});
test('shipping quote refuses ordinary members without contacting Shippo',async()=>{
 const r=response();await createTestShippingHandler({enabled:true,repository:{refundAccess:async()=>{throw new OrderAccessDenied('private');}},shipping:{quote:()=>assert.fail('provider')}})(request(),r);assert.equal(r.statusCode,403);assert.equal(r.body.includes('private'),false);
});
test('shipping quote rejects missing, live, malformed or unbounded carrier evidence',async()=>{
 const variants=[null,{...good,test:false},{...good,rates:[]},{...good,id:'foreign'},{...good,rates:Array(101).fill(good.rates[0])},...[{test:false},{amountCents:100001},{amountCents:1.1},{amountCents:-1},{currency:'EUR'},{service:''},{carrier:'x'.repeat(101)},{id:'wrong'}].map(p=>({...good,rates:[{...good.rates[0],...p}]}))];
 for(const quote of variants){const r=response();await createTestShippingHandler({enabled:true,repository:{refundAccess:async()=>{}},shipping:{quote:async()=>quote}})(request(),r);assert.equal(r.statusCode,503);assert.equal(JSON.parse(r.body).rates,undefined);}
});
test('shipping failures are sanitized with no retry and feature defaults closed',async()=>{
 let count=0;const args={repository:{refundAccess:async()=>{}},shipping:{quote:async()=>{count++;throw Error('secret key');}}};const disabled=response();await createTestShippingHandler(args)(request(),disabled);assert.equal(disabled.statusCode,404);assert.equal(count,0);
 const r=response();await createTestShippingHandler({...args,enabled:true})(request(),r);assert.equal(r.statusCode,503);assert.equal(count,1);assert.equal(r.body.includes('secret'),false);
});
