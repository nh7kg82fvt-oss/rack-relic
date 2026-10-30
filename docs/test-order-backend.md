# Isolated order backend: integration handoff

This branch contains an executable PostgreSQL order ledger plus server-side adapters. On October 30, 2026, the ledger was installed and verified in the existing isolated staging project. It is not connected to the public catalog. Existing public checkout remains closed. The only new route is a read-only setup status check, limited to this preview branch; no payment, order-write or webhook route is exposed.

## Validation

Use Node 22 or later, run `npm ci --ignore-scripts`, then `npm test`. The pinned PGlite development dependency runs the SQL using PostgreSQL compiled to WebAssembly; production handlers do not import it. The suite currently contains 158 passing tests.

The database tests execute the migration and cover competing reservation requests, self-purchase/hidden/sold rejection, locked price/visibility, invalid snapshots, duplicate/unpaid/paid/expired events, balanced ledger entries, late payments after re-reservation, role restrictions, fraud holds and private member views. The HTTP adapter/signature tests reach the same SQL transactions through a simulated PostgREST transport. They are not multi-worker Supabase load tests or proof of cloud configuration.

## Schema and isolation

`supabase/test/20261030_order_ledger.sql` creates private `rr_sandbox` tables for a **synthetic test catalog**, orders, provider-event deduplication, ledger entries, fulfillment jobs and risk assessments. It does not modify `public.listings` or production Storage/auth policies. It is a first-install migration, not a repeatedly runnable updater.

Apply it only to a selected, isolated test Supabase project after reviewing that project's schema and roles. The service-role-only public RPCs are:

| RPC | Purpose |
| --- | --- |
| `rr_test_reserve` | Atomically claim one test listing for one buyer; repeat order IDs are idempotent |
| `rr_test_attach_checkout` | Bind one test session, immutable totals, tax calculation, rate, destination hash and expiry |
| `rr_test_process_event` | Atomically deduplicate a verified event, transition the order, mark inventory sold, balance the ledger and queue held jobs |
| `rr_test_record_risk` | Audit fresh test risk evidence and hold or release eligible job states; never execute a job |
| `rr_test_member_orders` | Return limited order fields for the authenticated buyer/seller supplied by the server |

All financial tables have RLS enabled with no browser grants. RPC execution is revoked from PUBLIC, anon and authenticated; only service_role receives it. A paid order holds tax/postage/seller liabilities separately. Processing fees are not guessed. A duplicate event cannot create another ledger balance or job. A late paid event conflicting with another reservation enters a review/suspense path instead of assigning the same item twice. Local timeouts do not release open provider sessions.

## Runtime modules

- `test_order_repository.cjs` accepts only a separate Supabase project origin and a server key; it explicitly rejects the known production project, origin substitutions, non-service JWTs and cached authority. It validates the member through Supabase Auth before reservation/list requests. A caller cannot supply another member's UUID. Secrets are never written to this repository.
- `test_order_handlers.cjs` provides an orders-read handler and a bounded raw-body Stripe webhook handler. Both default to 503 until deliberately enabled with a repository. The webhook checks signatures/test mode before calling the atomic database RPC. These factories are not exported under `/api` yet.
- The existing test Checkout and Tax clients can provide immutable amount snapshots. Map `listing_updated_at` from the reserved order into the listing/Shippo quote snapshot. Persist an order-bound, expiring carrier rate and destination hash before creating Checkout.
- `stripe_test_risk.cjs` evaluates fresh provider evidence and returns explicit hold/block/clear reasons. It does not fetch Stripe itself or make financial decisions from browser-supplied fields. See [card fraud controls](card-fraud-controls.md).

## Remaining deployment work

The existing staging Supabase project was inspected and the test ledger installed. Cloud SQL checks verified six RLS-protected tables, five service-role-only RPCs, retry-safe reservation, payment-event deduplication, balanced accounting, initial and reviewed fraud holds, and unrelated-member isolation. All synthetic verification rows were rolled back; the catalog and order tables remain empty. Production data and policies were not changed.

Vercel retains Standard Protection on previews. Test credentials use the branch-specific `RACK_RELIC_TEST_SUPABASE_URL`, `RACK_RELIC_TEST_SUPABASE_SERVER_KEY`, `RACK_RELIC_TEST_STRIPE_KEY` and `RACK_RELIC_TEST_STRIPE_ACCOUNT` settings. No secret values belong in source control. `/api/test-setup-status` checks the staging RPC connection and Stripe account identity/test mode, returns no keys, account IDs or financial data, and always reports checkout disabled. It returns 404 outside the exact test preview branch and rejects live keys or a production database before sending any request. Configuration/deployment is only verified when that deployed endpoint returns ready. Do not create a billable project or paid service without the required authorization.

Before adding public wrappers, implement authenticated reservation/quote/Checkout orchestration; seed/import only synthetic test catalog data; configure raw webhook bodies; reconcile uncertain Checkout creation/attachment rather than blindly retrying; and confirm that test identities/keys cannot address production data. The synthetic test catalog must not be represented as real inventory.

Still outstanding: the customer-facing order screens, shipping-rate persistence and label/tracking workers, tax transaction recording/reversal jobs, actual fee reconciliation, seller onboarding and transfer/payout/refund workers, notification delivery, operator review and dispute tools, checkout attempt/bot limits and full deployed acceptance tests. Pending jobs in this schema are not evidence those integrations have executed. No shipping, notification or payout worker exists yet.

The current app must retain its disabled Buy button and preview manifest until a complete isolated purchase/fulfillment/refund cycle is verified and live launch receives its separate approval.
