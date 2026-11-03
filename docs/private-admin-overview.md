# Private test owner overview

This is a source-only, read-only test overview. It is not installed, accepted
hosted, or a production admin permission system. Real payments and ordinary
seller transfers/payouts remain closed. A green build is not evidence that the
sources shown here are connected live.

## What it reads

`GET /api/test-admin?action=overview` freshly authenticates an explicitly
configured participating owner in the exact approved environment. It reads
one service-role-only `rr_test_admin_overview` RPC and then rechecks owner
authority before returning data. The projection includes:

- Global synthetic order/seller/case/alert-gap counts.
- At most 15 recent opaque order references and 10 priority hashed case
  references, with explicit truncation indicators. Older actionable deadlines
  precede newer closed cases. This is not the complete case/deadline queue.
- Actual stored Stripe payment/risk/refund/case observation times, seller-check
  times and Shippo sample-tracking check times. No timer calls Stripe or Shippo.
- The installed Preview revision, when the host supplies a valid revision.
  Vercel control-plane health/logs remain **unavailable**.
- Backup recovery acceptance remains **unavailable** until a verified hosted
  evidence source is deliberately integrated. A Pro subscription is not itself
  a completed restore drill.

Every row retains `holdRequired:true`; every response has `test:true`,
`live:false` and `releaseEnabled:false`. Case closure cannot remove a hold.
There are no release, refund, dispute-submission, label-purchase, account-change
or other mutation controls. No names, emails, addresses, card/bank data, raw
provider payloads, payment/charge IDs or secrets appear in the projection.

## Configuration and access

- `RACK_RELIC_TEST_ADMIN_OVERVIEW_ENABLED=true` is off by default and gates the
  shell, public configuration and overview routes.
- Full Preview branch + exact Supabase URL + Stripe account must match one
  immutable row in `server/test_environment_registry.cjs`. Production and mixed
  combinations return 404 before private access.
- Exactly one `RACK_RELIC_TEST_ADMIN_OWNER_ID` UUID is required. It must be one
  of the two distinct test members and in the existing participating
  operator list, with the existing refund/review authorization flags. A second
  refund operator still cannot open this owner view. Missing, malformed,
  multiple or unbound owner IDs keep access closed.
  Those flags authorize the existing private test workflows; this overview
  does not expand their financial authority or create production admin access.
- Apply `supabase/test/20261103_admin_overview.sql` only to the reviewed isolated
  test environment, after `20261103_cloud_case_alerts.sql` and its dependencies.
  It creates one read-only SECURITY DEFINER RPC, requires the trusted server owner UUID
  and authenticated actor UUID to match, revokes browser access and
  grants execute only to `service_role`. It does not add table grants or modify
  existing RLS. Do not apply this synthetic schema to production.
- The private test marketplace displays a same-tab overview link only after its
  feature flag and dedicated `GET /api/test-admin?action=access` response permit
  it. That route freshly authenticates the exact configured owner and returns
  only `{test:true,allowed:true}`; refund access is not sufficient. The browser reuses
  the existing environment-scoped `rr-private-test-session` in sessionStorage.
  No new login, password, credential sharing or additional account is needed.
- The locked HTML shell and public `?action=config` contain no private records
  or operational panel markup. The browser constructs the private panel only
  after a validated owner-only response. Anonymous
  requests for the overview and ordinary members cannot reach the privileged
  RPC. The shell uses no-store/no-referrer/noindex headers and a strict CSP.

## Update and failure behavior

The page reads the database about every 30 seconds while visible, focused and
signed in. Refreshes do not overlap. Manual refresh and focus use the same
read-only route. Hidden/inactive pages cancel outstanding requests and clear
private records; returning performs a fresh authorized read.

401/403 responses, local sign-out or changed sign-in state revoke/clear the old
view. A late response from a canceled or previous session cannot render records
or erase a newer sign-in. Malformed, future or stale database responses clear
the view instead of showing reassuring old data. Provider observations older
than five minutes are labeled stale; missing observations stay unrecorded.
Even recent stored evidence is labeled **provider health unverified**. A fresh
database poll never refreshes a provider's observation timestamp.

## Acceptance still required

Before enabling this in the isolated hosted Preview, verify the exact revision,
flag/secret scope, installed migration, actual verified owner binding, participating users, browser
role denial and session loss behavior. Run the hosted view with actual signed
sandbox events and recorded sample tracking; test stale/missing sources,
partial outages, expired/revoked sessions, hidden-page cancellation and a
changed deployment/account. Verify that polling produces no provider writes
and that failures cannot enable financial operations.

Before live customer use, build and accept a separate production owner role
model and real order/seller bridge. Verify live Stripe/case access, actual
shipping ingestion, an authenticated hosted source feed, Vercel status/log
access, backup/restore evidence and urgent alerts/deadline ownership. This
browser dashboard only updates while open; backend holds, event processing,
cloud monitoring and urgent alerts must operate independently when the Mac or
page is closed. Bounded dashboard rows cannot replace the full case queue.

Only Wayne and the assistant through owner-authorized access are in scope.
There is no shared admin login or invitation of another operator. The assistant
uses an owner-authorized session or separately approved read-only service access,
never an invented browser owner claim. The actual hosted owner UUID is not yet
bound, so do not enable the flag until that identity is verified. The test RPC
trusts its service-role caller to supply the configured owner UUID; it is not a
substitute for a durable production owner-authorization system.
