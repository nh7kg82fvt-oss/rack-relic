-- ISOLATED TEST DATABASE ONLY. Apply after 20261030_order_ledger.sql.
-- Delayed payments retain the item until a verified failure or success.
-- Local clocks and late expiry events cannot release a pending payment.
begin;
alter table rr_sandbox.orders drop constraint orders_state_check;
alter table rr_sandbox.orders add constraint orders_state_check
 check(state in ('reserved','checkout_open','payment_pending','paid','expired','payment_failed','review'));
-- Backfill any previously verified unpaid completion before changing claims.
update rr_sandbox.orders o set state='payment_pending'
 where state='checkout_open' and exists(select 1 from rr_sandbox.provider_events e
 where e.order_id=o.id and e.event_type='checkout.session.completed');
drop index rr_sandbox.rr_test_one_claim;
create unique index rr_test_one_claim on rr_sandbox.orders(listing_id)
 where state in ('reserved','checkout_open','payment_pending','paid');

create or replace function rr_sandbox.guard_catalog() returns trigger
language plpgsql set search_path=rr_sandbox,pg_temp as $$
begin
 if exists(select 1 from orders where listing_id=old.id and state in ('reserved','checkout_open','payment_pending','paid')) then
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

create or replace function public.rr_test_reserve(p_order uuid,p_listing uuid,p_buyer uuid) returns jsonb
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
 if exists(select 1 from orders where listing_id=l.id and state in ('reserved','checkout_open','payment_pending','paid')) then raise exception 'Listing already reserved'; end if;
 insert into orders(id,listing_id,buyer_id,seller_id,listing_version,listing_updated_at,item_cents,buyer_fee_cents,state)
 values(p_order,l.id,p_buyer,l.seller_id,l.version,l.updated_at,l.price_cents,(l.price_cents*4+50)/100,'reserved') returning * into o;
 return to_jsonb(o);
end $$;

create or replace function public.rr_test_process_event(p_event text,p_payload_hash text,p_type text,p_order uuid,
 p_session text,p_amount bigint,p_currency text,p_paid boolean) returns jsonb
language plpgsql security definer set search_path=rr_sandbox,pg_temp as $$
declare o orders; l catalog; e provider_events; listing uuid;
begin
 -- Caller MUST verify raw-body signature + test-mode event before this RPC.
 if p_event is null or p_event !~ '^evt_[A-Za-z0-9]+$' or p_payload_hash is null or p_payload_hash !~ '^[0-9a-f]{64}$'
  or p_type not in ('checkout.session.completed','checkout.session.async_payment_succeeded','checkout.session.async_payment_failed','checkout.session.expired')
  or p_type is null or p_paid is null then raise exception 'Unsupported event'; end if;
 if p_type in ('checkout.session.expired','checkout.session.async_payment_failed') and p_paid
  or p_type='checkout.session.async_payment_succeeded' and not p_paid then raise exception 'Conflicting payment evidence'; end if;
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
 elsif p_type='checkout.session.async_payment_failed' then
  if o.state in ('checkout_open','payment_pending') then update orders set state='payment_failed',updated_at=now() where id=o.id returning * into o; end if;
 elsif not p_paid then
  if o.state='checkout_open' then update orders set state='payment_pending',updated_at=now() where id=o.id returning * into o; end if;
 elsif p_paid and o.state not in ('paid','review') then
  if l.sold_order_id is not null or exists(select 1 from orders where listing_id=l.id and id<>o.id and state in ('reserved','checkout_open','payment_pending','paid')) then
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

-- CREATE OR REPLACE preserves the existing service-role-only grants.
commit;
