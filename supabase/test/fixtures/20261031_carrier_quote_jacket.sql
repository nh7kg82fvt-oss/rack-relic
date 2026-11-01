-- Isolated staging only. Add once; never reset a sold or reserved fixture.
-- Derive the synthetic seller from the original staging catalog fixture.
insert into rr_sandbox.catalog(id,seller_id,title,price_cents)
select '95959595-9595-4595-8595-959595959595',seller_id,'Synthetic carrier quote jacket',2500
from rr_sandbox.catalog where id='73737373-7373-4373-8373-737373737373' and test=true
on conflict(id) do nothing;

select id,title,price_cents,status,test from rr_sandbox.catalog
where id='95959595-9595-4595-8595-959595959595';
