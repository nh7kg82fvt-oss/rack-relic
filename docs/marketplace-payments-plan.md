# Rack Relic: purchases and seller payouts

Reviewed October 30, 2026 (Pacific). Source baseline: `884b380ae7a35a772543cff127b77ae451796d5d`.

## Decision and boundaries

Start with a **Stripe Connect sandbox**, Stripe-hosted Checkout and hosted seller onboarding. Test one US seller, one US buyer, USD and one shippable listing per order. Use separate charges and transfers so a seller transfer can follow the agreed fulfillment rule rather than happen at checkout. This is a proposed funds flow, not an approved live provider arrangement. Test destination charges as an alternative if Stripe's account configuration or underwriting makes that preferable.

No live account activation is required to develop against a sandbox. A Stripe login, sandbox access, Connect configuration and sandbox keys are still needed. Stripe's sandbox capabilities can be less restrictive than live capabilities: passing tests does not establish launch eligibility. Wayne subsequently authorized proceeding with sandbox setup. Stripe is now connected to **Rack Relic sandbox** (`livemode: false`). The initial module tests used mocked responses; a subsequent isolated provider API smoke test created one unpaid test Checkout Session. See the verified results below.

This branch adds server-only test checkout, signed webhook handling, a Tax adapter, a private test order repository, an isolated PostgreSQL ledger migration and fraud-hold logic. Provider HTTP paths use mocked transports in tests, while the order SQL executes under PGlite PostgreSQL. It adds **no public route**, transfer/refund executor, live account creation, production migration, checkout UI or runtime secrets. The new test migration has not been applied remotely. Sandbox Tax settings were subsequently configured through the connected account as described below. The existing public Buy button and manifest remain closed. No production deployment or database state was inspected or changed by this review.

## What main actually contains

| Existing component | Reuse | Still required |
| --- | --- | --- |
| Supabase email sign-in, public seller profiles | Identity and profile UI | Server-side token verification on every order action; seller-to-provider mapping; hosted financial onboarding |
| Account drafts, publication, sold/archive states, six-photo galleries | Listing editor, gallery and trusted item snapshots | Transactional inventory reservation and paid-sale lock; current seller-edit permissions must not defeat a reservation |
| Moderation status, private listing reports, blocking and messages | Trust tooling and support context | Order disputes, refund decisions, chargeback evidence, staffed moderation and account restrictions |
| Seller delivery settings and `checkout_preview` RPC | Delivery preference and preliminary estimate UX | Final carrier/tax quotes, private addresses, immutable order totals and quote expiry |
| `server/shippo_test_client.cjs` | US test shipment quotes and test-label requests; test-token and test-response guards | Persistent order-bound rate IDs, address/package storage, authorized label orchestration, reconciliation, tracking and label refunds |
| `api/listing-photo.js`, protected photo delivery | Existing server-function pattern and private media delivery | Separate order, onboarding and webhook handlers; do not reuse photo authorization as payment authorization |
| PWA manifest and Vercel routing | Current app shell and hosting | Authenticated buyer orders/seller sales views, checkout result and shipping pages, notifications |

The source contains no checkout-session endpoint, payment webhook endpoint, provider seller-account mapping, transfer/refund service, or durable financial ledger. The UI's `checkout_preview` estimate explicitly omits the 4% buyer fee and tax. Seller-set shipping prices are not carrier quotes. A manual “Mark sold” changes listing visibility and is not a payment record.

Only three photo-related production SQL files are present on main. The full schema, original migrations, constraints, RLS policies and RPC definitions are not reproducible from this checkout. Retrieve and review the authoritative schema before designing an executable order migration; do not invent production relationships from browser queries. Repository code review alone does not verify deployed database policies or provider configuration.

PR #23 is gallery navigation; PR #24 is guided help and report preparation. Neither implements purchases or financial actions. See [PR #23](https://github.com/nh7kg82fvt-oss/rack-relic/pull/23), [PR #24](https://github.com/nh7kg82fvt-oss/rack-relic/pull/24), [manifest](https://github.com/nh7kg82fvt-oss/rack-relic/blob/main/manifest.webmanifest) and [Shippo client](https://github.com/nh7kg82fvt-oss/rack-relic/blob/main/server/shippo_test_client.cjs).

