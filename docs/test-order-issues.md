# Buyer order reports — staging only

November 2, 2026 (Pacific). Part of the Depop-model marketplace work in PR #25.

Implemented: a private buyer report for not received, damaged, or significantly not as described. The server derives buyer identity from fresh Supabase authentication and restricts it to the configured staging members. The SQL verifies order ownership and recorded payment, saves one report per order under an order lock, and keeps retries idempotent. A different category cannot replace a saved report. No free text, evidence documents, addresses or payment credentials are collected by this feature.

The report preserves ledger balances, retains fraud blocks, marks risk for review, holds pending label/seller-notice jobs and adds a held review task. It never calls Stripe, issues money, sends messages, creates a label, releases a payout or asserts buyer-protection eligibility. Existing held risk cannot be cleared by automatic rechecks. Already dispatched labels cannot be recalled by a report; review must handle them separately.

Deployment: apply `supabase/test/20261102_order_issues.sql` only to the isolated staging project after `20261030_order_ledger.sql`. Then enable `RACK_RELIC_TEST_ORDER_ISSUES_ENABLED=true` only on the existing protected preview branch. The flag defaults off; main/production remain rejected by the surrounding runtime. Sign in as the synthetic buyer, refresh orders and open Report a test order problem. Check status, submit a category, reload and check the saved report. Repeat as the seller and verify no buyer controls or access. No remote migration or flag activation has been performed by this change.

Still required for launch: evidence exchange, seller replies, operator assignment beyond the acknowledgment queue and resolution authority, notification delivery, refund/return execution, payout/dispute coordination, and legally reviewed protection terms. The intended 30-day reporting window is not enforced here: the current ledger lacks a trusted purchase timestamp distinct from order preparation and webhook processing. Preserve reports for manual review rather than incorrectly rejecting a buyer using a guessed payment date. No public protection promise is enabled. Add reliable purchase-time evidence before deciding automatic eligibility.

Automated coverage includes PostgreSQL execution, ownership and database grants, duplicate/mismatched reports, paid-order gating, fulfillment holds, preserved ledger and fraud blocks, strict HTTP input, authenticated buyer derivation, disabled/production routing and sign-out privacy. Hosted acceptance remains blocked by dashboard sign-in and remote staging activation.


## Operator acknowledgment queue

The private test page now includes an operator queue when both `RACK_RELIC_TEST_ORDER_ISSUES_ENABLED=true` and `RACK_RELIC_TEST_ISSUE_REVIEW_ENABLED=true` are set. Apply `supabase/test/20261102_order_issues_review.sql` after `20261102_order_issues.sql` in isolated staging. Reuse only the explicitly configured staging refund-operator allowlist and existing refund flags; ordinary members cannot read or acknowledge this queue. The SQL additionally limits it to orders in which that test operator participates. This is synthetic-test authority, not a production support role or permission grant.

Unacknowledged reports sort first. The queue shows up to 100 reports and flags additional records; a production paging/search workflow is still needed. One acknowledgment per order stores the first actor and database timestamp in a private, backend-only audit table. Retries and a second operator cannot replace the original audit entry. Public responses do not disclose the acknowledging actor. Sign-out and newer order refreshes prevent late requests from restoring the private queue.

Acknowledgment means only that a test operator marked a report for follow-up. It does not close or adjudicate the issue, change the buyer's report, notify anyone, clear fraud/review holds, release jobs, or change any accounting. Buyer reporting still shows review required. The separate held review task remains held for the future resolution workflow.

Hosted acceptance: with features enabled only on the existing protected preview, create one synthetic buyer report, verify ordinary members cannot read the operator queue, sign in as the configured participating operator, acknowledge once, refresh and confirm the acknowledgment remains. Check the original buyer report and all risk/financial/fulfillment holds remain unchanged. Repeat after sign-out and with lost responses. These hosted checks and both remote migrations remain pending; the local suite exercises the SQL, HTTP, authorization and client behavior without provider calls.
