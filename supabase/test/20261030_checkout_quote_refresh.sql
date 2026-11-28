-- ISOLATED TEST DATABASE ONLY. Preserve every dispatched/unknown checkout.
begin;
create or replace function public.rr_test_prepare_checkout(p_order uuid,p_buyer uuid,p_input jsonb,p_snapshot jsonb,p_expires timestamptz) returns jsonb
language plpgsql security definer set search_path=rr_sandbox,pg_temp as $$
declare o orders; a checkout_attempts; shipping bigint; tax bigint;
begin
 select * into o from orders where id=p_order for update;
 if not found or o.buyer_id<>p_buyer or p_buyer is null then raise exception 'Order unavailable'; end if;
 select * into a from checkout_attempts where order_id=p_order for update;
 if found then
  -- Fresh quotes and all dispatched evidence stay immutable. A refresh is
  -- possible only when the database proves expiry before any dispatch marker.
  if a.phase<>'prepared' or a.dispatched_at is not null or a.session_id is not null
   or a.session_expires_at is not null or a.quote_expires_at>clock_timestamp()
   then return to_jsonb(a); end if;
  if (p_input->'shippingQuote'->>'destinationHash') is distinct from
   (a.input->'shippingQuote'->>'destinationHash') then raise exception 'Destination differs from saved checkout'; end if;
 end if;
 if o.state<>'reserved' or p_expires is null or p_expires<=clock_timestamp() or p_expires>clock_timestamp()+interval '30 minutes' then raise exception 'Reservation or quote expired'; end if;
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
 if (p_input->'shippingQuote'->'amountCents') is distinct from (p_snapshot->'shippingCents')
  or (p_input->'taxQuote'->'amountCents') is distinct from (p_snapshot->'taxCents')
  or (p_input->'taxQuote'->'baseCents') is distinct from to_jsonb(o.item_cents+o.buyer_fee_cents+shipping)
  or (p_snapshot->'baseCents') is distinct from to_jsonb(o.item_cents+o.buyer_fee_cents+shipping)
  or (p_input->'shippingQuote'->'test') is distinct from 'true'::jsonb
  or (p_input->'taxQuote'->'test') is distinct from 'true'::jsonb
  or (p_input->'shippingQuote'->>'orderId') is distinct from o.id::text
  or (p_input->'taxQuote'->>'orderId') is distinct from o.id::text
  or (p_input->'shippingQuote'->>'destinationHash') is null
  or (p_input->'shippingQuote'->>'destinationHash') !~ '^[a-f0-9]{64}$'
  or (p_input->'taxQuote'->>'destinationHash') is distinct from (p_input->'shippingQuote'->>'destinationHash')
  then raise exception 'Checkout quote evidence mismatch'; end if;
 -- Raw addresses and arbitrary browser fields do not belong in this record.
 if exists(select 1 from jsonb_object_keys(p_input) k where k not in ('orderId','buyerId','listing','shippingQuote','taxQuote')) then raise exception 'Unexpected checkout input'; end if;
 insert into checkout_attempts(order_id,input,snapshot,quote_expires_at) values(p_order,p_input,p_snapshot,p_expires)
 on conflict(order_id) do update set input=excluded.input,snapshot=excluded.snapshot,quote_expires_at=excluded.quote_expires_at
 returning * into a;
 return to_jsonb(a);
end $$;

create or replace function public.rr_test_dispatch_checkout(p_order uuid,p_buyer uuid) returns jsonb
language plpgsql security definer set search_path=rr_sandbox,pg_temp as $$
declare o orders; a checkout_attempts;
begin
 select * into o from orders where id=p_order for update;
 if not found or o.buyer_id<>p_buyer or p_buyer is null then raise exception 'Order unavailable'; end if;
 select * into a from checkout_attempts where order_id=p_order for update;
 if not found then raise exception 'Checkout not prepared'; end if;
 if a.phase<>'prepared' then return jsonb_build_object('dispatch',false,'attempt',to_jsonb(a)); end if;
 if a.dispatched_at is not null or a.session_id is not null or a.session_expires_at is not null then raise exception 'Checkout requires reconciliation'; end if;
 if o.state<>'reserved' or a.quote_expires_at<=clock_timestamp() then raise exception 'Checkout quote expired'; end if;
 update checkout_attempts set phase='dispatched',dispatched_at=now() where order_id=p_order returning * into a;
 return jsonb_build_object('dispatch',true,'attempt',to_jsonb(a));
end $$;

revoke all on function public.rr_test_prepare_checkout(uuid,uuid,jsonb,jsonb,timestamptz) from public,anon,authenticated;
revoke all on function public.rr_test_dispatch_checkout(uuid,uuid) from public,anon,authenticated;
grant execute on function public.rr_test_prepare_checkout(uuid,uuid,jsonb,jsonb,timestamptz) to service_role;
grant execute on function public.rr_test_dispatch_checkout(uuid,uuid) to service_role;
commit;
