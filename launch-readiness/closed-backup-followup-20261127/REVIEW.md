# Rack Relic backup and restore follow-up

This package is for offline review and synthetic rehearsals on draft PR 25. The
November 27 carrier is unchanged. The original checkout and November 18 work
were preserved. The authorized handoff was GitHub repository 1414017364,
`6f0ba54a1947a2d5979fff9956b226363304a98d` and parent
`d26d647d94a6cf1c4367822dacd29f64e4b3d7d8`. The exact carrier blob
`236663e561cd6445b8921b9cfd61ad35bcc6c7ce` contained nine allowed regular
UTF-8 paths and 56,183 source bytes. All nine SHA-256 and lengths matched
before any source ran. The follow-up reads the frozen inputs as data.

## Local evidence

- Run `npm ci --ignore-scripts --no-audit --no-fund` and `npm test` here on
  Node 22.15+. Four new tests passed on Node 24. They loaded all five generated
  ESM entrypoints, exercised the offline signed ticket preflight, ran the
  actual admission, collector, Source facade and signed original ports through
  a nonempty synthetic PNG and manifest, and exercised loss of an acknowledgment
  after storing photo bytes. The latter retained the original UNKNOWN and issued
  no second put. The positive rehearsal used 42 mocked control-plane GETs and
  five mocked Source reads, and checked the two original journal records and
  two conditional object writes. PostgreSQL, Cloudflare, Supabase S3 and R2
  wire/runtime behavior for that flow were represented by local test doubles.
- Run `npm run test:native` with the pinned official PostgreSQL image already
  present locally. PostgreSQL 17.11 passed 12 installer/rollback checks and
  one combined restore challenge. The container uses temp storage, no published
  ports, no network and no host mount. The installer tests cover exact
  target/event/legacy checks, restored search path, empty closed ACLs, hostile
  default/MAINTAIN inheritance, state preservation and repeat refusal. The
  follow-up additionally rejects duplicate legacy pins and rollback mismatched
  signatures, and takes exclusive locks before checking emptiness. Preservation
  permits the exact dispatch foreign key's own internal triggers on the old
  journal table. That exception does not cover other old-table triggers.
- The disposable restore challenge ran a real `pg_dump` and `pg_restore`, then
  independently projected restored application rows/RLS and synthetic Auth
  users/identities. It compared those with local config, Edge module and photo
  artifacts from the same checkpoint. Negative checks rejected mixed
  checkpoints, missing components, changed database references and
  same-length wrong photo bytes. Local Auth/config/storage/Edge artifacts do
  not exercise managed Auth, a hosted Edge runtime or the live website.
- The previously completed November 18 29-test and native ticket race suites
  were not rerun. No managed installation or provider action ran.

## Minimum source parity delta

The frozen ticket SQL digest is
`097aea882ec2c2a7f8109aba4c6d4b46105635cda44d88f4ddc7b357155021b5`.
The canonical `cfbc7d20` digest is
`bdf5eb7a5ce7ea0134d578dd4a662a5e906457d7233315246c55600b70334023`.
The only SQL difference is the pre-install effective `MAINTAIN` check. The
new wrapper already enforces it across both tables, and the owner reported
independent managed probes passed for all three runtime roles. Do not repeat
the managed migration. The wrapper stays pinned to the historical install
inputs to make that closed install reproducible.

Historical reviewed adapter digest
`cea604af62eb41bd3a5c15642fff3c839b30cdab05975c6ee1e2c3a910621378`
compares to canonical
`39d660aa61ddb62bef9568f09c88f1baf5636f6bc3fa2210c0b1fdd83ce33de2`.
Reuse the latter file directly. The deltas are explicit string checks on
ticket ID and nonce and the final deadline read after response validation.
The carrier records the reviewed historical SQL, but contains no installed
Worker files or operational manifest. Installed module parity still requires
independent readback. A single source change can affect all five artifacts
because the entries share one runtime module.

To reproduce the fixture compile, run `node bundle.mjs NEW_OUTPUT_DIRECTORY`.
The pinned esbuild recipe creates five separate ESM artifacts and a digest
manifest. It resolves the CommonJS source uses of `node:crypto` and
`node:perf_hooks` through **static native ESM imports**. Its one public reviewer
key is visibly synthetic. For an authorized private build, the owner must
substitute only the externally held, independently verified reviewer SPKI
public record at the same compile-time define and rebuild from these source
bytes with the audited provider compatibility profile. The reviewer private
key stays outside all Workers and build inputs. Validate module content and
binding readback after every version-changing step and enroll only the
resulting five exact versions. Fixture hashes are never hosted pins.

## Owner packet for one future scheduled TEST

1. **Read back closed state and pick a feasible slot.** Verify the five exact
   Rack Worker IDs, six private bindings and no URLs, unapproved triggers or
   schedules. Verify the original journal still has its expected baseline,
   the two installed tables are empty, and runtime access is still closed.
   Reuse the existing fictional source user, reviewed bucket/policy/hook
   and independently read 15,079-byte PNG. The owner must supply the exact
   private object path and pin
   `e0814cc03edb6e6b87701d68208364cdcbb047dba7a714f5fc5aa3c1d0303045`.
   The two approved read tokens stay on Verifier only and expire Saturday,
   November 28 at 9:39 p.m. Pacific. If they or another dependency cannot cover
   preparation and the complete slot, hold for separate owner authorization.
