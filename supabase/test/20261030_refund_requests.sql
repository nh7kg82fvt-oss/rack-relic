-- ISOLATED STAGING ONLY. Apply after refund_receipts. Not applied remotely.
-- Durable operator requests; only a backend-authenticated configured operator
-- may invoke these service-role RPCs. No browser has table/function grants.
begin;
create table rr_sandbox.refund_requests (
 id uuid primary key,
 order_id uuid not null references rr_sandbox.orders(id),
 actor_id uuid not null,
 payment_intent_id text not null check(payment_intent_id ~ '^pi_[A-Za-z0-9]+$'),
 amount_cents bigint not null check(amount_cents between 1 and 30000000),
 total_cents bigint not null check(total_cents between 1 and 30000000),
 phase text not null default 'prepared' check(phase in ('prepared','dispatched','known')),
 refund_id text unique check(refund_id ~ '^re_[A-Za-z0-9]+$'),
 charge_id text check(charge_id ~ '^ch_[A-Za-z0-9]+$'),
 created_at timestamptz not null default now(),
 dispatched_at timestamptz,
 updated_at timestamptz not null default now(),
 check((phase='known')=(refund_id is not null and charge_id is not null)),
 check(amount_cents<=total_cents)
);
alter table rr_sandbox.refund_requests enable row level security;
revoke all on rr_sandbox.refund_requests from public,anon,authenticated;

-- Count provider receipts once and reserve room for requests whose receipt has
-- not arrived. An unknown POST outcome never frees its reserved refund amount.
create function rr_sandbox.refund_committed_cents(p_order uuid) returns bigint
language sql set search_path=rr_sandbox,pg_temp as $$
 select coalesce((select sum(amount_cents) from refunds where order_id=p_order and status in ('succeeded','pending','requires_action')),0)
 +coalesce((select sum(q.amount_cents) from refund_requests q where q.order_id=p_order
  and not exists(select 1 from refunds r where r.id=q.refund_id)),0);
$$;
revoke all on function rr_sandbox.refund_committed_cents(uuid) from public,anon,authenticated;

create function public.rr_test_prepare_refund(p_request uuid,p_order uuid,p_actor uuid,p_amount bigint) returns jsonb
language plpgsql security definer set search_path=rr_sandbox,pg_temp as $$
declare o orders; q refund_requests; listing uuid;
begin
 if p_request is null or p_actor is null or p_amount is null or p_amount not between 1 and 30000000 then raise exception 'Invalid refund request'; end if;
 select listing_id into listing from orders where id=p_order;
 if listing is null then raise exception 'Unknown order'; end if;
 perform 1 from catalog where id=listing for update;
 select * into o from orders where id=p_order for update;
 if p_actor not in (o.buyer_id,o.seller_id) then raise exception 'Order access denied'; end if;
 select * into q from refund_requests where id=p_request for update;
 if found then
  if q.order_id<>p_order or q.actor_id<>p_actor or q.amount_cents<>p_amount then raise exception 'Refund request identity mismatch'; end if;
  return to_jsonb(q);
 end if;
 if o.state not in ('paid','review') or o.payment_intent_id is null then raise exception 'Verified paid order required'; end if;
 if o.refund_state='review' then raise exception 'Refund reconciliation required'; end if;
 if exists(select 1 from refund_requests rq where rq.order_id=p_order
  and not exists(select 1 from refunds r where r.id=rq.refund_id)) then raise exception 'Existing refund request needs confirmation'; end if;
 if refund_committed_cents(p_order)+p_amount>(o.snapshot->>'totalCents')::bigint then raise exception 'Refund exceeds available amount'; end if;
 insert into refund_requests(id,order_id,actor_id,payment_intent_id,amount_cents,total_cents)
  values(p_request,p_order,p_actor,o.payment_intent_id,p_amount,(o.snapshot->>'totalCents')::bigint) returning * into q;
 update orders set risk_status=case when risk_status='blocked' then 'blocked' else 'review' end,updated_at=now() where id=o.id;
 update jobs set state='held' where order_id=o.id and state in ('pending','leased')
  and kind in ('record_tax_transaction','fraud_assessment','prepare_test_label','buyer_receipt','seller_sale_notice');
 insert into jobs(order_id,kind,state) values(o.id,'manual_refund_review','pending')
  on conflict(order_id,kind) do update set state='pending';
 return to_jsonb(q);
end $$;

create function public.rr_test_get_refund_request(p_request uuid,p_actor uuid) returns jsonb
language plpgsql security definer set search_path=rr_sandbox,pg_temp as $$
declare q refund_requests;
begin
 select * into q from refund_requests where id=p_request;
 if not found or p_actor is null or q.actor_id<>p_actor then raise exception 'Refund access denied'; end if;
 return to_jsonb(q);
end $$;

