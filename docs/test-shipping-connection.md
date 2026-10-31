# Private carrier connection test

The exact test marketplace preview branch can run a manual Shippo carrier-price check. It requires the existing explicit test operator authorization and a server-only `RACK_RELIC_TEST_SHIPPO_KEY` beginning with `shippo_test_`. Configure the secret only for this preview branch. Production and other branches return 404.

The route accepts only a POST with an empty JSON object. It sends a fixed synthetic Seattle-to-New York parcel (10 × 8 × 2 inches, 1 lb). It accepts no customer address, rate, order, label instructions or provider URL from the browser. Fresh operator verification precedes Shippo access. Responses must be test mode, bounded USD prices, uncached and free of live rates. Provider identifiers and credentials are omitted from the browser result.

This checks the shipping connection only. It does not change the simulated checkout price, modify an order, call the transactions endpoint, buy postage or activate fulfillment. There are no automatic retries. Test prices can differ from live prices. A later order-bound fulfillment workflow still needs durable address and parcel snapshots, rate expiry/requote rules, risk/refund gates, dispatch claims, uncertain-outcome reconciliation and tracking verification before label activation.

Reference: [Shippo test mode](https://docs.goshippo.com/guides/testing). The existing client pins API version 2018-02-08.
