-- ISOLATED TEST DATABASE ONLY, after payment_recovery.sql.
-- Store immutable quotes before contacting Stripe. A dispatched attempt is
-- never automatically dispatched again, even after its quote or lease expires.
begin;
create table rr_sandbox.checkout_attempts (
 order_id uuid primary key references rr_sandbox.orders(id),
 input jsonb not null check(jsonb_typeof(input)='object'),
 snapshot jsonb not null check(jsonb_typeof(snapshot)='object'),
 quote_expires_at timestamptz not null,
 phase text not null default 'prepared' check(phase in ('prepared','dispatched','attached')),
 session_id text unique check(session_id ~ '^cs_test_[A-Za-z0-9]+$'),
 session_expires_at timestamptz,
 created_at timestamptz not null default now(),
 dispatched_at timestamptz,
 test boolean not null default true check(test)
);
alter table rr_sandbox.checkout_attempts enable row level security;
revoke all on rr_sandbox.checkout_attempts from public,anon,authenticated;

create function public.rr_test_checkout_attempt(p_order uuid,p_buyer uuid) returns jsonb
language plpgsql security definer set search_path=rr_sandbox,pg_temp as $$
declare o orders; a checkout_attempts;
begin
 select * into o from orders where id=p_order;
 if not found or o.buyer_id<>p_buyer or p_buyer is null then raise exception 'Order unavailable'; end if;
 select * into a from checkout_attempts where order_id=p_order;
 return jsonb_build_object('order',to_jsonb(o),'attempt',case when found then to_jsonb(a) else null end);
end $$;

create function public.rr_test_prepare_checkout(p_order uuid,p_buyer uuid,p_input jsonb,p_snapshot jsonb,p_expires timestamptz) returns jsonb
language plpgsql security definer set search_path=rr_sandbox,pg_temp as $$
declare o orders; a checkout_attempts; shipping bigint; tax bigint;
begin
 select * into o from orders where id=p_order for update;
 if not found or o.buyer_id<>p_buyer or p_buyer is null then raise exception 'Order unavailable'; end if;
 select * into a from checkout_attempts where order_id=p_order;
 if found then
  -- First committed quote wins. A competing request cannot change the price.
  return to_jsonb(a);
 end if;
 if o.state<>'reserved' or p_expires is null or p_expires<=now() or p_expires>now()+interval '30 minutes' then raise exception 'Reservation or quote expired'; end if;
 if p_input is null or p_snapshot is null or jsonb_typeof(p_input)<>'object' or jsonb_typeof(p_snapshot)<>'object'
  or (p_input->>'orderId') is distinct from o.id::text or (p_input->>'buyerId') is distinct from o.buyer_id::text
  or (p_input->'listing'->>'id') is distinct from o.listing_id::text
  or (p_input->'listing'->>'seller_id') is distinct from o.seller_id::text
  or (p_input->'listing'->>'price_cents') is distinct from o.item_cents::text
  or (p_snapshot->'test') is distinct from 'true'::jsonb
  or (p_snapshot->>'orderId') is distinct from o.id::text or (p_snapshot->>'listingId') is distinct from o.listing_id::text
  or (p_snapshot->>'sellerId') is distinct from o.seller_id::text or (p_snapshot->>'currency') is distinct from 'USD'
  then raise exception 'Checkout identity mismatch'; end if;
 if not (p_snapshot ?& array['itemCents','buyerFeeCents','shippingCents','taxCents','totalCents'])
  or exists(select 1 from jsonb_each(p_snapshot) where key in ('itemCents','buyerFeeCents','shippingCents','taxCents','totalCents') and (jsonb_typeof(value)<>'number' or value::text !~ '^[0-9]+$')) then raise exception 'Invalid checkout amounts'; end if;
 shipping:=(p_snapshot->>'shippingCents')::bigint;tax:=(p_snapshot->>'taxCents')::bigint;
 if (p_snapshot->>'itemCents')::bigint<>o.item_cents or (p_snapshot->>'buyerFeeCents')::bigint<>o.buyer_fee_cents
  or shipping not between 0 and 100000 or tax not between 0 and 10000000
  or (p_snapshot->>'totalCents')::bigint<>o.item_cents+o.buyer_fee_cents+shipping+tax
  then raise exception 'Checkout amount mismatch'; end if;
 -- Raw addresses and arbitrary browser fields do not belong in this record.
 if exists(select 1 from jsonb_object_keys(p_input) k where k not in ('orderId','buyerId','listing','shippingQuote','taxQuote')) then raise exception 'Unexpected checkout input'; end if;
 insert into checkout_attempts(order_id,input,snapshot,quote_expires_at) values(p_order,p_input,p_snapshot,p_expires) returning * into a;
 return to_jsonb(a);
