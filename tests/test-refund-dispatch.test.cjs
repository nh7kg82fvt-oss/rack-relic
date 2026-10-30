const {test,before,after,beforeEach}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
const {createHmac}=require('node:crypto');
const {Readable}=require('node:stream');
const {createTestOrderRepository}=require('../server/test_order_repository.cjs');
const {createStripeTestRefundClient}=require('../server/stripe_test_refunds.cjs');
const {createTestRefundService,RefundPending}=require('../server/test_refund_service.cjs');
const {createTestRefundHandler}=require('../server/test_refund_handler.cjs');
const order='11111111-1111-4111-8111-111111111111',buyer='22222222-2222-4222-8222-222222222222',seller='33333333-3333-4333-8333-333333333333',listing='44444444-4444-4444-8444-444444444444',rid='55555555-5555-4555-8555-555555555555',rid2='66666666-6666-4666-8666-666666666666';
const project='https://zvtaqzcqfdjpuwnlpzln.supabase.co',account='acct_1UWJZuGVbz9Pnhxd';
const input={authorization:'Bearer operator',requestId:rid,orderId:order,amountCents:1000};
const snap={test:true,orderId:order,listingId:listing,sellerId:seller,currency:'USD',itemCents:2500,buyerFeeCents:100,shippingCents:500,taxCents:327,totalCents:3427};
let db;
const defs={rr_test_prepare_refund:['p_request','p_order','p_actor','p_amount'],rr_test_get_refund_request:['p_request','p_actor'],rr_test_dispatch_refund:['p_request','p_actor'],rr_test_save_refund:['p_request','p_actor','p_refund','p_charge'],rr_test_process_refund_receipt:['p_event','p_payload_hash','p_type','p_refund','p_payment_intent','p_charge','p_amount','p_currency','p_status','p_created','p_request']};
const rpc=async(name,p)=>(await db.query('select public.'+name+'('+defs[name].map((_,i)=>'$'+(i+1)).join(',')+') as result',defs[name].map(k=>p[k]))).rows[0].result;
before(async()=>{db=new PGlite();await db.exec('create role anon;create role authenticated;create role service_role;');for(const f of ['order_ledger','payment_recovery','checkout_attempts','refund_receipts','refund_requests'])await db.exec(fs.readFileSync(require.resolve('../supabase/test/20261030_'+f+'.sql'),'utf8'));});
after(async()=>db?.close());
beforeEach(async()=>{
 await db.exec('truncate rr_sandbox.catalog cascade');
 await db.query("insert into rr_sandbox.catalog(id,seller_id,title,price_cents) values($1,$2,'Synthetic jacket',2500)",[listing,seller]);
 await db.query('select public.rr_test_reserve($1,$2,$3)',[order,listing,buyer]);
 await db.query('select public.rr_test_attach_checkout($1,$2,$3,$4,$5,$6,$7)',[order,'cs_test_refund',JSON.stringify(snap),'taxcalc_fixture','a'.repeat(64),'b'.repeat(32),new Date(Date.now()+3600000).toISOString()]);
 await db.query('select public.rr_test_process_payment_event($1,$2,$3,$4,$5,$6,$7,$8,$9)',['evt_paid','a'.repeat(64),'checkout.session.completed',order,'cs_test_refund',3427,'usd',true,'pi_fixture']);
});
const refundObject=(patch={})=>({object:'refund',id:'re_fixture',amount:1000,currency:'usd',payment_intent:'pi_fixture',charge:'ch_fixture',status:'succeeded',metadata:{integration:'rack_relic_test_refund',request_id:rid,order_id:order},...patch});
function signed(refund=refundObject(),patch={}){
 const event={id:'evt_refund',type:'refund.created',livemode:false,created:Math.floor(Date.now()/1000)-10,data:{object:refund},...patch},rawBody=Buffer.from(JSON.stringify(event)),t=Math.floor(Date.now()/1000);
 return {rawBody,signature:'t='+t+',v1='+createHmac('sha256','whsec_fixture').update(t+'.').update(rawBody).digest('hex'),webhookSecret:'whsec_fixture'};
}
function setup({dbFailure,onPost,refundPatch,identityPatch,paymentPatch,chargePatch,headers,repositoryOptions={}}={}){
 const calls=[];
 const repository=createTestOrderRepository({projectUrl:project,serviceKey:'sb_secret_fixture',allowedMemberIds:[buyer,seller],allowedRefundOperatorIds:[seller],refundsEnabled:true,refundRequestsEnabled:true,...repositoryOptions,fetchImpl:async(url,opts)=>{
  calls.push({url,method:opts.method});
  if(url.endsWith('/auth/v1/user'))return Response.json({id:opts.headers.Authorization==='Bearer operator'?seller:opts.headers.Authorization==='Bearer buyer'?buyer:'77777777-7777-4777-8777-777777777777'});
  const name=url.split('/').pop();if(dbFailure?.(name))return Response.json({error:'private SQL'},{status:503});
  try{return Response.json(await rpc(name,JSON.parse(opts.body)));}catch{return Response.json({error:'private SQL'},{status:400});}
 }});
 const stripe=createStripeTestRefundClient({secretKey:'sk_test_fixture',accountId:account,fetchImpl:async(url,opts)=>{
  calls.push({url,method:opts.method,body:opts.body,headers:opts.headers});
  assert.equal(opts.redirect,'error');assert.equal(opts.cache,'no-store');assert.ok(opts.signal);
  if(url.endsWith('/v1/account'))return Response.json({id:account,...identityPatch});
  if(url.endsWith('/v1/balance'))return Response.json({livemode:false});
  if(url.endsWith('/v1/payment_intents/pi_fixture'))return Response.json({id:'pi_fixture',livemode:false,status:'succeeded',currency:'usd',amount:3427,amount_received:3427,metadata:{order_id:order},transfer_group:'rr_test_'+order,latest_charge:'ch_fixture',...paymentPatch});
  if(url.endsWith('/v1/charges/ch_fixture'))return Response.json({object:'charge',id:'ch_fixture',payment_intent:'pi_fixture',livemode:false,status:'succeeded',paid:true,captured:true,disputed:false,refunded:false,currency:'usd',amount:3427,amount_captured:3427,amount_refunded:0,...chargePatch});
  if(url.endsWith('/v1/refunds')){await onPost?.(repository);return Response.json(refundObject(refundPatch),{headers});}
  if(url.endsWith('/v1/refunds/re_fixture'))return Response.json(refundObject(refundPatch),{headers});
  throw Error('Unexpected request');
 }});
 return {calls,repository,stripe,service:createTestRefundService({repository,stripe})};
}
const posts=calls=>calls.filter(c=>c.url==='https://api.stripe.com/v1/refunds'&&c.method==='POST');
const requestRow=async()=>(await db.query('select * from rr_sandbox.refund_requests where id=$1',[rid])).rows[0];
const orderRow=async()=>(await db.query('select * from rr_sandbox.orders where id=$1',[order])).rows[0];
const ledger=async()=>(await db.query('select count(*)::int as count,sum(amount_cents)::int as balance from rr_sandbox.ledger_entries')).rows[0];

