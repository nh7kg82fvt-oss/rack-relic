begin;
alter table public.listings add column if not exists photo_paths text[] not null default '{}';
create or replace function public.validate_listing_gallery() returns trigger
language plpgsql set search_path = public, pg_temp as $$
declare p text;
begin
  -- Older clients replace the cover only. Retire their previous gallery.
  if TG_OP = 'UPDATE' then
    if new.photo_path is distinct from old.photo_path and new.photo_paths is not distinct from old.photo_paths then
      new.photo_paths := case when new.photo_path is null then '{}'::text[] else array[new.photo_path] end;
    end if;
  end if;
  if coalesce(cardinality(new.photo_paths),0) = 0 and new.photo_path is not null then
    new.photo_paths := array[new.photo_path];
  end if;
  if new.photo_paths is null or cardinality(new.photo_paths) > 6 or (cardinality(new.photo_paths)>0 and (array_ndims(new.photo_paths) <> 1 or array_lower(new.photo_paths,1) <> 1)) then
    raise exception 'Gallery must contain up to six photos';
  end if;
  if cardinality(new.photo_paths)>0 and new.photo_path is distinct from new.photo_paths[1] then
    raise exception 'Cover must be the first gallery photo';
  end if;
  if cardinality(new.photo_paths) <> (select count(distinct x) from unnest(new.photo_paths) x) then
    raise exception 'Gallery photos must be unique and non-null';
  end if;
  foreach p in array new.photo_paths loop
    if p !~ ('^' || new.seller_id::text || '/' || new.id::text || '/[A-Za-z0-9][A-Za-z0-9._-]{0,220}\.(jpg|jpeg|png|webp)$') then
      raise exception 'Invalid gallery photo path';
    end if;
  end loop;
  return new;
end $$;
drop trigger if exists listing_gallery_validated on public.listings;
create trigger listing_gallery_validated before insert or update on public.listings
for each row execute function public.validate_listing_gallery();
-- Existing row access and private Storage policies remain authoritative.
notify pgrst, 'reload schema';
commit;
