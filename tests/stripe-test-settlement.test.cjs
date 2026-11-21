'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {createStripeTestSettlementClient,SettlementProviderError}=require('../server/stripe_test_settlement.cjs');
const PLATFORM='acct_1UWJZuGVbz9Pnhxd',ACCOUNT='acct_sellerFixture',NOW=1793685000000;
const O='11111111-1111-4111-8111-111111111111',S='22222222-2222-4222-8222-222222222222',
 R='33333333-3333-4333-8333-333333333333',P='44444444-4444-4444-8444-444444444444',V='55555555-5555-4555-8555-555555555555';
function request(kind='transfer',known=false){
 return {test:true,simulationOnly:true,requestId:kind==='transfer'?R:kind==='payout'?P:V,orderId:O,sellerId:S,accountId:ACCOUNT,
  kind,currency:'USD',amountCents:kind==='transfer'?2000:kind==='payout'?500:300,itemCents:2500,totalCents:3502,maxTransferCents:2000,
  paymentIntentId:'pi_fixture',chargeId:'ch_fixture',transferGroup:'rr_test_'+O,phase:known?'known':'dispatched',
  providerId:known?(kind==='transfer'?'tr_fixture':kind==='payout'?'po_fixture':'trr_fixture'):null,
  parentProviderId:kind==='transfer'?null:'tr_fixture',...(kind==='transfer'?{}:{parentRequestId:R,parentAmountCents:2000}),
  ...(kind==='payout'?{bankAccountId:'ba_fixture',payoutFeeReserveCents:25}:{})};
}
const metadata=q=>({integration:'rack_relic_test_settlement',platform_id:PLATFORM,request_id:q.requestId,order_id:O,seller_id:S,kind:q.kind,...(q.parentRequestId?{parent_request_id:q.parentRequestId}:{})});
function fixture(config={}){
 const calls=[],environment=config.environment;
 const remap=value=>{if(!environment)return value;if(Array.isArray(value))return value.map(remap);if(!value||typeof value!=='object')return value;const out=Object.fromEntries(Object.entries(value).map(([k,v])=>[k,remap(v)]));if(out.object==='account'&&out.id===PLATFORM)out.id=environment.accountId;if(out.metadata){out.metadata.rr_test_environment=environment.id;if(out.metadata.integration==='rack_relic_test_settlement')out.metadata.integration+='_acceptance_v1';if(out.metadata.platform_id===PLATFORM)out.metadata.platform_id=environment.accountId;if(out.metadata.rr_test_platform===PLATFORM)out.metadata.rr_test_platform=environment.accountId;}return out;};
 const transfer={object:'transfer',id:'tr_fixture',livemode:false,amount:2000,currency:'usd',destination:ACCOUNT,source_transaction:'ch_fixture',transfer_group:'rr_test_'+O,
  amount_reversed:0,reversed:false,balance_transaction:'txn_transfer',metadata:metadata(request())};
 const bank={object:'bank_account',id:'ba_fixture',account:ACCOUNT,country:'US',currency:'usd',default_for_currency:true,status:'new',available_payout_methods:['standard'],routing_number:'private routing',account_holder_name:'private person'};
 const payout={object:'payout',id:'po_fixture',livemode:false,amount:500,currency:'usd',automatic:false,method:'standard',type:'bank_account',source_type:'card',destination:'ba_fixture',
  status:'pending',balance_transaction:'txn_payout',failure_balance_transaction:null,failure_code:null,metadata:metadata(request('payout'))};
 const reversal={object:'transfer_reversal',id:'trr_fixture',amount:300,currency:'usd',transfer:'tr_fixture',balance_transaction:'txn_reversal',source_refund:null,metadata:metadata(request('reversal'))};
 const balance=(amount)=>({object:'balance',livemode:false,available:[{currency:'usd',amount,source_types:{card:amount}}]});
 const client=createStripeTestSettlementClient({secretKey:'rk_test_fixture',accountId:environment?.accountId??PLATFORM,clock:()=>NOW,fetchImpl:async(url,options)=>{
  const u=new URL(url);assert.equal(u.origin,'https://api.stripe.com');assert.equal(options.headers.Authorization,'Bearer rk_test_fixture');assert.equal(options.headers['Stripe-Version'],'2026-10-28.endive');assert.equal(options.cache,'no-store');assert.equal(options.redirect,'error');assert.ok(options.signal);
  calls.push({url,path:u.pathname,options});let data;
  if(u.pathname==='/v1/account')data={object:'account',id:PLATFORM,country:'US'};
  if(u.pathname==='/v1/balance')data=balance(options.headers['Stripe-Account']?config.connectedAvailable??2200:config.platformAvailable??3370);
  if(u.pathname==='/v2/core/accounts/'+ACCOUNT){assert.deepEqual([...u.searchParams.values()],['configuration.recipient','defaults','identity','requirements']);data={object:'v2.core.account',id:ACCOUNT,livemode:false,identity:{country:'us'},dashboard:'express',applied_configurations:['recipient'],configuration:{recipient:{capabilities:{stripe_balance:{stripe_transfers:{status:'active'}}}}},defaults:{responsibilities:{fees_collector:'application',losses_collector:'application'}},metadata:{rr_test_seller_id:S,rr_test_platform:PLATFORM}};}
  if(u.pathname==='/v1/accounts/'+ACCOUNT)data={object:'account',id:ACCOUNT,settings:{payouts:{schedule:{interval:'manual'}}}};
  if(u.pathname==='/v1/accounts/'+ACCOUNT+'/external_accounts')data={object:'list',has_more:false,data:config.noBank?[]:[bank]};
  if(u.pathname==='/v1/accounts/'+ACCOUNT+'/external_accounts/ba_fixture')data=bank;
  if(u.pathname==='/v1/payment_intents/pi_fixture')data={id:'pi_fixture',livemode:false,status:'succeeded',currency:'usd',amount:3502,amount_received:3502,latest_charge:'ch_fixture',metadata:{order_id:O},transfer_group:'rr_test_'+O};
  if(u.pathname==='/v1/charges/ch_fixture')data={object:'charge',id:'ch_fixture',livemode:false,payment_intent:'pi_fixture',status:'succeeded',paid:true,captured:true,disputed:false,refunded:false,amount_refunded:0,currency:'usd',amount:3502,amount_captured:3502,balance_transaction:'txn_charge',outcome:{type:'authorized',risk_level:'normal'}};
  if(u.pathname==='/v1/refunds'){assert.equal(u.searchParams.get('charge'),'ch_fixture');data={object:'list',has_more:false,data:[]};}
  if(u.pathname==='/v1/transfers'||u.pathname==='/v1/transfers/tr_fixture')data=transfer;
  if(u.pathname==='/v1/payouts'||u.pathname==='/v1/payouts/po_fixture'){assert.equal(options.headers['Stripe-Account'],ACCOUNT);data=payout;}
  if(u.pathname==='/v1/transfers/tr_fixture/reversals'||u.pathname==='/v1/transfers/tr_fixture/reversals/trr_fixture')data=reversal;
  if(options.method==='GET'&&u.searchParams.has('limit')){
   if(u.pathname==='/v1/transfers'){assert.equal(u.searchParams.get('transfer_group'),'rr_test_'+O);assert.equal(u.searchParams.get('destination'),ACCOUNT);data={object:'list',has_more:false,data:config.noExisting?[]:[transfer]};}
   if(u.pathname==='/v1/payouts'){assert.equal(options.headers['Stripe-Account'],ACCOUNT);assert.equal(u.searchParams.get('destination'),'ba_fixture');data={object:'list',has_more:false,data:config.noExisting?[]:[payout]};}
   if(u.pathname==='/v1/transfers/tr_fixture/reversals')data={object:'list',has_more:false,data:config.noExisting?[]:[reversal]};
  }
  const txns={txn_charge:{source:'ch_fixture',amount:3502,type:'charge',fee:132,fee_details:[{type:'stripe_fee',amount:132,currency:'usd'}]},txn_transfer:{source:'tr_fixture',amount:-2000,type:'transfer',fee:0},txn_payout:{source:'po_fixture',amount:-500,type:'payout',fee:0},txn_failure:{source:'po_fixture',amount:500,type:'payout_failure',fee:0},txn_reversal:{source:'trr_fixture',amount:300,type:'transfer_refund',fee:0}};
  if(u.pathname.startsWith('/v1/balance_transactions/')){const id=u.pathname.split('/').pop(),t=txns[id];assert.ok(t);data={object:'balance_transaction',id,currency:'usd',status:'available',exchange_rate:null,...t,net:t.amount-t.fee};if(['txn_payout','txn_failure'].includes(id))assert.equal(options.headers['Stripe-Account'],ACCOUNT);else assert.equal(options.headers['Stripe-Account'],undefined);}
  assert.ok(data,'Unhandled synthetic request '+u.pathname);
  if(config.httpFailure&&options.method==='POST')return Response.json({error:{code:config.httpFailure.code,message:'private provider rejection'}},{status:config.httpFailure.status});
  if(config.lostResponse&&options.method==='POST')throw Error('private accepted response lost');
  data=remap(structuredClone(data));if(config.patch)data=config.patch(data,u,options)||data;
  return Response.json(data,{headers:config.headers});
 }});
 return {client,calls,transfer,payout,reversal,bank};
}
const posts=f=>f.calls.filter(c=>c.options.method==='POST');
test('new transfer preserves platform/tax/postage net budget, binds the charge and emits minimal sandbox evidence',async()=>{
 const f=fixture(),r=await f.client.createTransfer(request());assert.equal(r.status,'succeeded');assert.equal(r.balanceTransactionId,'txn_transfer');assert.equal(r.source,'stripe_sandbox');assert.equal(r.simulationOnly,true);assert.equal(r.checkedAt,NOW);
 assert.deepEqual(Object.keys(r).sort(),['test','simulationOnly','source','requestId','orderId','kind','providerId','parentProviderId','accountId','currency','amountCents','status','checkedAt','balanceTransactionId','failureBalanceTransactionId','failureCode'].sort());
 assert.equal(posts(f).length,1);const p=posts(f)[0],form=new URLSearchParams(p.options.body);assert.equal(p.path,'/v1/transfers');assert.equal(form.get('source_transaction'),'ch_fixture');assert.equal(form.get('amount'),'2000');assert.equal(form.get('transfer_group'),'rr_test_'+O);assert.equal(form.get('metadata[request_id]'),R);assert.equal(p.options.headers['Stripe-Account'],undefined);assert.equal(p.options.headers['Idempotency-Key'],'rr_test_settlement_transfer_'+R);
 assert.equal([...form.keys()].some(k=>/application_fee|on_behalf|transfer_data/.test(k)),false);assert.equal(JSON.stringify(r).includes('private'),false);
});
test('transfer budget subtracts only the verified original processing fee and rejects one cent of reserve shortage',async()=>{
 const enough=fixture({platformAvailable:3370});await enough.client.createTransfer(request());
 for(const config of [{platformAvailable:3369},{patch(d,u){if(u.pathname==='/v1/balance_transactions/txn_charge')return {...d,fee:133,net:3370};}},{patch(d,u){if(u.pathname==='/v1/balance_transactions/txn_charge')return {...d,status:'pending'};}}]){const f=fixture(config);await assert.rejects(f.client.createTransfer(request()));assert.equal(posts(f).length,0);}
 const reserve=fixture();await assert.rejects(reserve.client.createTransfer({...request(),platformReserveCents:1}));assert.equal(posts(reserve).length,0);
});
test('new money movements require sufficient total USD and card funds independently',async()=>{
 for(const [kind,method,minimum]of [['transfer','createTransfer',3370],['payout','createPayout',525],['reversal','createReversal',300]]){
  for(const amount of [-50,0,minimum-1]){
   const f=fixture({patch(d,u,options){
    if(u.pathname==='/v1/balance'&&Boolean(options.headers['Stripe-Account'])===(kind!=='transfer'))return {...d,available:[{currency:'usd',amount,source_types:{card:minimum+1000,bank_account:amount-minimum-1000}}]};
   }});
   await assert.rejects(f.client[method](request(kind)),e=>e instanceof SettlementProviderError&&e.code==='provider_balance_insufficient');assert.equal(posts(f).length,0);
  }
 }
 const recovery=fixture({patch(d,u,options){
  if(u.pathname==='/v1/balance'&&options.headers['Stripe-Account'])return {...d,available:[{currency:'usd',amount:-50,source_types:{card:500,bank_account:-550}}]};
  if(u.pathname==='/v1/payouts/po_fixture')return {...d,status:'failed',failure_code:'account_closed',failure_balance_transaction:'txn_failure'};
 }});const r=await recovery.client.retrievePayout(request('payout',true));assert.equal(r.status,'failed');assert.equal(r.failureBalanceTransactionId,'txn_failure');assert.equal(posts(recovery).length,0);
});
test('live keys, wrong platform, malformed requests, inflated proceeds and unclaimed writes fail before provider access',async()=>{
 for(const config of [{secretKey:'sk_live_fixture',accountId:PLATFORM},{secretKey:'rk_test_fixture',accountId:'acct_other'}])assert.throws(()=>createStripeTestSettlementClient(config));
 for(const patch of [{test:false},{simulationOnly:false},{accountId:PLATFORM},{requestId:'bad'},{amountCents:2001},{amountCents:1.5},{maxTransferCents:2501},{phase:'prepared'},{providerId:'tr_existing'},{currency:'EUR'},{application_fee_amount:1},{transferGroup:'other'},{parentProviderId:'tr_other'}]){const f=fixture();await assert.rejects(f.client.createTransfer({...request(),...patch}));assert.equal(f.calls.length,0);}
});
test('fresh platform and v2 recipient identity, capability and manual payout schedule are mandatory for new writes',async()=>{
 const patches=[(d,u)=>u.pathname==='/v1/balance'?{...d,livemode:true}:d,(d,u)=>u.pathname==='/v1/account'?{...d,id:'acct_other'}:d,
  (d,u)=>u.pathname.startsWith('/v2/')?{...d,livemode:true}:d,(d,u)=>u.pathname.startsWith('/v2/')?{...d,metadata:{...d.metadata,rr_test_seller_id:B}}:d,
  (d,u)=>u.pathname.startsWith('/v2/')?{...d,configuration:{recipient:{capabilities:{stripe_balance:{stripe_transfers:{status:'restricted'}}}}}}:d,
  (d,u)=>u.pathname.startsWith('/v2/')?{...d,defaults:{responsibilities:{fees_collector:'stripe',losses_collector:'stripe'}}}:d,
  (d,u)=>u.pathname==='/v1/accounts/'+ACCOUNT?{...d,settings:{payouts:{schedule:{interval:'daily'}}}}:d];
 for(const patch of patches){const f=fixture({patch});await assert.rejects(f.client.createTransfer(request()));assert.equal(posts(f).length,0);}
});
const B='66666666-6666-4666-8666-666666666666';
test('captured payment and source-charge binding reject refunds, reviews, disputed or transferred payments',async()=>{
 for(const [path,patch]of [['/v1/payment_intents/pi_fixture',{status:'processing'}],['/v1/payment_intents/pi_fixture',{latest_charge:'ch_other'}],['/v1/payment_intents/pi_fixture',{application_fee_amount:10}],...([{disputed:true},{refunded:true,amount_refunded:1},{review:'prv_fixture'},{captured:false},{outcome:{type:'authorized',risk_level:'elevated'}},{balance_transaction:'txn_other'},{transfer:'tr_other'}].map(p=>['/v1/charges/ch_fixture',p]))]){
  const f=fixture({patch(d,u){return u.pathname===path?{...d,...patch}:d;}});await assert.rejects(f.client.createTransfer(request()));assert.equal(posts(f).length,0);
 }
});
test('binding inspection returns only the supported default test bank ID or a held missing-bank result',async()=>{
 const f=fixture(),r=await f.client.inspectBinding({test:true,simulationOnly:true,orderId:O,sellerId:S,accountId:ACCOUNT});assert.deepEqual(r,{test:true,simulationOnly:true,source:'stripe_sandbox',accountId:ACCOUNT,bankAccountId:'ba_fixture',checkedAt:NOW});assert.equal(posts(f).length,0);assert.equal(JSON.stringify(r).includes('private'),false);
 const none=fixture({noBank:true});assert.equal((await none.client.inspectBinding({test:true,simulationOnly:true,orderId:O,sellerId:S,accountId:ACCOUNT})).bankAccountId,null);
 for(const patch of [{account:'acct_other'},{status:'errored'},{default_for_currency:false},{available_payout_methods:['instant']},{country:'CA'}]){const x=fixture({patch(d,u){if(u.pathname.endsWith('/ba_fixture'))return {...d,...patch};}});await assert.rejects(x.client.inspectBinding({test:true,simulationOnly:true,orderId:O,sellerId:S,accountId:ACCOUNT}));}
});
test('an external pending refund blocks new transfer and payout creation before amount_refunded changes',async()=>{
 for(const kind of ['transfer','payout'])for(const status of ['pending','requires_action','succeeded','unexpected']){
  const f=fixture({patch(d,u){if(u.pathname==='/v1/refunds')return {...d,data:[{object:'refund',id:'re_pending',amount:1,currency:'usd',charge:'ch_fixture',payment_intent:'pi_fixture',status}]};}});
  await assert.rejects(f.client[kind==='transfer'?'createTransfer':'createPayout'](request(kind)));assert.equal(posts(f).length,0);
 }
 for(const patch of [{has_more:true},{data:[{object:'refund',id:'re_failed',amount:1,currency:'usd',charge:'ch_other',payment_intent:'pi_fixture',status:'failed'}]}]){const f=fixture({patch(d,u){if(u.pathname==='/v1/refunds')return {...d,...patch};}});await assert.rejects(f.client.createTransfer(request()));assert.equal(posts(f).length,0);}
});
test('payout is a manual standard bank payout scoped to the bound connected account and parent transfer',async()=>{
 const f=fixture(),r=await f.client.createPayout(request('payout'));assert.equal(r.status,'pending');assert.equal(r.parentProviderId,'tr_fixture');assert.equal(posts(f).length,1);
 const p=posts(f)[0],form=new URLSearchParams(p.options.body);assert.equal(p.path,'/v1/payouts');assert.equal(p.options.headers['Stripe-Account'],ACCOUNT);assert.equal(form.get('method'),'standard');assert.equal(form.get('destination'),'ba_fixture');assert.equal(form.get('source_type'),'card');assert.equal(form.get('metadata[parent_request_id]'),R);
 for(const config of [{connectedAvailable:524},{patch(d,u){if(u.pathname==='/v1/transfers/tr_fixture')return {...d,amount_reversed:1501};}},{patch(d,u){if(u.pathname==='/v1/transfers/tr_fixture')return {...d,metadata:{...d.metadata,request_id:B}};}}]){const x=fixture(config);await assert.rejects(x.client.createPayout(request('payout')));assert.equal(posts(x).length,0);}
});
test('payout receipt rejects substituted destination, transfer, mode, method and metadata even after a provider POST',async()=>{
 for(const patch of [{destination:'ba_other'},{livemode:true},{method:'instant'},{automatic:true},{type:'card'},{metadata:{...metadata(request('payout')),order_id:B}},{status:'paid',balance_transaction:null},{failure_balance_transaction:'txn_failure'}]){
  const f=fixture({patch(d,u){if(u.pathname==='/v1/payouts')return {...d,...patch};}});await assert.rejects(f.client.createPayout(request('payout')));assert.equal(posts(f).length,1);
 }
});
test('known payout retrieval is GET only and preserves paid-to-failed evidence including verified returned funds',async()=>{
 const f=fixture({connectedAvailable:-50,patch(d,u){
  if(u.pathname.startsWith('/v2/'))return {...d,configuration:{recipient:{capabilities:{stripe_balance:{stripe_transfers:{status:'restricted'}}}}}};
  if(u.pathname==='/v1/payouts/po_fixture')return {...d,status:'failed',failure_code:'account_closed',failure_balance_transaction:'txn_failure'};
  return d;
 }});const r=await f.client.retrievePayout(request('payout',true));assert.equal(r.status,'failed');assert.equal(r.failureCode,'account_closed');assert.equal(r.failureBalanceTransactionId,'txn_failure');assert.equal(posts(f).length,0);assert.equal(f.calls.some(c=>c.path.endsWith('/external_accounts/ba_fixture')),false);
 const pending=fixture({patch(d,u){if(u.pathname==='/v1/payouts/po_fixture')return {...d,status:'failed',failure_code:'account_closed'};}});assert.equal((await pending.client.retrievePayout(request('payout',true))).failureBalanceTransactionId,null);
 for(const patch of [{source:'po_other'},{amount:499},{status:'pending'},{type:'payment'},{net:499}]){const x=fixture({patch(d,u){if(u.pathname==='/v1/payouts/po_fixture')return {...d,status:'failed',failure_balance_transaction:'txn_failure',failure_code:'account_closed'};if(u.pathname.endsWith('/txn_failure'))return {...d,...patch};}});await assert.rejects(x.client.retrievePayout(request('payout',true)));assert.equal(posts(x).length,0);}
});
test('reversal uses the original platform transfer and available connected funds without bank debits',async()=>{
 const f=fixture({patch(d,u){if(u.pathname.startsWith('/v2/'))return {...d,configuration:{recipient:{capabilities:{stripe_balance:{stripe_transfers:{status:'restricted'}}}}}};}}),r=await f.client.createReversal(request('reversal'));
 assert.equal(r.status,'succeeded');assert.equal(r.providerId,'trr_fixture');assert.equal(posts(f).length,1);const p=posts(f)[0];assert.equal(p.path,'/v1/transfers/tr_fixture/reversals');assert.equal(p.options.headers['Stripe-Account'],undefined);assert.equal(new URLSearchParams(p.options.body).get('amount'),'300');
 for(const config of [{connectedAvailable:299},{patch(d,u){if(u.pathname==='/v1/transfers/tr_fixture')return {...d,amount_reversed:1701};}},{patch(d,u){if(u.pathname==='/v1/transfers/tr_fixture')return {...d,source_transaction:'ch_other'};}}]){const x=fixture(config);await assert.rejects(x.client.createReversal(request('reversal')));assert.equal(posts(x).length,0);}
 assert.equal(f.calls.some(c=>/\/debits|external_accounts/.test(c.path)),false);
});
test('known transfer and reversal recovery only retrieve saved identities, even after seller restrictions',async()=>{
 const f=fixture({patch(d,u){if(u.pathname.startsWith('/v2/'))return {...d,configuration:{recipient:{capabilities:{stripe_balance:{stripe_transfers:{status:'restricted'}}}}}};if(u.pathname==='/v1/transfers/tr_fixture')return {...d,amount_reversed:300};}});
 assert.equal((await f.client.retrieveTransfer(request('transfer',true))).providerId,'tr_fixture');assert.equal((await f.client.retrieveReversal(request('reversal',true))).providerId,'trr_fixture');assert.equal(posts(f).length,0);
 const wrong=fixture({patch(d,u){if(u.pathname.endsWith('/trr_fixture'))return {...d,transfer:'tr_other'};}});await assert.rejects(wrong.client.retrieveReversal(request('reversal',true)));
});
test('lost creation responses have no retry loop and expose neither credentials nor private provider errors',async()=>{
 for(const [kind,method]of [['transfer','createTransfer'],['payout','createPayout'],['reversal','createReversal']]){const f=fixture({lostResponse:true});await assert.rejects(f.client[method](request(kind)),e=>!e.message.includes('private'));assert.equal(posts(f).length,1);}
 for(const headers of [{age:'1'},{'cf-cache-status':'HIT'},{'x-vercel-cache':'STALE'}]){const f=fixture({headers});await assert.rejects(f.client.createTransfer(request()));assert.equal(posts(f).length,0);}
});
test('typed failure codes distinguish insufficient funds, definite rejection and unknown outcomes without granting a retry',async()=>{
 for(const [config,code]of [[{connectedAvailable:299},'provider_balance_insufficient'],[{lostResponse:true},'provider_outcome_unknown'],
  [{httpFailure:{status:400,code:'balance_insufficient'}},'provider_balance_insufficient'],[{httpFailure:{status:403,code:'permission_denied'}},'provider_rejected'],
  [{httpFailure:{status:500,code:'api_error'}},'provider_outcome_unknown'],[{httpFailure:{status:409,code:'idempotency_key_in_use'}},'provider_outcome_unknown']]){
  const f=fixture(config);await assert.rejects(f.client.createReversal(request('reversal')),e=>e instanceof SettlementProviderError&&e.code===code&&!e.message.includes('private'));
  assert.equal(posts(f).length,config.connectedAvailable!==undefined?0:1);
 }
 assert.equal(new SettlementProviderError('arbitrary').code,'provider_outcome_unknown');
});
test('unknown creation outcome can be found once through a bounded GET inventory and fully reverified by saved identity',async()=>{
 for(const [kind,method]of [['transfer','createTransfer'],['payout','createPayout'],['reversal','createReversal']]){
  const f=fixture({lostResponse:true});await assert.rejects(f.client[method](request(kind)));if(kind==='reversal')f.transfer.amount_reversed=300;
  const before=f.calls.length,r=await f.client.findExisting({...request(kind),dispatchedAt:NOW-1000});assert.equal(r.kind,kind);assert.equal(r.source,'stripe_sandbox');assert.equal(posts(f).length,1);assert.ok(f.calls.slice(before).every(c=>c.options.method==='GET'));
  const list=f.calls.slice(before).find(c=>new URL(c.url).searchParams.has('limit'));assert.equal(new URL(list.url).searchParams.get('limit'),'100');
  if(kind==='payout')assert.equal(new URL(list.url).searchParams.get('created[gte]'),String(Math.floor((NOW-1000)/1000)-1));
 }
});
test('unknown-outcome searches never recreate absent operations or accept duplicates, partial lists or mismatched evidence',async()=>{
 for(const kind of ['transfer','payout','reversal']){const f=fixture({noExisting:true});assert.equal(await f.client.findExisting(request(kind)),null);assert.equal(posts(f).length,0);}
 const alterations=[d=>({...d,has_more:true}),d=>({...d,data:[...d.data,...d.data]}),d=>({...d,data:d.data.map(v=>({...v,amount:v.amount-1}))}),d=>({...d,data:d.data.map(v=>({...v,currency:'eur'}))})];
 for(const alter of alterations){const f=fixture({patch(d,u){if(u.pathname==='/v1/transfers'&&u.searchParams.has('limit'))return alter(d);}});await assert.rejects(f.client.findExisting(request()));assert.equal(posts(f).length,0);}
 const foreign=fixture({patch(d,u){if(u.pathname==='/v1/transfers'&&u.searchParams.has('limit'))return {...d,data:d.data.map(v=>({...v,metadata:{...v.metadata,seller_id:B}}))};}});assert.equal(await foreign.client.findExisting(request()),null);assert.equal(posts(foreign).length,0);
 const wrongGet=fixture({patch(d,u){if(u.pathname==='/v1/transfers/tr_fixture')return {...d,destination:'acct_other'};}});await assert.rejects(wrongGet.client.findExisting(request()));assert.equal(posts(wrongGet).length,0);
});

