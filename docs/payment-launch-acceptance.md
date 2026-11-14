# Payment launch acceptance and evidence

Prepared November 2, 2026 (Pacific). Baseline: draft PR #27, baseline remote commit
`0701b186e27af0a6c92dc1c354c6e66dcc2f1303`, tested source tree
`5d77c55af0fffe12c600c68e62bb65ab953c37b1`. This is an acceptance plan and
read-only source/evidence audit, not a record of newly completed hosted tests.

**Current recommendation: keep live marketplace payments closed.** The source
has substantial local coverage, but the current 5% plus $0.50 flow is not yet
installed and accepted end to end. Live seller settlement/recovery and final residual-reserve handling, real delivery
binding, tax workers and immediate operational alerts remain unfinished. A new
sandbox-only settlement rehearsal has local provider-adapter and database tests;
it does not grant normal release authority. The
database deliberately prevents transfer/payout jobs from dispatching. Passing
those hold tests is evidence that money stays held, not a completed seller payout.

## Evidence rules

- **Local covered** means a named test exercises source with PostgreSQL/PGlite
  and/or synthetic provider transports. It is not a real provider acceptance.
- **Recorded hosted** means an existing dated document records a matched sandbox
  provider, signed event and application/database result. Retain the original
  amount, version, order and receipt. Do not extrapolate it to later changes.
- **Pending** or **not implemented** remains a launch blocker. Missing evidence
  is unknown; a dashboard toggle, successful redirect, green deployment or AI
  opinion cannot turn it into a pass.
- Re-run acceptance on the exact installed revision. Record failures and partial
  results too. Never discard an uncertain provider reference to obtain a pass.

The latest recorded hosted checkout/refund evidence in
[test-refund-acceptance.md](test-refund-acceptance.md) covers historical 4% orders,
including an application-initiated partial/full refund cycle. The provider-backed
risk guide records a separate $35.59 synthetic purchase, free marked sample
label and full refund. These are useful baselines, not acceptance of the new
5% plus $0.50 pricing, seller-cost consent or the new protection migrations.

Current read-only verification in this chat confirmed that the connected Stripe
account is the Rack Relic sandbox with `livemode=false`. The existing private
setup endpoint returned `test:true`, database/Stripe connected and public
checkout disabled. Its private configuration still reports seller onboarding
and issue flags false, with sample labels, risk checks and informational tracking
enabled. It does not expose the new protection/cost flags. These observations
confirm the connection and deployment gap; they do not prove installation of
new database migrations or current-price hosted acceptance.

`tests/payment-journey-acceptance.test.cjs` now stitches the complete local
migration chain to the real repository and seller/quote/Checkout/tax/fee/risk/
refund adapters over synthetic provider transports. It verifies seller readiness
and consent before one buyer payment, signed payment/refund replay, actual cost
accounting, sticky issue/risk holds, a full refund and a lost Checkout response
without a second payment. Seller payouts remain disabled; a refund does not
recycle the startup allowance. This is local integration evidence only. The full
local suite passed 557 checks after these journeys were added. The subsequent
settlement, shipping and limit comparison work brings the current full local
suite to 653 passing checks, including test bank failure, returned-funds
recovery, signed-refund races and lost-ID reconciliation without another POST.
The subsequent Accounts v2 onboarding update brings the full local total to 657
passing checks, with no failures. The cloud case queue/outbox addition brings
the latest full suite to 673 passing checks. These are local database/service
checks; hosted provider acceptance and actual alert delivery remain pending.
See [sandbox settlement and recovery](sandbox-settlement-recovery.md).

## Resolve isolation before the next hosted transaction

1. Read the installed migration list, exact Preview deployment/branch, runtime
   flags, webhook subscriptions and existing fixture/order/job state. Do not
   print secrets or raw customer data. Repository prose contains historical
   deployment checkpoints; the current remote state needs fresh verification.
2. Review and integrate the prepared changes deliberately. The runtime currently
   now selects one complete immutable legacy or acceptance tuple. The new
   acceptance tuple binds PR #27's fixed Preview origin, database project
   `tzymapahsfiyhgilsmxl` and Stripe sandbox `acct_1UXdWBGppSOhWnq8`. The
   original tuple remains unchanged; mixed targets fail before provider access.
   A successful PR preview build does not install migrations, secrets or flags
   or activate checkout. The new credentials/users/owner still need binding.