## Practical payment options

Public US pricing checked October 30, 2026. These are reference rates, not an account quote or confirmation of eligibility. Product configuration, negotiated terms, payment method, country and risk can change them.

| Area | Stripe Connect + Checkout | PayPal multiparty / Complete Payments Platform |
| --- | --- | --- |
| Buyer checkout | Hosted card checkout and supported wallets; straightforward fit for Vercel server functions | PayPal checkout; card and other methods depend on the approved packaged solution |
| Seller payouts | Hosted connected-account onboarding, bank payouts; destination charges or separate transfers | Onboard sellers through PayPal's partner flow; seller settlement, partner fees and delayed disbursement depend on enabled features |
| Reference fees | Standard domestic online cards: 2.9% + $0.30. Under the platform-controlled pricing option, Connect lists $2 per monthly active account and 0.25% + $0.25 per bank payout; other configurations differ | Published PayPal Checkout reference: 3.49% + $0.49 for domestic USD. Other card products have different rates. Marketplace/partner terms require confirmation |
| Refunds | API refunds; separate transfers are not automatically reversed. Reconcile/refund platform fees and reverse transfers as appropriate; original processing/Connect fees generally are not returned on standard pricing | Capture refunds and platform-fee adjustments; platform-fee features need partner enablement. Original receipt fees generally are not returned |
| Tax | Stripe Tax supports marketplace collection; determine the liable entity, registrations and filing arrangements first. Tax and reporting products can add costs | Tax remains Rack Relic's compliance/integration responsibility unless a specific contracted service covers it; do not assume PayPal Checkout remits marketplace sales tax |
| Shipping | Keep Shippo as a separate order-bound integration | Shippo can also remain separate; payment acceptance does not solve shipping |
| Sandbox / launch | Sandbox can test account creation, verification outcomes, charges, transfers and payouts. Live business/seller verification and configuration remain separate | Sandbox available with a developer account. PayPal explicitly requires platform/marketplace approval before live credentials |
| Practical fit | Recommended first engineering path: clear sandbox tooling and hosted onboarding, with explicit platform liability | Credible alternative, especially if PayPal demand matters; partner approval and fee/disbursement enablement add uncertainty |

An ordinary CCP/EPI merchant account or a payout-only API is not a substitute for a marketplace product. Before using any such alternative, obtain written support for collecting buyer funds for unrelated sellers, submerchant onboarding, split settlement, refunds, reserves and chargeback liability. Do not route every seller through a single ordinary merchant account merely because it can accept a card.

## Fees and funds flow

Preserve the current proposed commercial model: buyer platform fee = 4% of item price, no fixed fee; shipping and tax separate; sellers bear actual processing cost. No fee policy is changed in this branch. Define rounding per order in integer cents (nearest cent, half up) and disclose the seller's expected net before listing/acceptance.

For a **hypothetical tax-free test** of a $25 item, $1 buyer fee and $5 shipping: buyer total is $31. At 2.9% + $0.30, illustrative processing is $1.20, leaving seller proceeds of $23.80, platform revenue of $1, and $5 earmarked for postage. Real tax must come from a calculation, and actual processor fees must come from the charge's balance transaction, not this estimate. Connect costs, tax tooling, support, disputes and postage adjustments are additional. The $2 active-seller monthly cost alone can exceed the $1 revenue from a seller's single $25 sale.

Store separate ledger entries for buyer funds, item proceeds, buyer fee, tax liability, postage funding, actual processing fees, seller transfers, refunds, disputes and adjustments. Do not pay collected sales tax to sellers. Decide who bears Connect costs, failed postage adjustments, refund processing losses, negative seller balances and buyer-fee refunds before live launch. Current copy only allocates payment-processing costs, not every possible cost.

Separate charges/transfers make the platform balance responsible for Stripe fees, refunds and chargebacks. A transfer credits a connected Stripe balance; a payout moves that balance to the seller's bank. They are separate operations. Delayed transfers are not escrow or an automatic buyer-protection service. Verify permitted holding periods, payout schedules, available balances and risk rules with Stripe. A refund after transfer requires explicit reversal/recovery and may create a loss for Rack Relic.

