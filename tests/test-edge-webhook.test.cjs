const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {createHmac}=require('node:crypto');
const path=require('node:path');
const {build}=require('../scripts/build-test-webhook.cjs');
const config={projectUrl:'https://zvtaqzcqfdjpuwnlpzln.supabase.co',serviceKey:'sb_secret_fixture',webhookSecret:'whsec_fixture'};
const oid='11111111-1111-4111-8111-111111111111';
async function handler(overrides={}){return (await import('../supabase/functions/stripe-test-events/index.mjs')).createTestEdgeWebhook({...config,...overrides});}
function request(change=()=>{},signed=true){const e={id:'evt_edge',livemode:false,type:'checkout.session.completed',data:{object:{id:'cs_test_edge',livemode:false,mode:'payment',status:'complete',payment_status:'paid',currency:'usd',amount_total:3410,client_reference_id:oid,metadata:{integration:'rack_relic_test',order_id:oid}}}};change(e);const raw=JSON.stringify(e),t=Math.floor(Date.now()/1000);return new Request('https://example.test',{method:'POST',body:raw,headers:{'stripe-signature':signed?'t='+t+',v1='+createHmac('sha256','whsec_fixture').update(t+'.'+raw).digest('hex'):'bad'}});}
test('deployed receiver is generated from the same reviewed verifier used by the Node handler',()=>{assert.equal(fs.readFileSync(path.join(__dirname,'../supabase/functions/stripe-test-events/index.mjs'),'utf8'),build());});
test('valid signed test payment reaches only the staging atomic RPC and returns no financial data',async()=>{
 let calls=0;const h=await handler({fetchImpl:async(url,opts)=>{calls++;assert.equal(url,config.projectUrl+'/rest/v1/rpc/rr_test_process_event');assert.equal(opts.redirect,'error');const p=JSON.parse(opts.body);assert.equal(p.p_order,oid);assert.equal(p.p_paid,true);return Response.json({duplicate:false,state:'paid'});}});
 const r=await h(request());assert.equal(r.status,200);assert.deepEqual(await r.json(),{received:true});assert.match(r.headers.get('cache-control'),/no-store/);assert.equal(calls,1);
});
test('forged, live, other-account and contradictory notifications never reach database',async()=>{
 let calls=0;const h=await handler({fetchImpl:async()=>{calls++;return Response.json({});}});
 for(const change of [e=>e.livemode=true,e=>e.account='acct_other',e=>e.data.object.status='open',e=>e.data.object.amount_total=-1])assert.equal((await h(request(change))).status,400);
 assert.equal((await h(request(()=>{},false))).status,400);assert.equal(calls,0);
});
test('wrong database or missing secrets fail closed before processing requests',async()=>{
 for(const overrides of [{projectUrl:'https://zrfztnbyynrdzfeblkeq.supabase.co'},{projectUrl:config.projectUrl+'/'},{serviceKey:'anon'},{webhookSecret:''}]){const h=await handler({...overrides,fetchImpl:()=>{throw Error('must not call');}});assert.equal((await h(request())).status,503);}
});
test('oversized bodies and wrong HTTP methods are rejected',async()=>{const h=await handler();assert.equal((await h(new Request('https://example.test'))).status,405);assert.equal((await h(new Request('https://example.test',{method:'POST',headers:{'stripe-signature':'t=1,v1=x'},body:'x'.repeat(1048577)}))).status,413);});
test('database failure requests provider retry without leaking private errors',async()=>{
 for(const transport of [async()=>new Response('private SQL',{status:400}),async()=>{throw Error('private key');},async()=>Response.json({duplicate:false,state:'paid'},{headers:{age:'1'}}),async()=>Response.json({duplicate:false,state:'paid'},{headers:{'cf-cache-status':'HIT'}}),async()=>Response.json({duplicate:false,state:'paid'},{headers:{'x-vercel-cache':'STALE'}})]){const h=await handler({fetchImpl:transport}),r=await h(request());assert.equal(r.status,503);assert.equal((await r.text()).includes('private'),false);}
});

const acceptance=require('../server/test_environment_registry.cjs').TEST_ENVIRONMENTS.acceptance;
const acceptanceEvent=e=>{e.account=acceptance.accountId;e.data.object.metadata={...e.data.object.metadata,integration:'rack_relic_test_acceptance_v1',rr_test_environment:acceptance.id};};
test('acceptance receiver routes a signed event only to its fixed project and rejects legacy or mixed tuples',async()=>{
 let calls=0;const fetchImpl=async(url)=>{calls++;assert.equal(url,acceptance.projectUrl+'/rest/v1/rpc/rr_test_process_event');return Response.json({duplicate:false,state:'paid'});};
 const h=await handler({projectUrl:acceptance.projectUrl,accountId:acceptance.accountId,fetchImpl});assert.equal((await h(request(acceptanceEvent))).status,200);assert.equal(calls,1);
 assert.equal((await h(request())).status,400);const legacy=await handler({fetchImpl:()=>assert.fail('cross-environment database access')});assert.equal((await legacy(request(acceptanceEvent))).status,400);
 for(const overrides of [{projectUrl:config.projectUrl,accountId:acceptance.accountId},{projectUrl:acceptance.projectUrl,accountId:'acct_1UWJZuGVbz9Pnhxd'},{projectUrl:acceptance.projectUrl},{projectUrl:acceptance.projectUrl,accountId:'acct_foreign'}]){const bad=await handler({...overrides,fetchImpl:()=>assert.fail('mixed tuple')});assert.equal((await bad(request(acceptanceEvent))).status,503);}
});
test('acceptance receiver requires a matching service-role JWT ref and never selects from event data',async()=>{
 const key=ref=>'e30.'+Buffer.from(JSON.stringify({role:'service_role',ref})).toString('base64url')+'.signature';
 const bad=await handler({projectUrl:acceptance.projectUrl,accountId:acceptance.accountId,serviceKey:key('zvtaqzcqfdjpuwnlpzln'),fetchImpl:()=>assert.fail('foreign credentials')});assert.equal((await bad(request(acceptanceEvent))).status,503);
 let calls=0;const good=await handler({projectUrl:acceptance.projectUrl,accountId:acceptance.accountId,serviceKey:key(acceptance.projectRef),fetchImpl:async()=>{calls++;return Response.json({duplicate:false,state:'paid'});}});assert.equal((await good(request(acceptanceEvent))).status,200);
 assert.equal((await good(request(e=>{acceptanceEvent(e);e.data.object.metadata.rr_test_environment='legacy';}))).status,400);assert.equal(calls,1);
});
