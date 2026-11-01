-- Isolated staging only. Informational sample tracking; no financial authority.
begin;
create table rr_sandbox.tracking_observations (
 order_id uuid not null references rr_sandbox.orders(id),
 evidence_hash text not null check(evidence_hash ~ '^[a-f0-9]{64}$'),
 snapshot jsonb not null,
 recorded_at timestamptz not null default now(),
 primary key(order_id,evidence_hash)
);
create table rr_sandbox.tracking_current (
 order_id uuid primary key references rr_sandbox.orders(id),
 snapshot jsonb not null,
 provider_status text not null check(provider_status in ('UNKNOWN','PRE_TRANSIT','TRANSIT','DELIVERED','RETURNED','FAILURE')),
 needs_review boolean not null default false,
 last_checked timestamptz not null
);
alter table rr_sandbox.tracking_observations enable row level security;
alter table rr_sandbox.tracking_current enable row level security;
revoke all on rr_sandbox.tracking_observations,rr_sandbox.tracking_current from public,anon,authenticated;

create function public.rr_test_tracking_status(p_order uuid,p_actor uuid) returns jsonb
language plpgsql security definer set search_path=rr_sandbox,pg_temp as $$
declare o orders; c tracking_current;
begin
 select * into o from orders where id=p_order;
 if not found or p_actor is null or p_actor not in (o.buyer_id,o.seller_id) or o.test is not true then raise exception 'Order unavailable'; end if;
 select * into c from tracking_current where order_id=p_order;
 if not found then return jsonb_build_object('test',true,'orderId',p_order,'state','not_recorded','status',null,'providerStatus',null,'checkedAt',null,'eventAt',null,'needsReview',false,'labelPurchaseEnabled',false,'payoutAvailable',false); end if;
 return jsonb_build_object('test',true,'orderId',p_order,'state','recorded','status',c.snapshot->>'status','providerStatus',c.provider_status,'checkedAt',floor(extract(epoch from c.last_checked)*1000)::bigint,'eventAt',c.snapshot->'eventAt','needsReview',c.needs_review,'labelPurchaseEnabled',false,'payoutAvailable',false);
end $$;

create function public.rr_test_record_tracking(p_order uuid,p_actor uuid,p_evidence jsonb) returns jsonb
language plpgsql security definer set search_path=rr_sandbox,pg_temp as $$
declare o orders; a label_attempts; c tracking_current; h text; checked timestamptz; s text; old_s text; conflict boolean:=false; had boolean;
begin
 select * into o from orders where id=p_order for update;
 if not found or p_actor is null or p_actor not in (o.buyer_id,o.seller_id) or o.test is not true then raise exception 'Order unavailable'; end if;
 select * into a from label_attempts where order_id=p_order;
 if not found or a.result->>'status' is distinct from 'SUCCESS' or a.transaction_id is null then raise exception 'Successful saved sample required'; end if;
 if p_evidence is null or jsonb_typeof(p_evidence)<>'object' or not p_evidence ?& array['test','orderId','requestId','transactionId','trackingNumber','carrier','status','eventAt','checkedAt','source'] or (select count(*) from jsonb_object_keys(p_evidence))<>10 then raise exception 'Invalid tracking evidence'; end if;
 if p_evidence->'test' is distinct from 'true'::jsonb or p_evidence->>'orderId' is distinct from p_order::text or p_evidence->>'requestId' is distinct from a.request_id::text or p_evidence->>'transactionId' is distinct from a.transaction_id or p_evidence->'trackingNumber' is distinct from a.result->'trackingNumber' or p_evidence->'carrier' is distinct from a.quote->'carrier' or p_evidence->>'source' is distinct from 'shippo_transaction' then raise exception 'Tracking identity mismatch'; end if;
 s:=p_evidence->>'status';if s is null or s not in ('UNKNOWN','PRE_TRANSIT','TRANSIT','DELIVERED','RETURNED','FAILURE') then raise exception 'Invalid tracking status'; end if;
 if jsonb_typeof(p_evidence->'checkedAt') is distinct from 'number' or coalesce(p_evidence->>'checkedAt','') !~ '^[0-9]{13}$' then raise exception 'Fresh tracking check required'; end if;
 checked:=to_timestamp((p_evidence->>'checkedAt')::bigint/1000.0);
 if checked<clock_timestamp()-interval '5 minutes' or checked>clock_timestamp()+interval '30 seconds' then raise exception 'Stale tracking check'; end if;
 if p_evidence->'eventAt' is distinct from 'null'::jsonb and (jsonb_typeof(p_evidence->'eventAt') is distinct from 'number' or coalesce(p_evidence->>'eventAt','') !~ '^[0-9]{13}$' or (p_evidence->>'eventAt')::numeric>(p_evidence->>'checkedAt')::numeric+30000) then raise exception 'Invalid tracking event time'; end if;
 h:=encode(sha256(convert_to((p_evidence-'checkedAt')::text,'UTF8')),'hex');
 insert into tracking_observations(order_id,evidence_hash,snapshot) values(p_order,h,p_evidence) on conflict(order_id,evidence_hash) do nothing;
 select * into c from tracking_current where order_id=p_order for update;had:=found;
 if had then
  if checked<c.last_checked then return public.rr_test_tracking_status(p_order,p_actor); end if;
  if c.snapshot->>'eventAt' is not null and p_evidence->>'eventAt' is not null and (p_evidence->>'eventAt')::bigint<(c.snapshot->>'eventAt')::bigint then return public.rr_test_tracking_status(p_order,p_actor); end if;
  old_s:=c.snapshot->>'status';
  conflict:=c.needs_review or (old_s<>s and c.snapshot->>'eventAt' is not null and p_evidence->>'eventAt' is null)
   or (old_s<>s and (old_s in ('DELIVERED','RETURNED','FAILURE') or old_s='TRANSIT' and s in ('UNKNOWN','PRE_TRANSIT') or old_s='PRE_TRANSIT' and s='UNKNOWN'))
   or (old_s<>s and c.snapshot->>'eventAt' is not null and p_evidence->>'eventAt' is not null and c.snapshot->'eventAt'=p_evidence->'eventAt');
  update tracking_current set provider_status=s,needs_review=conflict,last_checked=checked,
   snapshot=case when conflict or (p_evidence->>'eventAt' is null and c.snapshot->>'eventAt' is not null) then c.snapshot else p_evidence end where order_id=p_order;
 else
  insert into tracking_current(order_id,snapshot,provider_status,last_checked) values(p_order,p_evidence,s,checked);
 end if;
 return public.rr_test_tracking_status(p_order,p_actor);
end $$;
revoke all on function public.rr_test_tracking_status(uuid,uuid) from public,anon,authenticated;
revoke all on function public.rr_test_record_tracking(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.rr_test_tracking_status(uuid,uuid) to service_role;
grant execute on function public.rr_test_record_tracking(uuid,uuid,jsonb) to service_role;
commit;