create function public.rr_test_dispatch_refund(p_request uuid,p_actor uuid) returns jsonb
language plpgsql security definer set search_path=rr_sandbox,pg_temp as $$
declare q refund_requests; o orders; listing uuid; oid uuid;
begin
 select rq.order_id,ord.listing_id into oid,listing from refund_requests rq join orders ord on ord.id=rq.order_id where rq.id=p_request;
 if oid is null then raise exception 'Unknown refund request'; end if;
 perform 1 from catalog where id=listing for update;
 select * into o from orders where id=oid for update;
 select * into q from refund_requests where id=p_request for update;
 if p_actor is null or q.actor_id<>p_actor then raise exception 'Refund access denied'; end if;
 if q.phase<>'prepared' then return jsonb_build_object('dispatch',false,'request',to_jsonb(q)); end if;
 if o.state not in ('paid','review') or o.payment_intent_id is distinct from q.payment_intent_id
  or o.refund_state='review' or refund_committed_cents(oid)>q.total_cents then raise exception 'Refund reconciliation required'; end if;
 update refund_requests set phase='dispatched',dispatched_at=now(),updated_at=now() where id=p_request returning * into q;
 return jsonb_build_object('dispatch',true,'request',to_jsonb(q));
end $$;

create function public.rr_test_save_refund(p_request uuid,p_actor uuid,p_refund text,p_charge text) returns jsonb
language plpgsql security definer set search_path=rr_sandbox,pg_temp as $$
declare q refund_requests; r refunds; listing uuid; oid uuid;
begin
 if p_refund is null or p_refund !~ '^re_[A-Za-z0-9]+$' or p_charge is null or p_charge !~ '^ch_[A-Za-z0-9]+$' then raise exception 'Invalid refund identity'; end if;
 select rq.order_id,ord.listing_id into oid,listing from refund_requests rq join orders ord on ord.id=rq.order_id where rq.id=p_request;
 if oid is null then raise exception 'Unknown refund request'; end if;
 perform 1 from catalog where id=listing for update;
 perform 1 from orders where id=oid for update;
 select * into q from refund_requests where id=p_request for update;
 if p_actor is null or q.actor_id<>p_actor then raise exception 'Refund access denied'; end if;
 if q.phase='prepared' then raise exception 'Refund was not dispatched'; end if;
 if q.phase='known' and (q.refund_id<>p_refund or q.charge_id<>p_charge) then raise exception 'Refund identity mismatch'; end if;
 select * into r from refunds where id=p_refund;
 if found and (r.order_id<>oid or r.amount_cents<>q.amount_cents or r.payment_intent_id<>q.payment_intent_id or r.charge_id<>p_charge)
  then raise exception 'Refund receipt mismatch'; end if;
 update refund_requests set phase='known',refund_id=p_refund,charge_id=p_charge,updated_at=now() where id=p_request returning * into q;
 return to_jsonb(q);
end $$;

-- Signed metadata may associate a receipt with a pre-existing dispatched
-- request only after matching the order's PaymentIntent and frozen amount.
-- This recovers a lost POST response; metadata never creates a paid order.
create function public.rr_test_process_refund_receipt(p_event text,p_payload_hash text,p_type text,p_refund text,
 p_payment_intent text,p_charge text,p_amount bigint,p_currency text,p_status text,p_created bigint,p_request uuid) returns jsonb
language plpgsql security definer set search_path=rr_sandbox,pg_temp as $$
declare q refund_requests; o orders; listing uuid; result jsonb;
begin
 select * into o from orders where payment_intent_id=p_payment_intent;
 if not found then raise exception 'Refund payment binding not yet available'; end if;
 perform 1 from catalog where id=o.listing_id for update;
 perform 1 from orders where id=o.id for update;
 if p_request is not null then
  select * into q from refund_requests where id=p_request for update;
  if not found then raise exception 'Refund request receipt mismatch'; end if;
 else
  select * into q from refund_requests where refund_id=p_refund for update;
 end if;
 if q.id is not null then
  if q.phase='prepared' or q.order_id<>o.id or q.payment_intent_id<>p_payment_intent or q.amount_cents<>p_amount
   or q.refund_id is not null and q.refund_id<>p_refund or q.charge_id is not null and q.charge_id<>p_charge
   then raise exception 'Refund request receipt mismatch'; end if;
 end if;
 result:=public.rr_test_process_refund(p_event,p_payload_hash,p_type,p_refund,p_payment_intent,p_charge,p_amount,p_currency,p_status,p_created);
 if q.id is not null then
  update refund_requests set phase='known',refund_id=p_refund,charge_id=p_charge,updated_at=now() where id=q.id;
 end if;
 return result;
end $$;
revoke all on function public.rr_test_prepare_refund(uuid,uuid,uuid,bigint) from public,anon,authenticated;
revoke all on function public.rr_test_get_refund_request(uuid,uuid) from public,anon,authenticated;
revoke all on function public.rr_test_dispatch_refund(uuid,uuid) from public,anon,authenticated;
revoke all on function public.rr_test_save_refund(uuid,uuid,text,text) from public,anon,authenticated;
revoke all on function public.rr_test_process_refund_receipt(text,text,text,text,text,text,bigint,text,text,bigint,uuid) from public,anon,authenticated;
grant execute on function public.rr_test_prepare_refund(uuid,uuid,uuid,bigint) to service_role;
grant execute on function public.rr_test_get_refund_request(uuid,uuid) to service_role;
grant execute on function public.rr_test_dispatch_refund(uuid,uuid) to service_role;
grant execute on function public.rr_test_save_refund(uuid,uuid,text,text) to service_role;
grant execute on function public.rr_test_process_refund_receipt(text,text,text,text,text,text,bigint,text,text,bigint,uuid) to service_role;
commit;
