# Isolated test checkout and order backend

This branch connects a private test checkout page to the separate staging database and Stripe test account. Public checkout remains closed. Production is not changed. The test page is `/api/test-marketplace` on the `test-only-marketplace-foundation` Vercel preview only, behind existing Vercel Standard Protection and an additional staging-member allowlist.

## What is implemented

The private page signs in through staging Supabase Auth using a password or a one-time email link, reserves a synthetic $25 jacket, adds the 4% buyer fee, obtains a Stripe test tax calculation, and opens hosted Stripe Checkout. Shipping is explicitly a **$5 simulation**. No carrier quote, postage purchase or seller payout occurs. Buyer and seller views read their own orders from the server. Returning from Stripe is never treated as proof of payment.

The server derives price and identity from the authenticated reservation. It persists immutable quote evidence before creating Checkout, atomically claims one creation attempt, saves the session ID before attachment, and recovers known sessions with GET only. An uncertain creation with no saved session remains held for reconciliation; a retry cannot blindly create another payment. Competing requests with different destinations cannot silently use each other's quote.

Apply these first-install migrations in order to isolated staging only:

1. `supabase/test/20261030_order_ledger.sql`
2. `supabase/test/20261030_payment_recovery.sql`
3. `supabase/test/20261030_checkout_attempts.sql`

All three were applied to staging on October 30, 2026. The seven private tables have RLS enabled and no browser grants. The ten public RPC functions are callable only by `service_role`. No migration changes public inventory, production auth or Storage. The synthetic fixture is separate from the real catalog.

The payment transaction deduplicates provider events, validates session/order/totals, updates inventory, writes a balanced ledger and creates held jobs. Unpaid completion holds inventory; verified delayed failure releases the unpaid claim. Late payment conflicting with another reservation enters review/suspense. Payment success alone does not release fulfillment or payouts. Fraud assessment and manual review remain separate gates.

The branch also implements **refund receipt and accounting**, behind an off-by-default activation flag. `supabase/test/20261030_refund_receipts.sql` is a fourth migration, tested locally but **not applied to staging**. It binds PaymentIntents from signed Checkout events and accepts signed `refund.created`, `refund.updated` and `refund.failed` notifications. Partial/full successes, pending/action-required refunds and failures are distinct. Duplicate events cannot duplicate accounting; a later failure appends a balanced reversal. Ambiguous same-second or contradictory events remain held for reconciliation. Refunds never relist inventory, allocate tax/fees speculatively or release fulfillment. No refund-creation API or customer refund button is enabled. See [refund activation and acceptance](test-refund-acceptance.md).

An **operator-only test refund request API** is now implemented, also disabled by default. The fifth migration, `supabase/test/20261030_refund_requests.sql`, is tested locally but **not applied to staging**. A configured allowlisted operator is reauthenticated for every request operation. The server freezes the order/payment/amount and records a durable dispatch before one Stripe POST. It verifies the exact sandbox, successful PaymentIntent, captured charge, dispute status and remaining refundable amount. A known refund resumes with GET only. An unknown creation remains held even after Stripe's idempotency window; a matching signed receipt can recover its lost ID. HTTP responses never book refunded money. See the same activation guide for the additional flags and operator configuration.

## Runtime and configuration

`server/test_marketplace_runtime.cjs` requires the exact preview environment/branch, staging project origin, test Stripe account, test keys and two configured staging member IDs. It returns 404 elsewhere. Server keys never reach the browser. `test_checkout_service.cjs` coordinates reservations, trusted quotes and durable attempts. `test_order_repository.cjs` verifies Supabase Auth for each member operation and refuses the production project. The browser receives only a publishable key and synthetic item details.

Branch-specific Preview settings:

- `RACK_RELIC_TEST_SUPABASE_URL`
- `RACK_RELIC_TEST_SUPABASE_SERVER_KEY` (private)
- `RACK_RELIC_TEST_STRIPE_KEY` (private test key)
- `RACK_RELIC_TEST_STRIPE_ACCOUNT`
- `RACK_RELIC_TEST_SUPABASE_PUBLISHABLE_KEY`
- `RACK_RELIC_TEST_MEMBER_IDS` (existing staging users; do not commit their values)
- `RACK_RELIC_TEST_CHECKOUT_ENABLED=true`

`/api/test-setup-status` is the older read-only connection check; its `checkout: disabled` field describes the public checkout gate. The private route has its own explicit enablement and authorization checks.

## Deployed payment notification receiver

The approved receiver is deployed as Supabase staging function `stripe-test-events`. The function's legacy JWT check is off because Stripe does not send a Supabase token. Instead, the receiver verifies the raw-body Stripe signature, timestamp, exact permitted event types, test mode and event/session identity before any database write. Its signing secret is stored only in staging Edge secrets as `RACK_RELIC_TEST_WEBHOOK_SECRET`.

