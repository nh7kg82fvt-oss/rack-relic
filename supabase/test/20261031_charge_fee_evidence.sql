-- ISOLATED TEST DATABASE ONLY, after the existing nine test migrations.
-- Records original charge balance evidence. Never allocates money or releases jobs.
begin;
create table rr_sandbox.charge_fee_evidence (
 order_id uuid primary key references rr_sandbox.orders(id),
 charge_id text not null unique check(charge_id ~ '^ch_[A-Za-z0-9]+$'),
 balance_transaction_id text not null unique check(balance_transaction_id ~ '^txn_[A-Za-z0-9]+$'),
 evidence jsonb not null,
 recorded_at timestamptz not null default clock_timestamp()
);
alter table rr_sandbox.charge_fee_evidence enable row level security;
revoke all on rr_sandbox.charge_fee_evidence from public,anon,authenticated;

create function public.rr_test_fee_order(p_order uuid,p_actor uuid) returns jsonb
language plpgsql security definer set search_path=rr_sandbox,pg_temp as $$
declare o orders; fee jsonb;
begin
 select * into o from orders where id=p_order;
 if not found or p_actor is null or p_actor not in (o.buyer_id,o.seller_id)
  or o.state<>'paid' or o.payment_intent_id is null or o.snapshot is null then raise exception 'Paid test order required';end if;
 select evidence into fee from charge_fee_evidence where order_id=o.id;
 return jsonb_build_object('test',true,'orderId',o.id,'paymentIntentId',o.payment_intent_id,
  'totalCents',(o.snapshot->>'totalCents')::bigint,'recordedFee',fee);
end $$;

create function public.rr_test_record_charge_fee(p_order uuid,p_actor uuid,p_evidence jsonb) returns jsonb
language plpgsql security definer set search_path=rr_sandbox,pg_temp as $$
declare o orders; existing charge_fee_evidence; listing uuid; gross bigint; fee bigint; net bigint; details_total bigint;
begin
 select listing_id into listing from orders where id=p_order;
 perform 1 from catalog where id=listing for update;
 select * into o from orders where id=p_order for update;
 if not found or p_actor is null or p_actor not in (o.buyer_id,o.seller_id)
  or o.state<>'paid' or o.payment_intent_id is null then raise exception 'Paid test order required';end if;
 if p_evidence is null or jsonb_typeof(p_evidence)<>'object'
  or not(p_evidence ?& array['test','orderId','paymentIntentId','chargeId','balanceTransactionId','grossCents','feeCents','netCents','currency','feeDetails','checkedAt'])
  or exists(select 1 from jsonb_object_keys(p_evidence) k where k not in ('test','orderId','paymentIntentId','chargeId','balanceTransactionId','grossCents','feeCents','netCents','currency','feeDetails','checkedAt'))
  or p_evidence->'test' is distinct from 'true'::jsonb or p_evidence->>'orderId' is distinct from o.id::text
  or p_evidence->>'paymentIntentId' is distinct from o.payment_intent_id or p_evidence->>'currency' is distinct from 'USD'
  or p_evidence->>'chargeId' !~ '^ch_[A-Za-z0-9]+$' or p_evidence->>'balanceTransactionId' !~ '^txn_[A-Za-z0-9]+$'
  then raise exception 'Invalid fee identity';end if;
 if exists(select 1 from jsonb_each(p_evidence) where key in ('grossCents','feeCents','netCents','checkedAt') and (jsonb_typeof(value)<>'number' or value::text !~ '^[0-9]+$')) then raise exception 'Invalid fee amounts';end if;
 gross:=(p_evidence->>'grossCents')::bigint;fee:=(p_evidence->>'feeCents')::bigint;net:=(p_evidence->>'netCents')::bigint;
 if gross is distinct from (o.snapshot->>'totalCents')::bigint or gross not between 1 and 30000000 or fee not between 0 and gross or net<>gross-fee
  or (p_evidence->>'checkedAt')::numeric<extract(epoch from clock_timestamp())*1000-300000
  or (p_evidence->>'checkedAt')::numeric>extract(epoch from clock_timestamp())*1000+30000 then raise exception 'Stale or inconsistent fee evidence';end if;
 if jsonb_typeof(p_evidence->'feeDetails') is distinct from 'array' or jsonb_array_length(p_evidence->'feeDetails')>20 then raise exception 'Invalid fee details';end if;
 if exists(select 1 from jsonb_array_elements(p_evidence->'feeDetails') d where jsonb_typeof(d)<>'object'
  or not(d ?& array['type','amountCents','currency'])
  or exists(select 1 from jsonb_object_keys(d) k where k not in ('type','amountCents','currency'))
  or not coalesce(d->>'type' in ('stripe_fee','tax'),false) or d->>'currency' is distinct from 'USD'
  or jsonb_typeof(d->'amountCents') is distinct from 'number' or (d->'amountCents')::text !~ '^[0-9]+$') then raise exception 'Invalid fee components';end if;
 select coalesce(sum((d->>'amountCents')::bigint),0) into details_total from jsonb_array_elements(p_evidence->'feeDetails') d;
 if details_total<>fee then raise exception 'Fee component mismatch';end if;
 select * into existing from charge_fee_evidence where order_id=o.id for update;
 if found then
  if existing.evidence-'checkedAt' is distinct from p_evidence-'checkedAt' then raise exception 'Recorded fee needs reconciliation';end if;
  return existing.evidence;
 end if;
 insert into charge_fee_evidence(order_id,charge_id,balance_transaction_id,evidence)
  values(o.id,p_evidence->>'chargeId',p_evidence->>'balanceTransactionId',p_evidence);
 return p_evidence;
end $$;
revoke all on function public.rr_test_fee_order(uuid,uuid) from public,anon,authenticated;
revoke all on function public.rr_test_record_charge_fee(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.rr_test_fee_order(uuid,uuid) to service_role;
grant execute on function public.rr_test_record_charge_fee(uuid,uuid,jsonb) to service_role;
commit;
