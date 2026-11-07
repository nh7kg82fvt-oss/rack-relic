const {test}=require('node:test'),assert=require('node:assert/strict');
const {webcrypto,createHash}=require('node:crypto');
const {createTestEmailSignin}=require('../test-signin.js');
const fs=require('node:fs');
const environments=require('../test-environments.js');
const {build}=require('../scripts/build-test-environments.cjs');
function setup(fetchImpl,clock=()=>100000){const entries=new Map(),storage={getItem:k=>entries.get(k)||null,setItem:(k,v)=>entries.set(k,v),removeItem:k=>entries.delete(k)};return {entries,client:createTestEmailSignin({publishableKey:'sb_publishable_fixture',storage,fetchImpl,cryptoImpl:webcrypto,clock})};}
test('email login binds an existing account to this browser through S256 PKCE and an exact return URL',async()=>{
 let sent;const {client,entries}=setup(async(url,options)=>{sent={url,options};return Response.json({});});
 await client.send('Buyer@Example.com');const pending=JSON.parse([...entries.values()][0]),body=JSON.parse(sent.options.body);
 assert.equal(body.email,'buyer@example.com');assert.equal(body.create_user,false);assert.equal(body.code_challenge_method,'s256');assert.equal(body.code_challenge,createHash('sha256').update(pending.verifier).digest('base64url'));assert.equal(sent.options.body.includes(pending.verifier),false);
 assert.equal(new URL(sent.url).origin,'https://zvtaqzcqfdjpuwnlpzln.supabase.co');assert.equal(new URL(sent.url).searchParams.get('redirect_to'),'https://rack-relic-git-test-only-marketplace-foundation-rack-relic.vercel.app/api/test-marketplace');
 await assert.rejects(client.send('buyer@example.com'),/wait a minute/);
});
test('callback exchanges a one-time code only with the saved verifier and matching email',async()=>{
 let pending,exchanges=0;const {client,entries}=setup(async(url,options)=>{if(url.includes('/otp?'))return Response.json({});exchanges++;assert.deepEqual(JSON.parse(options.body),{auth_code:'one-time-code',code_verifier:pending.verifier});return Response.json({access_token:'fixture',user:{id:'member',email:'buyer@example.com'}});});
 await client.send('buyer@example.com');pending=JSON.parse([...entries.values()][0]);assert.equal((await client.complete('one-time-code')).user.email,'buyer@example.com');assert.equal(entries.size,0);await assert.rejects(client.complete('one-time-code'),/same Chrome profile/);assert.equal(exchanges,1);
});
test('missing or expired browser proof cannot exchange a callback',async()=>{
 let now=100000,calls=0;const {client,entries}=setup(async()=>{calls++;return Response.json({});},()=>now);
 await assert.rejects(client.complete('code'),/same Chrome profile/);assert.equal(calls,0);await client.send('buyer@example.com');now+=3600001;await assert.rejects(client.complete('code'),/fresh link/);assert.equal(calls,1);assert.equal(entries.size,0);
});
test('a different account in the response is rejected without retaining proof',async()=>{
 const {client,entries}=setup(async url=>Response.json(url.includes('/otp?')?{}:{access_token:'fixture',user:{id:'member',email:'other@example.com'}}));await client.send('buyer@example.com');await assert.rejects(client.complete('code'),/does not match/);assert.equal(entries.size,0);
});
test('restricted email delivery is explained and failed requests do not strand the login form',async()=>{
 const {client,entries}=setup(async()=>Response.json({code:'email_address_not_authorized',message:'private details'},{status:403}));await assert.rejects(client.send('buyer@example.com'),/email delivery is restricted/);assert.equal(entries.size,0);
});
test('network failure has a bounded request and a recoverable message',async()=>{
 const {client,entries}=setup(async(_url,options)=>{assert.ok(options.signal);throw Error('internal transport information');});await assert.rejects(client.send('buyer@example.com'),/did not respond/);assert.equal(entries.size,0);
});
test('browser identity registry is generated exactly from the reviewed server tuples',()=>{
 assert.equal(fs.readFileSync(require.resolve('../test-environments.js'),'utf8'),build());
 assert.ok(Object.isFrozen(environments)&&environments.every(Object.isFrozen));
 assert.equal(environments.length,2);
});
test('acceptance sign-in uses its exact callback and cannot consume legacy browser proof',async()=>{
 const row=environments.find(v=>v.id==='acceptance-v1'),entries=new Map(),calls=[];
 const storage={getItem:k=>entries.get(k)??null,setItem:(k,v)=>entries.set(k,v),removeItem:k=>entries.delete(k)};
 const fetchImpl=async(url,options)=>{calls.push({url,options});return Response.json(url.includes('/otp?')?{}:{access_token:'fixture',user:{id:'member',email:'buyer@example.com'}});};
 const legacy=createTestEmailSignin({publishableKey:'sb_publishable_fixture',storage,fetchImpl,cryptoImpl:webcrypto});
 const current=createTestEmailSignin({...row,environmentId:row.id,publishableKey:'sb_publishable_fixture',storage,fetchImpl,cryptoImpl:webcrypto});
 await legacy.send('buyer@example.com');const old=entries.get('rr-test-email-signin');
 await assert.rejects(current.complete('wrong-environment'),/same Chrome profile/);assert.equal(calls.length,1);assert.equal(entries.get('rr-test-email-signin'),old);
 await current.send('buyer@example.com');assert.equal(new URL(calls[1].url).origin,row.projectUrl);assert.equal(new URL(calls[1].url).searchParams.get('redirect_to'),row.returnUrl);
 assert.equal(entries.size,2);await current.complete('acceptance-code');assert.equal(entries.get('rr-test-email-signin'),old);assert.equal(entries.size,1);
});
test('mixed, arbitrary and cross-project sign-in targets fail before any request',()=>{
 const a=environments[0],b=environments[1];let calls=0;
 for(const patch of [{projectUrl:a.projectUrl,returnUrl:b.returnUrl},{projectUrl:b.projectUrl,returnUrl:a.returnUrl},{projectUrl:b.projectUrl,returnUrl:b.returnUrl,environmentId:a.id},{projectUrl:'https://evil.invalid',returnUrl:a.returnUrl},{projectUrl:a.projectUrl,returnUrl:a.returnUrl+'?redirect=elsewhere'}]){
  assert.throws(()=>createTestEmailSignin({...patch,publishableKey:'sb_publishable_fixture',storage:{},fetchImpl:()=>calls++}),/unavailable/);
 }
 assert.equal(calls,0);
});
test('copied or corrupted pending proof cannot be exchanged in another environment',async()=>{
 const row=environments.find(v=>v.id==='acceptance-v1'),entries=new Map(),storage={getItem:k=>entries.get(k)??null,setItem:(k,v)=>entries.set(k,v),removeItem:k=>entries.delete(k)};let calls=0;
 const client=createTestEmailSignin({...row,environmentId:row.id,publishableKey:'sb_publishable_fixture',storage,cryptoImpl:webcrypto,fetchImpl:async()=>{calls++;return Response.json({});}});
 await client.send('buyer@example.com');const key='rr-test-email-signin:'+row.id,pending=JSON.parse(entries.get(key));pending.projectUrl=environments[0].projectUrl;entries.set(key,JSON.stringify(pending));
 await assert.rejects(client.complete('code'),/same Chrome profile/);assert.equal(calls,1);assert.equal(entries.size,0);
});

test('project email limit is distinct from local cooldown and never repeats a send',async()=>{let calls=0;const{client,entries}=setup(async()=>{calls++;return Response.json({error_code:'over_email_send_rate_limit',message:'private provider text'},{status:429});});await assert.rejects(client.send('buyer@example.com'),e=>e.message.includes('delivery limit')&&!e.message.includes('private provider text'));assert.equal(calls,1);assert.equal(entries.size,0);});
test('rate-limit retry advice uses only bounded provider Retry-After seconds',async()=>{for(const [header,expected]of [['120',/Wait 2 minute/],['9999999',/Please wait before/],['arbitrary',/Please wait before/]]){const{client}=setup(async()=>Response.json({},{status:429,headers:{'retry-after':header}}));await assert.rejects(client.send('buyer@example.com'),expected);}});
