# Staging refund activation and acceptance

Scope: existing `test-only-marketplace-foundation` branch and draft PR #25 only. Do not merge, alter production, enable live payments, purchase plans, disable Vercel protection, buy postage or pay sellers.

## Implemented and tested; staging database installed

`20261030_refund_receipts.sql` adds one private RLS table and two service-role-only RPCs (eight private tables and twelve RPCs after activation). The original payment RPC remains compatible with the currently deployed receiver. A new wrapper atomically binds the PaymentIntent from a signed Checkout event, after validating session, order and totals. A refund is resolved by that binding, never by caller-provided order metadata.

`20261030_refund_requests.sql` is a fifth migration adding a private request table and five service-role-only RPCs (nine private tables and seventeen public RPCs after both migrations). Both migrations were applied once on October 30, 2026 to staging `zvtaqzcqfdjpuwnlpzln` through its authenticated SQL editor, after confirming the original seven tables and ten RPCs and no refund functions. Post-install inspection returned nine tables, RLS enabled on all nine, seventeen public RPCs, and zero table or routine grants to PUBLIC, anon or authenticated. It freezes operator identity, order, PaymentIntent and amount, reserves refund capacity, holds fulfillment and claims exactly one provider-creation attempt. An unresolved request blocks a replacement request for that order. Known refund IDs recover through GET only. Signed notifications can recover a lost ID after matching the pre-existing dispatched request's order/payment/amount. No client identity or refund metadata can create an order or override its financial data.

Refund receipts distinguish pending, requires-action, succeeded, failed and canceled statuses. The order reports cumulative confirmed and pending amounts separately. Different success events for the same refund do not duplicate the ledger. Aggregate confirmed plus pending amounts cannot exceed the order total. A subsequent failed refund reverses the provisional outflow through new balanced entries. Older events cannot undo newer evidence. Conflicting statuses in the same second and unsupported terminal regressions create a persistent review hold because event timestamps alone cannot settle their order.

Successful refunds post to refund-allocation suspense. This deliberately leaves seller liabilities, buyer fees, tax and simulated postage allocations unresolved until appropriate workers/operator review exist. A balanced ledger is not proof that tax was reversed, processing fees were recovered or a seller was paid. Risk review, inventory and fulfillment stay held. Refunds do not automatically relist a returned item. The new operator API can issue sandbox refunds only after explicit activation; it is currently disabled. Creating/refunding an unrelated test payment would not prove this integrated flow.

## Activation sequence when authenticated cloud management is available

1. Read back the exact staging project `zvtaqzcqfdjpuwnlpzln`. Inspect migration history/table/function definitions before changing anything. Never run this migration on production `zrfztnbyynrdzfeblkeq` or blindly reapply/reset earlier migrations or reservations.
2. Apply `supabase/test/20261030_refund_receipts.sql` once, after the existing three migrations; then apply `supabase/test/20261030_refund_requests.sql` once. Verify RLS, browser-role denial and service-role-only function grants. These are intentionally first-install migrations, not reset scripts.
3. Run `node scripts/build-test-webhook.cjs`. Deploy its generated `supabase/functions/stripe-test-events/index.mjs` as the staging function entrypoint, preserving the existing signature secret and raw-body signature verification. Legacy JWT verification stays off for Stripe. Both refund flags remain unset/false during deployment; checkout-only routing remains compatible.
4. Set `RACK_RELIC_TEST_REFUNDS_ENABLED=true` and `RACK_RELIC_TEST_REFUND_REQUESTS_ENABLED=true` in **staging Edge secrets**, then verify the running function uses the new payment and refund-receipt wrappers. A missing migration returns 503 and requests retry rather than acknowledging unprocessed data. Do not infer success from a deployment alone.
5. Read the current approved sandbox endpoint and retain the existing URL, API version, secret and four checkout subscriptions. Add only `refund.created`, `refund.updated`, `refund.failed` after the receiver and migration are ready. Read back the saved list. Do not replace it with `*` or create a duplicate destination.
6. Complete a genuine integrated test purchase. Inspect the same known session/order and signed delivery plus database records. If payment preceded activation, resend the original signed Checkout event after confirming its exact known order/session/PaymentIntent. Do not manually invent a binding. A refund arriving before the paid binding returns 503 for retry.
7. After receiver verification, set the same two refund flags in the **exact test branch's Vercel Preview settings** and set `RACK_RELIC_TEST_REFUND_OPERATOR_IDS` to explicitly authorized existing staging member IDs (a nonempty subset of the two-member allowlist). Do not assume every signed-in buyer or seller is a refund operator. Without all three settings the refund action returns 404. Do not set production values.
8. Use the protected operator API below for the known integrated payment. There is no operator form or public buyer/seller refund button yet. Verify Stripe, delivery logs and database receipts before recording any acceptance pass.