const acceptance=require('../server/test_environment_registry.cjs').TEST_ENVIRONMENTS.acceptance;
test('acceptance settlement uses its own platform, metadata and stable namespaces for all money simulations',async()=>{
 for(const [kind,method]of [['transfer','createTransfer'],['payout','createPayout'],['reversal','createReversal']]){
  const f=fixture({environment:acceptance}),q=request(kind),r=await f.client[method](q);assert.equal(r.simulationOnly,true);
  const writes=posts(f);assert.equal(writes.length,1);const form=new URLSearchParams(writes[0].options.body);
  assert.equal(form.get('metadata[integration]'),'rack_relic_test_settlement_acceptance_v1');assert.equal(form.get('metadata[rr_test_environment]'),acceptance.id);assert.equal(form.get('metadata[platform_id]'),acceptance.accountId);
  assert.equal(writes[0].options.headers['Idempotency-Key'],'rr_test_settlement_'+kind+'_acceptance_v1_'+q.requestId);
  const reloaded=fixture({environment:acceptance,patch(d,u){if(kind==='reversal'&&u.pathname==='/v1/transfers/tr_fixture')return {...d,amount_reversed:300};}});assert.equal((await reloaded.client.findExisting(q)).providerId,r.providerId);assert.equal(posts(reloaded).length,0);
 }
});
test('neither approved platform can be used as a recipient and wrong acceptance evidence never reaches a write',async()=>{
 for(const accountId of [PLATFORM,acceptance.accountId]){const f=fixture({environment:acceptance});await assert.rejects(f.client.createTransfer({...request(),accountId}));assert.equal(f.calls.length,0);}
 for(const patch of [(d,u)=>u.pathname==='/v1/account'?{...d,id:PLATFORM}:d,(d,u)=>u.pathname.startsWith('/v2/')?{...d,metadata:{...d.metadata,rr_test_environment:'legacy'}}:d,(d,u)=>u.pathname.startsWith('/v1/payment_intents/')?{...d,metadata:{order_id:O}}:d]){const f=fixture({environment:acceptance,patch});await assert.rejects(f.client.createTransfer(request()));assert.equal(posts(f).length,0);}
});
