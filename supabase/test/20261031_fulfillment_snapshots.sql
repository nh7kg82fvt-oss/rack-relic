-- ISOLATED STAGING ONLY. Private synthetic shipping evidence; no label executor.
begin;
create table rr_sandbox.fulfillment_quotes (
 order_id uuid not null references rr_sandbox.orders(id),
 rate_id text not null unique check(rate_id ~ '^[a-f0-9]{32}$'),
 snapshot jsonb not null check(jsonb_typeof(snapshot)='object'),
 recorded_at timestamptz not null default now(),
 primary key(order_id,rate_id)
);
alter table rr_sandbox.fulfillment_quotes enable row level security;
revoke all on rr_sandbox.fulfillment_quotes from public,anon,authenticated;

create function rr_sandbox.fulfillment_address_hash(a jsonb) returns text
language plpgsql immutable set search_path=rr_sandbox,pg_temp as $$
declare k text; canonical text;
begin
 if a is null or jsonb_typeof(a)<>'object' then raise exception 'Private address required'; end if;
 if not a ?& array['line1','city','state','postal_code','country'] or exists(select 1 from jsonb_object_keys(a) key where key not in ('line1','line2','city','state','postal_code','country')) then raise exception 'Invalid private address'; end if;
 foreach k in array array['line1','city','state','postal_code','country','line2'] loop
  if a ? k and (jsonb_typeof(a->k)<>'string' or length(a->>k)>150 or a->>k<>btrim(a->>k) or (k<>'line2' and length(a->>k)=0)) then raise exception 'Invalid private address'; end if;
 end loop;
 if a->>'country'<>'US' or a->>'postal_code' !~ '^[0-9]{5}(-[0-9]{4})?$' or not (a->>'state'=any(string_to_array('AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY',' '))) then raise exception 'US private address required'; end if;
 -- Match the server's normalized JSON.stringify order, including optional line2.
 canonical:='{"line1":'||(a->'line1')::text||',"city":'||(a->'city')::text||',"state":'||(a->'state')::text||',"postal_code":'||(a->'postal_code')::text||',"country":'||(a->'country')::text||case when a ? 'line2' then ',"line2":'||(a->'line2')::text else '' end||'}';
 return encode(sha256(convert_to(canonical,'UTF8')),'hex');
end $$;
revoke all on function rr_sandbox.fulfillment_address_hash(jsonb) from public,anon,authenticated;

create function public.rr_test_prepare_carrier_checkout(p_order uuid,p_buyer uuid,p_input jsonb,p_snapshot jsonb,p_expires timestamptz,p_fulfillment jsonb) returns jsonb
language plpgsql security definer set search_path=rr_sandbox,pg_temp as $$
declare o orders; a checkout_attempts; f fulfillment_quotes; destination text; expires_ms bigint;
begin
 select * into o from orders where id=p_order for update;
 if not found or p_buyer is null or o.buyer_id<>p_buyer or o.test is not true then raise exception 'Order unavailable'; end if;
 perform public.rr_test_prepare_checkout(p_order,p_buyer,p_input,p_snapshot,p_expires);
 select * into a from checkout_attempts where order_id=p_order;
 select * into f from fulfillment_quotes where order_id=p_order and rate_id=a.input->'shippingQuote'->>'rateId';
 if found then
  if f.snapshot->'amountCents' is distinct from a.input->'shippingQuote'->'amountCents' or f.snapshot->'expiresAt' is distinct from a.input->'shippingQuote'->'expiresAt' or fulfillment_address_hash(f.snapshot->'destination') is distinct from a.input->'shippingQuote'->>'destinationHash' then raise exception 'Saved carrier evidence mismatch'; end if;
  return to_jsonb(a);
 end if;
 if a.phase<>'prepared' or a.input is distinct from p_input or a.snapshot is distinct from p_snapshot then raise exception 'Missing carrier snapshot needs review'; end if;
 if p_fulfillment is null or jsonb_typeof(p_fulfillment)<>'object' or octet_length(p_fulfillment::text)>4096 then raise exception 'Invalid carrier snapshot'; end if;
 if not p_fulfillment ?& array['test','shipmentId','rateId','currency','amountCents','carrier','service','origin','destination','parcel','expiresAt'] or (select count(*) from jsonb_object_keys(p_fulfillment))<>11 then raise exception 'Invalid carrier fields'; end if;
 if p_fulfillment->'test' is distinct from 'true'::jsonb or p_fulfillment->>'currency' is distinct from 'USD'
  or coalesce(p_fulfillment->>'shipmentId','') !~ '^[a-f0-9]{32}$'
  or coalesce(p_fulfillment->>'rateId','') !~ '^[a-f0-9]{32}$'
  or p_fulfillment->>'rateId' is distinct from a.input->'shippingQuote'->>'rateId'
  or p_fulfillment->'amountCents' is distinct from a.input->'shippingQuote'->'amountCents'
  or p_fulfillment->'expiresAt' is distinct from a.input->'shippingQuote'->'expiresAt'
  or jsonb_typeof(p_fulfillment->'expiresAt')<>'number' or coalesce(p_fulfillment->>'expiresAt','') !~ '^[0-9]{13}$'
  or jsonb_typeof(p_fulfillment->'carrier')<>'string' or length(btrim(p_fulfillment->>'carrier')) not between 1 and 100
  or jsonb_typeof(p_fulfillment->'service')<>'string' or length(btrim(p_fulfillment->>'service')) not between 1 and 150
  then raise exception 'Carrier identity mismatch'; end if;
 expires_ms:=(p_fulfillment->>'expiresAt')::bigint;
 if to_timestamp(expires_ms/1000.0)<=clock_timestamp() or to_timestamp(expires_ms/1000.0)>clock_timestamp()+interval '30 minutes' or p_expires>to_timestamp(expires_ms/1000.0) then raise exception 'Carrier quote expired'; end if;
 perform fulfillment_address_hash(p_fulfillment->'origin');
 destination:=fulfillment_address_hash(p_fulfillment->'destination');
 if destination is distinct from a.input->'shippingQuote'->>'destinationHash' then raise exception 'Carrier destination mismatch'; end if;
 if jsonb_typeof(p_fulfillment->'parcel') is distinct from 'object' or not (p_fulfillment->'parcel') ?& array['length','width','height','weight'] or (select count(*) from jsonb_object_keys(p_fulfillment->'parcel'))<>4 then raise exception 'Invalid private parcel'; end if;
 if exists(select 1 from jsonb_each(p_fulfillment->'parcel') where jsonb_typeof(value)<>'number') then raise exception 'Invalid parcel numbers'; end if;
 if exists(select 1 from jsonb_each(p_fulfillment->'parcel') where value::text::numeric<=0 or value::text::numeric>case when key='weight' then 150 else 108 end) then raise exception 'Invalid parcel bounds'; end if;
 insert into fulfillment_quotes(order_id,rate_id,snapshot) values(p_order,p_fulfillment->>'rateId',p_fulfillment);
 return to_jsonb(a);
