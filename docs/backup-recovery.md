# Backup and recovery acceptance

Prepared November 3, 2026 (Pacific). These are source foundations with 31 local
checks. No archive provider, backup transport, scheduler, secret, production
restore endpoint or durable recovery-hold migration has been installed by this
work. The application does not import or run these modules yet. Live checkout
and ordinary seller money remain closed.

## What needs protecting

Supabase Pro daily database backups cover database records. Supabase documents
that these backups do **not** include the actual objects stored through Storage;
only their database metadata is included. Photo bytes need a separate retained
copy. A database restore also does not undo real Stripe charges, refunds,
transfers or bank payouts. Restored application records must be compared with
provider history before operations resume.

The current live photo delivery source uses the private `listing-photos` bucket,
server-side access checks and up to six photos per listing, each at most 2 MiB.
Those access protections do not create a backup. Public source code, this GitHub
repository, a seller's browser and the owner's Mac are not backup destinations.

Official references: [Supabase database backups](https://supabase.com/docs/guides/platform/backups),
[project pausing](https://supabase.com/docs/guides/platform/free-project-pausing).
Pro's seven daily database copies are not seven already-verified restore points
for this newly upgraded account; inspect actual availability and test a restore.

## Private photo snapshot foundation

`server/backup_recovery_photos.cjs` exports `createPhotoBackupRecovery`. It is
disabled unless explicitly configured by trusted server code. It has no built-in
HTTP/storage transport and accepts no browser authority, caller URL, card/bank
data or automatic production-restore request.

- The source must be Rack Relic's fixed production or an allowlisted private test
  project, and the bucket must be `listing-photos`. The inventory is bounded,
  paginated, globally ordered and duplicate-free. Each object must have a
  version, expected size and approved image type. Object reads must bind that
  exact version and reject stale/cached, oversized or invalid-image responses.
- The entire source inventory is listed again after the copy. Changed,
  incomplete or looping inventories cannot establish a verified backup. This is
  a stable-inventory check, not a transactional database snapshot or a guarantee
  of a single instant across the database and Storage.
- The archive must be private, independently credentialed, immutable and retain
  older objects for at least seven days. It cannot be the source project under
  another bucket name. Fresh policy checks precede writes and verification.
  The backup worker has no deletion or pruning interface and never mirrors a
  source deletion into older snapshots.
- Each snapshot has its own object namespace and content hashes. Daily snapshots
  do not share blobs whose old lifecycle could expire beneath a newer manifest.
  Conditional create-only writes must never overwrite existing contents. A lost
  response is reconciled by reading that exact key; the function does not issue
  another write to a replacement key.
- A private manifest binds original object paths, source versions, sizes, image
  types and SHA-256 checksums. An independent 32-byte secret authenticates the
  manifest using HMAC. Photo paths and manifest contents must stay private.
  Keep the HMAC verification key separately protected and recoverable, retaining
  the appropriate old keys when rotating it. No secrets are in source.
- The manifest is written last, and all stored bytes are read back before a
  verified receipt is returned. **Manifest existence alone is not success.**
  Persist the verified receipt in an independent durable job record. A partial,
  ambiguous, timed-out or corrupt copy must remain a failure requiring review.
  A replay of an already completed snapshot verifies its original contents; it
  does not silently replace them with a newer source state.

Default per-run bounds are 500 objects, 256 MiB total, 2 MiB per image, 50 objects
per page, 100 pages and 60 seconds. Reaching a limit is an incomplete backup,
not permission to silently skip the rest. A real worker needs bounded durable
batch/checkpoint continuation, scheduling, measured completion deadlines and
meaningful failure/staleness alerts before a larger inventory can be supported.
Snapshot retention and per-run limits do not themselves cap total archive cost.
Estimate storage using photo bytes times retained daily copies, plus object
requests, transfer and restoration costs. Any new paid service requires a
concrete quote and the owner's approval.

### Transport contracts

All callbacks are trusted **server adapters**, never request-supplied objects.
Their returned booleans are not evidence by themselves. Implement and verify
them against actual provider policies, responses and resource identities.

| Adapter | Required behavior |
| --- | --- |
| `source.listPage({cursor,limit,signal})` | Read the complete flattened private inventory, return `sourceIdentity`, fresh `checkedAt`, `items:[{path,version,size,contentType}]` and explicit `nextCursor:null` at the end. Do not enumerate only the first page or only current public listings. |
| `source.readVersion({path,version,signal})` | Return `{version,response}` for the exact original object version. Reject substitution, redirects and stale reads. An object changed/deleted during the run makes the backup incomplete. |
| `archive.inspect({signal})` | Verify the pinned `identity`, `private:true`, `immutable:true`, `deletePropagation:false`, `independentCredentialScope:true`, sufficient `retentionDays` and fresh `checkedAt`. Verify separate access/failure boundaries rather than relabeling a production bucket. |
| `archive.read({key,signal})` | Return a fresh `Response` or authoritative `null` for absence. Hide the destination from public serving. |
| `archive.putIfAbsent(...)` | Enforce atomic create-only semantics, exact private destination and minimum retention on every object, not just an earlier check. Preserve existing data on conflict. Acknowledgment alone is insufficient; read-back hashing is mandatory. |

Provider retention/lifecycle settings must keep all parts of a snapshot for the
claimed recovery window. Review minimum-retention protection and eventual expiry
with the owner's retention policy. Cleanup must use a separately authorized
capability that cannot erase a still-needed database/photo recovery set. The
snapshot worker itself has no such capability.

## Isolated photo restore drill

`verifySnapshot` is read-only and requires the saved snapshot reference and
expected authenticated manifest digest. `restoreDrill` verifies **every** object
before its first write and writes only beneath `drills/<drill-id>/...` in a
private `rr-backup-restore-drill` bucket on the reviewed acceptance project.
Production, the source project, public buckets and another target are rejected.
Fresh short-lived server authority must bind the exact snapshot, digest, drill,
purpose and target; authority and private-target conditions are rechecked after
a missing-object read immediately before every write, and again at completion.
A grant that expires during the policy check cannot authorize the write. The
target transport must also enforce the supplied bound authority, expiry and
private create-only condition at dispatch. Existing differing objects are not overwritten.
Lost writes are retrieved by the original path. No production restore is enabled.

The authority adapter still needs actual authenticated operator authorization,
durable audit/claim state and a verified private drill bucket. Passing local
injected-adapter tests is not evidence that those resources exist or that real
photo data has been copied or restored.

This photo drill does **not** restore the SQL database. Hosted acceptance must
restore a real database backup into an isolated target, select the matching
retained photo recovery set, then verify that all restored `photo_path` and
`photo_paths` references resolve to the correct seller/listing images. Exercise
private access after sign-out, hidden/archived listing access, gallery ordering
and a deliberately deleted/replaced original photo. Record actual counts and
checksums without publishing private object paths. A recent database snapshot
and an unrelated photo snapshot must not be assumed consistent.

## Post-restore Stripe reconciliation foundation

`server/backup_recovery_reconciliation.cjs` is test-only, read-only and disabled
by default. It accepts only a reviewed test environment. It never calls a
provider write, recreates a payment/refund/transfer/payout, clears a hold or
enables seller money. Even a consistent result retains `holdPayouts:true`,
`requiresOperatorReview:true` and `releaseEnabled:false`.

The caller must already have installed a durable recovery hold that blocks new
checkout, fulfillment and seller release. A fresh trusted adapter must prove
that hold for the exact run and project, both before and after assessment. This
module does **not** create that global hold or integrate it with existing money
jobs. Failure to provide it blocks reconciliation before provider access.

Fresh Stripe identity and `livemode:false` are required before order reads and
again before a result. The database project and Stripe account cannot be mixed.
The adapters must produce bounded complete inventories from the start of account
history through the run's start. They must include provider payments for which
the restored database has no order; reading only known restored references would
miss new payments lost by a rollback. Both sides are paginated and read twice;
incomplete coverage, changing data, repeated cursors, stale evidence or exceeded
limits leave the result blocked.

The canonical projection binds order, PaymentIntent and charge identities,
original USD amounts, saved payment/refund state, individual refunds, transfers,
their seller destinations/reversals and payouts bound to the transferred seller
funds. Missing orders, substituted references, duplicate provider references,
inconsistent accounting, pending refunds/payouts and unfunded transferred refunds
cannot be declared reconciled. Returned reasons contain only opaque order IDs
and bounded reason codes, never addresses, card/bank details or raw responses.

This initial projection supports the narrow single-order test settlement model.
Aggregated seller payouts, historical allocation rules, non-USD transactions,
unresolved/incomplete payment attempts, fees, taxes, postage, disputes and full
ledger/balance reconstruction require additional projections and verified
provider adapters. They must remain held rather than being filtered out to get
a pass. No production account or production recovery-release authority is
supported by this source.

## Before calling recovery ready

1. Verify actual Pro database backups, retention and an isolated SQL restore.
2. Choose and price a separate private archive, verify independent credentials,
   immutable retention, lifecycle and privacy, then obtain any required owner
   approval before adding paid services or security-sensitive access.
3. Implement real source/archive transports, durable job/checkpoint records,
   safe bounded continuation, daily cloud scheduling, and stale/failure alerts.
   Keep keys and manifests private; the Mac must not be required to run it.
4. Back up synthetic images first; simulate replacement, deletion, interrupted
   upload, corrupted snapshot and revoked credentials. Record actual provider
   evidence and a verified isolated SQL/photo restore with matching references.
5. Install and test a durable global recovery gate independently of chat or AI.
   Complete fresh provider history, ledger, refund/transfer/payout, tax/postage,
   balance and orphan-payment reconciliation. Obtain a separately reviewed
   decision before resuming operational writes. A good backup is not payment
   reconciliation and a consistent test report is not release authority.

Focused local checks:

```sh
node --test tests/backup-recovery-photos.test.cjs tests/backup-recovery-reconciliation.test.cjs
```
