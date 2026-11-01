-- Isolated staging only. Add once; preserve every prior paid/refunded fixture.
insert into rr_sandbox.catalog(id,seller_id,title,price_cents)
select 'a6a6a6a6-a6a6-46a6-86a6-a6a6a6a6a6a6',seller_id,'Synthetic sender contact jacket',2500
from rr_sandbox.catalog where id='73737373-7373-4373-8373-737373737373' and test=true
on conflict(id) do nothing;

select id,title,price_cents,status,test from rr_sandbox.catalog
where id='a6a6a6a6-a6a6-46a6-86a6-a6a6a6a6a6a6';
