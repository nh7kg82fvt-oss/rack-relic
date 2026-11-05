-- Isolated staging only. One durable sample-label dispatch per synthetic order.
begin;
create table rr_sandbox.label_attempts (
 request_id uuid primary key,
 order_id uuid not null unique references rr_sandbox.orders(id),
 actor_id uuid not null,
 quote jsonb not null,
 transaction_id text unique check(transaction_id ~ '^[a-f0-9]{32}$'),
 result jsonb,
 created_at timestamptz not null default now()
);
alter table rr_sandbox.label_attempts enable row level security;
revoke all on rr_sandbox.label_attempts from public,anon,authenticated;

create function public.rr_test_label_attempt(p_order uuid,p_actor uuid) returns jsonb
language plpgsql security definer set search_path=rr_sandbox,pg_temp as $$
declare o orders; a label_attempts;
begin
 select * into o from orders where id=p_order;
 if not found or p_actor is null or p_actor not in (o.buyer_id,o.seller_id) or o.test is not true then raise exception 'Order unavailable'; end if;
 select * into a from label_attempts where order_id=p_order;
 if not found then return null; end if;
 return jsonb_build_object('test',true,'orderId',a.order_id,'requestId',a.request_id,'quote',a.quote,'transactionId',a.transaction_id,'result',a.result);
end $$;

create function public.rr_test_label_context(p_order uuid,p_actor uuid) returns jsonb
language plpgsql security definer set search_path=rr_sandbox,pg_temp as $$
declare o orders; f fulfillment_quotes;
begin
 select * into o from orders where id=p_order for update;
 if not found or p_actor is null or p_actor not in (o.buyer_id,o.seller_id) or o.test is not true then raise exception 'Order unavailable'; end if;
 if o.state<>'paid' or o.payment_intent_id is null or o.risk_status<>'clear' or o.refund_state<>'none' or o.refunded_cents<>0 or o.refund_pending_cents<>0 then raise exception 'Sample label is held'; end if;
 if not exists(select 1 from risk_assessments where order_id=p_order and decision='clear' and checked_at>=clock_timestamp()-interval '5 minutes' and checked_at<=clock_timestamp()+interval '30 seconds') then raise exception 'Fresh risk evidence required'; end if;
 if not exists(select 1 from jobs where order_id=p_order and kind='prepare_test_label' and state='pending') then raise exception 'Shipping job is held'; end if;
 select * into f from fulfillment_quotes where order_id=p_order and rate_id=o.shipping_rate_id;
 if not found or f.snapshot->'amountCents' is distinct from o.snapshot->'shippingCents' or fulfillment_address_hash(f.snapshot->'destination') is distinct from o.destination_hash then raise exception 'Private shipping evidence missing'; end if;
 -- The original buyer quote may have expired. A new provider quote must use
 -- these same private addresses/parcel and never exceed the amount collected.
 return jsonb_build_object('test',true,'orderId',p_order,'shippingCents',o.snapshot->'shippingCents','snapshot',f.snapshot);
end $$;

create function public.rr_test_claim_label(p_order uuid,p_actor uuid,p_request uuid,p_quote jsonb) returns jsonb
language plpgsql security definer set search_path=rr_sandbox,pg_temp as $$
declare o orders; a label_attempts; c jsonb; k text;
begin
 select * into o from orders where id=p_order for update;
 if not found or p_actor is null or p_actor not in (o.buyer_id,o.seller_id) or o.test is not true or p_request is null then raise exception 'Order unavailable'; end if;
 select * into a from label_attempts where order_id=p_order;
 if found then return jsonb_build_object('dispatch',false,'attempt',public.rr_test_label_attempt(p_order,p_actor)); end if;
 c:=public.rr_test_label_context(p_order,p_actor);
 if p_quote is null or jsonb_typeof(p_quote)<>'object' or not p_quote ?& array['test','shipmentId','sourceRateId','rateId','currency','amountCents','carrier','service','expiresAt'] or (select count(*) from jsonb_object_keys(p_quote))<>9 then raise exception 'Invalid fresh label quote'; end if;
 if p_quote->'test' is distinct from 'true'::jsonb or p_quote->>'currency' is distinct from 'USD' or p_quote->>'sourceRateId' is distinct from o.shipping_rate_id then raise exception 'Fresh quote binding mismatch'; end if;
 foreach k in array array['shipmentId','sourceRateId','rateId'] loop
  if coalesce(p_quote->>k,'') !~ '^[a-f0-9]{32}$' then raise exception 'Invalid carrier identity'; end if;
 end loop;
 if coalesce(p_quote->>'amountCents','') !~ '^[0-9]{1,6}$' or jsonb_typeof(p_quote->'amountCents')<>'number' or (p_quote->>'amountCents')::bigint>(c->>'shippingCents')::bigint then raise exception 'Saved shipping budget exceeded'; end if;
 if coalesce(p_quote->>'expiresAt','') !~ '^[0-9]{13}$' or jsonb_typeof(p_quote->'expiresAt')<>'number' or to_timestamp((p_quote->>'expiresAt')::bigint/1000.0)<=clock_timestamp() or to_timestamp((p_quote->>'expiresAt')::bigint/1000.0)>clock_timestamp()+interval '5 minutes 30 seconds' then raise exception 'Fresh quote required'; end if;
 foreach k in array array['carrier','service'] loop
  if jsonb_typeof(p_quote->k) is distinct from 'string' or length(btrim(p_quote->>k)) not between 1 and 150 then raise exception 'Carrier description required'; end if;
 end loop;
 insert into label_attempts(request_id,order_id,actor_id,quote) values(p_request,p_order,p_actor,p_quote);
 update jobs set state='leased',attempts=attempts+1 where order_id=p_order and kind='prepare_test_label';
 return jsonb_build_object('dispatch',true,'attempt',public.rr_test_label_attempt(p_order,p_actor));
