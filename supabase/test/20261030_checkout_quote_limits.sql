-- Apply only to the isolated test database after the checkout-attempt migration.
begin;
create table rr_sandbox.checkout_quote_limits (
 buyer_id uuid primary key,
 minute_started timestamptz not null default clock_timestamp(),
 minute_count integer not null default 0 check(minute_count between 0 and 5),
 day_started timestamptz not null default clock_timestamp(),
 day_count integer not null default 0 check(day_count between 0 and 20)
);
alter table rr_sandbox.checkout_quote_limits enable row level security;
revoke all on rr_sandbox.checkout_quote_limits from public,anon,authenticated;

create function public.rr_test_quote_permit(p_order uuid,p_buyer uuid) returns jsonb
language plpgsql security definer set search_path=rr_sandbox,pg_temp as $$
declare o orders; q checkout_quote_limits; stamp timestamptz; retry integer:=0;
begin
 select * into o from orders where id=p_order;
 if not found or p_buyer is null or o.buyer_id<>p_buyer or o.state<>'reserved'
  then raise exception 'Quote reservation required'; end if;
 insert into checkout_quote_limits(buyer_id) values(p_buyer) on conflict do nothing;
 -- One durable row serializes all quote attempts by this account, across orders.
 select * into q from checkout_quote_limits where buyer_id=p_buyer for update;
 stamp:=clock_timestamp();
 if stamp<q.minute_started or stamp<q.day_started then
  return jsonb_build_object('test',true,'allowed',false,'retryAfter',86400);
 end if;
 if stamp>=q.minute_started+interval '1 minute' then q.minute_started:=stamp;q.minute_count:=0;end if;
 if stamp>=q.day_started+interval '24 hours' then q.day_started:=stamp;q.day_count:=0;end if;
 if q.minute_count>=5 then retry:=greatest(retry,ceil(extract(epoch from q.minute_started+interval '1 minute'-stamp))::integer);end if;
 if q.day_count>=20 then retry:=greatest(retry,ceil(extract(epoch from q.day_started+interval '24 hours'-stamp))::integer);end if;
 if retry>0 then return jsonb_build_object('test',true,'allowed',false,'retryAfter',least(86400,greatest(1,retry)));end if;
 update checkout_quote_limits set minute_started=q.minute_started,minute_count=q.minute_count+1,
  day_started=q.day_started,day_count=q.day_count+1 where buyer_id=p_buyer;
 return jsonb_build_object('test',true,'allowed',true,'retryAfter',0);
end $$;
revoke all on function public.rr_test_quote_permit(uuid,uuid) from public,anon,authenticated;
grant execute on function public.rr_test_quote_permit(uuid,uuid) to service_role;
commit;
