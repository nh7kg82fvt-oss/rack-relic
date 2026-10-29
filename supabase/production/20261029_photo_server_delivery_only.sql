-- Production project zrfztnbyynrdzfeblkeq only.
-- Apply after the production photo API is deployed and positively verified.
-- Keep listing_photo_insert unchanged. Never substitute a public bucket.
-- Existing cached raw-object URLs need separate migration/invalidation;
-- this restriction alone cannot revoke previously cached photo bytes.
BEGIN;
CREATE POLICY listing_photo_server_delivery_only
ON storage.objects AS RESTRICTIVE FOR SELECT TO anon, authenticated
USING (bucket_id <> 'listing-photos');
COMMIT;
