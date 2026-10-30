# Card fraud controls for Rack Relic

October 30, 2026. **Test implementation; public checkout is still closed.**

An approved charge does not establish card ownership or eliminate chargebacks. CVC and address information can be stolen together with a card. Radar, authentication and fulfillment controls reduce risk together; none is a guarantee.

## Implemented in the review branch

- The test hosted-Checkout request now collects a billing address and requests 3D Secure using `request_three_d_secure=any`. The issuer decides the authentication flow; a request does not guarantee a challenge or successful authentication.
- `stripe_test_risk.cjs` evaluates freshly retrieved, matching test Charge evidence. It requires a captured, unrefunded payment, normal Radar risk, passing CVC/street/postal checks, successful 3DS authentication, no unresolved provider review and no shipping-address change to clear the initial conservative fulfillment gate. Failed, unavailable or incomplete checks go to review; they are not silently treated as proof of fraud. This intentionally holds some legitimate payments, including some wallets, for review.
- Highest-risk/blocked outcomes, known fraud reports and disputes block fulfillment. The module stores reason codes, not card numbers or CVC. It does not enable any paid Radar product or change live account rules.
- The isolated PostgreSQL ledger marks a payment paid only from a matching signed test event. Shipping-label and seller-sale-notice jobs start **held**. Fresh risk evidence is recorded separately. Previously reviewed or blocked orders cannot be automatically cleared by a later score; an operator-review workflow is still needed.
- There are no payout or shipping workers and no live release route. Neither an event, a paid status nor a clear risk result initiates money movement. These are server modules and a test-only schema, not deployed fraud protection for the website.

## Required before live purchases

1. Verify available Radar controls and their account-specific pricing. Keep appropriate high-risk blocking; configure review/CVC/AVS/3DS rules deliberately. Do not turn on a paid upgrade without approval. Test issuer declines, failed CVC/AVS, 3DS failures, unsupported authentication, fraud warnings and open reviews.
2. Add checkout attempt limits per authenticated account and device/IP, plus bot defenses and abuse monitoring. Card-testing attacks must be blocked before repeated payment attempts. The current reservation/idempotency work prevents duplicate orders but is not a complete card-testing rate limiter.
3. Keep suspicious orders on hold before shipping. Review unusual order value, repeated cards/attempts, new accounts, expedited delivery and address changes. A different billing/shipping address is a review signal, not automatic proof of fraud. Avoid collecting unnecessary identity documents or card photos.
4. Ship only to the order's approved destination, using tracking and delivery evidence. Any requested change must trigger a fresh quote, tax calculation and risk review rather than an informal message to the seller. Consider an initial delay for suspicious/new/high-value orders, with published delivery expectations.
5. Use separate seller transfers with a defined fulfillment rule and reserves. Check risk, refunds/disputes, available funds and seller eligibility again before release. Holding funds is not escrow or guaranteed protection; the platform remains exposed to negative balances under separate charges/transfers.
6. Add provider dispute/early-fraud-warning handlers, manual review tools, original-payment-method refund/reversal handling and reconciliation. Confirmed fraud should stop fulfillment and be handled promptly in Stripe. Do not send refunds or seller money to an alternate account supplied in messages.
7. Keep raw card data with Stripe-hosted collection. Never store CVC or ask customers to email card details. Publish clear descriptors, receipts, delivery updates and return/refund policies so legitimate customers recognize transactions and can reach support.

Successful 3DS can shift liability for eligible card-fraud disputes in many cases. It does not cover every fraud scenario or disputes about non-delivery, item condition and other issues. Track chargebacks, review outcomes and false positives rather than promising zero fraud.

## Primary references

- [Stripe card verification checks](https://docs.stripe.com/disputes/prevention/verification)
- [Radar rules and 3DS behavior](https://docs.stripe.com/radar/rules)
- [Fraud prevention practices and shipping precautions](https://docs.stripe.com/disputes/prevention/best-practices)
- [Separate charges/transfers and platform liability](https://docs.stripe.com/connect/separate-charges-and-transfers)
