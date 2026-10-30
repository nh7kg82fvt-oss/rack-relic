# Rack Relic: purchases and seller payouts

Reviewed October 30, 2026 (Pacific). Source baseline: `884b380ae7a35a772543cff127b77ae451796d5d`.

## Decision and boundaries

Start with a **Stripe Connect sandbox**, Stripe-hosted Checkout and hosted seller onboarding. Test one US seller, one US buyer, USD and one shippable listing per order. Use separate charges and transfers so a seller transfer can follow the agreed fulfillment rule rather than happen at checkout. This is a proposed funds flow, not an approved live provider arrangement. Test destination charges as an alternative if Stripe's account configuration or underwriting makes that preferable.

No live account activation is required to develop against a sandbox. A Stripe login, sandbox access, Connect configuration and sandbox keys are still needed. Stripe's sandbox capabilities can be less restrictive than live capabilities: passing tests does not establish launch eligibility. Wayne subsequently authorized proceeding with sandbox setup. Stripe access has been requested but was not connected during this implementation; no provider objects or payment requests were created.

This branch adds server-only test checkout construction and raw-body webhook verification, exercised with mocked HTTP responses. It adds **no public route**, transfers, refunds, live account creation, database migrations, checkout UI, secrets or environment changes. The existing public Buy button and manifest remain closed. No production deployment or database state was inspected or changed by this review.

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

1. **Isolated environment.** Connect the Stripe sandbox, create test seller accounts and fake buyers, choose controller/dashboard properties and capabilities, and establish a separate Supabase test project. Keep production credentials inaccessible. Use fixture addresses and test cards only. Pin Stripe API and webhook versions, store secrets only in server environment configuration, and restrict access to the preview.
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

Checkout return URLs are deliberately fixed to a localhost test harness; that harness is not implemented. No account-specific SDK/API calls were executed. No claim is made that seller onboarding, transfers, payouts, refunds, Shippo-to-order integration or tax collection is complete. Change nothing in public checkout configuration until the isolated order stack passes acceptance tests.

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
