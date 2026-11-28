-- ISOLATED STAGING ONLY. Apply after checkout_attempts. Not applied remotely.
-- Receipt/accounting only: no refund POST, transfer, tax reversal or relisting.
begin;
alter table rr_sandbox.orders
 add column payment_intent_id text unique check(payment_intent_id ~ '^pi_[A-Za-z0-9]+$'),
 add column refunded_cents bigint not null default 0 check(refunded_cents>=0),
 add column refund_pending_cents bigint not null default 0 check(refund_pending_cents>=0),
 add column refund_state text not null default 'none'
 check(refund_state in ('none','pending','partial','refunded','failed','review'));

create table rr_sandbox.refunds (
 id text primary key check(id ~ '^re_[A-Za-z0-9]+$'),
 order_id uuid not null references rr_sandbox.orders(id),
 payment_intent_id text not null check(payment_intent_id ~ '^pi_[A-Za-z0-9]+$'),
 charge_id text not null check(charge_id ~ '^ch_[A-Za-z0-9]+$'),
 amount_cents bigint not null check(amount_cents between 1 and 30000000),
 status text not null check(status in ('pending','requires_action','succeeded','failed','canceled')),
 event_created bigint not null check(event_created>0),
 needs_review boolean not null default false,
 updated_at timestamptz not null default now()
);
alter table rr_sandbox.refunds enable row level security;
revoke all on rr_sandbox.refunds from public,anon,authenticated;

-- Preserve the existing payment transaction and lock order (catalog -> order).
-- Only a signature-verified Checkout event can bind a PaymentIntent. Refund
-- metadata is never trusted to establish that relationship.
create function public.rr_test_process_payment_event(p_event text,p_payload_hash text,p_type text,p_order uuid,
 p_session text,p_amount bigint,p_currency text,p_paid boolean,p_payment_intent text) returns jsonb
language plpgsql security definer set search_path=rr_sandbox,pg_temp as $$
declare o orders; listing uuid; result jsonb;
begin
 if p_payment_intent is not null and p_payment_intent !~ '^pi_[A-Za-z0-9]+$'
  or p_paid and p_payment_intent is null then raise exception 'PaymentIntent required'; end if;
 select listing_id into listing from orders where id=p_order;
 if listing is null then raise exception 'Unknown order'; end if;
 perform 1 from catalog where id=listing for update;
 select * into o from orders where id=p_order for update;
 if o.payment_intent_id is not null and p_payment_intent is not null and o.payment_intent_id<>p_payment_intent
  then raise exception 'PaymentIntent mismatch'; end if;
 result:=public.rr_test_process_event(p_event,p_payload_hash,p_type,p_order,p_session,p_amount,p_currency,p_paid);
 if p_payment_intent is not null then
  update orders set payment_intent_id=p_payment_intent where id=p_order;
 end if;
 return result;
end $$;

create function public.rr_test_process_refund(p_event text,p_payload_hash text,p_type text,p_refund text,
 p_payment_intent text,p_charge text,p_amount bigint,p_currency text,p_status text,p_created bigint) returns jsonb
language plpgsql security definer set search_path=rr_sandbox,pg_temp as $$
declare o orders; r refunds; e provider_events; listing uuid; oid uuid; known boolean;
 delta bigint:=0; confirmed bigint; outstanding bigint; conflict boolean:=false; next_state text;