end $$;

create function public.rr_test_fulfillment_status(p_order uuid,p_actor uuid) returns jsonb
language plpgsql security definer set search_path=rr_sandbox,pg_temp as $$
declare o orders; a checkout_attempts; f fulfillment_quotes; holds text[]:=array[]::text[]; stored boolean:=false;
begin
 select * into o from orders where id=p_order;
 if not found or p_actor is null or p_actor not in (o.buyer_id,o.seller_id) or o.test is not true then raise exception 'Order unavailable'; end if;
 select * into a from checkout_attempts where order_id=p_order;
 select * into f from fulfillment_quotes where order_id=p_order and rate_id=a.input->'shippingQuote'->>'rateId';
 stored:=found;
 if o.state<>'paid' or o.payment_intent_id is null then holds:=array_append(holds,'payment_unconfirmed'); end if;
 if o.risk_status<>'clear' then holds:=array_append(holds,'risk_hold'); end if;
 if o.refund_state<>'none' or o.refunded_cents<>0 or o.refund_pending_cents<>0 then holds:=array_append(holds,'refund_hold'); end if;
 if not stored or (o.state='paid' and (f.rate_id is distinct from o.shipping_rate_id or f.snapshot->'amountCents' is distinct from o.snapshot->'shippingCents')) then holds:=array_append(holds,'snapshot_missing'); end if;
 if stored and to_timestamp((f.snapshot->>'expiresAt')::bigint/1000.0)<=clock_timestamp() then holds:=array_append(holds,'quote_expired'); end if;
 if not exists(select 1 from jobs where order_id=p_order and kind='prepare_test_label' and state='pending') then holds:=array_append(holds,'job_held'); end if;
 return jsonb_build_object('test',true,'orderId',p_order,'state',case when cardinality(holds)>0 then 'held' else 'ready_for_review' end,'snapshotStored',stored,'holdReasons',to_jsonb(holds),'labelPurchaseEnabled',false);
end $$;
revoke all on function public.rr_test_prepare_carrier_checkout(uuid,uuid,jsonb,jsonb,timestamptz,jsonb) from public,anon,authenticated;
revoke all on function public.rr_test_fulfillment_status(uuid,uuid) from public,anon,authenticated;
grant execute on function public.rr_test_prepare_carrier_checkout(uuid,uuid,jsonb,jsonb,timestamptz,jsonb) to service_role;
grant execute on function public.rr_test_fulfillment_status(uuid,uuid) to service_role;
commit;