test('authenticated request is frozen before one POST and never books money from the HTTP response',async()=>{
 const x=setup({onPost:async()=>assert.equal((await requestRow()).phase,'dispatched')});
 const r=await x.service.start(input);assert.equal(r.state,'request_recorded');assert.equal(r.requestId,rid);assert.equal(r.refundId,undefined);assert.equal((await requestRow()).phase,'known');
 assert.equal((await orderRow()).refunded_cents,0);assert.deepEqual(await ledger(),{count:5,balance:0});
 const post=posts(x.calls)[0],form=new URLSearchParams(post.body);assert.equal(form.get('amount'),'1000');assert.equal(form.get('payment_intent'),'pi_fixture');assert.equal(form.get('reason'),'requested_by_customer');assert.equal(form.get('metadata[request_id]'),rid);assert.equal(form.has('reverse_transfer'),false);assert.equal(form.has('refund_application_fee'),false);assert.equal(post.headers['Idempotency-Key'],'rr_test_refund_'+rid);
 assert.equal((await db.query("select state from rr_sandbox.jobs where kind='prepare_test_label'")).rows[0].state,'held');
});
test('simultaneous retries issue one refund POST and known-ID retries use GET only',async()=>{
 const x=setup();const results=await Promise.allSettled([x.service.start(input),x.service.start(input)]);assert.ok(results.some(r=>r.status==='fulfilled'));assert.equal(posts(x.calls).length,1);
 const before=x.calls.length;await x.service.start(input);await x.service.status({authorization:input.authorization,requestId:rid});assert.equal(posts(x.calls).length,1);assert.ok(x.calls.slice(before).filter(c=>c.url.startsWith('https://api.stripe.com')).every(c=>c.method==='GET'));
});
test('lost POST response remains held beyond provider idempotency retention and cannot create another request',async()=>{
 const x=setup({onPost:async()=>{throw Error('provider received POST; response lost');}});
 await assert.rejects(x.service.start(input));await db.exec("update rr_sandbox.refund_requests set dispatched_at=now()-interval '3 days'");
 await assert.rejects(x.service.start(input),RefundPending);await assert.rejects(x.service.start({...input,requestId:rid2}));assert.equal(posts(x.calls).length,1);assert.equal((await requestRow()).refund_id,null);
});
test('a signed receipt recovers the lost refund ID and accounts once without another POST',async()=>{
 const x=setup({onPost:async()=>{throw Error('lost response');}});await assert.rejects(x.service.start(input));
 await x.repository.acceptStripeEvent(signed());assert.equal((await requestRow()).phase,'known');assert.equal((await requestRow()).refund_id,'re_fixture');
 await x.service.start(input);await x.repository.acceptStripeEvent(signed());assert.equal(posts(x.calls).length,1);assert.equal((await orderRow()).refunded_cents,1000);assert.deepEqual(await ledger(),{count:7,balance:0});
});
test('webhook arriving before the POST response saves the same identity and does not duplicate accounting',async()=>{
 const x=setup({onPost:repo=>repo.acceptStripeEvent(signed())});await x.service.start(input);assert.equal((await requestRow()).refund_id,'re_fixture');assert.deepEqual(await ledger(),{count:7,balance:0});assert.equal(posts(x.calls).length,1);
});
test('failed database save cannot cause another POST and a later signed event restores recovery',async()=>{
 let fail=true;const x=setup({dbFailure:name=>name==='rr_test_save_refund'&&fail});await assert.rejects(x.service.start(input));assert.equal((await requestRow()).phase,'dispatched');
 fail=false;await assert.rejects(x.service.start(input),RefundPending);await x.repository.acceptStripeEvent(signed());await x.service.start(input);assert.equal(posts(x.calls).length,1);
});
test('pending and failed signed outcomes confirm the request without treating a provider response as paid back',async()=>{
 const x=setup({refundPatch:{status:'pending'}});await x.service.start(input);await x.repository.acceptStripeEvent(signed(refundObject({status:'pending'})));assert.equal((await orderRow()).refunded_cents,0);assert.equal((await orderRow()).refund_pending_cents,1000);
 await x.repository.acceptStripeEvent(signed(refundObject({status:'failed'}),{id:'evt_failed',type:'refund.failed',created:Math.floor(Date.now()/1000)}));assert.equal((await orderRow()).refunded_cents,0);assert.equal((await orderRow()).refund_pending_cents,0);assert.deepEqual(await ledger(),{count:5,balance:0});
});
test('request amount, order and operator are immutable across retries',async()=>{
 const x=setup();await x.service.start(input);
 await assert.rejects(x.service.start({...input,amountCents:1001}));await assert.rejects(x.service.start({...input,orderId:rid2}));await assert.rejects(x.service.start({...input,authorization:'Bearer buyer'}));assert.equal(posts(x.calls).length,1);
});
test('unconfigured operators, ordinary members and invalid amounts never reach financial RPCs or Stripe',async()=>{
 for(const repositoryOptions of [{allowedRefundOperatorIds:[]},{allowedRefundOperatorIds:['77777777-7777-4777-8777-777777777777']},{refundRequestsEnabled:false},{refundsEnabled:false}]){const x=setup({repositoryOptions});await assert.rejects(x.service.start(input));assert.equal(x.calls.length,0);}
 for(const patch of [{authorization:'Bearer buyer'},{authorization:'Bearer outsider'},{authorization:''},{amountCents:0},{amountCents:1.5}]){const x=setup();await assert.rejects(x.service.start({...input,...patch}));assert.equal(x.calls.filter(c=>!c.url.endsWith('/auth/v1/user')).length,0);}
});
test('wrong sandbox, mismatched totals, unpaid or transferred payments stop before a refund POST',async()=>{
 for(const config of [{identityPatch:{id:'acct_other'}},...([{livemode:true},{amount_received:1},{status:'processing'},{currency:'eur'},{metadata:{order_id:rid2}},{transfer_group:'wrong'},{transfer_data:{destination:'acct_seller'}},{application_fee_amount:1}].map(paymentPatch=>({paymentPatch})))]){
  await db.exec('truncate rr_sandbox.refund_requests');const x=setup(config);await assert.rejects(x.service.start(input));assert.equal(posts(x.calls).length,0);assert.equal((await requestRow()).phase,'dispatched');
 }
});
test('mismatched refund responses or cached evidence remain uncertain and cannot trigger another POST',async()=>{
 for(const config of [{refundPatch:{amount:999}},{refundPatch:{payment_intent:'pi_wrong'}},{refundPatch:{charge:'ch_wrong'}},{refundPatch:{metadata:{}}},{refundPatch:{transfer_reversal:'trr_wrong'}},{headers:{age:'10'}}]){
  await db.exec('truncate rr_sandbox.refund_requests');const x=setup(config);await assert.rejects(x.service.start(input));await assert.rejects(x.service.start(input),RefundPending);assert.equal(posts(x.calls).length,1);assert.equal((await requestRow()).phase,'dispatched');
 }
});
test('disputed, uncaptured, fully refunded or mismatched charges stop before a refund POST',async()=>{
 for(const chargePatch of [{disputed:true},{captured:false},{refunded:true},{amount_refunded:3000},{amount_refunded:-1},{payment_intent:'pi_wrong'},{livemode:true},{source_transfer:'tr_wrong'},{amount_captured:1}]){
  await db.exec('truncate rr_sandbox.refund_requests');const x=setup({chargePatch});await assert.rejects(x.service.start(input));assert.equal(posts(x.calls).length,0);
 }
});
test('signed metadata cannot link a prepared request or mismatched amount and all changes roll back',async()=>{
 const x=setup();await x.repository.prepareRefund(input);await assert.rejects(x.repository.acceptStripeEvent(signed()));assert.deepEqual(await ledger(),{count:5,balance:0});
 await x.repository.dispatchRefund(input);await assert.rejects(x.repository.acceptStripeEvent(signed(refundObject({amount:999}))));await assert.rejects(x.repository.acceptStripeEvent(signed(refundObject({metadata:{integration:'rack_relic_test_refund',request_id:rid2,order_id:order}}))));assert.equal((await requestRow()).phase,'dispatched');assert.deepEqual(await ledger(),{count:5,balance:0});
});
test('confirmed partial refund is counted once and remaining request amount is bounded',async()=>{
 const x=setup();await x.service.start(input);await x.repository.acceptStripeEvent(signed());
 await assert.rejects(x.repository.prepareRefund({...input,requestId:rid2,amountCents:2428}));const q=await x.repository.prepareRefund({...input,requestId:rid2,amountCents:2427});assert.equal(q.amount_cents,2427);
 assert.equal((await db.query('select rr_sandbox.refund_committed_cents($1) as total',[order])).rows[0].total,3427);
});
test('an external refund between preparation and dispatch blocks an over-refund POST',async()=>{
 const x=setup();await x.repository.prepareRefund({...input,amountCents:2000});await x.repository.acceptStripeEvent(signed(refundObject({id:'re_external',amount:2000,metadata:{}})));
 await assert.rejects(x.repository.dispatchRefund(input));assert.equal(posts(x.calls).length,0);assert.equal((await requestRow()).phase,'prepared');
});
test('browser roles cannot call new RPCs or read request rows',async()=>{
 const x=setup();await x.repository.prepareRefund(input);
 const grants=(await db.query("select grantee from information_schema.routine_privileges where routine_name in ('rr_test_prepare_refund','rr_test_dispatch_refund','rr_test_save_refund','rr_test_get_refund_request','rr_test_process_refund_receipt','refund_committed_cents')")).rows;assert.ok(!grants.some(g=>['PUBLIC','anon','authenticated'].includes(g.grantee)));
 assert.equal((await db.query("select relrowsecurity from pg_class where oid='rr_sandbox.refund_requests'::regclass")).rows[0].relrowsecurity,true);
 await db.exec('set role authenticated');try{await assert.rejects(db.query('select * from rr_sandbox.refund_requests'),/permission denied/);await assert.rejects(db.query('select public.rr_test_get_refund_request($1,$2)',[rid,seller]),/permission denied/);}finally{await db.exec('reset role');}
 await assert.rejects(db.query('select public.rr_test_get_refund_request($1,$2)',[rid,buyer]),/access denied/);
});
const response=()=>({headers:{},setHeader(k,v){this.headers[k]=v;},end(body){this.body=JSON.parse(body);}});
const request=(body=input,method='POST')=>{const req=Readable.from([Buffer.from(JSON.stringify(body))]);req.method=method;req.url='/api/test-marketplace?action=refund';req.headers={'content-type':'application/json',authorization:'Bearer operator'};return req;};
test('private HTTP adapter rejects caller financial identity and keeps responses free of provider IDs',async()=>{
 const x=setup(),h=createTestRefundHandler({refunds:x.service,enabled:true});const body={requestId:rid,orderId:order,amountCents:1000};
 for(const patch of [{paymentIntent:'pi_wrong'},{actor:seller},{reason:'fraudulent'},{refundId:'re_wrong'}]){const r=response();await h(request({...body,...patch}),r);assert.equal(r.statusCode,400);}
 const r=response();await h(request(body),r);assert.equal(r.statusCode,200);assert.equal(r.body.state,'request_recorded');assert.equal(JSON.stringify(r.body).includes('pi_fixture'),false);assert.equal(JSON.stringify(r.body).includes('re_fixture'),false);assert.match(r.headers['Cache-Control'],/no-store/);
 const get=request({},'GET');get.url+='&requestId='+rid;const rr=response();await h(get,rr);assert.equal(rr.statusCode,200);assert.equal(posts(x.calls).length,1);
});
test('private HTTP adapter is disabled by default and reports unknown outcomes without leaking errors',async()=>{
 const x=setup({onPost:()=>{throw Error('private provider credentials');}}),body={requestId:rid,orderId:order,amountCents:1000};const r=response();await createTestRefundHandler({refunds:x.service})(request(body),r);assert.equal(r.statusCode,404);assert.equal(x.calls.length,0);
 const h=createTestRefundHandler({refunds:x.service,enabled:true}),a=response(),b=response();await h(request(body),a);await h(request(body),b);assert.equal(a.statusCode,503);assert.equal(b.statusCode,409);assert.equal(JSON.stringify(a.body).includes('credentials'),false);assert.equal(posts(x.calls).length,1);
});
test('provider client rejects live keys and recovery without a saved identity',async()=>{
 assert.throws(()=>createStripeTestRefundClient({secretKey:'sk_live_fixture',accountId:account}));assert.throws(()=>createStripeTestRefundClient({secretKey:'sk_test_fixture',accountId:'acct_wrong'}));
 const x=setup();const q=await x.repository.prepareRefund(input);await assert.rejects(x.stripe.retrieveRefund(q));await assert.rejects(x.stripe.createRefund(q));assert.equal(posts(x.calls).length,0);
});
test('removing refund metadata cannot evade checks against an already saved request',async()=>{
 const x=setup();await x.service.start(input);
 await assert.rejects(x.repository.acceptStripeEvent(signed(refundObject({metadata:{},amount:999}))));assert.deepEqual(await ledger(),{count:5,balance:0});
 await x.repository.acceptStripeEvent(signed(refundObject({metadata:{}})));assert.deepEqual(await ledger(),{count:7,balance:0});assert.equal((await requestRow()).refund_id,'re_fixture');
});
test('generated staging Edge receiver recovers an uncertain request from the signed refund notification',async()=>{
 const x=setup({onPost:()=>{throw Error('lost response');}});await assert.rejects(x.service.start(input));
 const {createTestEdgeWebhook}=await import('../supabase/functions/stripe-test-events/index.mjs');
 const h=createTestEdgeWebhook({projectUrl:project,serviceKey:'sb_secret_fixture',webhookSecret:'whsec_fixture',refundsEnabled:true,refundRequestsEnabled:true,fetchImpl:async(url,opts)=>{
  assert.equal(url,project+'/rest/v1/rpc/rr_test_process_refund_receipt');const p=JSON.parse(opts.body);assert.equal(p.p_request,rid);return Response.json(await rpc('rr_test_process_refund_receipt',p));
 }});
 const s=signed(),request=new Request('https://example.test',{method:'POST',body:s.rawBody,headers:{'stripe-signature':s.signature}});assert.equal((await h(request)).status,200);assert.equal((await requestRow()).phase,'known');assert.deepEqual(await ledger(),{count:7,balance:0});assert.equal(posts(x.calls).length,1);
});