end $$;

create function public.rr_test_dispatch_checkout(p_order uuid,p_buyer uuid) returns jsonb
language plpgsql security definer set search_path=rr_sandbox,pg_temp as $$
declare o orders; a checkout_attempts;
begin
 select * into o from orders where id=p_order for update;
 if not found or o.buyer_id<>p_buyer or p_buyer is null then raise exception 'Order unavailable'; end if;
 select * into a from checkout_attempts where order_id=p_order for update;
 if not found then raise exception 'Checkout not prepared'; end if;
 if a.phase<>'prepared' then return jsonb_build_object('dispatch',false,'attempt',to_jsonb(a)); end if;
 if o.state<>'reserved' or a.quote_expires_at<=now() then raise exception 'Checkout quote expired'; end if;
 update checkout_attempts set phase='dispatched',dispatched_at=now() where order_id=p_order returning * into a;
 return jsonb_build_object('dispatch',true,'attempt',to_jsonb(a));
end $$;

create function public.rr_test_save_checkout_session(p_order uuid,p_buyer uuid,p_session text,p_expires timestamptz) returns jsonb
language plpgsql security definer set search_path=rr_sandbox,pg_temp as $$
declare o orders; a checkout_attempts;
begin
 select * into o from orders where id=p_order for update;
 if not found or o.buyer_id<>p_buyer or p_buyer is null then raise exception 'Order unavailable'; end if;
 select * into a from checkout_attempts where order_id=p_order for update;
 if not found or a.phase='prepared' or p_session is null or p_session !~ '^cs_test_[A-Za-z0-9]+$' or p_expires is null then raise exception 'Invalid session evidence'; end if;
 if a.session_id is not null and (a.session_id<>p_session or a.session_expires_at<>p_expires) then raise exception 'Session identity mismatch'; end if;
 update checkout_attempts set session_id=p_session,session_expires_at=p_expires where order_id=p_order returning * into a;
 return to_jsonb(a);
end $$;

create function public.rr_test_finish_checkout(p_order uuid,p_buyer uuid) returns jsonb
language plpgsql security definer set search_path=rr_sandbox,pg_temp as $$
declare o orders; a checkout_attempts; listing uuid;
begin
 -- Use the same catalog -> order lock order as reservation and webhooks.
 select listing_id into listing from orders where id=p_order;
 perform 1 from catalog where id=listing for update;
 select * into o from orders where id=p_order for update;
 if not found or o.buyer_id<>p_buyer or p_buyer is null then raise exception 'Order unavailable'; end if;
 select * into a from checkout_attempts where order_id=p_order for update;
 if not found or a.session_id is null then raise exception 'Session requires reconciliation'; end if;
 if a.phase='attached' then return to_jsonb(o); end if;
 perform public.rr_test_attach_checkout(p_order,a.session_id,a.snapshot,a.input->'taxQuote'->>'taxCalculationId',a.input->'shippingQuote'->>'destinationHash',a.input->'shippingQuote'->>'rateId',a.session_expires_at);
 update checkout_attempts set phase='attached' where order_id=p_order;
 select * into o from orders where id=p_order;
 return to_jsonb(o);
end $$;

revoke all on function public.rr_test_checkout_attempt(uuid,uuid) from public,anon,authenticated;
revoke all on function public.rr_test_prepare_checkout(uuid,uuid,jsonb,jsonb,timestamptz) from public,anon,authenticated;
revoke all on function public.rr_test_dispatch_checkout(uuid,uuid) from public,anon,authenticated;
revoke all on function public.rr_test_save_checkout_session(uuid,uuid,text,timestamptz) from public,anon,authenticated;
revoke all on function public.rr_test_finish_checkout(uuid,uuid) from public,anon,authenticated;
grant execute on function public.rr_test_checkout_attempt(uuid,uuid) to service_role;
grant execute on function public.rr_test_prepare_checkout(uuid,uuid,jsonb,jsonb,timestamptz) to service_role;
grant execute on function public.rr_test_dispatch_checkout(uuid,uuid) to service_role;
grant execute on function public.rr_test_save_checkout_session(uuid,uuid,text,timestamptz) to service_role;
grant execute on function public.rr_test_finish_checkout(uuid,uuid) to service_role;
commit;
