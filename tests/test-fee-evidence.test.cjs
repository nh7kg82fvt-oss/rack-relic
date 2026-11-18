const {test,before,after,beforeEach}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
const {Readable}=require('node:stream');
const {createStripeTestFeeClient}=require('../server/stripe_test_fees.cjs');
const {createTestOrderRepository}=require('../server/test_order_repository.cjs');
const {createTestFeeService}=require('../server/test_fee_service.cjs');
const {createTestFeeHandler}=require('../server/test_fee_handler.cjs');
const order='11111111-1111-4111-8111-111111111111',buyer='22222222-2222-4222-8222-222222222222',seller='33333333-3333-4333-8333-333333333333',listing='44444444-4444-4444-8444-444444444444';
const input={authorization:'Bearer operator',orderId:order},account='acct_1UWJZuGVbz9Pnhxd';
let db;
before(async()=>{db=new PGlite();await db.exec('create role anon;create role authenticated;create role service_role;');for(const name of ['20261030_order_ledger','20261030_payment_recovery','20261030_checkout_attempts','20261030_refund_receipts','20261030_refund_requests','20261030_checkout_quote_limits','20261030_checkout_quote_refresh','20261031_cancel_preparation','20261031_refund_review','20261031_charge_fee_evidence'])await db.exec(fs.readFileSync(require.resolve('../supabase/test/'+name+'.sql'),'utf8'));});
after(async()=>db?.close());
beforeEach(async()=>{
 await db.exec('truncate rr_sandbox.catalog cascade');
 await db.query("insert into rr_sandbox.catalog(id,seller_id,title,price_cents) values($1,$2,'Test jacket',2500)",[listing,seller]);
 await db.query('select public.rr_test_reserve($1,$2,$3)',[order,listing,buyer]);
 const snapshot={test:true,orderId:order,listingId:listing,sellerId:seller,currency:'USD',itemCents:2500,buyerFeeCents:100,shippingCents:500,taxCents:327,totalCents:3427};
 await db.query('select public.rr_test_attach_checkout($1,$2,$3,$4,$5,$6,$7)',[order,'cs_test_fee',JSON.stringify(snapshot),'taxcalc_fixture','a'.repeat(64),'b'.repeat(32),new Date(Date.now()+3600000).toISOString()]);
 await db.query('select public.rr_test_process_payment_event($1,$2,$3,$4,$5,$6,$7,$8,$9)',['evt_paid','a'.repeat(64),'checkout.session.completed',order,'cs_test_fee',3427,'usd',true,'pi_fixture']);
});
function setup({payment={},charge={},balanceTransaction={},identity={},headers,unavailable,repositoryOptions={}}={}){
 const calls=[];
 const repository=createTestOrderRepository({projectUrl:'https://zvtaqzcqfdjpuwnlpzln.supabase.co',serviceKey:'sb_secret_fixture',allowedMemberIds:[buyer,seller],allowedRefundOperatorIds:[seller],refundsEnabled:true,refundRequestsEnabled:true,...repositoryOptions,fetchImpl:async(url,options)=>{
  calls.push({url,options});if(url.endsWith('/auth/v1/user'))return Response.json({id:options.headers.Authorization==='Bearer operator'?seller:buyer});
  const name=url.split('/').pop(),p=JSON.parse(options.body),args=name==='rr_test_fee_order'?[p.p_order,p.p_actor]:[p.p_order,p.p_actor,p.p_evidence];
  try{return Response.json((await db.query('select public.'+name+'('+args.map((_,i)=>'$'+(i+1)).join(',')+') as result',args)).rows[0].result);}catch{return Response.json({error:'private SQL'},{status:400});}
 }});
 const stripe=createStripeTestFeeClient({secretKey:'rk_test_fixture',accountId:account,fetchImpl:async(url,options)=>{
  calls.push({url,options});assert.equal(options.method,'GET');assert.equal(options.cache,'no-store');assert.equal(options.redirect,'error');assert.ok(options.signal);
  if(unavailable===url.split('/').pop())throw Error('private provider data');
  let body;
  if(url.endsWith('/account'))body={id:account,...identity};
  if(url.endsWith('/balance'))body={livemode:false};
  if(url.endsWith('/payment_intents/pi_fixture'))body={id:'pi_fixture',livemode:false,status:'succeeded',currency:'usd',amount:3427,amount_received:3427,metadata:{order_id:order},transfer_group:'rr_test_'+order,latest_charge:'ch_fixture',...payment};
  if(url.endsWith('/charges/ch_fixture'))body={object:'charge',id:'ch_fixture',payment_intent:'pi_fixture',livemode:false,status:'succeeded',paid:true,captured:true,currency:'usd',amount:3427,amount_captured:3427,balance_transaction:'txn_fixture',refunded:false,amount_refunded:0,...charge};
  if(url.endsWith('/balance_transactions/txn_fixture'))body={object:'balance_transaction',id:'txn_fixture',source:'ch_fixture',amount:3427,currency:'usd',fee:129,net:3298,type:'charge',reporting_category:'charge',status:'available',exchange_rate:null,fee_details:[{amount:129,currency:'usd',type:'stripe_fee',application:null,description:'private fee detail'}],...balanceTransaction};
  if(!body)throw Error('Unexpected request '+url);return Response.json(body,{headers});
 }});
 return {calls,repository,stripe,service:createTestFeeService({repository,stripe})};
}
const providerCalls=x=>x.calls.filter(c=>c.url.startsWith('https://api.stripe.com'));
const databaseState=async()=>(await db.query("select (select jsonb_agg(o) from rr_sandbox.orders o) as orders,(select jsonb_agg(l order by kind) from rr_sandbox.ledger_entries l) as ledger,(select jsonb_agg(j order by kind) from rr_sandbox.jobs j) as jobs")).rows[0];
test('records exact original charge fee with GET-only provider reads and no ledger or job release',async()=>{
 const x=setup(),before=await databaseState();assert.equal((await x.service.status(input)).state,'not_recorded');assert.equal(providerCalls(x).length,0);
 const result=await x.service.reconcile(input);assert.deepEqual(result,{test:true,orderId:order,state:'recorded',grossCents:3427,feeCents:129,netCents:3298,payoutAvailable:false});
 assert.equal(providerCalls(x).length,5);assert.deepEqual(await databaseState(),before);assert.equal((await db.query('select count(*)::int as n from rr_sandbox.charge_fee_evidence')).rows[0].n,1);
 const count=providerCalls(x).length;assert.deepEqual(await x.service.status(input),result);assert.equal(providerCalls(x).length,count);
 for(const secret of ['pi_fixture','ch_fixture','txn_fixture','private fee detail',seller])assert.equal(JSON.stringify(result).includes(secret),false);
});
test('repeat and concurrent reconciliation keep one immutable evidence record',async()=>{
 const x=setup();await Promise.all([x.service.reconcile(input),x.service.reconcile(input)]);await x.service.reconcile(input);
 assert.equal((await db.query('select count(*)::int as n from rr_sandbox.charge_fee_evidence')).rows[0].n,1);assert.ok(providerCalls(x).every(c=>c.options.method==='GET'));
 const changed=setup({balanceTransaction:{fee:130,net:3297,fee_details:[{type:'stripe_fee',amount:130,currency:'usd'}]}});await assert.rejects(changed.service.reconcile(input));assert.equal((await x.service.status(input)).feeCents,129);
});
test('a refunded charge can record its original fee without treating refunds as seller payout funds',async()=>{
 const x=setup({charge:{refunded:true,amount_refunded:3427}}),before=await databaseState();const r=await x.service.reconcile(input);assert.equal(r.feeCents,129);assert.equal(r.payoutAvailable,false);assert.deepEqual(await databaseState(),before);
});
test('ordinary members and disabled operators cannot reach financial RPCs or providers',async()=>{
 const x=setup();await assert.rejects(x.service.reconcile({...input,authorization:'Bearer buyer'}));assert.equal(x.calls.length,1);assert.equal(providerCalls(x).length,0);
 for(const repositoryOptions of [{refundsEnabled:false},{refundRequestsEnabled:false},{allowedRefundOperatorIds:[]}]){const x=setup({repositoryOptions});await assert.rejects(x.service.reconcile(input));assert.equal(x.calls.length,0);}
 await assert.rejects(x.service.reconcile({...input,orderId:'pi_wrong'}));assert.equal(providerCalls(x).length,0);
});
test('wrong account, unpaid, transferred or mismatched payment evidence never records a fee',async()=>{
 for(const patch of [{identity:{id:'acct_wrong'}},...([{livemode:true},{status:'processing'},{amount_received:1},{metadata:{order_id:listing}},{transfer_group:'wrong'},{transfer_data:{destination:'acct_other'}},{application_fee_amount:1}].map(payment=>({payment}))),...([{captured:false},{payment_intent:'pi_wrong'},{balance_transaction:null},{amount_captured:1},{currency:'eur'},{transfer:'tr_fixture'}].map(charge=>({charge})))]){const x=setup(patch);await assert.rejects(x.service.reconcile(input));}
 assert.equal((await db.query('select count(*)::int as n from rr_sandbox.charge_fee_evidence')).rows[0].n,0);
});
test('balance evidence rejects pending creation, currency conversion, inconsistent totals and fee components',async()=>{
 for(const balanceTransaction of [{source:'ch_other'},{id:'txn_other'},{currency:'eur'},{amount:3400},{fee:-1},{net:3427},{exchange_rate:1},{status:'unknown'},{type:'refund'},{reporting_category:'fee'},{fee_details:[]},{fee_details:[{type:'application_fee',amount:129,currency:'usd'}]},{fee_details:[{type:'stripe_fee',amount:129,currency:'usd',application:'ca_other'}]}]){const x=setup({balanceTransaction});await assert.rejects(x.service.reconcile(input));}
 const pending=setup({balanceTransaction:{status:'pending'}});assert.equal((await pending.service.reconcile(input)).feeCents,129);
});
test('cached and missing provider evidence remain unavailable without estimating fees or exposing errors',async()=>{
 for(const config of [{headers:{age:'1'}},{headers:{'cf-cache-status':'HIT'}},{unavailable:'txn_fixture'}]){const x=setup(config);await assert.rejects(x.service.reconcile(input),e=>!e.message.includes('private'));}
 assert.equal((await db.query('select count(*)::int as n from rr_sandbox.charge_fee_evidence')).rows[0].n,0);
});
test('SQL rejects stale, malformed and foreign evidence while preserving existing money state',async()=>{
 const x=setup(),orderData=await x.repository.feeOrder(input),e=await x.stripe.read(orderData),before=await databaseState();
 for(const patch of [{test:false},{orderId:listing},{paymentIntentId:'pi_other'},{grossCents:3428},{feeCents:1.5},{netCents:3299},{currency:'EUR'},{checkedAt:Date.now()-360000},{checkedAt:Date.now()+60000},{extra:'private'},{feeDetails:[{type:null,amountCents:129,currency:'USD'}]},{feeDetails:[{type:'stripe_fee',amountCents:129,currency:'USD',raw:'private'}]}])await assert.rejects(db.query('select public.rr_test_record_charge_fee($1,$2,$3)',[order,seller,JSON.stringify({...e,...patch})]));
 await assert.rejects(db.query('select public.rr_test_record_charge_fee($1,$2,$3)',[order,listing,JSON.stringify(e)]));assert.deepEqual(await databaseState(),before);
});
test('new fee table and RPCs are inaccessible to browser roles',async()=>{
 assert.equal((await db.query("select relrowsecurity from pg_class where oid='rr_sandbox.charge_fee_evidence'::regclass")).rows[0].relrowsecurity,true);
 const grants=(await db.query("select grantee from information_schema.routine_privileges where routine_name in ('rr_test_fee_order','rr_test_record_charge_fee')")).rows;assert.ok(!grants.some(g=>['PUBLIC','anon','authenticated'].includes(g.grantee)));
 await db.exec('set role authenticated');try{await assert.rejects(db.query('select * from rr_sandbox.charge_fee_evidence'),/permission denied/);await assert.rejects(db.query('select public.rr_test_fee_order($1,$2)',[order,seller]),/permission denied/);}finally{await db.exec('reset role');}
 await assert.rejects(db.query('select public.rr_test_fee_order($1,$2)',[order,listing]));
});
const response=()=>({headers:{},setHeader(k,v){this.headers[k]=v;},end(s){this.body=JSON.parse(s);}});
function request(body={orderId:order},method='POST',url='/api/test-marketplace?action=fee') {const req=Readable.from([Buffer.from(JSON.stringify(body))]);req.method=method;req.url=url;req.headers={authorization:'Bearer operator','content-type':'application/json'};return req;}
test('HTTP fee collection accepts only a saved order and strips provider identities',async()=>{
 const x=setup(),handler=createTestFeeHandler({fees:x.service,enabled:true});
 for(const body of [{orderId:order,feeCents:1},{orderId:order,actor:seller},{orderId:order,chargeId:'ch_fixture'},null,[]]){const r=response();await handler(request(body),r);assert.equal(r.statusCode,400);}
 const r=response();await handler(request(),r);assert.equal(r.statusCode,200);assert.equal(r.body.feeCents,129);assert.equal(r.body.payoutAvailable,false);assert.match(r.headers['Cache-Control'],/no-store/);
 const before=providerCalls(x).length,g=response();await handler(request({},'GET','/api/test-marketplace?action=fee&orderId='+order),g);assert.equal(g.statusCode,200);assert.equal(providerCalls(x).length,before);
});
test('HTTP guards disabled routes, methods, ambiguous parameters, oversized input and private failures',async()=>{
 const x=setup({unavailable:'txn_fixture'}),r=response();await createTestFeeHandler({fees:x.service})(request(),r);assert.equal(r.statusCode,404);assert.equal(x.calls.length,0);
 const h=createTestFeeHandler({fees:x.service,enabled:true});for(const [method,url,status] of [['DELETE','/api/test-marketplace?action=fee',405],['GET','/api/test-marketplace?action=fee&orderId='+order+'&orderId='+order,400],['POST','/api/test-marketplace?action=fee&orderId='+order,400],['GET','/api/test-marketplace?action=fee&action=fee&orderId='+order,400]]){const r=response();await h(request({},method,url),r);assert.equal(r.statusCode,status);}
 const big=response();await h(request({orderId:order,padding:'x'.repeat(1024)}),big);assert.equal(big.statusCode,413);
 const fail=response();await h(request(),fail);assert.equal(fail.statusCode,503);assert.equal(JSON.stringify(fail.body).includes('private'),false);
});
test('provider adapter refuses live keys and invalid saved identities before any network request',async()=>{
 assert.throws(()=>createStripeTestFeeClient({secretKey:'sk_live_fixture',accountId:account}));assert.throws(()=>createStripeTestFeeClient({secretKey:'sk_test_fixture',accountId:'acct_other'}));const x=setup();await assert.rejects(x.stripe.read({test:true,orderId:order,paymentIntentId:'../account',totalCents:3427}));assert.equal(x.calls.length,0);
});