3. Preserve the separate site-testing checkout and monitor. Do not change shared
   staging behavior without coordinating the installation and test window. Use
   the ordered dependencies in [private-preview-activation.md](private-preview-activation.md),
   then the fee/cost additions in [fee-policy-and-seller-costs.md](fee-policy-and-seller-costs.md).
   Inspect first; do not blindly reapply migrations or reset tables.
4. The startup policy permits only **one unsettled order marketplace-wide** and
   an owner-approved **$200 complete order total**, including the buyer fee,
   shipping and tax. The older $100 migration and evidence remain historical.
   Paid/refunded historical fixtures continue
   to count; a refund does not automatically close their risk allowance. Existing
   records may therefore block every new hosted scenario. Preserve them. Resolve
   this through a separately reviewed isolated scenario environment or a reviewed
   exposure/settlement closeout design, not direct deletion, changing a paid order
   to failed, disabling triggers, broadening limits or fabricating a release.
5. Before a new provider request, verify test keys/account/balance, authenticated
   synthetic buyer and seller, participating operator access, selected fixture,
   exact saved prices and permitted actions. Live keys and real card/bank details
   are never acceptance fixtures. New fixture IDs are not permission to reset
   old paid or uncertain records.

No access failure, missing migration, unavailable operator role or existing
unsettled claim should be worked around. Preserve the reference and identify
the specific access, installation or reconciliation decision needed.

## Approved $200 and proposed $300 comparison

`20261103_startup_limit_200.sql` is the additive approved starting policy. Install
it after the fee/cost dependencies and before any future sandbox settlement
addition. `supabase/proposals/startup_limit_300.sql` is a separate proposal for
disposable local comparison only; it is not approved and must not appear in the
staging or live activation sequence.

| Property | Approved $200 | Proposed $300, local comparison only |
| --- | --- | --- |
| Complete buyer total, including fee/shipping/tax | At most $200.00 | At most $300.00 in its disposable test database |
| Boundary behavior tested | $200.00 accepted; $200.01 rejected | $300.00 accepted; $300.01 rejected |
| Marketplace unsettled-order limit | One | One |
| Seller restrictions, waiting rule and normal money holds | Retained | Retained |
| Approved browser policy projection | `startup-v2` accepted with exact $200 values | `startup-proposed-300` rejected |
| Available cash, reserves and affordability | Must still be verified | Not established by this comparison |

`tests/startup-limit-options.test.cjs` exercises the full PostgreSQL guard chain,
new 5% plus $0.50 fee, shipping/tax boundaries, competing sellers, unknown/paid/
refunded claims, seller holds and disabled release. The two comparison databases
are separate; testing the proposal cannot alter the approved policy. Earlier
$100 tests and migration remain unchanged. These are enforcement tests, not proof
that either ceiling is affordable or protects the business from losses.

## Acceptance matrix