end $$;

create function public.rr_test_save_label(p_order uuid,p_actor uuid,p_request uuid,p_evidence jsonb) returns jsonb
language plpgsql security definer set search_path=rr_sandbox,pg_temp as $$
declare o orders; a label_attempts; s text;
begin
 select * into o from orders where id=p_order for update;
 if not found or p_actor is null or p_actor not in (o.buyer_id,o.seller_id) or o.test is not true then raise exception 'Order unavailable'; end if;
 select * into a from label_attempts where order_id=p_order and request_id=p_request for update;
 if not found then raise exception 'Saved label claim required'; end if;
 if p_evidence is null or jsonb_typeof(p_evidence)<>'object' or not p_evidence ?& array['test','orderId','requestId','transactionId','rateId','status','labelUrl','trackingNumber','checkedAt'] or (select count(*) from jsonb_object_keys(p_evidence))<>9 then raise exception 'Invalid sample label evidence'; end if;
 if p_evidence->'test' is distinct from 'true'::jsonb or p_evidence->>'orderId' is distinct from p_order::text or p_evidence->>'requestId' is distinct from p_request::text or p_evidence->>'rateId' is distinct from a.quote->>'rateId' or coalesce(p_evidence->>'transactionId','') !~ '^[a-f0-9]{32}$' or a.transaction_id is not null and a.transaction_id is distinct from p_evidence->>'transactionId' then raise exception 'Sample label identity mismatch'; end if;
 if jsonb_typeof(p_evidence->'checkedAt') is distinct from 'number' or coalesce(p_evidence->>'checkedAt','') !~ '^[0-9]{13}$' or to_timestamp((p_evidence->>'checkedAt')::bigint/1000.0)<clock_timestamp()-interval '5 minutes' or to_timestamp((p_evidence->>'checkedAt')::bigint/1000.0)>clock_timestamp()+interval '30 seconds' then raise exception 'Fresh label evidence required'; end if;
 s:=p_evidence->>'status';
 if s is null or s not in ('SUCCESS','WAITING','QUEUED','ERROR') then raise exception 'Invalid sample status'; end if;
 if s='SUCCESS' then
  if coalesce(p_evidence->>'labelUrl','') !~ '^https://(shippo-delivery(-[a-z0-9-]+)?[.]s3([.-][a-z0-9-]+)?[.]amazonaws[.]com|deliver[.]goshippo[.]com)/[^[:space:]]+$' or jsonb_typeof(p_evidence->'trackingNumber') is distinct from 'string' or length(p_evidence->>'trackingNumber') not between 1 and 100 then raise exception 'Invalid sample document'; end if;
 elsif p_evidence->'labelUrl' is distinct from 'null'::jsonb or p_evidence->'trackingNumber' is distinct from 'null'::jsonb then raise exception 'Unexpected sample document'; end if;
 -- Terminal evidence is immutable; later stale WAITING responses cannot undo it.
 if a.result->>'status' in ('SUCCESS','ERROR') then
  if a.result->>'status'<>s or a.result->'labelUrl' is distinct from p_evidence->'labelUrl' or a.result->'trackingNumber' is distinct from p_evidence->'trackingNumber' then raise exception 'Terminal sample evidence conflict'; end if;
  return public.rr_test_label_attempt(p_order,p_actor);
 end if;
 update label_attempts set transaction_id=p_evidence->>'transactionId',result=p_evidence where request_id=p_request;
 update jobs set state=case when s='SUCCESS' then 'done' when s='ERROR' then 'failed' else 'uncertain' end,provider_reference=p_evidence->>'transactionId' where order_id=p_order and kind='prepare_test_label';
 return public.rr_test_label_attempt(p_order,p_actor);
end $$;
revoke all on function public.rr_test_label_attempt(uuid,uuid) from public,anon,authenticated;
revoke all on function public.rr_test_label_context(uuid,uuid) from public,anon,authenticated;
revoke all on function public.rr_test_claim_label(uuid,uuid,uuid,jsonb) from public,anon,authenticated;
revoke all on function public.rr_test_save_label(uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.rr_test_label_attempt(uuid,uuid) to service_role;
grant execute on function public.rr_test_label_context(uuid,uuid) to service_role;
grant execute on function public.rr_test_claim_label(uuid,uuid,uuid,jsonb) to service_role;
grant execute on function public.rr_test_save_label(uuid,uuid,uuid,jsonb) to service_role;
commit;
