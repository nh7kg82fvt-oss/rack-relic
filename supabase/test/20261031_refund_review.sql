-- ISOLATED TEST DATABASE ONLY, after refund_requests.sql.
-- Read-only evidence. No provider request, financial write or release action.
begin;
create function public.rr_test_refund_review(p_actor uuid) returns jsonb
language sql security definer set search_path=rr_sandbox,pg_temp as $$
 select coalesce(jsonb_agg(x),'[]'::jsonb) from (
  select q.id,q.order_id,q.actor_id,q.amount_cents,q.phase,q.created_at,q.updated_at,
   (p_actor in (o.buyer_id,o.seller_id)) as participant,
   case when r.order_id=q.order_id and r.amount_cents=q.amount_cents and r.payment_intent_id=q.payment_intent_id
    then r.status else null end as receipt_status,
   (o.refund_state='review' or q.payment_intent_id is distinct from o.payment_intent_id or coalesce(r.needs_review,false) or
    (r.id is not null and (r.order_id<>q.order_id or r.amount_cents<>q.amount_cents or r.payment_intent_id<>q.payment_intent_id or r.charge_id is distinct from q.charge_id or q.phase<>'known'))) as needs_review
  from refund_requests q join orders o on o.id=q.order_id left join refunds r on r.id=q.refund_id
  where p_actor is not null and q.actor_id=p_actor and p_actor in (o.buyer_id,o.seller_id)
  order by case when r.status='succeeded' and not r.needs_review and o.refund_state<>'review' then 1 else 0 end,
   q.created_at,q.id limit 101
 ) x;
$$;
revoke all on function public.rr_test_refund_review(uuid) from public,anon,authenticated;
grant execute on function public.rr_test_refund_review(uuid) to service_role;
commit;