2. **Prepare authority privately.** Approve the minimum effective Journal
   access to the two schedule RPCs and the existing original lookup/record
   plus dispatch claim/consume call paths. Verify underlying helper permissions
   for the invoker routines, with direct table, reset and unrelated role access
   closed. Use the exact authorized Journal server key and a short-lived
   dedicated Source session with the exact Source grant, legacy anon key and
   region in their existing compartments. Verify provider-enforced RLS and
   Data API denial independently. The offline claim parser checks token
   shape and window only. Keep Verifier tokens and the eleven existing
   internal values in their approved holders. Perform private carrier
   installation and independent version/module/flags/bindings readback after
   changes have settled, before final enrollment. Review planned Cron
   metadata and independently verify its actual readback when armed.
3. **Assemble then arm.** Externally sign final enrollment and the one owner
   grant over the original selection/request/profile and fixed deadline.
   `preflight.cjs` verifies the construction chunks, signatures and exact
   wire, and returns the canonical owner seed envelope and reconciliation
   pins in memory. Never log or commit the seed envelope or credential
   inputs. Verify the local source-session window check and the independent
   storage-byte pin. The owner seeds one unclaimed ticket and arms the exact
   UTC Caller Cron only, with each other schedule array empty. Cold start,
   Cron propagation or delivery delay can exhaust the five-second window.
   Only actual provider measurements can establish the observed execution
   and cost profile. The source projection is 63 external HTTP and 16 SQL
   on a complete positive path, including the 42 control GETs. No additional
   runtime call, retry, rearm or deadline change was added here.
4. **Reconcile and close.** Confirm delivery/timing, then read the original
   ticket, dispatch rows, journal tuples and exact private R2 photo and
   manifest bytes through independently authorized read-only channels. Use
   the same snapshot/request/attempt IDs, checking hashes/sizes and manifest
   linkage. `reconcile.cjs` distinguishes a confirmed empty scope from
   uncertain reads and matching originals from observed terminal success.
   The current Worker return is not a durable hosted receipt export. Before
   arming, confirm an approved method can retain bounded terminal evidence
   of the original run (including final Source recheck and receipt digests).
   If absent, treat matching objects as independent originals readback and
   leave run completion held. A possible follow-up is a reviewed,
   allowlisted terminal digest projection through existing private
   observability, without raw payloads, new public ingress or a new signing
   holder. Do not forge terminal evidence from object existence, verify
   expired leases by setting clocks back, mark an UNKNOWN verified, or resubmit.
   Remove Cron, close flags/temporary privileges and revoke temporary
   sessions through the owner; independently verify all five remain private
   and schedules are empty. Keep original ticket, dispatch and journal history.

## Recurring operational backup proposal

One signed TEST slot cannot provide continuing coverage. The existing Source
session parser enforces a maximum one-hour lifetime and there is no accepted
refresh, re-enrollment or profile renewal service. A calendar Cron can fire
again but cannot renew this ticket. Any recurring design needs separately
approved external custody for rolling enrollment, per-window authority and
purpose-scoped session issuance/revocation; the reviewer signing key must
remain external. Keep a write-once identity per capture with explicit missed
window reporting. No missed slot should silently rewrite or reopen an original
attempt. Review independent stale/absence alerts and revoke/disable paths
before relying on it. New acceptance must include rollover, expired and
revoked sessions, drift, duplicate delivery, unknown commit, late scheduling,
restoration from a newly captured checkpoint and bounded provider usage.
This proposal adds no renewal or monitoring authority.

## Remaining full coherent restore challenge

Reuse the completed protected owner sign-in/GetUser/data 200 and logout 204 as
bounded owner-access evidence. That window is closed and its revoked keys and
removed Preview Secrets stay closed. No recovery app or managed Edge deployment
module is in this handoff. The repository's payment test Edge source is not an
inventory of the functions required by the intended restore.

- The owner must choose one coherent, independently approved checkpoint on
  the exact source. Pin its database snapshot identity and logical data/schema
  projections, migrations/constraints/RLS, Auth identities and sanitized
  required Auth/config inventory, Edge function module/entrypoint/config and
  required secret **names** with separately held values, and every required
  private photo referenced by the snapshot. Coordinate the cut so database
  references and storage bytes can be reconciled to that checkpoint. A later
  one-slot original photo does not establish this cut by itself.
- On the existing restored project only, first read back its state and determine
  whether it can satisfy that exact checkpoint without overwriting it. It
  currently lacks restored Edge Functions. The owner must separately approve
  the required data/Auth/config comparison, Edge restoration and safe
  feature smoke coverage, and private photo-byte restoration. If reaching the
  selected checkpoint would require overwriting existing state or a new
  project, keep the challenge held for a separate decision.
- Use `restore-check.cjs` with externally pinned manifest bytes and
  independently exported checkpoint-bound inventories, derived from actual
  readback instead of copying expected metadata. Database/Auth/config inputs
  are stable logical projections; modules and photos are actual bytes. Verify
  all referenced photo paths, lengths and hashes, exact required Edge modules
  and safe nonfinancial function behavior, ownership/denial and protected
  application photo reads. Private configuration and secrets stay outside the
  manifest. Record evidence and verify any rehearsal access closes. The helper
  validates completeness relative to the approved inventory, so source inventory
  coverage and checkpoint custody must be accepted independently.
