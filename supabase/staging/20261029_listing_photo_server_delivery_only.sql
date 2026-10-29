-- STAGING ONLY: project zvtaqzcqfdjpuwnlpzln.
-- Applied through the staging dashboard on 2026-10-29 at approximately 05:16 UTC.
-- This migration is a receipt for the already-applied policy; it is not wired
-- into an automatic deploy. Do not apply to production without its own review.
--
-- The application uses /api/listing-photo?id=<listing UUID>. That handler
-- checks the current caller and listing visibility, reads bytes with the
-- existing server-only credential, rechecks the row, and returns no-store.
-- Direct client Storage SELECT must be denied even while a listing is public:
-- a CDN cache hit can otherwise outlive an authorization/state change.
-- INSERT policy stays unchanged so owners can still upload fresh object paths.
-- Roles with BYPASSRLS, including the existing server reader, are unaffected.
BEGIN;
CREATE POLICY listing_photo_server_delivery_only
ON storage.objects AS RESTRICTIVE
FOR SELECT TO anon, authenticated
USING (bucket_id <> 'listing-photos');
COMMIT;

-- Operational acceptance, 2026-10-29:
-- 1. Buyer and Seller identities verified in isolated browser profiles.
-- 2. Direct storage reads denied for Buyer, Seller and anonymous clients.
-- 3. Owner upload succeeded; owner private/archived protected reads succeeded.
-- 4. Published protected reads succeeded; after archive Buyer/anonymous denied.
-- 5. Replacement changed returned image hash; retired direct path denied.
-- 6. Removing the photo reference denied protected reads, including owner.
-- 7. Existing synthetic cache fixture was renamed in place to a fresh path,
--    and its listing reference updated. Old warmed Buyer URL then returned 400.
--    Policy change alone did NOT invalidate the old CDN HIT.
-- 8. Both original test listings returned to archived; checkout stayed closed.
-- No physical object deletion, plan upgrade or production change performed.
-- A 307-byte unused synthetic replacement object is retained for audit.
--
-- Recovery: restoring direct-read permissions reopens the known privacy issue.
-- Prefer fixing protected delivery or keeping checkout closed over dropping
-- this restriction. Any permission restoration needs its own review.
