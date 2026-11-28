-- Isolated rack-relic-staging (zvtaqzcqfdjpuwnlpzln) only.
-- Separate fixture for operator acceptance. Never reset the original sold item.
begin;
do $$
declare existing rr_sandbox.catalog; fixture_seller uuid;
begin
 select seller_id into fixture_seller from rr_sandbox.catalog where id='73737373-7373-4373-8373-737373737373';
 if fixture_seller is null then raise exception 'Original synthetic fixture is required'; end if;
 select * into existing from rr_sandbox.catalog where id='84848484-8484-4484-8484-848484848484';
 if found then
  if existing.seller_id<>fixture_seller
   or existing.title<>'Synthetic operator refund jacket' or existing.price_cents<>2500
   then raise exception 'Existing operator fixture does not match'; end if;
  -- Preserve status, reservation and sale evidence exactly as found.
 else
  insert into rr_sandbox.catalog(id,seller_id,title,price_cents)
   values('84848484-8484-4484-8484-848484848484',fixture_seller,'Synthetic operator refund jacket',2500);
 end if;
end $$;
select id,title,price_cents,status from rr_sandbox.catalog where id='84848484-8484-4484-8484-848484848484';
commit;
