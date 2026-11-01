# Private fulfillment evidence and readiness

Apply `20261031_fulfillment_snapshots.sql` only to the isolated staging database, after charge-fee evidence. It adds one RLS-enabled private table and two backend-only public RPCs. Browser roles receive no table, schema or RPC access. The private address-hash helper also has no browser grants.

Carrier checkout now commits normalized origin/destination addresses, packed parcel dimensions/weight, shipment/rate identities, carrier/service, amount and quote expiry with the financial preparation in one transaction. The address hash must equal the shipping and tax destination hash. The saved rate and amount must equal the selected financial quote. Financial preparation rolls back if private evidence fails validation. Competing requests preserve the first committed quote and private snapshot. Expired undispatched preparations can append fresh rate evidence; dispatched attempts cannot acquire reconstructed addresses. Simulated checkout does not create carrier evidence.

Addresses and parcel data stay in the private table. They are absent from checkout attempts, ordinary order views and browser readiness responses. Existing orders are not backfilled by guessing the details used for an earlier quote.

The operator-only GET readiness action returns bounded hold reasons and whether a snapshot exists. Payment, risk, refunds, missing snapshots, expired quotes and held jobs prevent readiness. It never modifies jobs, purchases a label, writes a ledger entry or contacts Shippo. Even `ready_for_review` always includes `labelPurchaseEnabled:false`. This read-only result is not dispatch authority; a future label executor must recheck all holds atomically when claiming a durable attempt and reconcile uncertain provider responses before another request.

## Durable sample labels

Apply `20261031_label_attempts.sql` after the snapshot migration, only in isolated staging. It adds one private RLS table and four service-role-only RPCs. It does not grant browser access or automatically contact Shippo.

The separate `sample-label` action defaults to disabled. It requires the exact private preview branch, Shippo test mode, `RACK_RELIC_TEST_LABEL_REQUESTS_ENABLED=true`, and fresh membership in the existing explicitly configured operator list. It accepts only an order and a saved request UUID. Private addresses and parcel details come from the immutable checkout snapshot, never browser label parameters.

A new sample requires a signed paid order, a payment-intent identity, clear risk with evidence checked within five minutes, no pending or confirmed refund, and a pending shipping job. An expired original carrier quote is not reused. Shippo quotes the same saved addresses and parcel again; the new rate must be USD and at or below the original collected shipping amount. Checkout totals and original financial evidence remain unchanged. The claim rechecks all gates and stores the new rate before the only provider transaction POST. One order can have only one sample attempt, including failed and uncertain attempts.

The browser saves its request UUID before sending and never replaces it on refresh or an error. A provider timeout or lost database-save response leaves the committed claim held. The status action can retrieve a known transaction, but cannot dispatch another purchase. An unknown transaction requires manual Shippo reconciliation using the exact metadata marker; no guessed identity or replacement purchase is supported. Known responses must match the request marker, rate, transaction and test mode. Only bounded statuses and allowlisted HTTPS sample-document hosts are accepted. Terminal success/error evidence cannot be overwritten by a stale pending response. No ledger entry, seller transfer or tax adjustment is generated.

The readiness GET still always returns `labelPurchaseEnabled:false`; it is not dispatch authority. When the separate sample workflow is configured, its UI explicitly says the readiness check does not generate a label. The operator sample workflow is manual and never valid postage. Actual browser/provider acceptance remains required before treating label generation as verified.

Seller access to labels, tracking callbacks, delivery decisions, rate adjustments, label refunds and seller settlement remain separate implementation and acceptance work. Live shipping is not activated by either migration.
