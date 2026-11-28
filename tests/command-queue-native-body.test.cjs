'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),{Readable}=require('node:stream');
const {handleQueue}=require('../server/command_queue_runtime.cjs');
const {TEST_ENVIRONMENTS}=require('../server/test_environment_registry.cjs');
const E=TEST_ENVIRONMENTS.acceptance,owner='11111111-1111-4111-8111-111111111111',other='11111111-1111-4111-8111-111111111112';
const env={VERCEL_ENV:'preview',VERCEL_GIT_COMMIT_REF:E.branch,RACK_RELIC_TEST_SUPABASE_URL:E.projectUrl,RACK_RELIC_TEST_STRIPE_ACCOUNT:E.accountId,RACK_RELIC_TEST_ADMIN_OWNER_ID:owner,RACK_RELIC_TEST_MEMBER_IDS:owner+','+other,RACK_RELIC_TEST_REFUND_OPERATOR_IDS:owner,RACK_RELIC_TEST_REFUNDS_ENABLED:'true',RACK_RELIC_TEST_REFUND_REQUESTS_ENABLED:'true',RACK_RELIC_TEST_ADMIN_OVERVIEW_ENABLED:'true',RACK_RELIC_COMMAND_QUEUE_ACK_ENABLED:'true'};
const command={requestId:owner,caseRef:'case_'+'a'.repeat(32),orderRef:other,generation:1,evidenceVersion:'b'.repeat(64)};
async function attempt({raw=JSON.stringify(command),parsed=false}={}){
 const req=Readable.from([Buffer.from(raw)]);Object.assign(req,{url:'/api/command-center?action=queue&op=ack&nonce='+owner,method:'POST',headers:{origin:E.previewOrigin,'sec-fetch-site':'same-origin','content-type':'application/json','content-length':String(Buffer.byteLength(raw))}});
 if(parsed)Object.defineProperty(req,'body',{get(){return JSON.parse(raw);}});
 const res={headers:{},setHeader(k,v){this.headers[k]=v;},end(v){this.value=JSON.parse(v);}};
 let authorityReads=0;
 await handleQueue({req,res,env,fetchImpl:()=>{throw Error('No provider call allowed');},clock:Date.now,commandSession:{config:{},async resolve(){authorityReads++;throw Error('Synthetic stop before authority/provider');}}});
 return {status:res.statusCode,authorityReads};
}
test('documented parsed-body helper conflicts with the unchanged strict raw parser',async()=>{
 assert.deepEqual(await attempt({parsed:true}),{status:400,authorityReads:0});
});
test('native Node request stream passes raw parsing with helpers disabled',async()=>{
 assert.deepEqual(await attempt(),{status:503,authorityReads:1});
});
test('duplicate raw JSON remains rejected before owner authority or provider access',async()=>{
 const raw=JSON.stringify(command).replace('{','{"requestId":"'+other+'",');
 assert.deepEqual(await attempt({raw}),{status:400,authorityReads:0});
});

