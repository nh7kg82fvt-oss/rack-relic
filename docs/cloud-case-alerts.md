# Private cloud case queue and alert outbox

This is a **staging source addition**, not active cloud dispute monitoring.
`20261103_cloud_case_alerts.sql` follows the existing provider-risk migration.
It does not install a scheduler or notification transport, expose a production
operator, contact anyone, or enable payment, shipping or seller-money release.
Existing signed ingestion and sticky financial holds remain unchanged.

The existing signature-verified receiver calls `rr_test_process_risk_notice`.
An additional trigger records a minimal case head and durable alert in the same
database transaction. If case recording fails, ingestion fails and must retry;
it cannot acknowledge a notice while silently dropping its alert. Installation
backfills existing verified notice history without resetting orders or replaying
money. Direct table writes are not a substitute for signature verification.

Only opaque case/order references, provider status, confirmed dispute amount,
response deadline, freshness and conflict/review flags enter the projection.
No raw provider payload, charge/payment identifier, address, contact information,
bank/card detail or message body is returned. Fraud warnings have no invented
amount or response deadline. The projection always reports `test:true`,
`cloudReady:false` and `releaseEnabled:false`.

Replay and unchanged newer evidence do not multiply case-change alerts. Older
events cannot replace the current case. Same-second conflicts retain actionable
response status and the earlier deadline, and remain marked for review. Newer
provider status/deadline changes remain visible, but an earlier recorded deadline
is retained in `dueBy`; `providerDueBy` is the latest canonical provider value,
and `deadlineReviewRequired` marks a difference. The conservative reminder clock
uses the retained deadline while the current status needs a response. A closed
or won status changes that response flag, but neither erases deadline history
nor clears the order's financial hold. These fields require human reconciliation;
they are not a claim that Stripe rejected a genuine deadline extension.

The bounded queue shows per-case and aggregate pending, unknown and exhausted
delivery counts. A successful queue read is not proof that an alert reached Wayne.
Source receipt timestamps are distinct from provider event timestamps.

## Worker contract

All new tables have RLS and deny browser and service-role direct table access.
Only the four backend service-role RPCs are exposed:

- `rr_test_case_alert_queue(limit, after_case)` returns at most 50 cases plus
  `hasMore`, `nextCaseCursor` and delivery gaps. Its validated opaque case-ID
  keyset cursor lets a reader traverse the whole queue; start again next run to
  catch earlier insertions or changes. It changes no case, hold or notification state.
- `rr_test_claim_case_alerts(worker, limit)` refreshes deadline work and claims at
  most 25 alerts with a 90-second lease. Claims increment a maximum-five attempt
  budget. Row locks and `SKIP LOCKED` prevent competing workers claiming one alert.
- `rr_test_case_alert_authority(alert, worker, lease)` must be checked immediately
  before a provider send. It rejects expired, foreign and superseded work.
- `rr_test_finish_case_alert(alert, worker, lease, outcome, reference)` records a
  normalized transport outcome. A `delivered` confirmation requires a bounded,
  opaque provider reference; it cannot be reused for another alert. A database
  acknowledgment alone is not a provider delivery receipt, and provider delivery
  does not prove that the user read the message. The future transport adapter must
  verify the exact destination, stable delivery key and provider result first.

Use the stable `deliveryKey` for downstream provider idempotency. Do not create a
new alert or key after a timeout. Only a confirmed temporary failure retries,
with 30-second, two-minute, ten-minute and thirty-minute delays, then exhaustion.
Permanent failures stop. An ambiguous send or expired lease becomes `unknown`
and remains visible; it does not automatically send a replacement. Read-only
provider reconciliation may confirm the original unknown delivery with the same
lease and matching reference. Conflicting outcomes remain a review gap, while
audit evidence is preserved.

Deadline levels are 24 hours, four hours and overdue, using the database clock.
Initial case alerts already include their current severity, preventing an
immediate duplicate reminder. A stronger level may create a new alert even if an
older delivery is unknown or exhausted. Weaker unsent work becomes superseded.
Refresh selects only cases needing escalation before its 100-case bound, so
already handled overdue cases cannot permanently starve later cases. This is a
bounded scheduler primitive, not a guaranteed notification time.

## Before calling this operational

Install and read back the reviewed schema in the isolated acceptance database;
retain the signed test receiver and normal release guards. Configure a supported
cloud scheduler, narrowly scoped server access and an approved notification
transport. Keep secrets in provider configuration, never in a browser, repository,
chat or alert body. A ChatGPT cloud schedule needs its own verified read-only
connection; a signed-in Chrome session on the Mac is not cloud access.

Verify hosted signature rejection, case binding, replay, deadline change,
competing worker claims, transport failure/retry, lost response and read-only
reconciliation. Demonstrate a real test alert reaching its intended owner and a
cloud review run while the Mac is unavailable before replacing local checks.
No such hosted installation or delivery was performed by this source work.

Local PostgreSQL tests cover those database boundaries, backfill, browser denial,
more than 100 deadline cases and unchanged orders, inventory, ledger and ordinary
jobs during worker activity. They do not establish multi-connection load behavior,
provider delivery, production authorization or live dispute-response coverage.
