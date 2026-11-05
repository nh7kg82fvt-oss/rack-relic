-- Isolated staging only. No bank, identity documents, secrets, or onboarding URLs.
BEGIN;
CREATE TABLE rr_sandbox.seller_accounts (
 seller_id uuid PRIMARY KEY,
 phase text NOT NULL DEFAULT 'prepared' CHECK(phase IN ('prepared','dispatched','known')),
 account_id text UNIQUE,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK((phase='known' AND account_id ~ '^acct_[A-Za-z0-9]+$') OR (phase<>'known' AND account_id IS NULL))
);
ALTER TABLE rr_sandbox.seller_accounts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON rr_sandbox.seller_accounts FROM PUBLIC,anon,authenticated;
CREATE FUNCTION public.rr_test_seller_context(p_actor uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE s rr_sandbox.seller_accounts;
BEGIN
 IF p_actor IS NULL OR NOT EXISTS(SELECT 1 FROM rr_sandbox.catalog WHERE seller_id=p_actor) THEN RAISE EXCEPTION 'Test seller required'; END IF;
 SELECT * INTO s FROM rr_sandbox.seller_accounts WHERE seller_id=p_actor;
 RETURN jsonb_build_object('test',true,'sellerId',p_actor,'phase',COALESCE(s.phase,'prepared'),'accountId',s.account_id);
END $$;
CREATE FUNCTION public.rr_test_claim_seller(p_actor uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE n integer;
BEGIN
 IF p_actor IS NULL OR NOT EXISTS(SELECT 1 FROM rr_sandbox.catalog WHERE seller_id=p_actor) THEN RAISE EXCEPTION 'Test seller required'; END IF;
 INSERT INTO rr_sandbox.seller_accounts(seller_id) VALUES(p_actor) ON CONFLICT DO NOTHING;
 UPDATE rr_sandbox.seller_accounts SET phase='dispatched',updated_at=now() WHERE seller_id=p_actor AND phase='prepared';
 GET DIAGNOSTICS n=ROW_COUNT;
 RETURN jsonb_build_object('claimed',n=1,'sellerId',p_actor);
END $$;
CREATE FUNCTION public.rr_test_save_seller(p_actor uuid,p_account text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE s rr_sandbox.seller_accounts;
BEGIN
 IF p_account IS NULL OR p_account !~ '^acct_[A-Za-z0-9]+$' THEN RAISE EXCEPTION 'Invalid account'; END IF;
 SELECT * INTO s FROM rr_sandbox.seller_accounts WHERE seller_id=p_actor FOR UPDATE;
 IF NOT FOUND OR s.phase NOT IN ('dispatched','known') OR (s.phase='known' AND s.account_id<>p_account) THEN RAISE EXCEPTION 'Invalid binding'; END IF;
 UPDATE rr_sandbox.seller_accounts SET phase='known',account_id=p_account,updated_at=now() WHERE seller_id=p_actor;
 RETURN jsonb_build_object('saved',true);
END $$;
REVOKE ALL ON FUNCTION public.rr_test_seller_context(uuid),public.rr_test_claim_seller(uuid),public.rr_test_save_seller(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.rr_test_seller_context(uuid),public.rr_test_claim_seller(uuid),public.rr_test_save_seller(uuid,text) TO service_role;
COMMIT;