| Area | Existing local or recorded evidence | Evidence still required before live payments |
| --- | --- | --- |
| Environment and authorization | Runtime and repository tests reject production, other branches, live keys, foreign members, browser authority and cached identity. | Verify the installed revision, actual Preview protection, secret scope, browser/RPC denial, session loss and live/test isolation in the hosted environment. A staging participant-operator role is not a production-wide admin model. |
| Seller onboarding and eligibility | Local durable Accounts v2 recipient creation, exact hosted links, preserved legacy bindings and fresh v2 capability/requirement tests exist; all ordinary/live seller money remains disabled. | Complete hosted seller setup, incomplete/restricted/changed requirements and lost-creation recovery. Verify hosted Accounts v2 compatibility, current recipient capability and account-update notification handling; do not infer live eligibility from legacy booleans or a return URL. Verify adult eligibility and final seller agreement; minor selling stays closed without its own verified guardian path. |
| Current fees and seller consent | Versioned fee and SQL tests cover 5% plus $0.50 once/order, rounding, tax bases, immutable snapshots and historical 4% recovery/refunds. Cost service/database/UI tests bind exact authenticated consent. | Install additions and complete a fresh 5% plus $0.50 hosted quote, seller review/acceptance, buyer retry and receipt. On a $25 item, verify $1.75 buyer fee, plus the actual test shipping and tax. Missing/wrong hash, buyer acceptance, changed quote and old-order repricing must fail. Bundle arithmetic tests do not enable bundle checkout. |
| Checkout and interruption | Local reservation, quote expiry, concurrent clicks, dispatch claims, known-session GET recovery and uncertain outcomes are covered. Historical successful hosted checkout is recorded. | Hosted decline, explicit 3DS failure, cancellation/expiry, duplicate click, reload and lost response on the current flow. An unpaid/cancel return must not create paid accounting, duplicate Checkout or release unresolved inventory. |
| Signed payment and risk events | Local Node/generated Edge signature, identity, replay, ordering and dispute/early-warning hold tests exist. Historical paid/refund webhook delivery is recorded. | Deploy the matching receiver and read back only the required sandbox subscriptions. Show current order/session/PaymentIntent/event agreement, successful signed delivery, deduplication and retry/reconciliation for unbound or conflicting events. Test a hold arriving during dispatch. |
| Startup exposure and seller holds | Local full-total, concurrent global claim, fresh seller verification, sticky issue/risk and saved-link recovery tests exist. | Hosted cap/concurrency/freshness tests without resetting old claims. Verify that stale/restricted sellers and open issues cannot create or resume app checkout. A previously obtained Stripe URL can still receive money; reconciliation/expiry must handle that exposure. |
| Fraud and authentication | Local risk evaluator requires captured matching payment, normal risk, successful supported checks/authentication and no unresolved review; unknown evidence holds. Current chat records live Radar Plus, Adaptive 3DS and risk-aware CVC/postcode controls enabled. | Verify actual account rules/entitlements and test high/elevated risk, failed/missing checks, open reviews, 3DS success/failure/unsupported outcomes, wallets and changed destination. A review may follow a successful buyer charge; application fulfillment/settlement must remain held independently. Test checkout/card-attempt abuse limits beyond the existing quote budget. |
| Carrier quote and label | Local order/destination/parcel binding, rate limits, budget checks and one durable label claim are covered. A marked sample-label provider run is recorded. | Current hosted quote/label access for the correct seller, expired/repriced shipping, uncertain purchase, provider error, changed address, adjustment and refund handling. Real postage and optional insurance must use approved actual quotes and costs; free sample labels are not valid postage. |
| Tracking and delivery wait | Local informational sample tracking deduplicates/rejects stale/conflicting observations. Two-business-day Pacific calendar tests cover weekends, holidays and DST. | Implement authenticated real delivery ingestion/retrieval bound to the paid order, original destination and label. Test delayed, forged, duplicate, returned, conflicting and unmapped notices, then the waiting boundary. Sample `DELIVERED` cannot authorize settlement. Extend/review the bounded calendar before unsupported dates. |
| Provider costs and seller proceeds | Local immutable original-charge evidence and new bounded reserve/actual allocation tests exist, including shared seller/month/source caps and balanced entries. | Verify the complete provider charge inventory, account-specific billing and accepted seller policy; ingest actual processing, screening, account/month, payout and selected insurance evidence. Include tax tooling, failed attempts, refunds/credits and unallocated costs. Reconcile seller net without consuming buyer tax, postage or platform fee. The runtime intentionally reports an incomplete schedule. |
| Refund before transfer | Local amount/access/dispatch/replay/recovery and signed pending/failed/succeeded receipt accounting exist. New private SQL/adapter checks compare complete provider refund inventory with the signed database baseline, blocking pending/unmapped refunds and substituted prior receipts. Historical application partial/full refund and saved-request retrieval are recorded. | Install the additional refund-inventory migration and matching adapter; complete current-price partial/full refund, external pending/changed/missing receipts, lost HTTP/database response, replay/out-of-order event and pending/failed/canceled provider outcomes; preserve original request IDs. Reconcile fee, tax, postage and inventory decisions. A saved HTTP acknowledgement is not a confirmed refund. |
| Transfer, payout and post-transfer refund | Sandbox-only adapters, durable simulation requests and a separate balanced simulation ledger now test transfers, standard payouts, verified bank returns, reversals, signed-refund races and lost-ID retrieval. The entire accepted cost ceiling is retained; unused reserve remains owed to the seller. Normal money jobs still reject dispatch/completion. | Install and run the current hosted simulation with a verified test seller, manual schedule and test bank. Then finish live settlement, final unused-reserve settlement, partial-refund allocation, funded post-bank-payout refunds and unrecoverable debt/recovery policy. Reconcile actual provider costs, platform/connected balances and payout evidence. Test bank connection and platform funds must be verified separately. No live seller money until this passes. |
| Tax accounting | Test quote calculation and historical sandbox registration/calculation evidence exist. Tax-recording/refund-tax jobs remain held. | Resolve live marketplace obligations, registrations and item/buyer-fee/shipping tax classification. Implement and test transaction recording, partial/full refund reversals, ledger reconciliation and filing/remittance ownership. Calculated tax alone is not completed tax settlement or compliance. |
| Support, disputes and notices | Local structured buyer issue, operator acknowledgment, seller response, refund-readiness and sticky dispute holds exist. Chat-assisted review is read-only. | Hosted participant isolation, deadline tracking, evidence/return/support procedure and production admin authority. Implement actual receipt/shipping/urgent notices with privacy and delivery-failure handling. Closed/won dispute, acknowledgment or clear score alone cannot remove all holds. |
| Monitoring and operational readiness | The local setup monitor remains every four hours. An enabled hourly cloud website monitor gates readiness checks to every four hours; initial cloud HTTP checks passed, while autonomous timer dispatch and live private access remain unverified. New source tests case/deadline outbox, pagination, leases and delivery gaps without a scheduler or transport. None supplies continuous staffed coverage or financial authority. | Install and verify the case/outbox schema, actual cloud dispatch, authenticated live case access and notification delivery/reconciliation. Test immediate verified provider alerts and durable holds, approximately 15-minute assisted flagged-case checks, alert delivery/failure, named urgent-response ownership and escalation. Faster cadence is a launch requirement, not currently running. Higher volume requires staffed response capacity. |
| Owner operations dashboard | Source-only private test screen and service-role projection, with one configured owner UUID, actual provider observation times, bounded queues and no money controls. | Install and accept owner-only access, denial of another operator, visible/focused polling, revocation/late responses, stale/missing feeds and provider data bindings. A locked public shell has no private panels. Build and accept separate production owner authority and real operational feeds; the page cannot replace backend alerts while closed. |
| Database/photo recovery | Pro upgrade and isolated empty branch are verified. Source-only immutable private photo snapshots, authenticated manifests, isolated drills and read-only restored-order/provider reconciliation have local tests. | Verify actual Pro backup availability and a real isolated SQL restore; install private independently credentialed retained photo archive and daily cloud job/alerts, prove matching listing/photo recovery and privacy, and reconcile complete provider history under a durable recovery hold before resuming writes. No archive transport, scheduler, SQL restore or durable recovery gate is installed by those source tests. |
| Funds, policies and launch approval | Draft seller rules and money-release blockers exist; no funded reserve is invented in source. The separate marketplace agreement remains held in this work. | Verify available Stripe/business funds against outstanding liabilities, define an affordable reserve/recovery rule, finalize clear fees/returns/dispute/eligibility terms and authenticated acceptance, and complete production configuration review. The owner makes the final marketplace-agreement and launch decisions; test success is not authorization. |

