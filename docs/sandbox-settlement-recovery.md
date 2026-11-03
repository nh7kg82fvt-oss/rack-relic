# Seller settlement and recovery rehearsal

This is a **sandbox-only simulation**, not a live seller payout implementation
or permission to release marketplace money. Normal money-release jobs and the
live-readiness blockers remain unchanged. The new server adapter accepts only
test credentials and the fixed Rack Relic sandbox, verifies mode and identity
freshly, and refuses the production environment through the existing runtime.
No actual provider write was made while developing these local tests.

## What the source does

The separate `settlement_sim_*` tables bind one paid v2 order, its authenticated
operator, the seller's connected account, amounts, parent transfer and provider
references. The first transfer retains the seller's entire immutable accepted
maximum cost ceiling, including costs not yet confirmed. It cannot include the
buyer fee, tax, postage or that cost reserve. Later allocations within the agreed
ceiling remain funded; a smaller confirmed cost cannot increase an already
frozen transfer or silently create another one. Unused reserve remains owed to
the seller and held for final reconciliation, not platform profit. Final residual
settlement is still a live-launch requirement. Funding checks use the available net
charge balance and retained liabilities without counting processing fees twice.
Simulation reserves do not establish real business cash or available bank funds.

A new simulated transfer requires fresh seller/risk evidence, a paid balanced
ledger, actual original processing evidence, an accepted seller-cost disclosure,
bounded cost inventory and no unresolved issue/refund/recovery. A matching
marked sample must show delivered and the two-business-day clock must have
elapsed. That sample is explicitly a test delivery simulation; it never clears
the ordinary real-delivery or live-release gates.

New transfers and standard bank payouts additionally check Accounts v2 recipient
transfer capability, expected platform responsibilities, a manual payout
schedule and available test funds. Stripe currently manages payout settings
through the v1 API; reading those settings is separate from the v2 eligibility
check. The adapter does not silently change schedules, add a bank, request an
instant payout or authorize a bank debit.

The server inspects the connected seller's default USD bank account, stores only
its opaque provider reference and fresh check time, and requires the same bank
before a payout. Bank details and arbitrary provider payloads never reach the
browser. This seller test-bank binding is separate from Rack Relic's own
platform bank connection. Both must be verified appropriately before live use.

## Durable dispatch and known receipts

An immutable request and one dispatch claim are committed before a provider
POST. Repeated calls do not issue another POST. Unknown creation outcomes keep
their original request and reserved allowance, even after the provider's
idempotency window. Saving a provider identity does not itself book a payout:
the adapter retrieves the saved resource and validates its amount, currency,
metadata, connected scope, parent and balance transactions before accounting.

Read-only reconciliation can search a bounded complete provider list for one
exact request binding after a response or database save was lost. No match,
multiple matches, incomplete pagination or conflicting evidence stays held;
none is permission to create a replacement. Retrieval and reversals remain
available when a seller becomes restricted, refunded or has a negative balance.

The simulation ledger appends balanced, idempotent movements and preserves
the original order ledger. A transfer to a connected Stripe balance and a bank
payout are distinct steps. Pending/in-transit is not paid. A bank can return a
payout after it was marked paid; the failure remains a review case, and returned
funds are recognized only with its verified failure balance transaction. The
system does not automatically send another payout. A fresh server-confirmed
prepared request may be explicitly continued with its same reference; the
database proves no POST has been dispatched yet. Unknown/dispatched requests
remain read-only reconciliation cases.

## Refunds and recovery

A payout and reversal cannot allocate the same parent funds concurrently.
Only an exact matching transfer can be reversed, within its unreversed and
unallocated amount. An insufficient connected balance becomes a recovery hold;
there is no automatic debit of a seller's bank or card.

The application's refund-dispatch fence prevents a refund POST racing an unknown
settlement operation and requires confirmed recovery of transferred funds for
this initial rehearsal. Preparing a refund can still create the hold that stops
a new transfer. Verified external refund notices are always recorded, even if
they arrive during a transfer; they mark related simulations for review rather
than rejecting the refund or losing the provider references. An operator can
explicitly continue the same unused prepared reversal after that notice; its
review hold and audit remain. This does not permit another request for an
unknown/dispatched reversal or clear any ordinary release gate.

After a confirmed full transfer reversal, the existing approved refund service
can process the original buyer payment and signed refund receipt. If money has
already reached the seller's bank and cannot be recovered, a funded platform
refund and debt/recovery policy still needs implementation and owner approval.
Do not leave a buyer without a response or promise guaranteed seller recovery.
Partial-refund allocation, provider fee losses, outstanding debt and the complete
cost schedule must be resolved before adapting this to live use.

## Private activation boundaries

Apply `20261103_settlement_simulation.sql` only after the existing staging
protection, fee, cost and approved `20261103_startup_limit_200.sql` migrations.
Never install the local $300 proposal as part of this sequence. Inspect existing
fixtures first; the one-unsettled-order rule still counts old paid/refunded
orders. Do not delete them or weaken guards to obtain a hosted pass.

`RACK_RELIC_TEST_SETTLEMENT_SIMULATION_ENABLED` defaults off. Activation also
requires the exact private branch, fixed staging project and Stripe sandbox,
test keys, two-member restriction, existing participating refund-operator
allowlist, seller protections, seller costs, informational tracking and Shippo
test mode. The browser supplies only order/request/parent references and an
operation kind. It cannot choose an amount, bank, account, receipt or actor.

The private UI labels every operation as test funds only and always reports
`releaseEnabled:false` and `liveReady:false`. All new tables have RLS and deny
browser table/RPC access. The repository reauthenticates the configured operator
for every operation. No new public payment route or production permissions are
introduced.

## Acceptance evidence still required

Local tests exercise the SQL, actual repository/services and provider adapters
over synthetic responses, including lost responses, one dispatch, parent caps,
known/unknown recovery, transfer reversal, bank-payout failure/return, refund
accounting and unchanged ordinary holds. They are not hosted Stripe acceptance,
proof of a real bank connection, real shipment delivery or live recoverability.

The matching private deployment, installed migrations, test connected account,
manual schedule and default test bank still need read-back verification and a
complete hosted simulation. Current onboarding and live adaptation also require
the reviewed Accounts v2 creation/remediation path. Keep the marketplace
agreement and public payments held until the complete launch matrix passes.

Primary references:

- [Separate charges and transfers](https://docs.stripe.com/connect/separate-charges-and-transfers)
- [Manual payouts and settings](https://docs.stripe.com/connect/manual-payouts)
- [Payout states and bank returns](https://docs.stripe.com/api/payouts/object)
- [Transfer reversals](https://docs.stripe.com/api/transfer_reversals)
- [Marketplace refunds and disputes](https://docs.stripe.com/connect/marketplace/tasks/refunds-disputes)
- [Accounts v2 configuration](https://docs.stripe.com/connect/accounts-v2/connected-account-configuration)
