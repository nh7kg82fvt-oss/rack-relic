-- ISOLATED TEST DATABASE ONLY. This owns a separate synthetic catalog and
-- does not alter public.listings, production auth, Storage or existing RLS.
-- Apply via an authorized migration after reviewing the target project.
-- RPCs are server-role-only; they never accept browser financial writes.
begin;
create schema if not exists rr_sandbox;
revoke all on schema rr_sandbox from public, anon, authenticated;

create table rr_sandbox.catalog (
 id uuid primary key,
 seller_id uuid not null,
 title text not null check(length(title) between 3 and 100),
 price_cents bigint not null check(price_cents between 100 and 10000000),
 status text not null default 'published' check(status in ('published','sold','archived')),
 moderation_status text not null default 'active' check(moderation_status in ('active','hidden')),
 version bigint not null default 1,
 updated_at timestamptz not null default now(),
 sold_order_id uuid,
 test boolean not null default true check(test)
);
create table rr_sandbox.orders (
 id uuid primary key,
 listing_id uuid not null references rr_sandbox.catalog(id),
 buyer_id uuid not null,
 seller_id uuid not null,
 listing_version bigint not null,
 listing_updated_at timestamptz not null,
 item_cents bigint not null,
 buyer_fee_cents bigint not null,
 state text not null check(state in ('reserved','checkout_open','paid','expired','review')),
 risk_status text not null default 'pending' check(risk_status in ('pending','clear','review','blocked')),
 session_id text unique check(session_id ~ '^cs_test_[A-Za-z0-9]+$'),
 snapshot jsonb,
 tax_calculation_id text,
 destination_hash text,
 shipping_rate_id text,
 expires_at timestamptz,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 test boolean not null default true check(test),
 check(buyer_id <> seller_id),
 check(item_cents between 100 and 10000000),
 check(buyer_fee_cents = (item_cents * 4 + 50) / 100)
);
-- A timed-out local clock is NOT authority to release an open provider session.
-- Only verified provider expiry or a separately reviewed reconciliation can.
create unique index rr_test_one_claim on rr_sandbox.orders(listing_id)
 where state in ('reserved','checkout_open','paid');
create table rr_sandbox.provider_events (
 id text primary key check(id ~ '^evt_[A-Za-z0-9]+$'),
 payload_hash text not null check(payload_hash ~ '^[0-9a-f]{64}$'),
 order_id uuid not null references rr_sandbox.orders(id),
 event_type text not null,
 processed_at timestamptz not null default now()
);
create table rr_sandbox.ledger_entries (
 order_id uuid not null references rr_sandbox.orders(id),
 kind text not null,
 amount_cents bigint not null,
 currency text not null default 'USD' check(currency = 'USD'),
 primary key(order_id,kind)
);
create table rr_sandbox.jobs (
 order_id uuid not null references rr_sandbox.orders(id),
 kind text not null,
 state text not null default 'pending' check(state in ('held','pending','leased','done','uncertain','failed')),
 attempts integer not null default 0,
 provider_reference text,
 primary key(order_id,kind)
);
create table rr_sandbox.risk_assessments (
 order_id uuid not null references rr_sandbox.orders(id),
 charge_id text not null check(charge_id ~ '^ch_[A-Za-z0-9]+$'),
 evidence_hash text not null check(evidence_hash ~ '^[0-9a-f]{64}$'),
 decision text not null check(decision in ('clear','review','blocked')),
 reason_codes jsonb not null check(jsonb_typeof(reason_codes)='array'),
 checked_at timestamptz not null,
 primary key(order_id,evidence_hash)
);
alter table rr_sandbox.catalog enable row level security;
alter table rr_sandbox.orders enable row level security;
alter table rr_sandbox.provider_events enable row level security;
alter table rr_sandbox.ledger_entries enable row level security;
alter table rr_sandbox.jobs enable row level security;
alter table rr_sandbox.risk_assessments enable row level security;
revoke all on all tables in schema rr_sandbox from public, anon, authenticated;

create function rr_sandbox.guard_catalog() returns trigger
language plpgsql set search_path=rr_sandbox,pg_temp as $$
begin
 if exists(select 1 from orders where listing_id=old.id and state in ('reserved','checkout_open','paid')) then
  -- Only the paid-event transaction may perform the one-way sold transition.
  if not (new.status='sold' and old.status='published' and new.sold_order_id is not null
   and exists(select 1 from orders where id=new.sold_order_id and listing_id=old.id and state='paid')
   and new.seller_id=old.seller_id and new.price_cents=old.price_cents and new.title=old.title
   and new.moderation_status=old.moderation_status and new.version=old.version) then
   raise exception 'Reserved or paid listing cannot be edited';
  end if;
 end if;
 if new.price_cents<>old.price_cents or new.status<>old.status or new.moderation_status<>old.moderation_status
  or new.title<>old.title or new.seller_id<>old.seller_id then new.version:=old.version+1;new.updated_at:=now(); end if;
 return new;
