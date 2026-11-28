# Refund inventory safety check

This is an additional private-test safeguard. It does not submit live refunds,
change seller recovery policy, clear holds or permit seller payouts.

## Problem and behavior

A refund initiated outside the application can still be pending while the
charge's completed refund total has not changed. Checking only that total can
let the application try a second refund. A local integrated regression
reproduced that missing check before this change.

Before a new test refund POST, the server now compares a fresh, complete,
charge-scoped Stripe refund inventory with the already signed and reconciled
database receipts. Pending or requires-action refunds, unfamiliar completed
refunds, missing or changed prior receipts, duplicate IDs, incomplete lists,
cached evidence and inconsistent totals block creation. An empty or missing
inventory is not a substitute for proof of completeness. A failed or canceled
refund does not use completed-refund capacity, but its identity, amount and
payment binding are still checked.

A confirmed partial refund can be followed by the exact remaining amount only
when the saved IDs, charge IDs, individual amounts and total agree with Stripe.
An equal aggregate total with substituted refund IDs is insufficient.

The baseline is assembled by a service-only database function while the existing
catalog/order/request locks and settlement dispatch fences are held. The
original dispatcher becomes a private helper; browser roles and the service role
cannot call it directly. Its wrapper returns only prior succeeded refund IDs,
charge IDs and amounts to the trusted server. These identifiers never enter the
public refund response. No new browser arguments, credentials or permissions
are accepted. The adapter copies the baseline before its first asynchronous
provider call; later caller mutations cannot change that comparison.

## Installation and acceptance

Install `supabase/test/20261103_refund_provider_inventory.sql` once, only in the
reviewed acceptance database, after the existing refund-request schema and all
current dispatch guards. It preserves the original function and its history;
it does not reset any records. Deploy the matching refund adapter deliberately.
A missing baseline fails closed before provider access, so new code must not be
mistaken for complete installation. Known refund-ID retrieval and signed receipt
accounting continue through the existing paths.

If provider preflight fails after the durable dispatch claim, keep that request
and its reserved allowance held for reconciliation. Do not clear the claim,
invent a receipt or issue a replacement POST. A successful response still does
not book the refund; matching signed receipt accounting remains required.

Local tests cover the actual repository, PostgreSQL functions and refund adapter
over synthetic provider responses, including a confirmed partial refund followed
by the remaining full refund, stale/mismatched inventories, unresolved refunds,
access denial, lost responses and the existing transfer-recovery fence. These
are not hosted Stripe acceptance or proof that live refunds are ready.

This preflight is not an atomic lock on Stripe. Another authorized Stripe action
can occur after the final read. Signed events, sticky holds, saved request
references, subsequent reconciliation and owner response remain necessary. The
post-transfer funding policy, tax/postage/fee allocation and unrecoverable
post-bank-payout losses remain separate launch blockers.

References: [Stripe refund inventory](https://docs.stripe.com/api/refunds/list),
[refund statuses and bindings](https://docs.stripe.com/api/refunds/object).
