# Scoped TEST case-alert receiver proposal

The canonical TEST receiver includes the complete unchanged 15,500-byte v9 ingestion module and a separately gated finite alert host. The added host remains OFF unless its existing private wake setting and all separately reviewed bindings are supplied. Publication does not enable it, provide keys, install SQL, authenticate an owner or approve any message. No browser route, scheduler, live endpoint or payment authority is added.

The package under `server/urgent-alert-package/` is self-contained source. Its pinned modules build exactly `supabase/functions/stripe-test-events/index.mjs`; no evaluation, dependency installation or provider call occurs during the build. Run `node server/urgent-alert-package/scripts/build-edge-bundle.cjs > receiver-proposal.mjs` to write a separate local comparison artifact. The original v9 baseline is retained as a build input because the generated receiver embeds it byte-for-byte while suppressing its legacy registration and registering one combined handler.

The reviewed scope binds one alert ID, case, order, generation, head evidence digest, signed-ingestion event ID, raw body digest, creation cutoff and canonical minimal message hash. Old unscoped enrollment fails closed to original ingestion without wake. Unrelated signed events retain original ingestion behavior. The original delivered rehearsal case/order and worker are explicitly excluded. No actual new case, order, worker, enrollment, secret or send authority is included in this package.

`supabase/proposals/urgent_alert_enrolled_scope.sql` is an uninstalled proposal, not a migration or activation script. It creates only exact-row scope helpers and two closed RPCs, with execution revoked from PUBLIC, browser roles and service_role. Function owners and database administrators retain their inherent authority; these runtime revocations do not remove that authority. It adds no table, queue, journal, trigger, schedule, backfill or global refresh. Any later installation needs its own guarded native catalog/dependency review and exact-target decision; this source file does not authorize running it. Existing generic alert RPCs remain unchanged and are not allowlisted by this host.

The exact claim locks the head and enrolled outbox row in the existing order, uses SKIP LOCKED, and only leases a never-attempted pending case_changed row whose current ancestry and projection match. Attempted, unknown, delivered, final, foreign and expired work remains held. It does not reconcile or clear any old row. The original worker, send journal, stable delivery/idempotency keys, transport and privacy projection are reused.

Immediately before the email POST, after the durable journal has already been consumed, the host checks current row authority and enrollment again. This reduces a race; it cannot make a database observation atomic with a remote send or prove provider commit before the deadline. A lost/uncertain response stays UNKNOWN and never receives a replacement send grant. Accepted provider response is not signed delivery proof.

The original finite deadline remains min(five seconds, enrollment remaining lifetime), with wall/monotonic rollback, stop/expiry and pre-dispatch checks. A synthetic success uses20 HTTP operations:12 receipt rejection probes,7 database requests and1 email. Native Deno latency, cancellation, multi-isolate propagation, independent PostgreSQL contention, real signed purchase/adverse-event delivery and provider receipt reconciliation remain unaccepted. No timeout is extended. Actual trusted fulfillment, payment/Tax/refund, manual-release/delivery/reserve/recovery and financial gates remain separate.

Portable source checks, with Node and an already trusted `@electric-sql/pglite`0.5.13 dependency available:

```
node --test tests/urgent-alert-package.test.cjs
```

The42 portable package checks use synthetic transports and disposable PGlite only. The2 root composition checks verify canonical build parity and OFF behavior. The root wrapper also loads all42 package tests so the ordinary repository test glob includes them once. They are separate from native/provider/hosted acceptance and from any historical test totals. The old before-defect diagnostic is not part of the package; its current finite-scope regressions run against this package only. No external historical checkpoint, private manifest, raw log, local machine path, archive or dependency tarball is needed by these tests.