## Concrete implementation sequence

1. **Isolated environment.** Connect the Stripe sandbox, reuse suitable existing test fixtures or create test seller accounts and fake buyers; for new seller accounts use Accounts v2 recipient configuration with `stripe_balance.stripe_transfers`, Express dashboard and explicit platform fee/loss responsibility (do not request merchant/card-payments capabilities for transfer-only sellers), and establish a separate Supabase test project. Keep production credentials inaccessible. Use fixture addresses and test cards only. Pin Stripe API and webhook versions, store secrets only in server environment configuration, and restrict access to the preview.
2. **Recover schema and add order storage.** Review existing tables/RLS and migrations, then add `seller_payment_accounts`, private addresses/package records, immutable `orders`/`order_items`, `listing_reservations`, `payment_attempts`, `provider_events`, `ledger_entries`, `transfers`, `refunds`, `shipments`, and a notification outbox. Separate test/provider identities from production identities. Buyers and sellers may read their permitted order views; only server handlers may write financial state. Raw addresses must never be publicly selectable.
3. **Reserve atomically.** Authenticate buyer; require a distinct eligible seller, active published listing and configured delivery. Lock the listing, re-read price/moderation/version, and acquire one reservation per listing in a database transaction. Use the reservation/order ID for provider idempotency. Prevent seller price/status edits from silently changing a reserved snapshot. Reconcile uncertain Checkout creation before retrying. Release reservations only after provider expiration/cancellation is confirmed; handle late paid webhooks without creating two owners of the item.
4. **Real test quote + Checkout route.** Collect private destination and seller return addresses and packed dimensions/weight. Quote Shippo test rates, persist order ownership/rate ID/amount/expiry, and calculate tax for the complete taxable components and destination. The current foundation accepts explicit order-bound test quotes; it is not the carrier/tax adapter. Create hosted Checkout from the immutable server snapshot, never browser prices. Initial scope is one seller/item, US shipping, USD and cards; defer pickup/bundles until their fulfillment and tax rules exist.
5. **Verified payment processing.** Add a raw-body webhook route with signature/timestamp checks and explicit sandbox response checks. Store provider event IDs uniquely and process order state plus ledger/outbox atomically. Verify session, order, amount, currency and paid status. Handle retries, duplicate and out-of-order events, failed/asynchronous payments, expiry and missing events through reconciliation. A success redirect is display-only. Mark inventory sold only through the server's paid-order transaction. Never reuse the browser's manual sold action as proof of payment.
6. **Fulfillment and seller money.** Issue exactly one test label for a verified paid test order through a durable job/lease. Persist uncertain requests for provider reconciliation, not blind retries; the existing Shippo client's in-memory quoted-rate set is insufficient across Vercel invocations. Deliver label only to the authorized seller. Save test tracking and verify tracking callbacks/reconcile delivery. Apply the agreed release rule, use actual processing fees, create one idempotent test transfer, then observe payout status/failure separately. Add refund/return and transfer-reversal workflows, dispute holds, reserves and negative-balance recovery.
7. **Complete customer experience.** Add buyer orders, seller sales/onboarding status, shipment/label access, delivery updates, receipts and durable email notifications. Replace preview-only help with accurate purchase/return/refund terms only when those workflows exist. Keep private financial routes excluded from marketing tracking. Add operator reconciliation and support tools.
8. **Acceptance tests before any launch decision.** Two buyers race for one item; changed/hidden listing; expired quote; tax unavailable; tampered amounts; self-purchase; seller not eligible; failed/3DS card; duplicate/forged/late/out-of-order webhook; payment received after reservation expiry; full/partial refund before/after transfer; duplicate/uncertain label request; non-delivery/dispute; payout failure; authorization between two buyer/seller accounts. Reconcile buyer total = item + buyer fee + shipping + tax and all ledger movements to provider balances. Test notifications without contacting real members.

## Eligibility and policy gates for live launch

