-- ISOLATED TEST DATABASE ONLY, after the previous seven test migrations.
-- No provider-session cancellation, refund, ledger entry or inventory reset.
begin;
alter table rr_sandbox.orders drop constraint orders_state_check;
alter table rr_sandbox.orders add constraint orders_state_check
 check(state in ('reserved','checkout_open','payment_pending','paid','expired','payment_failed','review','cancelled'));

create function rr_sandbox.can_cancel_preparation(p_order uuid,p_buyer uuid) returns boolean
language sql stable set search_path=rr_sandbox,pg_temp as $$
 select coalesce((select o.buyer_id=p_buyer and o.state='reserved' and o.session_id is null
  and o.snapshot is null and o.payment_intent_id is null and a.phase='prepared'
  and a.dispatched_at is null and a.session_id is null and a.session_expires_at is null
  and not exists(select 1 from provider_events e where e.order_id=o.id)
  and not exists(select 1 from ledger_entries e where e.order_id=o.id)
  and not exists(select 1 from jobs j where j.order_id=o.id)
  and not exists(select 1 from risk_assessments r where r.order_id=o.id)
 from orders o join checkout_attempts a on a.order_id=o.id where o.id=p_order),false);
$$;
revoke all on function rr_sandbox.can_cancel_preparation(uuid,uuid) from public,anon,authenticated,service_role;

create function public.rr_test_cancel_preparation(p_order uuid,p_buyer uuid) returns jsonb
language plpgsql security definer set search_path=rr_sandbox,pg_temp as $$
declare o orders; a checkout_attempts; listing uuid;
begin
 select listing_id into listing from orders where id=p_order;
 perform 1 from catalog where id=listing for update;
 select * into o from orders where id=p_order for update;
 if not found or p_buyer is null or o.buyer_id<>p_buyer then raise exception 'Order unavailable';end if;
 select * into a from checkout_attempts where order_id=p_order for update;
 if o.state='cancelled' then return jsonb_build_object('test',true,'orderId',o.id,'state','cancelled');end if;
 if a.phase is distinct from 'prepared' or a.dispatched_at is not null or a.session_id is not null
  or a.session_expires_at is not null or not rr_sandbox.can_cancel_preparation(o.id,p_buyer)
  then raise exception 'Checkout requires confirmation; preparation cannot be cancelled';end if;
 update orders set state='cancelled',updated_at=clock_timestamp() where id=o.id;
 return jsonb_build_object('test',true,'orderId',o.id,'state','cancelled');
end $$;

create or replace function public.rr_test_member_orders(p_member uuid) returns jsonb
language sql security definer set search_path=rr_sandbox,pg_temp as $$
 select coalesce(jsonb_agg(x),'[]'::jsonb) from (
  select id,listing_id,buyer_id,seller_id,state,risk_status,item_cents,buyer_fee_cents,
   snapshot->'shippingCents' as shipping_cents,snapshot->'taxCents' as tax_cents,
   snapshot->'totalCents' as total_cents,refund_state,refunded_cents,refund_pending_cents,
   rr_sandbox.can_cancel_preparation(id,p_member) as can_cancel_preparation,created_at,updated_at
  from orders where buyer_id=p_member or seller_id=p_member order by created_at desc limit 100
 ) x;
$$;
revoke all on function public.rr_test_cancel_preparation(uuid,uuid) from public,anon,authenticated;
revoke all on function public.rr_test_member_orders(uuid) from public,anon,authenticated;
grant execute on function public.rr_test_cancel_preparation(uuid,uuid) to service_role;
grant execute on function public.rr_test_member_orders(uuid) to service_role;
commit;
