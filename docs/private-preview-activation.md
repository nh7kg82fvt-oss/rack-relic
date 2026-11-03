# Private preview activation and acceptance

Prepared November 2, 2026 (Pacific). This is a staging checklist, not a production launch instruction. Keep PR #25 draft, preserve preview protection, and leave public checkout closed.

## Confirm the targets before changing anything

- Vercel: existing Rack Relic project, Preview environment, branch `test-only-marketplace-foundation` only.
- Supabase: isolated test project `zvtaqzcqfdjpuwnlpzln`. Never apply these test migrations to production `zrfztnbyynrdzfeblkeq`.
- Stripe: existing Rack Relic sandbox, `livemode=false`. No live keys, real merchant identities or real bank details in acceptance fixtures.
- Confirm the deployed commit matches the current PR head, and existing private checkout and authentication still work. A passing local suite is not hosted acceptance.

## Apply only the pending schema additions

Inspect existing staging migration state first. Do not blindly reapply earlier checkout/refund migrations or reset synthetic orders that have payment evidence. The new additions are:

1. `supabase/test/20261102_seller_onboarding.sql` after the existing order schema, if not already applied.
2. `supabase/test/20261102_order_issues.sql` after the existing order schema.
3. `supabase/test/20261102_order_issues_review.sql` after step 2.
4. `supabase/test/20261102_order_issues_thread.sql` after step 3.
5. `supabase/test/20261102_order_issues_review_refunds.sql` after step 3 and the existing installed refund-request schema.
6. `supabase/test/20261103_seller_protections.sql` after the above plus existing charge-fee, fulfillment, label and tracking migrations. This immediately enforces seller-verification and exposure gates; follow [protection activation](prelaunch-seller-protections.md) before applying it. Do not reset historical orders or assume disabling its UI flag removes its database guards.
7. `supabase/test/20261103_provider_risk_holds.sql` after step 6. Rebuild/deploy the staging webhook receiver and configure only its sandbox event subscription before enabling dispute processing. Do not acknowledge unbound or failed notices as processed.
8. `supabase/test/20261103_startup_policy.sql` after steps 6–7 adds the stricter $100/one-unsettled-order global pilot gates, the two-business-day clock calculation, and the money-job dispatch lock. Existing unresolved fixtures continue to count; do not reset them or treat sample delivery as real delivery.
9. `supabase/test/20261103_fee_policy_v2.sql` preserves historical 4% order evidence and selects the approved 5% plus $0.50 once per order for new reservations. Deploy the matching version-aware server before new quotes are attempted.
10. `supabase/test/20261103_seller_costs.sql` after step 9 and the charge-fee dependencies requires an immutable disclosure and authenticated seller consent before new v2 Checkout dispatch. It freezes disclosed quotes and stores bounded reserve/actual cost allocations; it cannot release money. Follow [fee and cost acceptance](fee-policy-and-seller-costs.md).

Verify new tables have RLS enabled and anon/authenticated roles cannot invoke their RPCs or read their tables. Server-only RPCs accept actor IDs only from freshly verified server authentication. Never expose the Supabase server key in the browser, repository or chat.

## Enable only the matching preview features

After schema and deploy checks, use the existing preview-scoped environment configuration:

- `RACK_RELIC_TEST_SELLER_ONBOARDING_ENABLED=true` for seller acceptance.
- `RACK_RELIC_TEST_ORDER_ISSUES_ENABLED=true` for buyer reports.
- `RACK_RELIC_TEST_ISSUE_REVIEW_ENABLED=true` for the operator queue.
- `RACK_RELIC_TEST_ISSUE_RESPONSES_ENABLED=true` for shared issue updates and seller responses; this also requires the buyer-report flag.
- `RACK_RELIC_TEST_ISSUE_REFUND_REVIEW_ENABLED=true` for read-only refund readiness and staging an amount in the existing local refund-review flow. The report flag and configured refund-operator access are also required.
- `RACK_RELIC_TEST_SELLER_PROTECTIONS_ENABLED=true` records a fresh provider-readiness projection when the seller checks their status, and exposes operator-only protection reviews/one-way seller holds. Seller onboarding must be enabled and the migration installed first. All transfer/payout controls remain disabled.
- `RACK_RELIC_TEST_DISPUTE_HOLDS_ENABLED=true` on the staging webhook receiver activates signed dispute/early-fraud holds after migration 7. Closed or won notices remain held for review. No automatic refund, debit or transfer reversal is issued. Preserve and reconcile unknown provider identities and response deadlines.
- `RACK_RELIC_TEST_SELLER_COSTS_ENABLED=true` exposes the private seller cost review/consent rehearsal after migrations 9–10 and matching code installation. Only an explicitly configured synthetic server quote can prepare test ceilings; browser amounts are never authority. The full provider schedule stays incomplete and payouts stay held. Do not invent a live cost schedule to make a test pass.

The review queue also requires the existing explicit refund-operator allowlist and refund flags. Do not widen that allowlist or remove the runtime's two-member staging restriction just to make a test pass. The SQL restricts this synthetic operator queue to orders the operator participates in. It is not a production admin role. If a dependency is missing, keep that feature off and resolve its specific dependency.

## Hosted evidence to capture

| Flow | Acceptance evidence |
| --- | --- |
| Seller setup | Authenticated synthetic seller; one bound test account; hosted Stripe return and incomplete verification; fresh provider status; simultaneous starts do not create two accounts. No transfers or payouts enabled. |
| Fee and seller-cost consent | New $25 v2 order has a $1.75 buyer fee once, plus current test shipping/tax. Seller reviews and accepts the exact immutable disclosure before buyer dispatch. Buyer/foreign acceptance, wrong hash, changed quote and historical repricing fail. Unknown costs remain pending. |
| Buyer report | Paid synthetic buyer order; report category saved; refresh preserves report; duplicate does not create a second record; changed category cannot overwrite original; unrelated member and seller cannot report as buyer. |
| Operator queue | Ordinary member denied; configured participating operator sees report; one acknowledgment persists after refresh; retries retain first audit actor/time. |
| Seller response | Buyer/seller can read only their own shared issue. Only the seller submits a structured response; identical retry preserves it; a different response cannot replace it. The operator queue shows the same response. Sign-out suppresses late responses. |
| Issue refund review | No report: no readiness. Unacknowledged: acknowledge first. Pending/unknown/failed or conflicting refunds: no new preparation. Partial confirmed refund: remaining amount can be staged locally for review. Fully refunded: no new request. Existing saved references are preserved. No readiness/staging action sends a refund. |
| Financial and fulfillment holds | Buyer report remains open; acknowledgment does not alter risk, jobs or ledger, issue a refund, generate postage, send email or transfer money. |
| Session privacy | Sign out during each in-flight read/write; late responses cannot restore private content or dispatch a follow-up request as the previous user. |
| Environment isolation | The same feature actions return 404 on main/production; no test secret is published; preview remains protected. |

Use synthetic fixtures only. No test emails to real marketplace members. Record failures and ambiguous provider outcomes before retrying. Do not replace an unknown seller account or payment/refund reference.

## Separate live launch work

Business/bank/identity verification for Rack Relic, live Connect eligibility, seller settlement and payouts, guardian onboarding, operational returns/disputes, tax recording/reversal, real shipping, notifications and recovery acceptance remain separate. Reports and acknowledgments do not constitute a buyer-protection program. The 30-day policy needs trusted purchase-time evidence before automatic eligibility can be enforced. Keep customer promises aligned to implemented operations.

Use [the complete launch acceptance matrix](payment-launch-acceptance.md) to keep
local coverage, recorded legacy hosted results and current missing evidence
separate. The stitched local payment journeys do not complete hosted acceptance.