end $$;
create trigger rr_test_catalog_guard before update on rr_sandbox.catalog
 for each row execute function rr_sandbox.guard_catalog();

create function public.rr_test_reserve(p_order uuid,p_listing uuid,p_buyer uuid) returns jsonb
language plpgsql security definer set search_path=rr_sandbox,pg_temp as $$
declare l catalog; o orders;
begin
 select * into l from catalog where id=p_listing for update;
 if not found then raise exception 'Listing unavailable'; end if;
 select * into o from orders where id=p_order;
 if found then
  if o.buyer_id<>p_buyer or o.listing_id<>p_listing then raise exception 'Order identity mismatch'; end if;
  return to_jsonb(o);
 end if;
 if l.status<>'published' or l.moderation_status<>'active' or l.seller_id=p_buyer then raise exception 'Listing unavailable'; end if;
 if exists(select 1 from orders where listing_id=l.id and state in ('reserved','checkout_open','paid')) then raise exception 'Listing already reserved'; end if;
 insert into orders(id,listing_id,buyer_id,seller_id,listing_version,listing_updated_at,item_cents,buyer_fee_cents,state)
 values(p_order,l.id,p_buyer,l.seller_id,l.version,l.updated_at,l.price_cents,(l.price_cents*4+50)/100,'reserved') returning * into o;
 return to_jsonb(o);
end $$;

create function public.rr_test_attach_checkout(p_order uuid,p_session text,p_snapshot jsonb,
 p_tax_calculation text,p_destination_hash text,p_shipping_rate text,p_expires timestamptz) returns jsonb
language plpgsql security definer set search_path=rr_sandbox,pg_temp as $$
declare l catalog; o orders; listing uuid; shipping bigint; tax bigint; total bigint;
begin
 select listing_id into listing from orders where id=p_order;
 if listing is null then raise exception 'Unknown order'; end if;
 select * into l from catalog where id=listing for update;
 select * into o from orders where id=p_order for update;
 if o.state='checkout_open' and o.session_id=p_session and o.snapshot=p_snapshot then return to_jsonb(o); end if;
 if o.state<>'reserved' or l.version<>o.listing_version or l.status<>'published' or l.moderation_status<>'active'
  then raise exception 'Reservation is not eligible'; end if;
 if p_session !~ '^cs_test_[A-Za-z0-9]+$' or p_tax_calculation !~ '^taxcalc_[A-Za-z0-9]+$'
  or p_destination_hash !~ '^[0-9a-f]{64}$' or p_shipping_rate !~ '^[a-f0-9]{32}$'
  or p_session is null or p_tax_calculation is null or p_destination_hash is null or p_shipping_rate is null
  or p_expires is null or p_expires<=now() then raise exception 'Invalid checkout evidence'; end if;
 if p_snapshot is null or jsonb_typeof(p_snapshot)<>'object' or (p_snapshot->'test') is distinct from 'true'::jsonb
  or (p_snapshot->>'orderId') is distinct from o.id::text or (p_snapshot->>'listingId') is distinct from o.listing_id::text
  or (p_snapshot->>'sellerId') is distinct from o.seller_id::text or (p_snapshot->>'currency') is distinct from 'USD'
  then raise exception 'Snapshot identity mismatch'; end if;
 if not (p_snapshot ?& array['test','orderId','listingId','sellerId','currency','itemCents','buyerFeeCents','shippingCents','taxCents','totalCents'])
  then raise exception 'Incomplete snapshot'; end if;
 if exists(select 1 from jsonb_each(p_snapshot) where key in ('itemCents','buyerFeeCents','shippingCents','taxCents','totalCents') and (jsonb_typeof(value)<>'number' or value::text !~ '^[0-9]+$')) then raise exception 'Invalid amounts'; end if;
 shipping:=(p_snapshot->>'shippingCents')::bigint; tax:=(p_snapshot->>'taxCents')::bigint; total:=(p_snapshot->>'totalCents')::bigint;
 if (p_snapshot->>'itemCents')::bigint<>o.item_cents or (p_snapshot->>'buyerFeeCents')::bigint<>o.buyer_fee_cents
  or shipping not between 0 and 100000 or tax not between 0 and 10000000
  or total<>o.item_cents+o.buyer_fee_cents+shipping+tax then raise exception 'Snapshot amount mismatch'; end if;
 update orders set state='checkout_open',session_id=p_session,snapshot=p_snapshot,tax_calculation_id=p_tax_calculation,
  destination_hash=p_destination_hash,shipping_rate_id=p_shipping_rate,expires_at=p_expires,updated_at=now()
 where id=o.id returning * into o;
 return to_jsonb(o);