The active Stripe test destination sends `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed` and `checkout.session.expired`. Dashboard-created snapshot events use `2026-09-30.endive`, the stable version offered there. The Checkout client pins `2026-10-28.endive`; the Tax client retains its existing `2025-02-24.acacia` pin. These distinct versions are intentional and must be tested together before launch. No live account default was changed.

`node scripts/build-test-webhook.cjs` deterministically produces `supabase/functions/stripe-test-events/index.mjs` from the same signature validator used by the server and the Edge runtime. The dashboard deployment uses that exact generated JavaScript as `index.ts`. An actual unsigned request to the deployed receiver returned HTTP 400, confirming the signature gate is active. This is not evidence of a successful payment delivery.

## Validation and remaining work

Use Node 22+, `npm ci --ignore-scripts`, then `npm test`. The PostgreSQL tests use PGlite, plus simulated HTTP transports for Auth, PostgREST and Stripe. Tests cover immutable pricing, simultaneous clicks, uncertain creation/attachment, saved-session recovery, signature rejection, replay, delayed outcomes, balanced accounting, access isolation and buyer/seller views. These tests do not replace deployed acceptance tests or concurrent Supabase load testing.

A prior real Stripe test API smoke check created/retrieved an unpaid $34.10 session with simulated shipping/tax. It did not complete a payment. The newly integrated private checkout still needs authenticated browser acceptance, successful signed notification delivery, declined/cancelled/repeated attempts and a complete refund cycle. Do not claim these have passed until provider and database evidence agree.

Still outstanding: real carrier quote/label/tracking integration, tax transaction/reversal jobs, actual fee reconciliation, seller onboarding, transfers/payouts, refund deployment/provider acceptance and ambiguous-evidence reconciliation, notifications, operator/dispute UI and checkout abuse limits. Pending jobs are not evidence those workers ran. Fulfillment and payout jobs remain held.

### Cloud verification on October 30, 2026

- Baseline: 205 tests passed. After refund receipt/accounting and order-view additions: **227 tests passed**, including actual PostgreSQL execution in PGlite and signed Node/Edge-to-SQL tests. These are local tests in the cloud executor, not deployed Supabase acceptance or multi-connection load tests.
- The connected Stripe context was verified as `acct_1UWJZuGVbz9Pnhxd`, `livemode=false`. Listing all Checkout sessions returned two open/unpaid sessions; listing refunds and the seven checkout/refund event types returned no results, with no additional pages. There is still no successful integrated payment/refund evidence.
- The approved endpoint `we_1UWLjuGVbz9Pnhxdx69sMqDI` is enabled at the staging Edge URL and still subscribes only to the original four Checkout event types. No destination settings were changed.
- An unsigned cloud POST to the staging receiver returned **400**. Unauthenticated access to the private preview redirected (**302**) instead of exposing the page. Protection was not changed.
- This cloud session has GitHub and Stripe access, but no authenticated Supabase/Vercel management connection or staging database credential. It did not apply the refund migration, redeploy the Edge function, set its activation flag or add refund subscriptions. The existing deployed receiver remains in its prior checkout-only configuration.
- The password-free sign-in is still awaiting email receipt and same-profile callback verification. No browser credential was requested, extracted or transferred.

Cloud continuation: **250 tests now pass** after operator refund dispatch/recovery was added. Tests include lost POST responses and database saves, webhook-before-response races, recovery after the idempotency retention window, financial identity isolation, disputed/refunded charge rejection, receipt linkage, grants and disabled-route checks. Stripe was read again and still returned two open/unpaid Checkout sessions and no refunds, with no additional pages. No refund POST was sent to Stripe by this cloud work. Neither refund migration nor Edge/Preview refund activation settings were applied remotely. All implementation and tests ran without the owner's Mac.

## Launch preparation

The owner deferred paid Vercel/Supabase upgrades until immediately before launch. Do not buy plans or enable paid overages during routine testing. Recheck pricing and staging organization placement then. Before launch configure usage/billing alerts, independent monitoring, database and photo backups with a restore test, and load/payment acceptance checks. The deployed site must operate without an active Mac or Codex chat. Keep customer checkout closed until full purchase, failure, fulfillment and refund flows pass and live launch receives separate approval.

## Test account recovery

The private page offers email sign-in without changing the existing test account or password. The browser requests `/auth/v1/otp` with `create_user=false`, an S256 PKCE challenge and the exact private preview callback. Only the initiating Chrome profile retains the short-lived verifier; callback exchange verifies the returned email and the server still enforces the staging member allowlist. Auth codes are removed from the address bar before further requests. Secrets and tokens are not logged. Open the email link in the same profile used to request it. Requests have a timeout and clear delivery/expiry errors. Staging uses Supabase default mail delivery, whose recipient restrictions must be verified before claiming successful email delivery. No custom SMTP or paid service was added. See [Supabase email sign-in](https://supabase.com/docs/guides/auth/auth-email-passwordless).