The desktop continuation verified staging access and completed steps 1–2 on October 30, 2026. All 250 automated tests passed again. After explicit owner approval, the exact generated receiver was deployed to the existing staging function; the dashboard confirmed success and an actual unsigned request returned HTTP 400. Steps 1–3 are complete. After separate explicit owner approval, both Edge receipt flags were saved as true (verified by their SHA256 digests), and the existing Stripe sandbox endpoint was updated/read back with the original four Checkout subscriptions plus refund.created, refund.updated and refund.failed. Its URL, API version, enabled status and signing secret were preserved. Configuration steps 4–5 are saved, but no genuine signed payment/refund delivery has yet proven the new runtime wrappers. Steps 6–8, Preview refund flags and operator authorization remain pending; issuing refunds is disabled. Do not reapply the first-install migrations. Existing credentials remain in their original private settings.

## Private operator API contract (disabled until activation)

`POST /api/test-marketplace?action=refund` accepts JSON with exactly `requestId` (a stable UUID), `orderId` and `amountCents`. It requires the existing staging bearer session of an explicitly configured operator, who must also be an order participant. Persist the request UUID before sending and reuse it for retries. Payment/charge IDs, operator identity, fees, transfer instructions and reasons are not accepted from the caller. The server uses `requested_by_customer` and never requests a transfer or application-fee reversal.

`GET /api/test-marketplace?action=refund&requestId=<saved UUID>` reauthenticates the same operator and retrieves only a saved, known refund. It cannot create a refund or book money. An unknown outcome returns 409 and must remain held, even beyond Stripe's idempotency retention period. An authenticated signed notification can recover the ID; without one, operator reconciliation is still required. `request_recorded` means only that the request and provider identity were saved, not that money was confirmed refunded. The signed-event order view remains the financial authority.

The Stripe client verifies the exact sandbox account and test balance, order-bound successful PaymentIntent and its captured test charge. Disputed, fully refunded, insufficient-remaining-amount, mismatched and connected-account-transfer charges fail before POST. Uncertain errors after dispatch retain the marker. These choices are intentionally conservative; there is no automatic second POST.

## Acceptance evidence still required

| Case | Evidence required | Current result |
| --- | --- | --- |
| Buyer sign-in | Same requesting Chrome profile completes PKCE; server accepts allowlisted member | Pending; email request accepted only |
| Successful checkout | Paid test session, signed delivery, one sold synthetic item, one balanced payment ledger | Pending; provider sessions are unpaid |
| Decline / 3DS failure | Provider decline/authentication result, no paid ledger, no fulfillment | Pending |
| Cancel | Return page does not confirm payment or prematurely release inventory; signed expiry handles release | Pending |
| Repeated click / interruption | Same saved order/session, no second creation; unknown creation remains held | Automated tests pass; browser/provider acceptance pending |
| Partial then full refund | Same bound payment, distinct refund receipts, correct cumulative total, balanced suspense | Automated tests pass; provider/database acceptance pending |
| Pending / failed / canceled refund | No unverified refund credited; later failed success is reversed once | Automated tests pass; provider acceptance pending |
| Replay / out-of-order refund | No duplicate accounting; stale events ignored; ambiguity held | Automated tests pass; provider acceptance pending |
| Operator request / lost response | Authenticated configured operator, one durable POST, GET-only known-ID recovery, signed receipt recovery | Automated tests pass; activation/provider acceptance pending |
| Member isolation | Buyer and seller see only their orders; provider IDs/private payloads stay server-side | Automated tests pass; browser acceptance pending |

Do not alter the synthetic listing or clear its reservation to make a test pass. Inspect the saved checkout attempt and provider session first. Cloud work can continue without a Mac; completing the pending browser sign-in needs the person using the original requesting Chrome profile. Email receipt itself is not proof of completed sign-in.

## Remaining implementation

Deploy and accept the implemented operator refund requests; operator UI; fresh provider reconciliation for ambiguous receipts or unknown creations without a signed receipt; tax transaction/reversal workers; actual processor-fee accounting; return/relisting policy; seller onboarding and payout workers; notifications and operational review. No paid upgrades or launch-availability changes are part of this work.

Validation: 250 automated tests pass, including PGlite execution and signed Node/Edge notification paths. No test has been relabeled as provider/browser acceptance. Stripe readback still shows two unpaid sessions and no refunds. The desktop continuation changed the approved staging receiver and its sandbox notification subscriptions only; it sent no refund POST. The earlier cloud-only observations are historical, not proof of current provider acceptance.

Provider references: [Stripe refund statuses](https://docs.stripe.com/api/refunds/object), [refund events and failures](https://docs.stripe.com/refunds), [webhook delivery and ordering](https://docs.stripe.com/webhooks). Refund receipts use the destination's existing snapshot schema; account API defaults are unchanged.
