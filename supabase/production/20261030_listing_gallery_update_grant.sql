-- Sellers already edit approved listing columns under owner-only row security.
-- Include the new gallery column without granting table-wide UPDATE.
begin;
grant update (photo_paths) on public.listings to authenticated;
notify pgrst, 'reload schema';
commit;