- **Platform and sellers:** verify the legal operator and marketplace business model with the chosen provider; configure loss/fee responsibility and supported geography. Hosted onboarding should collect required seller identity, business/representative details, bank ownership, tax details and agreement acceptance. Monitor capabilities and requirements continuously; a returned onboarding URL is not approval. Do not assert approval from sandbox results.
- **Teen marketplace:** determine the buyer/seller age policy and implement it. Stripe's agreement requires an adult representative where the user/representative is below 18 or local majority, subject to country-specific terms. Do not onboard a teen seller as an unsupported independent adult. A practical first live scope is adult sellers, with a separately verified guardian path before enabling teen sellers. This is a recommendation, not an implemented policy change.
- **Permitted inventory:** main currently prohibits counterfeit, replica and unauthorized copies even when disclosed, consistent with Stripe's restrictions. Older instructions to allow replicas are not a launch-compatible assumption. Retain and enforce the current prohibition; resolve any intended exception with provider/legal review before payment activation. Reporting guidance alone is not inventory enforcement or authentication.
- **Tax:** determine marketplace-facilitator obligations by jurisdiction, registrations, taxable treatment of shipping/buyer fees and filing/remittance responsibilities. Configure a tax service and retain evidence; a tax line or Stripe Tax toggle is not automatic legal compliance. Determine 1099 responsibilities separately from sales tax. No universal reporting threshold is assumed here.
- **Customer policies and operations:** approve delivery/return deadlines, not-as-described/non-delivery handling, refund amounts, buyer-fee treatment, return-label costs, payout release timing, dispute reserves and support response commitments. Do not promise Depop protections or rules without implementing Rack Relic's own matching obligations.
- **Release approval:** verified live platform/seller eligibility, production secrets and environment isolation, end-to-end evidence, provider terms acceptance, account-specific fees, tax arrangements and explicit owner approval. No live charges, paid shipping services or financial transactions are authorized by this test work.

## Test module usage and limitations

Run `node --test tests/*.test.cjs` (Node with global fetch, AbortSignal.timeout and node:test).

`server/marketplace_test_checkout.cjs` exports:

- `buildTestCheckout(input, now)`: integer-cent order snapshot, 4% item-only fee, US shipping, current order-bound shipping/tax fixtures and availability validation. Test tax must be explicit, including a calculated zero when appropriate. The caller must provide an authenticated, reserved server snapshot.
- `createStripeTestCheckoutClient({secretKey, fetchImpl})`: accepts only `sk_test_` keys, sends to the fixed Stripe Checkout API with an order-bound idempotency key, checks test session identity/amount/currency and permits only the Stripe checkout host. No automatic retries. API version is `2025-02-24.acacia`; align the future sandbox webhook destination to this supported version or upgrade both after testing.
- `verifyStripeTestEvent(rawBuffer, signature, options)`: checks HMAC on raw bytes, five-minute signature freshness, allowed event types, test mode and order metadata. Verification alone does not deduplicate events or alter an order.
- `matchesPaidTestOrder(event, storedOrder)`: only for a previously verified event and trusted DB order; requires a complete/paid session matching the immutable amount and IDs. Persist acceptance atomically with a unique event ID.

Checkout return URLs are deliberately fixed to a localhost test harness; that harness is not implemented. The module itself has not been exercised with a sandbox key; the separate connector smoke test below does not validate this module's HTTP path or the website. No claim is made that seller onboarding, transfers, payouts, refunds, Shippo-to-order integration or tax collection is complete. Change nothing in public checkout configuration until the isolated order stack passes acceptance tests.

## Verified sandbox results after connection

