# Stripe-hosted seller onboarding — private sandbox only

Updated November 3, 2026. Accounts v2 source prepared in draft PR #27; not activated or provider-accepted.

The existing private preview can expose seller setup using the separate off-by-default `RACK_RELIC_TEST_SELLER_ONBOARDING_ENABLED=true` flag. It still requires the exact preview branch, isolated staging origin, test platform account and member allowlist. No production route or real seller onboarding is enabled.

Apply `supabase/test/20261102_seller_onboarding.sql` once to isolated staging, after the existing test schema. It creates one private RLS table and three backend-only RPCs. Do not apply it to production. No bank details, identity documents, credentials or temporary onboarding URLs are stored. A seller must own an existing synthetic catalog fixture. The server derives the seller from current Supabase authentication; the browser cannot select another seller or an account ID.

Starting setup atomically claims account creation before one Stripe test request. Two simultaneous requests cannot create two accounts. Account metadata binds the account to the seller and fixed Rack Relic sandbox. Provider account and test balances are checked before generating a short-lived hosted link. Creation timeouts and lost saves stay held: an unknown account is not replaced or retried. Operators must reconcile its exact `rr_test_seller_id` and `rr_test_platform` metadata in the same Stripe sandbox. A recovery/adoption action is not implemented; preserve the attempt.

New accounts use `/v2/core/accounts` with recipient-only capability configuration, and hosted setup uses `/v2/core/account_links`. The adapter verifies the exact account, test-only `accounts.stripe.com` link, use case, recipient configuration, return/refresh destinations and RFC3339 expiry. A known account can receive a fresh link. Stripe collects the verification details and presents its agreement to the seller. Returning to Rack Relic does not establish completion: a fresh authenticated Accounts v2 read checks test mode, recipient configuration, US identity country, Express access, application fee/loss responsibility, Stripe requirement collection and the recipient stripe_transfers capability. Every outstanding requirement entry conservatively keeps the rehearsal closed. An existing bound account is read through v2; incompatible legacy evidence stays held without creating a replacement. Even `provider_ready` always reports transfers/payouts disabled. No transfer or payout API exists in this workflow. Payout scheduling, delivery gates, reserves, commissions, refunds after transfers and disputes remain separate launch work.

The private UI guards duplicate clicks and late responses after sign-out. Links are returned only to the authenticated seller and never emailed or logged. Invalid provider hosts or expired links cannot redirect the user. The return/refresh destination is the fixed private test page; the user rechecks status and chooses Continue to request a replacement hosted link. No background account creation occurs on return.

The full local suite passes 657 checks with synthetic provider transports. New tests cover v2 request shape and fresh readiness, foreign/live account and link rejection, bad expiry/return data, durable creation, legacy binding preservation and sign-out privacy.

Acceptance still required: authenticated staging seller creation, hosted test verification, return/refresh and incomplete verification, permission loss, provider-error reconciliation, account-update notification handling and deployed backend permissions. Local SQL and simulated-provider tests are not proof of Stripe Connect access or live seller eligibility. Live account selection, provider approval and financial terms must be verified before adapting this to production.

References:
- https://docs.stripe.com/api/v2/core/accounts/create
- https://docs.stripe.com/connect/marketplace/tasks/onboard
- https://docs.stripe.com/api/v2/core/account-links/create
