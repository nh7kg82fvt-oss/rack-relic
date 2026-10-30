# Staging refund activation and acceptance

Scope: existing `test-only-marketplace-foundation` branch and draft PR #25 only. Do not merge, alter production, enable live payments, purchase plans, disable Vercel protection, buy postage or pay sellers.

## Implemented and tested, not activated remotely

`20261030_refund_receipts.sql` adds one private RLS table and two service-role-only RPCs (eight private tables and twelve RPCs after activation). The original payment RPC remains compatible with the currently deployed receiver. A new wrapper atomically binds the PaymentIntent from a signed Checkout event, after validating session, order and totals. A refund is resolved by that binding, never by caller-provided order metadata.

Refund receipts distinguish pending, requires-action, succeeded, failed and canceled statuses. The order reports cumulative confirmed and pending amounts separately. Different success events for the same refund do not duplicate the ledger. Aggregate confirmed plus pending amounts cannot exceed the order total. A subsequent failed refund reverses the provisional outflow through new balanced entries. Older events cannot undo newer evidence. Conflicting statuses in the same second and unsupported terminal regressions create a persistent review hold because event timestamps alone cannot settle their order.

Successful refunds post to refund-allocation suspense. This deliberately leaves seller liabilities, buyer fees, tax and simulated postage allocations unresolved until appropriate workers/operator review exist. A balanced ledger is not proof that tax was reversed, processing fees were recovered or a seller was paid. Risk review, inventory and fulfillment stay held. Refunds do not automatically relist a returned item. No server API issues a refund yet; creating/refunding an unrelated test payment would not prove this integrated flow.

## Activation sequence when authenticated cloud management is available

1. Read back the exact staging project `zvtaqzcqfdjpuwnlpzln`. Inspect migration history/table/function definitions before changing anything. Never run this migration on production `zrfztnbyynrdzfeblkeq` or blindly reapply/reset earlier migrations or reservations.
2. Apply `supabase/test/20261030_refund_receipts.sql` once, after the existing three migrations. Verify RLS, browser-role denial and service-role-only function grants. The migration is intentionally first-install SQL, not a reset script.
3. Run `node scripts/build-test-webhook.cjs`. Deploy its generated `supabase/functions/stripe-test-events/index.mjs` as the staging function entrypoint, preserving the existing signature secret and raw-body signature verification. Legacy JWT verification stays off for Stripe. The default `RACK_RELIC_TEST_REFUNDS_ENABLED` remains unset/false; checkout-only routing remains compatible during deployment.
4. Set `RACK_RELIC_TEST_REFUNDS_ENABLED=true` in **staging Edge secrets only**, then verify the running function uses the new payment wrapper. A missing migration returns 503 and requests retry rather than acknowledging unprocessed data. Do not infer success from a deployment alone.
5. Read the current approved sandbox endpoint and retain the existing URL, API version, secret and four checkout subscriptions. Add only `refund.created`, `refund.updated`, `refund.failed` after the receiver and migration are ready. Read back the saved list. Do not replace it with `*` or create a duplicate destination.
6. Complete a genuine integrated test purchase. Inspect the same known session/order and signed delivery plus database records. If payment preceded activation, resend the original signed Checkout event after confirming its exact known order/session/PaymentIntent. Do not manually invent a binding. A refund arriving before the paid binding returns 503 for retry.
7. Use the sandbox's authorized operator refund control for the known integrated payment when appropriate. There is no buyer/seller refund endpoint yet. Verify Stripe, delivery logs and database receipts before recording any acceptance pass.

There is no authenticated Supabase/Vercel management connection in this cloud session, so steps 1–7 remain pending. No secret or browser credential needs to be copied into chat. Existing credentials remain in their original private settings.

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
| Member isolation | Buyer and seller see only their orders; provider IDs/private payloads stay server-side | Automated tests pass; browser acceptance pending |

Do not alter the synthetic listing or clear its reservation to make a test pass. Inspect the saved checkout attempt and provider session first. Cloud work can continue without a Mac; completing the pending browser sign-in needs the person using the original requesting Chrome profile. Email receipt itself is not proof of completed sign-in.

## Remaining implementation

Authenticated refund requests and operator authorization; durable one-attempt refund dispatch with known-ID GET recovery; fresh provider reconciliation for ambiguous receipts; tax transaction/reversal workers; actual processor-fee accounting; return/relisting policy; seller onboarding and payout workers; notifications and operational review. No paid upgrades or launch-availability changes are part of this work.

Provider references: [Stripe refund statuses](https://docs.stripe.com/api/refunds/object), [refund events and failures](https://docs.stripe.com/refunds), [webhook delivery and ordering](https://docs.stripe.com/webhooks). Refund receipts use the destination's existing snapshot schema; account API defaults are unchanged.