- The account-access listing identifies **Rack Relic sandbox**, with `livemode: false`. Balance retrieval independently returned `livemode: false`. No live account was selected.
- The v1 current-account response reports `charges_enabled: false`, `payouts_enabled: false`, and no active capabilities. These flags do not establish production readiness. Stripe nevertheless accepted the unpaid sandbox Checkout creation below.
- Two pre-existing synthetic connected-account fixtures are present. One has an Express dashboard, platform-paid fees/platform loss responsibility, active transfers, a test bank, payouts enabled and no currently due requirements. These were not created or onboarded by this work and are not real seller eligibility evidence.
- Stripe's implementation planner confirms separate charges/transfers for delayed release, platform loss/fee responsibility, fee retention by transferring less, and Accounts v2 recipient configuration for new marketplace seller accounts. Do not use `application_fee_amount` with separate charges/transfers. The planner's preference for embedded onboarding does not invalidate the separately documented hosted-onboarding option.
- Created one provider test session with `livemode: false`, `amount_total: 3100`, `status: open`, `payment_status: unpaid`. It uses a synthetic order reference and is unrelated to website inventory or real members. Components are $25 fictional item + $1 buyer fee + $5 synthetic shipping. No tax service was invoked and this is not a final sale quote. The return URLs point only to the unimplemented localhost harness. It expires automatically.
- At that first smoke check, no test payment, seller transfer, bank payout, refund, carrier quote, label purchase, tax calculation, order row or webhook delivery had been executed. A subsequent zero-tax diagnostic is recorded below. Creating an unpaid provider session is an API smoke test, not end-to-end checkout completion.
- Current connector limitations: v2 retrieval of the platform account returned a permission denial; v1 account and balance reads work. Searches exposed account/transfer reads but no create-connected-account or create-Connect-transfer operation. Do not infer that more general account authorization alone would expose unsupported operations. Continue those tests through a supported secure server-side sandbox integration or an approved Dashboard workflow; never request API secrets in chat.

## Subsequent tax configuration and implementation

The owner requested the remaining test integration and instructed us to use CCP's state-listed business address. The full address was verified in existing records and saved in the sandbox Tax head-office setting, replacing the initial documented sample address. The actual address and private provider IDs are intentionally omitted from this public repository.

Verified Tax settings: `livemode: false`, `status: active`, default tax behavior `exclusive`, default tax code `txcd_99999999` (general physical goods). A default code is only a fallback; individual listings need specific classification. Stripe's catalog returned `txcd_30011000` for ordinary clothing/everyday footwear and `txcd_30060001` for purses/handbags. Athletic equipment, jewelry and other accessories require their own classifications. The returned platform-fee candidate `txcd_90050001` describes fees charged to businesses/sellers, so it has **not** been adopted for Rack Relic's buyer fee. That classification remains required explicitly by the adapter.

One sandbox Tax API diagnostic used a public sample Seattle destination and synthetic $25 goods/$1 fee/$5 shipping components. The $1 fee used the goods code solely as a test fixture, not as a production tax determination. Stripe returned a $31 total, zero tax and `taxability_reason: not_collecting`. There are no active registrations. This result is **not** evidence of tax exemption and must not enable checkout.

Automatic approval review rejected creating the proposed Washington sandbox sales-tax registration because it required proof of registration or explicit approval for that persistent compliance setting. No registration was created at that point and no workaround was attempted. The owner subsequently explicitly approved the simulated sandbox registration, which was then created and verified active as described below. Adding a sandbox registration is distinct from registering with a tax authority. Live tax registration, filing/remittance and actual legal obligations remain unverified.

`server/stripe_test_tax.cjs` now provides a server-only test adapter that:

- accepts only test secret keys and checks test-mode settings/registrations;
- requires complete US origin/destination addresses and an order-bound shipping quote tied to the same destination hash;
- requires an active, unexpired sandbox state sales-tax registration before calculation;
- requires explicit item and buyer-fee tax codes, preventing an assumed exemption;
- sends item, buyer fee and shipping separately to Stripe Tax, checks exact amounts/currency/line references/tax-code identity, and reconciles the tax breakdown;
- rejects `not_collecting`, missing/unknown taxability evidence, live-mode responses, expired quotes, transport errors and altered order amounts;
- emits a short-lived tax quote usable by the existing checkout builder. The builder independently rejects blocked tax, `not_collecting` and destination mismatches.

All **142 Node tests pass**, including eight new tax scenarios and the existing checkout, signature, account, gallery, media and tracking checks. The new adapter's provider HTTP path is mocked in tests; the connected-account Tax diagnostic was executed separately. No secret key was provided to the repository/runtime, no tax transaction was recorded after payment, and no public tax/checkout route was enabled.

