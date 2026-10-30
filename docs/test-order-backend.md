# Isolated order backend: integration handoff

This branch contains an executable PostgreSQL order ledger plus server-side adapters. On October 30, 2026, the ledger was installed and verified in the existing isolated staging project. It is not connected to the public catalog. Existing public checkout remains closed. The only new route is a read-only setup status check, limited to this preview branch; no payment, order-write or webhook route is exposed.

## Validation

Use Node 22 or later, run `npm ci --ignore-scripts`, then `npm test`. The pinned PGlite development dependency runs the SQL using PostgreSQL compiled to WebAssembly; production handlers do not import it. The suite currently contains 176 passing tests.

The database tests execute the migration and cover competing reservation requests, self-purchase/hidden/sold rejection, locked price/visibility, invalid snapshots, duplicate/unpaid/paid/expired events, delayed failures, out-of-order outcomes, balanced ledger entries, late payments after re-reservation, role restrictions, fraud holds and private member views. The HTTP adapter/signature tests reach the same SQL transactions through a simulated PostgREST transport. They are not multi-worker Supabase load tests or proof of cloud configuration.

## Schema and isolation

`supabase/test/20261030_order_ledger.sql` creates private `rr_sandbox` tables for a **synthetic test catalog**, orders, provider-event deduplication, ledger entries, fulfillment jobs and risk assessments. It does not modify `public.listings` or production Storage/auth policies. It is a first-install migration, not a repeatedly runnable updater. Apply `20261030_payment_recovery.sql` next; it preserves service-only access while adding `payment_pending` and `payment_failed` states, updating inventory claims and backfilling previously observed unpaid completions. Both migrations were applied to isolated staging on October 30, 2026.

Apply it only to a selected, isolated test Supabase project after reviewing that project's schema and roles. The service-role-only public RPCs are:

| RPC | Purpose |
| --- | --- |
| `rr_test_reserve` | Atomically claim one test listing for one buyer; repeat order IDs are idempotent |
| `rr_test_attach_checkout` | Bind one test session, immutable totals, tax calculation, rate, destination hash and expiry |
| `rr_test_process_event` | Atomically deduplicate a verified event, transition the order, mark inventory sold, balance the ledger and queue held jobs |
| `rr_test_record_risk` | Audit fresh test risk evidence and hold or release eligible job states; never execute a job |
| `rr_test_member_orders` | Return limited order fields for the authenticated buyer/seller supplied by the server |

All financial tables have RLS enabled with no browser grants. RPC execution is revoked from PUBLIC, anon and authenticated; only service_role receives it. A paid order holds tax/postage/seller liabilities separately. Processing fees are not guessed. A duplicate event cannot create another ledger balance or job. A late paid event conflicting with another reservation enters a review/suspense path instead of assigning the same item twice. Local timeouts do not release open provider sessions. Unpaid completion holds inventory in `payment_pending`; a late expiry cannot release it. Verified asynchronous failure releases only an unpaid order. A subsequent success conflicting with another reservation goes to manual review with balanced suspense entries. A late failure cannot reverse a paid sale.

## Runtime modules

