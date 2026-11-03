# Rack Relic protection status before Stripe acceptance

November 2, 2026 (Pacific). Owner instruction: implement protections before live
launch and before accepting the pending Connect agreement. That agreement is
**not accepted by this work**. Public checkout, transfers and payouts stay closed.

This change is based on PR #25 at `ef377f4590f1eb141afe4c7b7578d531c4da5533`
in a separate checkout and branch. It does not alter the site-testing checkout,
its monitor, existing test fixtures, production database or provider settings.

## Implemented safeguards, awaiting staging installation

| Safeguard | Enforcement |
| --- | --- |
| Verified sellers | A fresh server-side read checks the bound Stripe sandbox account, US country, submitted details, transfer capability, payout status, outstanding requirements and pending verification. Only the authenticated seller can record the small readiness projection. No documents or bank details are copied. |
| Verification expiry | Database checks require evidence no older than five minutes. Older responses cannot replace a newer restriction. An equal-time restriction wins. Missing evidence blocks checkout. |
| New-seller limits | The isolated database caps full test orders at $300, unsettled claims at five orders and unsettled gross at $1,000 per seller. These conservative test values are not approved live policies. A seller lock serializes claims across listings. Final totals include shipping, tax and the existing buyer fee. |
| Uncertain payments | Open, processing, paid and unknown claims continue to count. A locally expired timer or refund request cannot free exposure. Only existing authoritative expiry/failure or safe cancellation of an unused preparation removes the claim. |
| Buyer issues | The existing buyer report creates a sticky review hold. This migration also stops the seller creating or resuming additional app checkouts while an issue, risk hold or refund review exists. Acknowledgments do not resolve issues. |
| Operator seller hold | An explicitly configured participating staging operator can apply a one-way seller hold with a structured reason. The first actor/time/reason are preserved. Provider refresh cannot clear it. No browser clear-hold action exists. |
| Existing checkout recovery | A saved Checkout URL is not returned by the app after a hold or stale verification. Original provider/session references remain intact for reconciliation. A URL already obtained at Stripe is not automatically expired; it may still receive payment. Such funds remain held, and provider expiry/recovery is required before launch. |
| Money-release review | An operator-only read shows verification, payment, ledger, risk, refund, buyer-issue and sample-tracking problems. It always reports release disabled and cannot create a transfer or payout. Unknown fields cannot grant permission. |
| Privacy | New table has RLS; browser roles have no table/RPC access. Server verifies current identity and the existing operator allowlist on every request. Late UI results after sign-out are discarded. |

The SQL guards become mandatory once the migration is installed, even if the
UI flag is later turned off. Turning off the flag is not a way to bypass them.
Orders with missing new seller evidence remain held; historical money records
are not overwritten or reset.

## Protections still required for live use

These are explicit blockers, not completed features or promises to customers:

1. **Real tracked delivery and waiting period.** Bind real carrier notices to the
   paid order, original destination and label. Verify authenticity, replay
   protection, conflicting status and returns. Define and enforce an approved
   waiting period with business days/holidays and provider holding limits.
   Sample `DELIVERED` can never satisfy this gate.
2. **Seller settlement and recovery.** Implement durable separate transfers,
   refund transfer reversals, chargeback/early-fraud notices, negative-balance
   recovery, reconciliation and payout-failure handling. Unknown outcomes must
   never cause duplicate transfers. Recheck holds at the atomic dispatch point.
3. **Fraud operations.** Verify actual Radar availability and account pricing,
   live blocking/review rules, 3DS behavior, gateway/card-testing limits and alerts.
   Existing test risk checks do not establish live Radar configuration.
4. **Seller terms and eligibility.** Approve clear refund/return and recovery
   terms, prohibited inventory rules, delivery obligations, delays and selling
   limits; record authenticated acceptance of their exact version. Require an
   eligible adult seller or a separately verified guardian path. Do not reuse
   Depop's terms, promise its protection program or sign on a seller's behalf.
5. **Business cash cushion.** Wayne must choose and fund the reserve amount.
   Enforce available-balance and outstanding-liability checks before every
   transfer; collected tax and postage are not platform profit. There is no
   invented funded balance or automatic bank-debit authorization here.
6. **Financial and operational acceptance.** Finish tax recording/reversal,
   real shipping, evidence exchange, support ownership and dispute deadlines.
   Reconcile fees, refunds and seller net; fees are unchanged by this PR.
7. **Final approval.** Confirm live provider eligibility and account-specific
   obligations, then obtain explicit agreement acceptance and a separate live
   launch decision. Staging success alone cannot authorize production.

## Activation sequence for this private change

1. Review and integrate this branch into the existing private payments branch;
   do not merge or activate public checkout as part of this work.
2. Inspect installed migrations in staging `zvtaqzcqfdjpuwnlpzln`. Apply missing
   dependencies in `private-preview-activation.md`, then
   `supabase/test/20261103_seller_protections.sql` exactly once. It also needs the
   existing refund requests, actual charge-fee evidence, fulfillment, label and
   tracking migrations. Never apply it to production `zrfztnbyynrdzfeblkeq`.
3. Verify browser-role denial, RLS and server-only grants before enabling UI.
   The migration immediately gates new/continued checkouts until the synthetic
   seller refreshes verification; plan this staging interruption deliberately.
4. Set `RACK_RELIC_TEST_SELLER_PROTECTIONS_ENABLED=true` and the existing seller
   onboarding flag only on the exact private payments preview branch. Preserve
   the two-member staging restriction, existing participating operator allowlist
   and preview access protection. No new operators or credentials are needed.
5. As the synthetic seller, use **Check test seller status** after hosted test
   onboarding. This records the fresh projection. Run checkout promptly; a
   closed browser or elapsed freshness window does not maintain verification.
6. As the configured synthetic operator, use **Check protection holds** and
   **Hold seller for review**. Verify ordinary members are denied, saved session
   recovery is blocked on hold, and refresh/sign-out preserve privacy. Do not
   clear test holds by direct table edits to make acceptance pass.
7. Record hosted evidence for concurrent claims, full-total caps, pending
   payments, report/acknowledgment, unknown refunds, provider restrictions,
   permission loss and sample `DELIVERED`. All money release stays disabled.

## Evidence and limits

Local PostgreSQL tests execute the migrations and real constraints/triggers;
HTTP/provider tests use synthetic transports. Client tests exercise operator
controls and late sign-out responses. Existing browsing and payment tests run
with the changes. Remote migration/flag installation, real Stripe onboarding,
live carrier evidence and full hosted acceptance remain outstanding.

Primary guidance checked November 2, 2026:

- [Stripe marketplace refunds and disputes](https://docs.stripe.com/connect/marketplace/tasks/refunds-disputes)
- [Stripe risk management](https://docs.stripe.com/connect/risk-management/best-practices)
- [Depop US payouts](https://depophelp.zendesk.com/hc/en-gb/articles/9057092334865-How-do-I-get-paid-US)
- [Depop seller protection](https://depophelp.zendesk.com/hc/en-gb/articles/360001845367-Depop-Protection-for-sellers)

These sources support the risk-control approach. They do not prove Rack Relic
has Depop's internal settings, funded protection program or contractual terms.
