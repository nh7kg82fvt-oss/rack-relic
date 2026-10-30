const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createShippoTestClient}=require('../server/shippo_test_client.cjs');
const id='a'.repeat(32), rate='b'.repeat(32);
const addr={name:'Test only',street1:'1 Test Street',city:'Test',state:'CA',zip:'94107',country:'US'};
const input={from:addr,to:addr,package:{length:10,width:8,height:2,weight:1}};
const reply=(data)=>({ok:true,json:async()=>data});
test('refuses missing and live credentials',()=>{
 for(const token of [undefined,'shippo_live_example','']) assert.throws(()=>createShippoTestClient({token}));
});
test('validates input before sending addresses; US only',async()=>{
 let calls=0; const c=createShippoTestClient({token:'shippo_test_fixture',fetchImpl:async()=>{calls++;}});
 await assert.rejects(c.quote({...input,to:{...addr,country:'CA'}}));
 await assert.rejects(c.quote({...input,package:{...input.package,weight:0}}));
 assert.equal(calls,0);
});
test('quotes cents exactly, strips extra address data, then makes one test label',async()=>{
 const calls=[]; const c=createShippoTestClient({token:'shippo_test_fixture',fetchImpl:async(url,options)=>{
 calls.push({url,options}); return reply(calls.length===1?{test:true,object_id:id,rates:[{object_id:rate,amount:'7.25',currency:'USD',provider:'USPS',servicelevel:{name:'Ground'}}]}:{test:true,object_id:id,status:'SUCCESS',label_url:'https://example.com/test.pdf'});
 }});
 const result=await c.quote({...input,from:{...addr,email:'sender@example.com',phone:'4155550123',privateNote:'not for carrier'}});
 assert.equal(result.rates[0].amountCents,725);
 assert.equal(JSON.parse(calls[0].options.body).address_from.privateNote,undefined);
 assert.equal(JSON.parse(calls[0].options.body).address_from.email,'sender@example.com');
 assert.equal(calls[0].options.redirect,'error');
 assert.equal((await c.label(rate)).test,true);
 await assert.rejects(c.label(rate)); assert.equal(calls.length,2);
});
test('rejects live response and unquoted rate IDs',async()=>{
 let calls=0; const c=createShippoTestClient({token:'shippo_test_fixture',fetchImpl:async()=>{calls++;return reply({test:false,object_id:id,rates:[]});}});
 await assert.rejects(c.quote(input)); await assert.rejects(c.label(rate)); assert.equal(calls,1);
});
test('does not leak provider errors or automatically retry failed requests',async()=>{
 let calls=0; const c=createShippoTestClient({token:'shippo_test_fixture',fetchImpl:async()=>{calls++;throw Error('secret token and address');}});
 await assert.rejects(c.quote(input),e=>!e.message.includes('secret'));assert.equal(calls,1);
});