- `test_order_repository.cjs` accepts only a separate Supabase project origin and a server key; it explicitly rejects the known production project, origin substitutions, non-service JWTs and cached authority. It validates the member through Supabase Auth before reservation/list requests. A caller cannot supply another member's UUID. Secrets are never written to this repository.
- `test_order_handlers.cjs` provides an orders-read handler and a bounded raw-body Stripe webhook handler. Both default to 503 until deliberately enabled with a repository. The webhook checks signatures/test mode before calling the atomic database RPC. These factories are not exported under `/api` yet.
- `marketplace_test_checkout.cjs` provides `retrieveCheckout({sessionId, snapshot})` for a known test session and its trusted persisted totals. It performs a bounded GET, validates identity/amount/test mode and rejects cached or contradictory evidence. It returns limited status fields and an open-session URL; it never recreates Checkout, writes the ledger or releases inventory. A complete/unpaid session is reported conservatively as pending; only the verified failure event establishes failure. An unknown session ID or a missing response requires durable attempt reconciliation, still outstanding.
- The test Checkout request pins `2026-10-28.endive`, verified against [Stripe API versioning](https://docs.stripe.com/api/versioning) on October 30, 2026. It omits the removed `payment_method_types` parameter, uses a fixed integration identifier so retries retain identical parameters, keeps the existing card authentication request, and disables Adaptive Pricing for the USD-only ledger. Existing Tax (`2025-02-24.acacia`) and setup-status (`2026-09-30.endive`) pins were not changed; no account default or webhook endpoint version was changed. Non-card payments remain held for manual risk review by the existing conservative risk gate.
- The existing test Checkout and Tax clients can provide immutable amount snapshots. Map `listing_updated_at` from the reserved order into the listing/Shippo quote snapshot. Persist an order-bound, expiring carrier rate and destination hash before creating Checkout.
- `stripe_test_risk.cjs` evaluates fresh provider evidence and returns explicit hold/block/clear reasons. It does not fetch Stripe itself or make financial decisions from browser-supplied fields. See [card fraud controls](card-fraud-controls.md).

## Remaining deployment work

The existing staging Supabase project was inspected and the test ledger installed. Cloud SQL checks verified six RLS-protected tables, five service-role-only RPCs, retry-safe reservation, payment-event deduplication, balanced accounting, initial and reviewed fraud holds, and unrelated-member isolation. Additional cloud SQL checks verified pending-payment holds, late expiry, delayed failure, replay, reservation reuse, late-success review, balanced suspense entries and retained RPC permissions. All synthetic verification rows were rolled back; the catalog and order tables remain empty. Production data and policies were not changed.

Vercel retains Standard Protection on previews. Test credentials use the branch-specific `RACK_RELIC_TEST_SUPABASE_URL`, `RACK_RELIC_TEST_SUPABASE_SERVER_KEY`, `RACK_RELIC_TEST_STRIPE_KEY` and `RACK_RELIC_TEST_STRIPE_ACCOUNT` settings. No secret values belong in source control. `/api/test-setup-status` checks the staging RPC connection and Stripe account identity/test mode, returns no keys, account IDs or financial data, and always reports checkout disabled. It returns 404 outside the exact test preview branch and rejects live keys or a production database before sending any request. Configuration/deployment is only verified when that deployed endpoint returns ready. Do not create a billable project or paid service without the required authorization.

A real Stripe sandbox smoke check created and retrieved one unpaid USD 34.10 Checkout Session using the client-generated parameters (25.00 synthetic item, 1.00 fee, 5.00 simulated shipping, 3.10 simulated tax). Returned totals, metadata, test mode and dynamic methods matched. The retrieved response also passed the local reconciliation validator. This connector check does not verify the application HTTP request version, real tax/quote calculation, a completed payment, a webhook delivery or an end-to-end purchase. The unused test session expires automatically; no card, real payment or transfer was used.

Before adding public wrappers, implement authenticated reservation/quote/Checkout orchestration; seed/import only synthetic test catalog data; configure raw webhook bodies; reconcile uncertain Checkout creation/attachment rather than blindly retrying; and confirm that test identities/keys cannot address production data. The synthetic test catalog must not be represented as real inventory.

Still outstanding: the customer-facing order screens, shipping-rate persistence and label/tracking workers, tax transaction recording/reversal jobs, actual fee reconciliation, seller onboarding and transfer/payout/refund workers, notification delivery, operator review and dispute tools, checkout attempt/bot limits and full deployed acceptance tests. Pending jobs in this schema are not evidence those integrations have executed. No shipping, notification or payout worker exists yet.

The current app must retain its disabled Buy button and preview manifest until a complete isolated purchase/fulfillment/refund cycle is verified and live launch receives its separate approval.

## Launch preparation deferred by the owner

Keep development on the isolated test branch and defer Vercel/Supabase paid upgrades until just before customer launch. Recheck pricing then, move staging to a separate free organization if supported and suitable, and upgrade only the production services that need paid capacity. Do not purchase or enable paid overages as part of routine testing.

Before launch, configure billing and usage alerts, review service-pause settings, verify database and separate listing-photo backups with a restore exercise, set up independent availability monitoring, and complete load and payment acceptance tests. The deployed application must run without an active Mac or chat session; uptime depends on its hosting, database and payment services. Keep live checkout disabled until the complete purchase, failure, fulfillment and refund flows pass and live launch is approved.