After the owner's explicit approval, the Washington **sandbox-only** state sales-tax registration was created and independently read back as active, with `livemode: false`. A subsequent Stripe Tax API calculation for the same synthetic Seattle example returned **$3.27 tax and $34.27 total** on a $31 base, with `taxability_reason: standard_rated` and a destination-specific 10.55% rate. This is not a statewide rate or a live tax determination. The $1 buyer fee still used the item tax code only as a fixture; its live classification remains unresolved. No tax authority filing, payment or money movement occurred. No private registration/calculation identifiers are published here.

Remaining access and implementation dependencies: Supabase and Vercel are available integrations but are not connected to this session. The full Supabase schema, an isolated test database, hosting configuration and secure sandbox runtime credentials are still needed to implement and deploy the durable order ledger, inventory reservations, webhook processing, shipping jobs, transfers/refunds, notifications and customer order screens. These are outstanding, not completed by the tax adapter. No live payments or paid services were enabled.

See [Stripe Tax sandbox testing](https://docs.stripe.com/tax/testing) and [Tax settings API](https://docs.stripe.com/tax/settings-api).

## Order ledger and stolen-card controls added in the draft branch

The owner requested continued implementation and protection against stolen/fraudulent cards. The branch now includes an isolated PostgreSQL order ledger, service-role-only repository and handler factories, plus a conservative test fraud gate. No public route or cloud database migration was activated.

The ledger reserves one synthetic item per buyer/order, locks price and visibility, binds immutable checkout amounts, deduplicates signed payment events atomically, keeps seller/tax/postage liabilities separate, handles conflicting late payments through a suspense/review state, and queues jobs without executing them. Paid orders start with label and seller-sale-notice jobs held pending fresh fraud assessment. A held/blocked order cannot be silently auto-cleared later.

The test Checkout request collects billing address and requests 3DS. The risk evaluator checks matching, fresh provider Charge evidence, CVC/street/postal checks, 3DS outcome, Radar outcome, open reviews, refunds/disputes and address-change signals. Missing or failed evidence leads to review; explicit fraud/highest-risk outcomes block fulfillment. This is a test policy and does not establish that a cardholder is legitimate or that disputes are impossible. No paid Radar product or live rule was enabled.

**158 automated tests pass.** The added tests execute PostgreSQL functions through PGlite and exercise signed raw webhooks through the HTTP repository into those SQL transactions. They also verify role restrictions, member isolation, duplicate-event accounting, late-payment handling, fraud holds and production-project rejection. Multi-worker cloud load tests, real Supabase Auth tests and end-to-end deployed purchases remain outstanding.

See [test order backend handoff](test-order-backend.md) for schema/runtime details and deployment dependencies, and [card fraud controls](card-fraud-controls.md) for the staged policy and remaining protections. Supabase/Vercel access, actual runtime credentials, catalog/UI integration, fulfillment/notification workers, tax recording/reversals, seller transfers/payouts/refunds, operator reviews, abuse limits and live launch verification are still required. The draft is not a completed or deployed marketplace.

## Official sources

- [Stripe marketplace configuration](https://docs.stripe.com/connect/marketplace)
- [Connect sandbox testing](https://docs.stripe.com/connect/testing)
- [Hosted seller onboarding](https://docs.stripe.com/connect/hosted-onboarding)
- [Separate charges and transfers, refund responsibility](https://docs.stripe.com/connect/separate-charges-and-transfers)
- [Stripe payments pricing](https://stripe.com/pricing) and [Connect pricing](https://stripe.com/connect/pricing)
- [Webhook signature verification](https://docs.stripe.com/webhooks/signature)
- [Stripe Tax for marketplaces](https://docs.stripe.com/tax/tax-for-marketplaces)
- [Stripe restricted businesses](https://stripe.com/legal/restricted-businesses) and [services agreement](https://stripe.com/legal/ssa)
- [PayPal multiparty overview and approval requirements](https://developer.paypal.com/docs/multiparty/)
- [PayPal seller onboarding](https://developer.paypal.com/docs/multiparty/seller-onboarding/)
- [PayPal US business fees](https://www.paypal.com/us/business/paypal-business-fees)
- [Shippo API reference](https://docs.goshippo.com/shippoapi/public-api/)
