'use strict';
// New compatibility regressions only: actual modules with fictional streams/Auth/RPC/provider responses.
const assert=require('node:assert/strict');
const {Readable,PassThrough}=require('node:stream');
const querystring=require('node:querystring');
const {fixture,OWNER,OTHER,ACCOUNT}=require('./helpers/owner-practice-runtime-fixture.cjs');
const {BEGIN_PATH,RETURN_PATH,API_VERSION}=require('../server/owner_practice_runtime.cjs');

function setup({fixtureOptions={},changeResponse=null,missingV2Echo=true}={}){
 const f=fixture(fixtureOptions),provider=[];
 const fetchImpl=async(url,init)=>{
  const r=await f.fetchImpl(url,init);
  if(url.startsWith('https://api.stripe.com/')){
   const u=new URL(url);provider.push({path:u.pathname,method:init.method,connected:init.headers['Stripe-Account']??null});
   assert.equal(init.headers['Stripe-Version'],API_VERSION);
   assert.equal(init.headers.Authorization,'Bearer '+f.restrictedKey);
   if(missingV2Echo&&u.pathname.startsWith('/v2/'))r.headers.delete('stripe-version');
   if(changeResponse)await changeResponse({response:r,url:u,init,f,provider});
  }
  return r;
 };
 const instance=f.build({fetchImpl});
 return {f,provider,request:(method,action,extra={})=>f.request(method,action,{...extra,instance})};
}
function noProviderOrSql(t){assert.deepEqual(t.provider,[]);assert.deepEqual(t.f.providerPosts,[]);assert.deepEqual(t.f.sqlCalls,[]);assert.deepEqual(t.f.writes,[]);}
function noFinancialEndpoints(t){
 assert(t.provider.every(p=>p.method==='GET'||p.method==='POST'&&['/v2/core/accounts','/v2/core/account_links'].includes(p.path)));
 assert(t.f.sqlCalls.every(c=>['context','claim','save','protection'].includes(c.p_operation)));
}
function notLeaked(t,res){for(const secret of [t.f.restrictedKey,t.f.serverKey,t.f.publishableKey])assert.equal(res.body.includes(secret),false);}
function held(res){assert(res.statusCode>=400,res.body);assert.equal(res.headers['referrer-policy'],'no-referrer');assert.equal(res.headers.location,undefined);}
function assertBound(t){assert.equal(t.f.phase,'known');assert.equal(t.f.accountId,ACCOUNT);assert.equal(t.f.writes.filter(x=>x==='claim').length,1);assert.equal(t.f.writes.filter(x=>x==='save').length,1);}
const parsed=action=>querystring.parse('action='+action);

