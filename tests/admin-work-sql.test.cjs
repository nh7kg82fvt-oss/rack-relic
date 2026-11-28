'use strict';
const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
const {list,receipt,cursor}=require('../server/admin_work_data.cjs');
const migrations=['20261030_order_ledger','20261030_payment_recovery','20261030_checkout_attempts','20261030_refund_receipts','20261030_refund_requests','20261030_checkout_quote_limits','20261030_checkout_quote_refresh','20261031_cancel_preparation','20261031_refund_review','20261031_charge_fee_evidence','20261031_fulfillment_snapshots','20261031_label_attempts','20261031_tracking_observations','20261102_seller_onboarding','20261102_order_issues','20261102_order_issues_review','20261102_order_issues_thread','20261102_order_issues_review_refunds','20261103_seller_protections','20261103_provider_risk_holds','20261103_startup_policy','20261103_fee_policy_v2','20261103_seller_costs','20261103_startup_limit_200','20261103_settlement_simulation','20261103_cloud_case_alerts','20261103_admin_overview','20261103_refund_provider_inventory'];
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0'),S=id(1),B=id(2),L=id(3);let db,next=100;
const rpc=(name,args)=>db.query('select public.'+name+'('+args.map((_,i)=>'$'+(i+1)).join(',')+') x',args).then(r=>r.rows[0].x);
const create=(patch={})=>({operation:'create',requestId:id(next++),itemId:id(next++),version:0,service:'vercel',title:'Check verification email',note:'Practice support follow-up only.',status:'open',...patch});
const write=(c,actor=S,owner=S)=>rpc('rr_test_write_admin_work',[owner,actor,c]);
const financial=()=>db.query("select (select jsonb_agg(o) from rr_sandbox.orders o) orders,(select jsonb_agg(l) from rr_sandbox.ledger_entries l) ledger,(select jsonb_agg(j) from rr_sandbox.jobs j) jobs,(select jsonb_agg(c) from rr_sandbox.catalog c) catalog").then(r=>r.rows);
before(async()=>{db=new PGlite();await db.exec('create role anon;create role authenticated;create role service_role;');for(const m of migrations)await db.exec(fs.readFileSync('supabase/test/'+m+'.sql','utf8'));await db.exec(fs.readFileSync('supabase/test/20261103230114_private_admin_work.sql','utf8'));await db.query("insert into rr_sandbox.catalog(id,seller_id,title,price_cents,status,moderation_status) values($1,$2,'Hidden practice fixture',2500,'archived','hidden')",[L,S]);});
after(async()=>db?.close());
test('saved work, version updates and exact idempotent retries retain one immutable receipt each without touching finances',async()=>{
 const before=await financial(),c=create(),saved=await write(c);assert.equal(receipt(saved,{requestId:c.requestId,expected:c}).item.version,1);
 const earlierClock=(await db.query("update rr_sandbox.admin_work_items set updated_at=clock_timestamp()+interval '10 seconds' where id=$1 returning jsonb_build_object('updatedAt',updated_at) d",[c.itemId])).rows[0].d.updatedAt;
 const updated={...c,operation:'update',requestId:id(next++),version:1,status:'complete',note:'Support response reviewed.'},r=await write(updated);assert.equal(r.item.version,2);assert.equal(r.item.status,'complete');
 assert.equal(r.item.updatedAt,earlierClock,'a backwards database clock cannot move the saved update time backwards');
 const replay=await write(c);assert.equal(replay.replayed,true);assert.deepEqual(replay.item,saved.item);
 const known=await rpc('rr_test_admin_work_receipt',[S,S,c.requestId]);assert.equal(known.replayed,true);assert.deepEqual(known.item,saved.item);
 assert.equal((await db.query('select count(*)::int n from rr_sandbox.admin_work_audit where request_id in ($1,$2)',[c.requestId,updated.requestId])).rows[0].n,2);
 assert.deepEqual(await financial(),before);
});
test('stale versions and conflicting request retries preserve the current work record and audit',async()=>{
 const c=create(),saved=await write(c);const u={...c,operation:'update',version:1,requestId:id(next++),status:'in_review'};await write(u);
 await assert.rejects(write({...u,requestId:id(next++),note:'Stale editor'}),/Work version conflict/);
 await assert.rejects(write({...c,title:'Changed retry'}),/Work request conflict/);
 const current=(await db.query('select version,note,status from rr_sandbox.admin_work_items where id=$1',[c.itemId])).rows[0];assert.equal(current.version,2);assert.equal(current.note,saved.item.note);assert.equal(current.status,'in_review');
});
test('owner/actor mismatch and browser access cannot read or change private work; direct audit changes are denied',async()=>{
 const c=create();await write(c);
 for(const [owner,actor]of [[S,B],[S,null],[null,S],[B,B]]){await assert.rejects(rpc('rr_test_admin_work_list',[owner,actor]),/participating test owner/);await assert.rejects(write(create(),actor,owner),/participating test owner/);}
 for(const role of ['anon','authenticated']){await db.exec('set role '+role);try{await assert.rejects(rpc('rr_test_admin_work_list',[S,S]));await assert.rejects(write(create()));for(const t of ['admin_work_items','admin_work_audit'])await assert.rejects(db.query('select * from rr_sandbox.'+t));}finally{await db.exec('reset role');}}
 await db.exec('set role service_role');try{assert.equal((await rpc('rr_test_admin_work_list',[S,S])).test,true);await assert.rejects(db.query('select * from rr_sandbox.admin_work_items'));await assert.rejects(db.query('select * from rr_sandbox.admin_work_audit'));}finally{await db.exec('reset role');}
 await assert.rejects(db.query("update rr_sandbox.admin_work_audit set operation='update' where request_id=$1",[c.requestId]),/append only/);await assert.rejects(db.query('delete from rr_sandbox.admin_work_audit where request_id=$1',[c.requestId]),/append only/);await assert.rejects(db.exec('truncate rr_sandbox.admin_work_audit'),/append only/);
 const rls=(await db.query("select relrowsecurity from pg_class where oid in ('rr_sandbox.admin_work_items'::regclass,'rr_sandbox.admin_work_audit'::regclass)")).rows;assert.equal(rls.length,2);assert.ok(rls.every(r=>r.relrowsecurity));
});
test('work lists are bounded, provide explicit missing coverage and cannot be confused with financial case completion',async()=>{
 for(let n=0;n<26;n++)await write(create({service:'shippo',title:'Practice follow-up '+n,status:n%2?'complete':'waiting'}));const data=list(await rpc('rr_test_admin_work_list',[S,S]));assert.equal(data.items.length,25);assert.equal(data.hasMore,true);assert.equal(data.releaseEnabled,false);assert.equal(data.live,false);assert.equal(Object.hasOwn(data,'cases'),false);
 assert.match(data.nextCursor,/^[A-Za-z0-9_-]{1,256}$/);const after=cursor(data.nextCursor),second=list(await rpc('rr_test_admin_work_list',[S,S,after.updatedAt,after.id]),{cursor:data.nextCursor});assert.equal(second.hasMore,false);assert.equal(second.nextCursor,null);assert.ok(second.items.every(i=>!data.items.some(first=>first.id===i.id)));assert.equal(data.items.length+second.items.length,(await db.query('select count(*)::int n from rr_sandbox.admin_work_items where owner_id=$1',[S])).rows[0].n);
 await assert.rejects(rpc('rr_test_admin_work_list',[S,S,after.updatedAt,null]),/Bounded private work page/);
 const noReceipt=receipt(await rpc('rr_test_admin_work_receipt',[S,S,id(999999)]),{requestId:id(999999)});assert.equal(noReceipt.state,'unconfirmed');assert.equal(Object.hasOwn(noReceipt,'saved'),false);
});
test('invalid commands and financial fields fail atomically before a private work item or audit is written',async()=>{
 const before=await financial();for(const patch of [{releaseEnabled:true},{version:null},{service:'ccp'},{status:'released'},{title:'x'.repeat(121)},{note:'x'.repeat(2001)},{title:' hidden'},{operation:'refund'},{title:'bad\nheading'}]){const c=create(patch);await assert.rejects(write(c));assert.equal((await db.query('select count(*)::int n from rr_sandbox.admin_work_audit where request_id=$1',[c.requestId])).rows[0].n,0);}assert.deepEqual(await financial(),before);
});
