# Buyer order reports — staging only

November 2, 2026 (Pacific). Part of the Depop-model marketplace work in PR #25.

Implemented: a private buyer report for not received, damaged, or significantly not as described. The server derives buyer identity from fresh Supabase authentication and restricts it to the configured staging members. The SQL verifies order ownership and recorded payment, saves one report per order under an order lock, and keeps retries idempotent. A different category cannot replace a saved report. No free text, evidence documents, addresses or payment credentials are collected by this feature.

The report preserves ledger balances, retains fraud blocks, marks risk for review, holds pending label/seller-notice jobs and adds a held review task. It never calls Stripe, issues money, sends messages, creates a label, releases a payout or asserts buyer-protection eligibility. Existing held risk cannot be cleared by automatic rechecks. Already dispatched labels cannot be recalled by a report; review must handle them separately.

Deployment: apply `supabase/test/20261102_order_issues.sql` only to the isolated staging project after `20261030_order_ledger.sql`. Then enable `RACK_RELIC_TEST_ORDER_ISSUES_ENABLED=true` only on the existing protected preview branch. The flag defaults off; main/production remain rejected by the surrounding runtime. Sign in as the synthetic buyer, refresh orders and open Report a test order problem. Check status, submit a category, reload and check the saved report. Repeat as the seller and verify no buyer controls or access. No remote migration or flag activation has been performed by this change.

Still required for launch: evidence exchange and further seller dialogue beyond the structured first response, operator assignment beyond the acknowledgment queue and resolution authority, notification delivery, refund/return execution, payout/dispute coordination, and legally reviewed protection terms. The intended 30-day reporting window is not enforced here: the current ledger lacks a trusted purchase timestamp distinct from order preparation and webhook processing. Preserve reports for manual review rather than incorrectly rejecting a buyer using a guessed payment date. No public protection promise is enabled. Add reliable purchase-time evidence before deciding automatic eligibility.

Automated coverage includes PostgreSQL execution, ownership and database grants, duplicate/mismatched reports, paid-order gating, fulfillment holds, preserved ledger and fraud blocks, strict HTTP input, authenticated buyer derivation, disabled/production routing and sign-out privacy. Hosted acceptance remains blocked by dashboard sign-in and remote staging activation.


## Operator acknowledgment queue

The private test page now includes an operator queue when both `RACK_RELIC_TEST_ORDER_ISSUES_ENABLED=true` and `RACK_RELIC_TEST_ISSUE_REVIEW_ENABLED=true` are set. Apply `supabase/test/20261102_order_issues_review.sql` after `20261102_order_issues.sql` in isolated staging. Reuse only the explicitly configured staging refund-operator allowlist and existing refund flags; ordinary members cannot read or acknowledge this queue. The SQL additionally limits it to orders in which that test operator participates. This is synthetic-test authority, not a production support role or permission grant.

Unacknowledged reports sort first. The queue shows up to 100 reports and flags additional records; a production paging/search workflow is still needed. One acknowledgment per order stores the first actor and database timestamp in a private, backend-only audit table. Retries and a second operator cannot replace the original audit entry. Public responses do not disclose the acknowledging actor. Sign-out and newer order refreshes prevent late requests from restoring the private queue.

Acknowledgment means only that a test operator marked a report for follow-up. It does not close or adjudicate the issue, change the buyer's report, notify anyone, clear fraud/review holds, release jobs, or change any accounting. Buyer reporting still shows review required. The separate held review task remains held for the future resolution workflow.

Hosted acceptance: with features enabled only on the existing protected preview, create one synthetic buyer report, verify ordinary members cannot read the operator queue, sign in as the configured participating operator, acknowledge once, refresh and confirm the acknowledgment remains. Check the original buyer report and all risk/financial/fulfillment holds remain unchanged. Repeat after sign-out and with lost responses. These hosted checks and both remote migrations remain pending; the local suite exercises the SQL, HTTP, authorization and client behavior without provider calls.


## Shared issue updates and structured seller response

Apply `supabase/test/20261102_order_issues_thread.sql` after the review migration. Set `RACK_RELIC_TEST_ISSUE_RESPONSES_ENABLED=true` only on the protected preview after migration/deploy validation; it also requires the existing buyer-report flag. The feature defaults off.

Buyers and sellers can read the report category, report time, operator acknowledgment time and seller response for their own order. A nonparticipant cannot read it. Only that order's seller can submit a response, after a buyer report exists. The first response category and database timestamp persist privately; identical retries return the same record, while a changed category cannot overwrite it. The existing operator queue includes the saved response. No user-supplied actor/account ID is accepted by the browser route.

Response categories are checking the issue, proposing a return for review, or requesting operator review. These are statements/proposals, never return instructions, refund approval or support resolution. There is no free text, evidence attachment, return address, notification delivery or automatic deadline in this feature. Seller and buyer status views keep the issue open. Risk, fulfillment, acknowledgment, original buyer report and accounting remain unchanged. Existing dispatched shipping and future seller settlement still need separate operational handling.

Hosted acceptance: as the synthetic buyer, save a report and read issue updates; as the seller, check the saved issue then submit one response; refresh both accounts and the configured operator queue; verify the response matches and all holds persist. Repeat with duplicated/lost responses, unrelated accounts, sign-out during reads/writes and malformed requests. These hosted checks remain pending; the local automated suite covers SQL/RLS, strict request/receipt validation, member identity, role restrictions, idempotency, unchanged money/holds and stale client responses.


## Refund review from an order issue

Apply `supabase/test/20261102_order_issues_review_refunds.sql` after the acknowledgment schema and existing refund-request schema, then enable `RACK_RELIC_TEST_ISSUE_REFUND_REVIEW_ENABLED=true` only in the private preview. The report flag and explicitly configured refund-operator authority are also required. It defaults off. This is a read-only STABLE database function and GET-only API; neither has a refund-dispatch path.

A report and operator acknowledgment are required before an amount can be offered for review. The function compares actual confirmed/pending receipts with order totals, payment bindings, gross ledger evidence and outstanding saved requests. Unknown requests, pending/failed receipts and conflicting evidence prevent another preparation. A confirmed full refund remains distinct from closing an issue. The operator can review the remaining amount after a confirmed partial refund.

The private page's Prepare remaining test refund for review button rechecks fresh evidence, preserves any existing browser recovery reference, and saves the remaining amount locally using the existing refund-request client. It performs no POST and creates no provider or database refund request. The operator then reviews the amount in Operator test refund and separately chooses whether to issue it through the existing durable request/dispatch/signed-receipt workflow. That workflow still checks authority and available amount server-side; a readiness response cannot bypass those checks. Lost or pending references are never replaced by this shortcut.

Readiness is financial evidence only. It is not a decision that a buyer is entitled to a refund, proof of a returned item, a return shipping instruction or a change to consumer policy. Return requirements, evidence review, taxes/fees, refunds after seller transfers, operational closure and relisting remain separate. The new flow never clears fulfillment/risk holds or sends customer communications. Hosted activation/acceptance remains pending.

The refund replay regression now reuses the original signed event bytes across a duplicate-delivery test; rebuilding an event with the same ID and a new wall-clock timestamp was intermittently testing an event-ID collision rather than a replay. Production collision checks remain unchanged.