end $$;

create function public.rr_test_process_event(p_event text,p_payload_hash text,p_type text,p_order uuid,
 p_session text,p_amount bigint,p_currency text,p_paid boolean) returns jsonb
language plpgsql security definer set search_path=rr_sandbox,pg_temp as $$
declare o orders; l catalog; e provider_events; listing uuid;
begin
 -- Caller MUST verify raw-body signature + test-mode event before this RPC.
 if p_event is null or p_event !~ '^evt_[A-Za-z0-9]+$' or p_payload_hash is null or p_payload_hash !~ '^[0-9a-f]{64}$'
  or p_type not in ('checkout.session.completed','checkout.session.async_payment_succeeded','checkout.session.expired')
  or p_type is null or p_paid is null then raise exception 'Unsupported event'; end if;
 select listing_id into listing from orders where id=p_order;
 if listing is null then raise exception 'Unknown order'; end if;
 select * into l from catalog where id=listing for update;
 select * into o from orders where id=p_order for update;
 if o.session_id is null or p_session is null or o.session_id<>p_session then raise exception 'Checkout session mismatch'; end if;
 if p_currency is null or p_currency<>'usd' or p_amount is null or p_amount<>(o.snapshot->>'totalCents')::bigint then raise exception 'Payment amount mismatch'; end if;
 select * into e from provider_events where id=p_event;
 if found then
  if e.payload_hash<>p_payload_hash or e.order_id<>p_order or e.event_type<>p_type then raise exception 'Event ID collision'; end if;
  return jsonb_build_object('duplicate',true,'state',o.state);
 end if;
 insert into provider_events(id,payload_hash,order_id,event_type) values(p_event,p_payload_hash,p_order,p_type);
 if p_type='checkout.session.expired' then
  if o.state='checkout_open' then update orders set state='expired',updated_at=now() where id=o.id returning * into o; end if;
 elsif p_paid and o.state not in ('paid','review') then
  if l.sold_order_id is not null or exists(select 1 from orders where listing_id=l.id and id<>o.id and state in ('reserved','checkout_open','paid')) then
   update orders set state='review',updated_at=now() where id=o.id returning * into o;
   insert into ledger_entries(order_id,kind,amount_cents) values(o.id,'gross_receivable',p_amount),(o.id,'unallocated_payment',-p_amount);
   insert into jobs(order_id,kind) values(o.id,'manual_payment_review');
  else
   update orders set state='paid',updated_at=now() where id=o.id returning * into o;
   update catalog set status='sold',sold_order_id=o.id where id=l.id;
   insert into ledger_entries(order_id,kind,amount_cents) values
    (o.id,'gross_receivable',p_amount),(o.id,'seller_item_liability',-o.item_cents),
    (o.id,'buyer_fee_revenue',-o.buyer_fee_cents),(o.id,'tax_liability',-(o.snapshot->>'taxCents')::bigint),
    (o.id,'postage_liability',-(o.snapshot->>'shippingCents')::bigint);
   -- Explicit pending jobs; neither insertion nor a paid event sends money.
   insert into jobs(order_id,kind,state) values(o.id,'record_tax_transaction','pending'),(o.id,'fraud_assessment','pending'),
    (o.id,'prepare_test_label','held'),(o.id,'buyer_receipt','pending'),(o.id,'seller_sale_notice','held');
  end if;
 end if;
 return jsonb_build_object('duplicate',false,'state',o.state);
end $$;

-- Only the backend verifies the bearer token and passes that user's UUID.
create function public.rr_test_member_orders(p_member uuid) returns jsonb
language sql security definer set search_path=rr_sandbox,pg_temp as $$
 select coalesce(jsonb_agg(x),'[]'::jsonb) from (
  select id,listing_id,buyer_id,seller_id,state,risk_status,item_cents,buyer_fee_cents,
   snapshot->'shippingCents' as shipping_cents,snapshot->'taxCents' as tax_cents,
   snapshot->'totalCents' as total_cents,created_at,updated_at
  from orders where buyer_id=p_member or seller_id=p_member order by created_at desc limit 100
 ) x;
