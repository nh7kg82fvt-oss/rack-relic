# Approved fees and private seller-cost rehearsal

Owner decision, November 2, 2026 (Pacific): buyer platform fee is **5% of the
order's item subtotal plus $0.50 once per order**. Round the percentage once to
integer cents, nearest cent with half cents rounded up, then add 50 cents. A
$25 item has a $1.75 platform fee. Shipping and tax remain separate. Bundles
would pay the fixed component once; this change does not enable bundle checkout.

## Versioned orders

`rr-fees-v1` is the historical 4% policy with no fixed charge. Missing policy
metadata in saved legacy evidence retains v1 behavior; explicit null or unknown
policies fail validation. `rr-fees-v2` is 5% plus $0.50 once per order. New order
reservations choose v2 explicitly. The additive fee migration backfills only
policy metadata, preserves original monetary evidence, and guards new input and
snapshot tags against the reservation. It does not change any historical SQL
migration or reprice previously paid, prepared or dispatched orders.

Checkout, shipping/tax base calculation and the single buyer-fee Stripe line
use the shared policy. Saved v1 receipts, GET-only recovery, signed payment
events and refund accounting continue to use the frozen original total.

## Buyer and seller amounts

The buyer pays item subtotal, platform fee, actual shipping and applicable tax.
The seller funds actual processing and clearly disclosed, accepted provider
costs attributable to their sales. Selected extra shipping insurance requires
its own agreed quote; this private route does not purchase or select insurance.
Rack Relic retains its platform fee as revenue for operations and reserves.
Revenue is not guaranteed net profit, and no implementation guarantees no loss.

Stripe bills the platform first. Refunds, unsuccessful screened attempts,
disputes, negative balances and unallocated costs can leave Rack Relic with
expenses it cannot recover. Do not promise that every provider charge can
automatically be deducted from a successful seller's proceeds. Final handling
of non-refundable processing, failed payments, returns and recovery remains a
launch decision that must match the accepted seller terms.

The private seller view shows one payment processing and handling total and an
estimated payout when the full cost inventory is known. Details expand into
processing, attributable fraud screening, monthly connected-account allocation,
payout allocation and selected insurance. A monthly account cost is allocated
once per seller/month, and a payout cost once per batch. Neither is charged in
full on every item. Missing evidence is pending rather than a zero cost.

## Private consent and accounting

`20261103_seller_costs.sql` stores an immutable canonical disclosure and its hash,
the authenticated seller's acceptance of that exact hash, and bounded cost
allocations. A trusted server creates the disclosure from a prepared order and
explicit cost ceilings. Browser requests contain only an order reference or
the reviewed hash; they cannot choose costs, sellers, rates or provider receipts.
This is a test consent rehearsal, not acceptance of final live seller terms.

After a disclosure exists, its whole prepared quote is frozen. A changed or
expired quote requiring different evidence needs a new order and new review.
Checkout dispatch and direct snapshot attachment require seller consent in
the database, even if the UI flag is later disabled. Historical v1 orders return
a clear unsupported-policy hold and cannot accept new cost terms.

Reservations encumber proceeds without recording invented actual provider
costs. A verified actual receipt can replace its reservation within the agreed
caps. Confirmed allocations are immutable and actual accounting appends one
balanced pair, once. Shared obligation and receipt locks prevent duplicate
seller/month or payout allocation across orders. Costs above a reservation,
accepted ceiling or available item proceeds stay held for review. Buyer fees,
tax and postage are not consumed to cover an insufficient seller balance.

The browser has no record-cost or release endpoint. All new tables use RLS and
deny browser table/RPC access. The server checks current membership for every
read, preparation and acceptance, and SQL checks the actor is the order seller.
UI results arriving after sign-out or another order render are discarded.

## Installation and acceptance still required

Apply only in the separate staging project, after the existing private payments
and protection dependencies, in this order:

1. `supabase/test/20261103_fee_policy_v2.sql`
2. `supabase/test/20261103_seller_costs.sql`

The migrations have been exercised locally against PostgreSQL/PGlite, including
the full existing protection chain. They have **not** been installed remotely.
Keep `RACK_RELIC_TEST_SELLER_COSTS_ENABLED` off until installation and access
checks are complete. The existing exact private branch, test account, two-member
allowlist and off-by-default production boundaries remain mandatory.

For the isolated rehearsal only, a server environment may provide
`RACK_RELIC_TEST_SELLER_COST_QUOTE_FIXTURE` with version
`rr-cost-quote-fixture-v1`, integer `maxTotalCents`, and a `costCaps` object with
`processing`, `radar`, `connect_active_account`, `payout` and `insurance` integer
ceilings. Insurance must be zero. These are explicit synthetic consent ceilings,
not actual provider prices or billing instructions. Without the fixture or a
future verified provider quote adapter, preparation stays unavailable.

The runtime deliberately reports `provider_cost_schedule_incomplete` and keeps
release disabled. Tax tooling, full provider billing ingestion, failed-attempt
cost policy, applicable invoice periods, post-transfer recovery, real delivery,
available-balance reserves and final live seller terms still need evidence.
Do not enable transfers, payouts or live checkout by setting a UI flag.

Hosted acceptance must cover two signed-in members, seller consent before buyer
dispatch, quote expiry/change, mismatched hashes, denied buyer/foreign access,
lost permissions, old 4% recovery/refunds, current 5% plus $0.50 tax/receipts,
reservation-to-actual accounting and shared monthly/payout source allocation.
No successful local fixture is evidence of provider fee recovery or live safety.

Primary guidance reviewed November 2, 2026:

- [Stripe Connect pricing](https://stripe.com/connect/pricing)
- [Radar plans](https://stripe.com/radar/pricing)
- [Radar screening and platform fee responsibility](https://docs.stripe.com/radar/how-radar-works)
- [Marketplace refunds and disputes](https://docs.stripe.com/connect/marketplace/tasks/refunds-disputes)
- [Depop buyer fee](https://depophelp.zendesk.com/hc/en-gb/articles/21752555753361-What-is-the-Marketplace-fee)
- [Depop seller fees](https://depophelp.zendesk.com/hc/en-gb/articles/360001791127-Seller-fees-and-charges)
- [Vinted U.S. price list](https://www.vinted.com/pricelist)
