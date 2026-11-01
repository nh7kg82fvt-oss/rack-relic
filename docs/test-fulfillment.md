# Private fulfillment evidence and readiness

Apply `20261031_fulfillment_snapshots.sql` only to the isolated staging database, after charge-fee evidence. It adds one RLS-enabled private table and two backend-only public RPCs. Browser roles receive no table, schema or RPC access. The private address-hash helper also has no browser grants.

Carrier checkout now commits normalized origin/destination addresses, packed parcel dimensions/weight, shipment/rate identities, carrier/service, amount and quote expiry with the financial preparation in one transaction. The address hash must equal the shipping and tax destination hash. The saved rate and amount must equal the selected financial quote. Financial preparation rolls back if private evidence fails validation. Competing requests preserve the first committed quote and private snapshot. Expired undispatched preparations can append fresh rate evidence; dispatched attempts cannot acquire reconstructed addresses. Simulated checkout does not create carrier evidence.

Addresses and parcel data stay in the private table. They are absent from checkout attempts, ordinary order views and browser readiness responses. Existing orders are not backfilled by guessing the details used for an earlier quote.

The operator-only GET readiness action returns bounded hold reasons and whether a snapshot exists. Payment, risk, refunds, missing snapshots, expired quotes and held jobs prevent readiness. It never modifies jobs, purchases a label, writes a ledger entry or contacts Shippo. Even `ready_for_review` always includes `labelPurchaseEnabled:false`. This read-only result is not dispatch authority; a future label executor must recheck all holds atomically when claiming a durable attempt and reconcile uncertain provider responses before another request.

Label purchase, seller access to labels, tracking callbacks, delivery decisions, rate adjustments, label refunds and seller settlement remain separate implementation and acceptance work. Live shipping is not activated by this migration.
