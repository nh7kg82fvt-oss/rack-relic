'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createTestSetupStatus}=require('../server/test_setup_status.cjs');
const env={VERCEL_ENV:'preview',VERCEL_GIT_COMMIT_REF:'test-only-marketplace-foundation',RACK_RELIC_TEST_SUPABASE_URL:'https://zvtaqzcqfdjpuwnlpzln.supabase.co',RACK_RELIC_TEST_SUPABASE_SERVER_KEY:'sb_secret_syntheticFixture',RACK_RELIC_TEST_STRIPE_KEY:'sk_test_syntheticFixture',RACK_RELIC_TEST_STRIPE_ACCOUNT:'acct_syntheticFixture'};
const response=data=>({ok:true,headers:{get:()=>null},json:async()=>data});
function transport(overrides={}){
 return async(url,options)=>{
  assert.equal(options.redirect,'error');assert.equal(options.cache,'no-store');
  if(url.includes('supabase.co')){assert.equal(options.method,'POST');assert.equal(JSON.parse(options.body).p_member,'00000000-0000-4000-8000-000000000000');return overrides.database??response([]);}
  assert.equal(options.method,'GET');
  return url.endsWith('/account')?(overrides.account??response({object:'account',id:env.RACK_RELIC_TEST_STRIPE_ACCOUNT})):(overrides.balance??response({object:'balance',livemode:false}));
 };
}
async function invoke(settings=env,fetchImpl=transport(),method='GET'){
 const res={headers:{},setHeader(k,v){this.headers[k]=v;},end(v){this.body=JSON.parse(v);}};
 await createTestSetupStatus({env:settings,fetchImpl})({method},res);return res;
}
test('only the exact preview branch can use the status check',async()=>{
 for(const override of [{VERCEL_ENV:'production'},{VERCEL_ENV:'development'},{VERCEL_GIT_COMMIT_REF:'main'}]){
  const r=await invoke({...env,...override},()=>{throw Error('Must not call providers');});assert.equal(r.statusCode,404);
 }
});
test('configuration rejects live keys, production DB, substituted origins and missing account before any request',async()=>{
 for(const override of [{RACK_RELIC_TEST_STRIPE_KEY:'sk_live_syntheticFixture'},{RACK_RELIC_TEST_SUPABASE_URL:'https://zrfztnbyynrdzfeblkeq.supabase.co'},{RACK_RELIC_TEST_SUPABASE_URL:'https://zvtaqzcqfdjpuwnlpzln.supabase.co.evil.example'},{RACK_RELIC_TEST_STRIPE_ACCOUNT:''},{RACK_RELIC_TEST_SUPABASE_SERVER_KEY:'sb_publishable_fixture'}]){
  let called=false;const r=await invoke({...env,...override},()=>{called=true;});assert.equal(r.statusCode,503);assert.equal(called,false);
 }
});
test('read-only connection status never exposes keys or account IDs and leaves checkout disabled',async()=>{
 const r=await invoke();assert.equal(r.statusCode,200);assert.deepEqual(r.body,{test:true,ready:true,database:'connected',stripe:'connected',checkout:'disabled'});
 const body=JSON.stringify(r.body);for(const value of Object.values(env))assert.equal(body.includes(value),false);
 assert.match(r.headers['Cache-Control'],/no-store/);
});
test('restricted test keys are accepted by the read-only verifier',async()=>{
 assert.equal((await invoke({...env,RACK_RELIC_TEST_STRIPE_KEY:'rk_test_syntheticFixture'})).statusCode,200);
});
test('wrong sandbox, live response, and revoked credentials fail closed',async()=>{
 for(const overrides of [{account:response({object:'account',id:'acct_other'})},{balance:response({object:'balance',livemode:true})},{account:{ok:false}}]){
  const r=await invoke(env,transport(overrides));assert.equal(r.statusCode,503);assert.equal(r.body.stripe,'unavailable');
 }
});
test('database failure, unexpected rows, and cached authority fail closed',async()=>{
 for(const database of [{ok:false},response([{id:'not-a-test-row'}]),{...response([]),headers:{get:k=>k==='age'?'9':null}}]){
  const r=await invoke(env,transport({database}));assert.equal(r.statusCode,503);assert.equal(r.body.database,'unavailable');
 }
});
test('transport errors return no provider details or secrets',async()=>{
 const r=await invoke(env,async()=>{throw Error(env.RACK_RELIC_TEST_STRIPE_KEY);});assert.equal(r.statusCode,503);assert.equal(JSON.stringify(r.body).includes('syntheticFixture'),false);
});
test('POST cannot invoke providers',async()=>{
 let called=false;const r=await invoke(env,()=>{called=true;},'POST');assert.equal(r.statusCode,405);assert.equal(called,false);
});
