const {test}=require('node:test'),assert=require('node:assert/strict');
const {webcrypto,createHash}=require('node:crypto');
const {createTestEmailSignin}=require('../test-signin.js');
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