begin
 -- Caller verifies raw bytes, timestamp, test account and event livemode.
 if p_event is null or p_event !~ '^evt_[A-Za-z0-9]+$' or p_payload_hash is null or p_payload_hash !~ '^[0-9a-f]{64}$'
  or p_type is null or p_type not in ('refund.created','refund.updated','refund.failed')
  or p_refund is null or p_refund !~ '^re_[A-Za-z0-9]+$'
  or p_payment_intent is null or p_payment_intent !~ '^pi_[A-Za-z0-9]+$'
  or p_charge is null or p_charge !~ '^ch_[A-Za-z0-9]+$'
  or p_amount is null or p_amount not between 1 and 30000000 or p_currency is distinct from 'usd'
  or p_status is null or p_status not in ('pending','requires_action','succeeded','failed','canceled')
  or p_created is null or p_created<=0 or p_created>extract(epoch from now())+30
  or p_type='refund.failed' and p_status<>'failed' then raise exception 'Invalid refund evidence'; end if;
 select id,listing_id into oid,listing from orders where payment_intent_id=p_payment_intent;
 -- A refund can precede the paid notification. Retry; do not discard it or
 -- create an order from refund metadata, and never guess a PaymentIntent.
 if oid is null then raise exception 'Refund payment binding not yet available'; end if;
 perform 1 from catalog where id=listing for update;
 select * into o from orders where id=oid for update;
 if o.state not in ('paid','review') then raise exception 'Paid order evidence not yet available'; end if;
 if p_amount>(o.snapshot->>'totalCents')::bigint then raise exception 'Refund exceeds order total'; end if;
 select * into e from provider_events where id=p_event;
 if found then
  if e.payload_hash<>p_payload_hash or e.order_id<>o.id or e.event_type<>p_type then raise exception 'Event ID collision'; end if;
  return jsonb_build_object('duplicate',true,'state',o.refund_state);
 end if;
 select * into r from refunds where id=p_refund for update;known:=found;
 if known and (r.order_id<>o.id or r.payment_intent_id<>p_payment_intent or r.charge_id<>p_charge or r.amount_cents<>p_amount)
  then raise exception 'Refund identity mismatch'; end if;
 insert into provider_events(id,payload_hash,order_id,event_type) values(p_event,p_payload_hash,o.id,p_type);
 if known and p_created<r.event_created then
  return jsonb_build_object('duplicate',false,'state',o.refund_state,'stale',true);
 end if;
 -- Event timestamps are second-resolution, so conflicting statuses in the
 -- same second cannot establish order. Hold for fresh provider reconciliation.
 -- A succeeded refund can later fail. No other terminal regression is assumed.
 conflict:=known and (r.needs_review
  or p_created=r.event_created and p_status<>r.status
  or r.status in ('failed','canceled') and p_status<>r.status
  or r.status='succeeded' and p_status not in ('succeeded','failed'));
 if conflict then
  update refunds set needs_review=true,updated_at=now() where id=p_refund;
 else
  delta:=(case when p_status='succeeded' then p_amount else 0 end)
        -(case when known and r.status='succeeded' then r.amount_cents else 0 end);
  if known then
   update refunds set status=p_status,event_created=p_created,updated_at=now() where id=p_refund;
  else
   -- A concurrent attempt to bind the same refund to a different order must
   -- fail on the unique key, never update the winner's row through an UPSERT.
   insert into refunds(id,order_id,payment_intent_id,charge_id,amount_cents,status,event_created)
    values(p_refund,o.id,p_payment_intent,p_charge,p_amount,p_status,p_created);
  end if;
 end if;
 select coalesce(sum(amount_cents) filter(where status='succeeded'),0),
        coalesce(sum(amount_cents) filter(where status in ('pending','requires_action')),0)
  into confirmed,outstanding from refunds where order_id=o.id;
 if confirmed+outstanding>(o.snapshot->>'totalCents')::bigint then raise exception 'Aggregate refunds exceed order total'; end if;
 if delta<>0 then
  -- Append balanced suspense entries. No allocation to item/fee/tax/postage
  -- is invented for a partial refund. Later workers reconcile actual fees and
  -- tax reversals. Failure after success appends the opposite pair once.
  insert into ledger_entries(order_id,kind,amount_cents) values
   (o.id,'refund_outflow:'||p_event,-delta),(o.id,'refund_allocation_pending:'||p_event,delta);
 end if;
 next_state:=case
  when exists(select 1 from refunds where order_id=o.id and needs_review) then 'review'
  when outstanding>0 then 'pending'
  when confirmed=(o.snapshot->>'totalCents')::bigint then 'refunded'
  when confirmed>0 then 'partial' else 'failed' end;
 -- Keep purchase state and inventory unchanged even for a full refund. A
 -- physical return, relisting, tax reversal and payout decision need review.
 update orders set refunded_cents=confirmed,refund_pending_cents=outstanding,refund_state=next_state,
  risk_status=case when risk_status='blocked' then 'blocked' else 'review' end,updated_at=now() where id=o.id;
 update jobs set state='held' where order_id=o.id and state in ('pending','leased')
  and kind in ('record_tax_transaction','fraud_assessment','prepare_test_label','buyer_receipt','seller_sale_notice');
 insert into jobs(order_id,kind,state) values(o.id,'manual_refund_review','pending')
  on conflict(order_id,kind) do update set state='pending';
 if delta<>0 then
  insert into jobs(order_id,kind,state) values(o.id,'reconcile_refund_tax','held'),(o.id,'reconcile_refund_fees','held')
   on conflict(order_id,kind) do update set state='held';
 end if;
 return jsonb_build_object('duplicate',false,'state',next_state);
end $$;

create or replace function public.rr_test_member_orders(p_member uuid) returns jsonb
language sql security definer set search_path=rr_sandbox,pg_temp as $$
 select coalesce(jsonb_agg(x),'[]'::jsonb) from (
  select id,listing_id,buyer_id,seller_id,state,risk_status,item_cents,buyer_fee_cents,
   snapshot->'shippingCents' as shipping_cents,snapshot->'taxCents' as tax_cents,
   snapshot->'totalCents' as total_cents,refund_state,refunded_cents,refund_pending_cents,created_at,updated_at
  from orders where buyer_id=p_member or seller_id=p_member order by created_at desc limit 100
 ) x;
$$;
revoke all on function public.rr_test_process_payment_event(text,text,text,uuid,text,bigint,text,boolean,text) from public,anon,authenticated;
revoke all on function public.rr_test_process_refund(text,text,text,text,text,text,bigint,text,text,bigint) from public,anon,authenticated;
grant execute on function public.rr_test_process_payment_event(text,text,text,uuid,text,bigint,text,boolean,text) to service_role;
grant execute on function public.rr_test_process_refund(text,text,text,text,text,text,bigint,text,text,bigint) to service_role;
commit;
