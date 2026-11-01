# Private carrier connection test

The exact test marketplace preview branch can run a manual Shippo carrier-price check. It requires the existing explicit test operator authorization and a server-only `RACK_RELIC_TEST_SHIPPO_KEY` beginning with `shippo_test_`. Configure the secret only for this preview branch. Production and other branches return 404.

The route accepts only a POST with an empty JSON object. It sends a fixed synthetic Seattle-to-New York parcel (10 × 8 × 2 inches, 1 lb). It accepts no customer address, rate, order, label instructions or provider URL from the browser. Fresh operator verification precedes Shippo access. Responses must be test mode, bounded USD prices, uncached and free of live rates. Provider identifiers and credentials are omitted from the browser result.

This diagnostic checks the shipping connection only. It does not change the simulated checkout price, modify an order, call the transactions endpoint, buy postage or activate fulfillment. There are no automatic retries. Test prices can differ from live prices.

## Optional carrier checkout mode

Checkout defaults to `simulated`. The prepared `RACK_RELIC_TEST_SHIPPING_MODE=shippo_test` mode requires a valid server-only test key **and** `RACK_RELIC_TEST_QUOTE_LIMITS_ENABLED=true`. Unknown modes, live keys or missing durable limits close checkout instead of falling back silently. Configuration and interface descriptions identify carrier test prices accurately.

When activated for a fresh synthetic fixture, the existing authenticated reservation and durable quote budget precede Shippo requests. The lowest eligible bounded USD test rate is bound to the reserved listing version, order and destination hash, included in the Stripe test tax calculation and persisted in the immutable checkout attempt before payment-session dispatch. Existing attempts retain their saved financial snapshot and destination; changing provider mode never reprices an existing checkout. Activation and a deployed new-order acceptance run remain separate from the connection test.

A later fulfillment workflow still needs durable private address and parcel snapshots, rate expiry/requote rules, risk/refund gates, dispatch claims, uncertain-outcome reconciliation and tracking verification before label activation. Neither mode can purchase postage through this route.

## Unpaid checkout acceptance

After owner-approved test activation, deploy the exact preview branch with carrier mode, quote limits and the fresh synthetic fixture selected. Never reset a sold fixture. Verify the page identifies carrier test pricing, create one unpaid hosted test checkout, and compare its item, buyer fee, shipping, tax and total with the immutable database snapshot. Confirm a real test rate identifier and a test tax calculation are saved for that order, with no paid ledger entries or fulfillment jobs. Reloading checkout must retain the same order and session; it must not create another quote or session. Leave payment submission and label purchase closed during this acceptance step.

Reference: [Shippo test mode](https://docs.goshippo.com/guides/testing). The existing client pins API version 2018-02-08.