## What a sandbox can establish

Stripe sandbox payments use simulated funds and are not processed through card
networks. Use Stripe test keys and official test payment methods for payment,
refund, dispute and bank/payout simulations. Any displayed test fee is test
accounting; simulated payments do not establish negotiated live pricing,
recoverability, available real funds or live settlement timing. The real live
Radar plan enrollment has its separately approved billing terms. Shipping test
prices and sample labels likewise do not establish live postage or insurance
costs. [Stripe sandboxes](https://docs.stripe.com/sandboxes),
[testing](https://docs.stripe.com/testing),
[testing Connect](https://docs.stripe.com/connect/testing)

Stripe currently documents an Adaptive 3DS test card on its testing page, while
the risk-control guide says the authentication fraud-prevention control is not
available in testing environments. Verify account-specific test availability
and record the result. Independently exercise explicit 3DS success, failure,
attempt-only and unsupported outcomes through the supported test flow. Do not
claim that a synthetic trigger proves the live adaptive model's effectiveness,
future fraud loss, or conversion impact. Never substitute a fake live purchase
with a real card to obtain test evidence. [Test fraud/authentication scenarios](https://docs.stripe.com/testing#fraud-prevention),
[risk controls](https://docs.stripe.com/radar/risk-settings)

## Local execution and hosted evidence record

With the repository's supported Node runtime and dependencies installed:

```sh
npm test
```

Focused references for failures or changes (not a replacement for the full run):

```sh
node --test tests/fee-policy.test.cjs tests/fee-policy-sql.test.cjs tests/seller-costs-sql.test.cjs tests/test-seller-cost-service.test.cjs
node --test tests/payment-journey-acceptance.test.cjs tests/shipping-journey-acceptance.test.cjs
node --test tests/cloud-case-alerts-sql.test.cjs
node --test tests/settlement-simulation-sql.test.cjs tests/stripe-test-settlement.test.cjs tests/settlement-service.test.cjs tests/settlement-runtime.test.cjs tests/startup-limit-options.test.cjs
node --test tests/test-seller-protections.test.cjs tests/test-startup-policy.test.cjs tests/test-dispute-holds.test.cjs tests/test-edge-webhook.test.cjs
node --test tests/test-checkout-flow.test.cjs tests/test-refund-dispatch.test.cjs tests/test-labels.test.cjs tests/test-tracking.test.cjs
```

For each hosted scenario save: scenario name, exact revision/environment,
synthetic actor role, opaque order/request/event references, frozen financial
components, provider mode/status, signed-delivery result, resulting order/ledger/
job/hold state, observed time, pass/fail/unknown, and the evidence needed next.
Store no secrets, authentication links, card data, bank details or full addresses
in the acceptance report. A provider test event without the application's
matching order/ledger effect is an incomplete result.

## Recommendation sequence

First complete installation/isolation and the current hosted buyer-to-refund
journey. Then finish missing fulfillment, settlement/recovery, tax and immediate
operational controls and test them as one coherent sandbox flow. Review live
eligibility/configuration and owner obligations separately. Only after those
gates pass should the owner consider a small invite-only real launch, retaining
the approved risk limits and a visible stop switch. A single-unsettled-order
pilot cannot support a broad high-volume buyer campaign; growth and limit
changes require a separate evidence and funding review.

Primary launch guidance:
[Stripe go-live checklist](https://docs.stripe.com/get-started/checklist/go-live),
[Connect recipient configuration](https://docs.stripe.com/connect/accounts-v2/connected-account-configuration),
[separate charges and transfers](https://docs.stripe.com/connect/separate-charges-and-transfers),
[marketplace refunds and disputes](https://docs.stripe.com/connect/marketplace/tasks/refunds-disputes),
[webhook security and delivery](https://docs.stripe.com/webhooks).

## November 3 infrastructure and recovery checkpoint

The existing Vercel-managed organization now shows Supabase Pro, $35/month
excluding overages plus applicable tax/fees, with both original databases
connected. Temporary branch `payment-acceptance` (`tzymapahsfiyhgilsmxl`) was
created under the already approved $0.01344/hour allowance; initial read-only
counts show zero orders/events/ledger/jobs/users/objects. The new Stripe sandbox
is API-verified in test mode, with test Connect and explicitly fictional tax
fixtures configured. This is infrastructure preparation, not hosted current-flow
acceptance. Preserve all legacy records and the separate website checkout.

See [backup/recovery](backup-recovery.md) and [private owner
overview](private-admin-overview.md) for concrete source contracts and missing
installation evidence. Neither a verified backup nor the admin screen guarantees
chargeback recovery. The sole owner must be bound to a freshly verified private
Auth UUID; an email address or Stripe team membership is not website admin authority.
