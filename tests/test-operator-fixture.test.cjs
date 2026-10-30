const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
test('separate operator fixture derives its seller and never resets completed fixture evidence',async()=>{
 const db=new PGlite(),original='73737373-7373-4373-8373-737373737373',fixture='84848484-8484-4484-8484-848484848484',seller='33333333-3333-4333-8333-333333333333';
 try{
  await db.exec('create role anon;create role authenticated;create role service_role;');await db.exec(fs.readFileSync(require.resolve('../supabase/test/20261030_order_ledger.sql'),'utf8'));
  await db.query("insert into rr_sandbox.catalog(id,seller_id,title,price_cents,status) values($1,$2,'Original fixture',2500,'sold')",[original,seller]);
  const sql=fs.readFileSync(require.resolve('../supabase/test/fixtures/operator_refund_jacket.sql'),'utf8');await db.exec(sql);
  const first=(await db.query('select seller_id,title,price_cents,status from rr_sandbox.catalog where id=$1',[fixture])).rows[0];assert.equal(first.seller_id,seller);assert.equal(first.price_cents,2500);assert.equal(first.status,'published');
  await db.query("update rr_sandbox.catalog set status='sold',sold_order_id='11111111-1111-4111-8111-111111111111' where id=$1",[fixture]);await db.exec(sql);
  const again=(await db.query('select status,sold_order_id from rr_sandbox.catalog where id=$1',[fixture])).rows[0];assert.equal(again.status,'sold');assert.equal(again.sold_order_id,'11111111-1111-4111-8111-111111111111');assert.equal((await db.query('select status from rr_sandbox.catalog where id=$1',[original])).rows[0].status,'sold');
  await db.query('update rr_sandbox.catalog set price_cents=2600 where id=$1',[fixture]);await assert.rejects(db.exec(sql),/does not match/);await db.exec('rollback');
 }finally{await db.close();}
});
