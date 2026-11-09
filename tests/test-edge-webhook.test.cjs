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
 for(const transport of [async()=>new Response('private SQL',{status:400}),async()=>{throw Error('private key');},async()=>Response.json({duplicate:false,state:'paid'},{headers:{age:'1'}})]){const h=await handler({fetchImpl:transport}),r=await h(request());assert.equal(r.status,503);assert.equal((await r.text()).includes('private'),false);}
});
