const {test,before,after,beforeEach}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
const {createHmac}=require('node:crypto');
const {Readable}=require('node:stream');
const {createTestOrderRepository}=require('../server/test_order_repository.cjs');
const {createTestWebhookHandler,createTestOrdersHandler}=require('../server/test_order_handlers.cjs');
let db;
const listing='44444444-4444-4444-8444-444444444444',seller='33333333-3333-4333-8333-333333333333',buyer='22222222-2222-4222-8222-222222222222',buyer2='66666666-6666-4666-8666-666666666666',order='11111111-1111-4111-8111-111111111111',order2='55555555-5555-4555-8555-555555555555';
before(async()=>{db=new PGlite();await db.exec('create role anon;create role authenticated;create role service_role;');await db.exec(fs.readFileSync(require.resolve('../supabase/test/20261030_order_ledger.sql'),'utf8'));});
after(async()=>{await db?.close();});
beforeEach(async()=>{await db.exec('truncate rr_sandbox.catalog cascade;');await db.query("insert into rr_sandbox.catalog(id,seller_id,title,price_cents) values($1,$2,'Synthetic test jacket',2500)",[listing,seller]);});
async function reserve(id=order,member=buyer){return (await db.query('select public.rr_test_reserve($1,$2,$3) as result',[id,listing,member])).rows[0].result;}
function snapshot(id=order){return {test:true,orderId:id,listingId:listing,sellerId:seller,currency:'USD',itemCents:2500,buyerFeeCents:100,shippingCents:500,taxCents:327,totalCents:3427};}
async function attach(id=order,session='cs_test_fixture',snap=snapshot(id)){return (await db.query('select public.rr_test_attach_checkout($1,$2,$3,$4,$5,$6,$7) as result',[id,session,JSON.stringify(snap),'taxcalc_fixture','a'.repeat(64),'b'.repeat(32),new Date(Date.now()+3600000).toISOString()])).rows[0].result;}
async function event({id='evt_fixture',hash='c'.repeat(64),type='checkout.session.completed',oid=order,session='cs_test_fixture',amount=3427,currency='usd',paid=true}={}){return (await db.query('select public.rr_test_process_event($1,$2,$3,$4,$5,$6,$7,$8) as result',[id,hash,type,oid,session,amount,currency,paid])).rows[0].result;}
test('migration isolates its own catalog and exposes financial RPCs only to service_role',async()=>{
 const grants=await db.query("select grantee,privilege_type from information_schema.routine_privileges where routine_name='rr_test_reserve'");
 assert.ok(grants.rows.some(r=>r.grantee==='service_role'&&r.privilege_type==='EXECUTE'));
 assert.ok(!grants.rows.some(r=>['PUBLIC','anon','authenticated'].includes(r.grantee)));
 await db.exec('set role authenticated');try{await assert.rejects(reserve(),/permission denied/);}finally{await db.exec('reset role');}
});
test('two buyers competing for one item get exactly one reservation, with stable order idempotency',async()=>{
 const results=await Promise.allSettled([reserve(),reserve(order2,buyer2)]);
 assert.equal(results.filter(x=>x.status==='fulfilled').length,1);assert.equal(results.filter(x=>x.status==='rejected').length,1);
 const winner=results[0].status==='fulfilled'?order:order2,member=winner===order?buyer:buyer2;
 assert.equal((await reserve(winner,member)).id,winner);
 await assert.rejects(reserve(winner,member===buyer?buyer2:buyer),/identity mismatch/);
});
test('self purchase, hidden items and already sold items cannot be reserved',async()=>{
 await assert.rejects(reserve(order,seller),/unavailable/);
 await db.exec("update rr_sandbox.catalog set moderation_status='hidden'");await assert.rejects(reserve(),/unavailable/);
 await db.exec("update rr_sandbox.catalog set moderation_status='active',status='sold'");await assert.rejects(reserve(),/unavailable/);
});
test('reservation locks price and visibility; invalid or null checkout totals cannot attach',async()=>{
 await reserve();await assert.rejects(db.exec('update rr_sandbox.catalog set price_cents=2600'),/cannot be edited/);
 await assert.rejects(db.exec("update rr_sandbox.catalog set moderation_status='hidden'"),/cannot be edited/);
 for(const patch of [{currency:null},{test:null},{orderId:null},{itemCents:2499},{buyerFeeCents:0},{totalCents:1},{shippingCents:-1},{taxCents:1.1}])await assert.rejects(attach(order,'cs_test_fixture',{...snapshot(),...patch}));
 assert.equal((await attach()).state,'checkout_open');assert.equal((await attach()).state,'checkout_open');
 await assert.rejects(attach(order,'cs_test_other'),/not eligible/);
});
test('unpaid completion does not sell; paid notification sells once and balances the ledger',async()=>{
 await reserve();await attach();assert.equal((await event({paid:false})).state,'checkout_open');
 assert.equal((await event({id:'evt_paid',hash:'d'.repeat(64)})).state,'paid');
 assert.equal((await db.query('select status from rr_sandbox.catalog')).rows[0].status,'sold');
 assert.equal((await event({id:'evt_paid',hash:'d'.repeat(64)})).duplicate,true);
 await event({id:'evt_secondpaid',hash:'e'.repeat(64)});
 const l=(await db.query('select count(*)::int as count,sum(amount_cents)::int as balance from rr_sandbox.ledger_entries')).rows[0];assert.equal(l.count,5);assert.equal(l.balance,0);
 assert.equal((await db.query('select count(*)::int as count from rr_sandbox.jobs')).rows[0].count,5);
 assert.equal((await db.query("select state from rr_sandbox.jobs where kind='prepare_test_label'")).rows[0].state,'held');
});
test('amount, currency, session and event-body collisions cannot mutate balances',async()=>{
 await reserve();await attach();
 for(const patch of [{amount:1},{currency:'cad'},{session:'cs_test_wrong'},{hash:null}])await assert.rejects(event(patch));
 await event();await assert.rejects(event({hash:'d'.repeat(64)}),/collision/);
 assert.equal((await db.query('select count(*)::int as count from rr_sandbox.provider_events')).rows[0].count,1);
});
test('provider expiry releases inventory, but a late paid event cannot steal another reservation',async()=>{
 await reserve();await attach();assert.equal((await event({type:'checkout.session.expired',paid:false})).state,'expired');
 await reserve(order2,buyer2);await attach(order2,'cs_test_new',snapshot(order2));
 assert.equal((await event({id:'evt_late',hash:'d'.repeat(64)})).state,'review');
 assert.equal((await db.query('select status from rr_sandbox.catalog')).rows[0].status,'published');
 const suspense=(await db.query("select sum(amount_cents)::int as balance,count(*)::int as count from rr_sandbox.ledger_entries where order_id=$1",[order])).rows[0];assert.equal(suspense.balance,0);assert.equal(suspense.count,2);
 assert.equal((await event({id:'evt_newpaid',hash:'e'.repeat(64),oid:order2,session:'cs_test_new'})).state,'paid');
});
test('late expiry cannot undo a paid sale and member order views exclude provider evidence',async()=>{
 await reserve();await attach();await event();await event({id:'evt_expired',hash:'d'.repeat(64),type:'checkout.session.expired',paid:false});
 const mine=(await db.query('select public.rr_test_member_orders($1) as result',[buyer])).rows[0].result;
 assert.equal(mine.length,1);assert.equal(mine[0].state,'paid');assert.equal(mine[0].session_id,undefined);assert.equal(mine[0].destination_hash,undefined);
 assert.deepEqual((await db.query('select public.rr_test_member_orders($1) as result',[buyer2])).rows[0].result,[]);
});
test('fresh fraud assessment is required to release shipping; a hold cannot silently clear',async()=>{
 await reserve();await attach();await event();
 const risk=(decision,hash,checkedAt=Date.now())=>db.query('select public.rr_test_record_risk($1,$2,$3) as result',[order,JSON.stringify({test:true,orderId:order,chargeId:'ch_fixture',decision,checkedAt}),hash]);
 await assert.rejects(risk('clear','d'.repeat(64),Date.now()-600000),/Stale/);
 await risk('clear','d'.repeat(64));
 assert.equal((await db.query("select state from rr_sandbox.jobs where kind='prepare_test_label'")).rows[0].state,'pending');
 await risk('review','e'.repeat(64));
 assert.equal((await db.query("select state from rr_sandbox.jobs where kind='prepare_test_label'")).rows[0].state,'held');
 await assert.rejects(risk('clear','f'.repeat(64)),/Manual review/);
 assert.equal((await db.query('select risk_status from rr_sandbox.orders')).rows[0].risk_status,'review');
});

