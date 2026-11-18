Rack Relic immutable ONE-slot backup TEST source

This portable package is for source development/review in the existing draft
launch branch. It does not deploy, install SQL, create credentials, schedule a
Worker, read a customer photo or activate production. It contains no operational
profile, final enrollment, ticket row, owner identity, current deployment/version
ID, provider snapshot, saved deployed module or generated fixture bundle.

Run from this directory with an existing Node22+ runtime:
  npm install --ignore-scripts --no-audit --no-fund
  npm test

The only development dependency is exact @electric-sql/pglite0.5.13 (no runtime
dependency). Dependency installation can use the ordinary package registry;
the tests themselves use only in-memory synthetic transports/data. Do not add
provider credentials to run tests. No package script publishes or deploys code.
The path-only dependency change was checked locally against the same existing
0.5.13 package through standard Node module resolution, without downloading it.

runtime/ and server/ preserve the accepted derivative's code bytes. The existing
fixed source account/project/bucket/namespace/role identity constants intentionally
remain; they are public/non-secret scope fences, not operational grants. Do not
replace them with broader/generic origins to make a test pass. Every provider
deployment/version/module used by tests is now fictional in-memory data from
tests/helpers/synthetic-provider-fixture.cjs. No operational readback is imported.

Caller exports only native scheduled and fetch404, without a direct run RPC.
Its exact externally signed request is fixed to one UTC slot with an absolute
5000ms deadline. All admission plus original work shares that SAME deadline.
Early/late delivery, wrong schedule, signature/profile mismatch, consumed ticket,
unknown reply or timeout holds. It cannot mint/renew authority, retry, rearm or
replace the snapshot. The five-role graph and fixed source/receipt/dispatch
checks stay intact; one Journal admission RPC and two bounded fixed DB POSTs
are added before the original root. The actual42GETcollector admits exactly one
Caller schedule and empty schedules everywhere else; it never hides a Cron.

sql/schedule_ticket_v1.sql is an UNINSTALLED source proposal. It starts empty
and owner-only, provides no seed/reset/rearm/delete API and checks a single
immutable ticket claim after row lock. Its hypothetical installation needs a
separately reviewed exact-target/catalogue/event/owner/default-privilege wrapper.
Do not execute it against any provider as part of source tests. App roles remain
denied; a source pass is not permission to add grants or refresh launch guards.

New tests cover real derivative authorization/42-read collection, wrapper/RPC
composition, durable admission before Source, concurrent/lost-result/late/timer
cases, closed/effective ACLs, unrelated default grants, search-path preservation,
rollback and bounded identity-encoding transport. The wrapper integration stops
deliberately before photo I/O and asserts photoSnapshotComplete=false. Earlier
work may already have occurred if a downstream result is lost; further automatic
Source execution remains held and the same original outcome must be reconciled.

PGlite is local/queued, with explicit test-only clocks in positive SQL slot cases.
It is not managed/nativePG17, independent-session contention, real provider wire,
Cron timing/CPU/latency, automatic nonempty-photo or full restored-site acceptance.
The real SQL/R2/photo/session/financial workflows are not called by these tests.
No local browser, Mac-only helper or provider access is required in the cloud.

Remaining operational acceptance still requires the exact authorized private
actors/credentials, actual role bindings/versions/custody, dedicated source
principal/bucket/fixture scope, signed final enrollment, owner-seeded ticket,
timed actual run, independent bytes/receipt reconciliation and verified shutdown.
Cloud source access alone supplies none of that authority. Do not claim live
backups or full recovery from a green test report, and do not fetch credentials
or change providers to fill an access gap. Preserve payment/support/privacy
boundaries and the existing human holds.