$$;

create function public.rr_test_record_risk(p_order uuid,p_evidence jsonb,p_hash text) returns jsonb
language plpgsql security definer set search_path=rr_sandbox,pg_temp as $$
declare o orders; decision text; checked timestamptz; reasons jsonb;
begin
 if p_evidence is null or (p_evidence->'test') is distinct from 'true'::jsonb
  or (p_evidence->>'orderId') is distinct from p_order::text
  or (p_evidence->>'chargeId') is null or (p_evidence->>'chargeId') !~ '^ch_[A-Za-z0-9]+$'
  or p_hash is null or p_hash !~ '^[0-9a-f]{64}$' then raise exception 'Invalid risk evidence'; end if;
 decision:=p_evidence->>'decision';
 reasons:=coalesce(p_evidence->'reasonCodes','[]'::jsonb);
 if jsonb_typeof(reasons) is distinct from 'array' then raise exception 'Invalid risk reasons'; end if;
 if exists(select 1 from jsonb_array_elements(reasons) r where jsonb_typeof(r)<>'string' or (r#>>'{}') !~ '^[a-z_]{1,80}$')
  or jsonb_array_length(reasons)>20 then raise exception 'Invalid risk reasons'; end if;
 if decision='clear' and jsonb_array_length(reasons)>0 then raise exception 'Conflicting risk evidence'; end if;
 if decision is null or decision not in ('clear','review','blocked') or jsonb_typeof(p_evidence->'checkedAt') is distinct from 'number'
  then raise exception 'Invalid risk decision'; end if;
 checked:=to_timestamp((p_evidence->>'checkedAt')::numeric/1000);
 if checked<now()-interval '5 minutes' or checked>now()+interval '30 seconds' then raise exception 'Stale risk evidence'; end if;
 select * into o from orders where id=p_order for update;
 if not found or o.state<>'paid' then raise exception 'Order is not paid'; end if;
 if exists(select 1 from risk_assessments where order_id=p_order and evidence_hash=p_hash) then return jsonb_build_object('duplicate',true,'risk_status',o.risk_status); end if;
 -- A previously held or blocked order needs an explicit operator workflow;
 -- later automated evidence cannot silently override the hold.
 if o.risk_status in ('review','blocked') and decision='clear' then raise exception 'Manual review required'; end if;
 if o.risk_status='blocked' then decision:='blocked'; end if;
 insert into risk_assessments(order_id,charge_id,evidence_hash,decision,reason_codes,checked_at)
 values(p_order,p_evidence->>'chargeId',p_hash,decision,reasons,checked);
 update orders set risk_status=decision,updated_at=now() where id=p_order;
 update jobs set state='done' where order_id=p_order and kind='fraud_assessment';
 if decision='clear' then
  update jobs set state='pending' where order_id=p_order and kind in ('prepare_test_label','seller_sale_notice') and state='held';
 else
  update jobs set state='held' where order_id=p_order and kind in ('prepare_test_label','seller_sale_notice') and state='pending';
  insert into jobs(order_id,kind) values(p_order,'manual_fraud_review') on conflict(order_id,kind) do update set state='pending';
 end if;
 return jsonb_build_object('duplicate',false,'risk_status',decision);
end $$;

revoke all on function public.rr_test_reserve(uuid,uuid,uuid) from public, anon, authenticated;
revoke all on function public.rr_test_attach_checkout(uuid,text,jsonb,text,text,text,timestamptz) from public, anon, authenticated;
revoke all on function public.rr_test_process_event(text,text,text,uuid,text,bigint,text,boolean) from public, anon, authenticated;
revoke all on function public.rr_test_member_orders(uuid) from public, anon, authenticated;
revoke all on function public.rr_test_record_risk(uuid,jsonb,text) from public, anon, authenticated;
grant usage on schema rr_sandbox to service_role;
grant execute on function public.rr_test_reserve(uuid,uuid,uuid) to service_role;
grant execute on function public.rr_test_attach_checkout(uuid,text,jsonb,text,text,text,timestamptz) to service_role;
grant execute on function public.rr_test_process_event(text,text,text,uuid,text,bigint,text,boolean) to service_role;
grant execute on function public.rr_test_member_orders(uuid) to service_role;
grant execute on function public.rr_test_record_risk(uuid,jsonb,text) to service_role;
commit;