function repository(){return createTestOrderRepository({projectUrl:'https://abcdefghijklmnopqrst.supabase.co',serviceKey:'sb_secret_fixture',fetchImpl:async(url,opts)=>{
 if(url.endsWith('/auth/v1/user'))return Response.json(opts.headers.Authorization==='Bearer fixture'?{id:buyer}:{},{status:opts.headers.Authorization==='Bearer fixture'?200:401});
 const name=url.split('/').pop(),p=JSON.parse(opts.body),definitions={
  rr_test_reserve:['p_order','p_listing','p_buyer'],rr_test_member_orders:['p_member'],
  rr_test_process_event:['p_event','p_payload_hash','p_type','p_order','p_session','p_amount','p_currency','p_paid'],
  rr_test_record_risk:['p_order','p_evidence','p_hash']
 };
 const keys=definitions[name];if(!keys)throw Error('Unknown test RPC');
 const args=keys.map(k=>p[k]&&typeof p[k]==='object'?JSON.stringify(p[k]):p[k]);
 try{return Response.json((await db.query('select public.'+name+'('+keys.map((_,i)=>'$'+(i+1)).join(',')+') as result',args)).rows[0].result);}
 catch{return Response.json({error:'private database detail'},{status:400});}
 }});}
const res=()=>({headers:{},setHeader(k,v){this.headers[k]=v;},end(body){this.body=JSON.parse(body);}});
test('signed raw webhook passes through HTTP adapter into the PostgreSQL transaction exactly once',async()=>{
 await reserve();await attach();const r=repository(),handler=createTestWebhookHandler({repository:r,webhookSecret:'whsec_fixture',enabled:true});
 const payload={id:'evt_bridge',livemode:false,type:'checkout.session.completed',data:{object:{id:'cs_test_fixture',livemode:false,mode:'payment',currency:'usd',amount_total:3427,client_reference_id:order,metadata:{order_id:order,integration:'rack_relic_test'},payment_status:'paid',status:'complete'}}};
 const raw=Buffer.from(JSON.stringify(payload)),stamp=Math.floor(Date.now()/1000),signature='t='+stamp+',v1='+createHmac('sha256','whsec_fixture').update(stamp+'.').update(raw).digest('hex');
 for(let i=0;i<2;i++){const req=Readable.from([raw]);req.method='POST';req.headers={'stripe-signature':signature};const response=res();await handler(req,response);assert.equal(response.statusCode,200);assert.equal(response.headers['Cache-Control'],'private, no-store, max-age=0');}
 assert.equal((await db.query('select count(*)::int as count from rr_sandbox.provider_events')).rows[0].count,1);
 assert.equal((await db.query('select state,risk_status from rr_sandbox.orders')).rows[0].risk_status,'pending');
 const bad=Readable.from([Buffer.concat([raw,Buffer.from(' ')])]);bad.method='POST';bad.headers={'stripe-signature':signature};const response=res();await handler(bad,response);assert.equal(response.statusCode,400);
});
test('authenticated order endpoint ignores caller-selected member IDs and rejects missing identity',async()=>{
 const r=repository();await r.reserve({authorization:'Bearer fixture',orderId:order,listingId:listing,buyerId:buyer2});
 const handler=createTestOrdersHandler({repository:r,enabled:true}),mine=res();await handler({method:'GET',url:'/?member='+buyer2,headers:{authorization:'Bearer fixture'}},mine);
 assert.equal(mine.statusCode,200);assert.equal(mine.body.orders.length,1);assert.equal(mine.body.orders[0].buyer_id,buyer);assert.equal(mine.body.orders[0].session_id,undefined);
 const denied=res();await handler({method:'GET',headers:{}},denied);assert.equal(denied.statusCode,401);
 const disabled=res();await createTestOrdersHandler({repository:r})({method:'GET',headers:{authorization:'Bearer fixture'}},disabled);assert.equal(disabled.statusCode,503);
});
