'use strict';
// Fictional in-process transports only; native/global fetch is never invoked.
const test=require('node:test'),assert=require('node:assert/strict');
const {fixture,ACCOUNT}=require('./helpers/owner-practice-runtime-fixture.cjs');
const {ENV,API_VERSION}=require('../server/owner_practice_runtime.cjs');
async function isolated(run){
 const original=globalThis.fetch;let globalCalls=0;
 globalThis.fetch=()=>{globalCalls++;throw Error('Unexpected global network transport');};
 try{return await run();}finally{globalThis.fetch=original;assert.equal(globalCalls,0);}
}
function observed(f,mutate){
 const stripe=[],supabase=[];
 const instance=f.build({fetchImpl:async(url,init)=>{
  const u=new URL(url),provider=u.origin==='https://api.stripe.com';
  if(provider){
   stripe.push({method:init.method,path:u.pathname,query:u.search,headers:{...init.headers}});
   assert.equal(init.headers['Accept-Encoding'],'identity');assert.equal(init.headers['Stripe-Version'],API_VERSION);
   assert.equal(init.headers.Authorization,'Bearer '+f.restrictedKey);assert.equal(init.headers.apikey,undefined);
  }else{
   assert.equal(u.origin,ENV.projectUrl);supabase.push({path:u.pathname,headers:{...init.headers}});
   assert.equal(init.headers['Stripe-Version'],undefined);assert.equal(init.headers.apikey,f.serverKey);
  }
  const response=await f.fetchImpl(url,init);if(provider&&mutate)mutate(response,{url,init});return response;
 }});
 return {instance,stripe,supabase};
}
test('all five owner Stripe request shapes and both balance contexts request identity through the final forwarding port',()=>isolated(async()=>{
 const f=fixture(),o=observed(f);
 assert.equal((await f.request('POST','begin',{instance:o.instance})).statusCode,303);
 assert.equal((await f.request('POST','observe',{instance:o.instance})).statusCode,200);
 assert.equal((await f.request('POST','refresh',{instance:o.instance})).statusCode,303);
 assert.deepEqual([...new Set(o.stripe.map(x=>x.method+' '+x.path))].sort(),[
  'GET /v1/account','GET /v1/balance','GET /v2/core/accounts/'+ACCOUNT,'POST /v2/core/account_links','POST /v2/core/accounts'].sort());
 assert.deepEqual([...new Set(o.stripe.filter(x=>x.path==='/v1/balance').map(x=>x.headers['Stripe-Account']??'platform'))].sort(),[ACCOUNT,'platform'].sort());
 assert(o.stripe.every(x=>x.headers['Accept-Encoding']==='identity'));
 assert(o.stripe.filter(x=>x.path!=='/v1/balance').every(x=>x.headers['Stripe-Account']===undefined));
 const get=o.stripe.find(x=>x.method==='GET'&&x.path==='/v2/core/accounts/'+ACCOUNT);
 assert.deepEqual([...new URLSearchParams(get.query).values()],['configuration.recipient','defaults','identity','requirements']);
 assert.equal(o.stripe.filter(x=>x.method==='POST'&&x.path==='/v2/core/accounts').length,1);
 assert.equal(o.stripe.filter(x=>x.method==='POST'&&x.path==='/v2/core/account_links').length,2);
 assert(o.supabase.length>0);assert.deepEqual(f.writes,['claim','save','protection']);
}));
test('an explicit identity response remains acceptable with the same strict pinned owner flow',()=>isolated(async()=>{
 const f=fixture({providerHeaders:{'content-encoding':'identity'}}),o=observed(f);
 const r=await f.request('POST','begin',{instance:o.instance});assert.equal(r.statusCode,303,r.body);assert.equal(r.body,'');
 assert.match(r.headers.location,/^https:\/\/accounts\.stripe\.com\/r\//);assert.equal(f.phase,'known');
}));
test('compressed, conflicting-length and wrong or missing version responses remain held before claim',()=>isolated(async()=>{
 const changes=[r=>r.headers.set('content-encoding','gzip'),r=>r.headers.set('content-encoding','br'),
  r=>r.headers.set('content-encoding','identity, gzip'),r=>r.headers.set('content-length','1'),
  r=>r.headers.set('stripe-version','fictional-unpinned'),r=>r.headers.delete('stripe-version')];
 for(const mutate of changes){
  const f=fixture(),o=observed(f,mutate),r=await f.request('POST','begin',{instance:o.instance});
  assert.equal(r.statusCode,503);assert.equal(r.headers.location,undefined);assert.equal(f.phase,'prepared');
  assert.deepEqual(f.writes,[]);assert.deepEqual(f.providerPosts,[]);assert(o.stripe.length>0);
 }
}));
test('a provider ignoring identity after account dispatch preserves the unknown and never grants another creation',()=>isolated(async()=>{
 const f=fixture(),o=observed(f,(r,{url,init})=>{if(new URL(url).pathname==='/v2/core/accounts'&&init.method==='POST')r.headers.set('content-encoding','gzip');});
 const r=await f.request('POST','begin',{instance:o.instance});assert.equal(r.statusCode,503);assert.equal(r.headers.location,undefined);
 assert.equal(f.phase,'dispatched');assert.deepEqual(f.writes,['claim']);assert.deepEqual(f.providerPosts,['/v2/core/accounts']);
 assert.equal((await f.request('POST','begin',{instance:o.instance})).statusCode,503);
 assert.deepEqual(f.providerPosts,['/v2/core/accounts']);assert.deepEqual(f.writes,['claim']);
}));