const checks=[
 ['begin completes its single fictional create/bind/link chain when all allowed v2 echoes are absent',async()=>{
  const t=setup(),res=await t.request('POST','begin');assert.equal(res.statusCode,303,res.body);assertBound(t);
  assert.deepEqual(t.f.providerPosts,['/v2/core/accounts','/v2/core/account_links']);
  assert.equal(res.headers['referrer-policy'],'no-referrer');assert.match(res.headers.location,/^https:\/\/accounts\.stripe\.com\/r\/acct_fictionalOwnerPractice#alu_test_/);
  assert(t.f.calls.indexOf('sql:claim')<t.f.calls.indexOf('POST /v2/core/accounts'));notLeaked(t,res);noFinancialEndpoints(t);
 }],
 ['known observe and refresh keep the original binding when v2 response echoes are absent',async()=>{
  const observed=setup({fixtureOptions:{phase:'known'}}),a=await observed.request('POST','observe');
  assert.equal(a.statusCode,200,a.body);assert.equal(observed.f.phase,'known');assert.deepEqual(observed.f.writes,['protection']);
  assert.deepEqual(observed.f.providerPosts,[]);assert.equal(a.headers['referrer-policy'],'no-referrer');assert.match(a.body,/Payments remain closed/);
  const refreshed=setup({fixtureOptions:{phase:'known'}}),b=await refreshed.request('POST','refresh');
  assert.equal(b.statusCode,303,b.body);assert.deepEqual(refreshed.f.writes,[]);assert.deepEqual(refreshed.f.providerPosts,['/v2/core/account_links']);
  assert.equal(refreshed.f.accountId,ACCOUNT);assert.equal(b.headers['referrer-policy'],'no-referrer');noFinancialEndpoints(observed);noFinancialEndpoints(refreshed);
 }],
 ['exact v2 response echoes remain compatible without changing the pinned requests',async()=>{
  for(const action of ['begin','observe','refresh']){
   const t=setup({fixtureOptions:{phase:action==='begin'?'prepared':'known'},missingV2Echo:false});
   const res=await t.request('POST',action);assert.equal(res.statusCode,action==='observe'?200:303,res.body);noFinancialEndpoints(t);
  }
 }],
 ['present wrong, empty and undefined v2 versions hold for create, account read and account link responses',async()=>{
  for(const stage of ['create','read','link'])for(const version of ['2026-09-30.endive','',undefined]){
   const t=setup({fixtureOptions:{phase:stage==='create'?'prepared':'known'},changeResponse:({response,url,init})=>{
    const selected=stage==='create'&&url.pathname==='/v2/core/accounts'&&init.method==='POST'||
     stage==='read'&&url.pathname==='/v2/core/accounts/'+ACCOUNT||stage==='link'&&url.pathname==='/v2/core/account_links';
    if(!selected)return;
    if(version===undefined){const h=response.headers;response.headers={get:name=>name.toLowerCase()==='stripe-version'?undefined:h.get(name)};}
    else response.headers.set('stripe-version',version);
   }});
   const res=await t.request('POST',stage==='create'?'begin':stage==='read'?'observe':'refresh');held(res);notLeaked(t,res);
   if(stage==='create'){assert.equal(t.f.phase,'dispatched');assert.deepEqual(t.f.writes,['claim']);assert.deepEqual(t.f.providerPosts,['/v2/core/accounts']);}
   if(stage==='read')assert.deepEqual(t.f.writes,[]);
   noFinancialEndpoints(t);
  }
 }],
 ['v1 account, platform balance and connected balance still require exact response versions',async()=>{
  for(const target of ['account','platform-balance','connected-balance']){
   const t=setup({fixtureOptions:{phase:'known'},changeResponse:({response,url,init})=>{
    if(target==='account'&&url.pathname==='/v1/account'||target==='platform-balance'&&url.pathname==='/v1/balance'&&init.headers['Stripe-Account']===undefined||
     target==='connected-balance'&&url.pathname==='/v1/balance'&&init.headers['Stripe-Account']===ACCOUNT)response.headers.delete('stripe-version');
   }});
   held(await t.request('POST','observe'));assert.deepEqual(t.f.writes,[]);assert.deepEqual(t.f.providerPosts,[]);
  }
 }],
 ['missing v2 echo cannot bypass status, URL, redirect, Date, cache or JSON-body bounds',async()=>{
  const changes=[r=>r.status=401,r=>r.ok=false,r=>r.url+='&foreign=1',r=>r.redirected=true,
   r=>r.headers.set('date','Fri, 01 Nov 2024 00:00:00 GMT'),r=>r.headers.set('age','1'),
   r=>r.headers.set('content-type','text/html'),r=>r.headers.set('content-length','65537'),r=>r.headers.set('content-length','1')];
  for(const change of changes){
   const t=setup({fixtureOptions:{phase:'known'},changeResponse:({response,url})=>{if(url.pathname==='/v2/core/accounts/'+ACCOUNT)change(response);}});
   held(await t.request('POST','observe'));assert.deepEqual(t.f.writes,[]);assert.deepEqual(t.f.providerPosts,[]);
  }
  const live=setup({fixtureOptions:{phase:'known',liveBalance:true}});held(await live.request('POST','observe'));assert.deepEqual(live.f.writes,[]);
 }],
 ['only successful current-owner GET form sinks select same-origin referrer policy',async()=>{
  for(const url of [BEGIN_PATH,RETURN_PATH]){
   const t=setup(),res=await t.request('GET',null,{url});assert.equal(res.statusCode,200,res.body);
   assert.equal(res.headers['referrer-policy'],'same-origin');assert.equal(res.headers['content-type'],'text/html; charset=utf-8');
   assert.match(res.headers['cache-control'],/no-store/);assert.match(res.headers['content-security-policy'],/form-action 'self'/);
   assert.equal(res.headers['set-cookie'],undefined);noProviderOrSql(t);
  }
 }],
 ['errors, nonowners, revoked owners and conflicting form origins retain no-referrer without dispatch',async()=>{
  for(const extra of [{cookies:{actor:OTHER}},{headers:{origin:'null'}},{headers:{origin:'https://foreign.example.invalid'}},
   {headers:{origin:undefined}},{headers:{'sec-fetch-site':'cross-site'}},{headers:{'sec-fetch-site':undefined}}]){
   const t=setup(),res=await t.request('POST','begin',extra);held(res);noProviderOrSql(t);
  }
  const revoked=setup();revoked.f.revoke();held(await revoked.request('GET',null,{url:BEGIN_PATH}));noProviderOrSql(revoked);
  const badPath=setup();held(await badPath.request('GET',null,{url:RETURN_PATH+'?action=begin'}));noProviderOrSql(badPath);
 }],
 ['native querystring null-prototype parsing with exact restored bytes supports begin, observe and refresh',async()=>{
  for(const action of ['begin','observe','refresh']){
   const t=setup({fixtureOptions:{phase:action==='begin'?'prepared':'known'}}),value=parsed(action);
   assert.equal(Object.getPrototypeOf(value),null);const res=await t.request('POST',action,{parsedBody:value});
   assert.equal(res.statusCode,action==='observe'?200:303,res.body);noFinancialEndpoints(t);
  }
 }],
 ['native PassThrough replay validates the original action bytes and leaves ordinary object/raw compatibility intact',async()=>{
  const t=setup(),stream=new PassThrough(),pending=t.request('POST','begin',{parsedBody:parsed('begin'),stream});
  stream.write('action=');stream.end('begin');const res=await pending;assert.equal(res.statusCode,303,res.body);assertBound(t);
  for(const extra of [{parsedBody:{action:'begin'},raw:'ignored-only-for-original-object-compatibility'},{raw:'action=begin'}]){
   const old=setup(),r=await old.request('POST','begin',extra);assert.equal(r.statusCode,303,r.body);assertBound(old);
  }
 }],
 ['normalized action aliases, mismatched actions, absent bytes and oversized replays are held before SQL or Stripe',async()=>{
  const variants=[{raw:'%61ction=begin'},{raw:'action=beg%69n'},{raw:'action=begin&extra=1'},{raw:'action=refresh'},
   {raw:''},{raw:'action=begin '},{raw:'action=begin'+' '.repeat(60)},{stream:Readable.from([Buffer.from([255])])}];
  for(const extra of variants){const t=setup(),res=await t.request('POST','begin',{parsedBody:parsed('begin'),...extra});held(res);noProviderOrSql(t);}
 }],
 ['accessors, hidden action, extra keys, symbols and foreign parsed prototypes never gain replay authority',async()=>{
  let getters=0;const accessor=Object.create(null);Object.defineProperty(accessor,'action',{enumerable:true,get(){getters++;return 'begin';}});
  const hidden=Object.create(null);Object.defineProperty(hidden,'action',{value:'begin',enumerable:false});
  const extra=parsed('begin');extra.extra='ignored';const symbol=parsed('begin');symbol[Symbol('extra')]=1;
  const repeated=querystring.parse('action=begin&action=begin');
  for(const value of [accessor,hidden,extra,symbol,repeated,Object.create({action:'begin'})]){
   const t=setup(),res=await t.request('POST','begin',{parsedBody:value});held(res);noProviderOrSql(t);
  }
  assert.equal(getters,0);
 }],
 ['raw replay remains inside the same operation deadline and observes revocation before seller work',async()=>{
  for(const expire of [false,true]){
   const t=setup();const stream=Readable.from((async function*(){yield Buffer.from('action=');if(expire)t.f.advance(5001);else t.f.revoke();yield Buffer.from('begin');})());
   const res=await t.request('POST','begin',{parsedBody:parsed('begin'),stream});held(res);noProviderOrSql(t);
  }
 }],
 ['a timed-out or revoked create response cannot bind, redirect or repeat the consumed account claim',async()=>{
  for(const expire of [false,true]){
   const t=setup({changeResponse:({url,init,f})=>{if(url.pathname==='/v2/core/accounts'&&init.method==='POST')expire?f.advance(5001):f.revoke();}});
   const res=await t.request('POST','begin');held(res);assert.equal(t.f.phase,'dispatched');assert.deepEqual(t.f.writes,['claim']);
   assert.deepEqual(t.f.providerPosts,['/v2/core/accounts']);assert.equal(t.f.accountId,null);notLeaked(t,res);
  }
 }],
 ['uncertain create outcomes remain dispatched across new requests and never mint a replacement account',async()=>{
  for(const lost of [false,true]){
   const t=setup({fixtureOptions:{lostCreate:lost},changeResponse:({response,url,init})=>{
    if(!lost&&url.pathname==='/v2/core/accounts'&&init.method==='POST')response.headers.set('stripe-version','2026-09-30.endive');
   }});
   held(await t.request('POST','begin'));assert.equal(t.f.phase,'dispatched');assert.deepEqual(t.f.writes,['claim']);
   held(await t.request('POST','begin'));assert.deepEqual(t.f.providerPosts,['/v2/core/accounts']);
   assert.equal(t.f.writes.filter(x=>x==='claim').length,1);assert.equal(t.f.accountId,null);
  }
 }]
];
async function isolated(run){const original=globalThis.fetch;let unexpected=0;globalThis.fetch=()=>{unexpected++;throw Error('Real networking is forbidden in these source checks');};try{await run();}finally{globalThis.fetch=original;assert.equal(unexpected,0);}}
async function runFocused(){const results=[];for(const [name,run]of checks){await isolated(run);results.push({name,passed:true});}return{kind:'new-seller-hosted-compatibility-synthetic-checks',pass:results.length,fail:0,realProviderRequests:0,results};}
if(require.main===module){const {test}=require('node:test');for(const [name,run]of checks)test(name,()=>isolated(run));}
module.exports={runFocused};
