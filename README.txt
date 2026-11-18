Rack Relic recovery private composition — LOCAL source candidate

This adds the missing root mount and server configuration loader to the existing
recovery package. It is OFF unless explicit, reviewed future configuration is
present. No provider settings, branches, deployments, keys, photos, accounts or
database contents were changed. This is not a successful hosted recovery drill,
an automatic production photo backup, or launch clearance.

Fixed future scope
  Vercel project: prj_XO9ADzBydcq45PHSQHX9v23GPCri
  Git branch: codex/recovery-readiness-20261117
  Exact allowed origin:
    https://rack-relic-git-codex-recovery-readiness-20261117-rack-relic.vercel.app
  Separate recovered target: xkxolhgafjadpknsfqqw
  No production, practice/source database, main/testing checkout or payment route.

Root/runtime layout
  api/recovery-readonly.js — lazy frozen host mount; body parser disabled.
  api/recovery-bootstrap.js — one same-origin JavaScript enrollment response.
  server/recovery-env-binding.cjs — fixed tuple and canonical profile validator.
  server/recovery-browser-bridge.cjs — explicit projection and narrow fetch adapter.
  public/index.html — original HTML plus one last deferred bootstrap script.
  public/* — original public assets except two explicitly reviewed browser forks.
  frozen/* — all 17 original sealed files, bytes and modes preserved.
  vercel.json — public output only, two functions, cancellation and HTTP headers.
  provenance.json — exact frozen mapping, index insertion and two public overrides.

The proposed publication tree in source-manifest.json contains these runtime
roots, provenance, the three focused new tests, this README and .gitignore. Local
assembler and private test reports/manifests are excluded from that proposed tree. No deployment/root setting has been changed.
The original frozen README/tests remain under frozen/ as provenance; they are
outside public output. Function tracing explicitly includes frozen/package/**.
No main marketplace, payment, shipping or old preview API route is present.

Explicit future server configuration
  RACK_RECOVERY_ENABLED — only the literal string true can admit a configuration.
  RACK_RECOVERY_PROFILE — canonical compact JSON, at most 4096 UTF-8 bytes.
  RACK_RECOVERY_SERVER_SECRET — modern sb_secret_ form only; no legacy fallback.

The profile has EXACTLY these eleven own keys:
  version, projectRef, ownerId, email, origin, branch, revision, notBefore,
  expiresAt, reviewRef, publishableKey.
  version must be rr-recovery-private-profile-v1.
  projectRef/origin/branch must match the fixed future scope above.
  revision must be a full lowercase 40-hex reviewed Git commit.
  ownerId is one nonzero UUID; email is one lowercase normalized owner email.
  reviewRef is one rr-review-... reference. No arbitrary extra settings.
  notBefore/expiresAt are absolute integer Unix milliseconds. The window is at
  most 900000ms, and current time must be within [notBefore, expiresAt).
  publishableKey uses only the modern sb_publishable_ form.

Canonical means JSON.stringify(JSON.parse(value)) equals the supplied value,
which rejects duplicate keys, whitespace variants and noncanonical encodings.
No fixture profile, credential, owner defaults or operational values are shipped.
Future provider installation must use branch-only server-side Secret variables,
never NEXT_PUBLIC or a broadly scoped configuration. No such installation is
part of this preparation or the proposed CLOSED source publication.

System values also required at runtime:
  VERCEL_ENV=preview
  VERCEL_PROJECT_ID=the exact existing Rack project ID above
  VERCEL_GIT_COMMIT_REF=the exact future branch above
  VERCEL_GIT_COMMIT_SHA=the exact profile revision
Missing/mismatched values fail closed. VERCEL_URL and production-origin variables
are deliberately not substitutes. These variables are documented as build and
runtime system variables; the actual future deployment must expose them.
https://vercel.com/docs/environment-variables/system-environment-variables

Loader and lifecycle boundaries
Import, construction, configuration and bootstrap perform zero Auth/DB/fetch I/O.
Disabled configuration does not even read the secret field. A malformed profile
embedding the server secret in a browser-visible value is rejected before output.
The only browser enrollment fields are version, projectRef, ownerId, email, origin,
branch, revision, notBefore and expiresAt, plus its modern publishable key. The
server key, review reference, deployment object and fingerprint are never sent.
Bootstrap JSON escapes <, >, &, U+2028 and U+2029 before forming script text.

The host is constructed only on the first currently valid request: a pre-window
request cannot cache a permanently disabled host. Once constructed, profile/key
changes or expiry close that warm host permanently. Cold starts still use the
original absolute expiry; no request opens a fresh fifteen-minute window. The
frozen monotonic clock and five-second request checks remain intact.

Bootstrap accepts only exact raw GET /api/recovery-bootstrap with the exact Host,
no query, no body/transfer encoding, and no foreign Origin or Sec-Fetch-Site.
Wrong route/context is 404; wrong method 405; supplied body 400. A structurally
valid request on a CLOSED/misconfigured/expired deployment returns 200 harmless
JavaScript comment, with no configuration or action. The data route stays 404
when closed. Both success and denial are no-store and no-transform.

The added script installs after the existing deferred coordinator. A nonwritable
per-document guard prevents a duplicate script from reinstalling/resetting the
coordinator's one-Open state. This is one composition instance, not a distributed
or cross-reload one-use lease. The server does not claim global request counting.

Request changes and Vercel Authentication
This composition adds ONE same-origin bootstrap GET, with zero target I/O. After
one explicit owner Open, the existing coordinator still sends one login, one
GetUser, one recovered-data GET and one local-session logout. The frozen data
host performs exactly five backend reads. No refresh loop, retry or new helper.

The frozen browser requires credentials:omit for its data GET, but a private
Vercel deployment needs the owner's existing Vercel protection cookie. Therefore
the injected fetch adapter permits exactly one outbound GET to the exact allowed
origin + /api/recovery-readonly to use credentials:same-origin. It accepts only
the original omit/no-store/error/no-body shape and Accept/Authorization headers.
It consumes its data-attempt guard before awaiting native fetch, preserves the
input object/signal/native Response, and rejects a second or concurrent attempt.
Every exact fixed-target Auth call remains credentials:omit. Unknown paths,
origins, queries, aliases, manual Cookie or protection-bypass headers are rejected.
No global fetch replacement, cookie reading, cookie forwarding to Supabase or
protection bypass is implemented. Actual ambient Vercel access remains unproven.

Explicit browser overrides
Two public files differ from their preserved frozen originals.
The first is public/recovery-session-provider.js.
Reviewed fork: 13764 bytes; SHA256
  b01425a780bdd4bbce7466ed05671106214edb8e57480746beb1b1b8511abeae
Its interface and fixed Auth routes remain unchanged. It accounts for Date not
being CORS-exposed, default Auth responses lacking Cache-Control, and automatic
browser decompression. It still requests no-store/error/omit, rejects visible
cache/stale metadata, bounds decoded bytes and token issuance to the original
request, verifies owner via GetUser, and requires exact 204 local cleanup. JWT
parsing can only reject; it is not signature verification. The frozen server's
GetUser/current-session checks remain the authentication authority.
The exact independently reviewed 12 focused Auth-fork tests are copied unchanged.

The second is public/recovery-readonly-view.js: 11595 bytes; SHA256
  f986c31bb7da6cc6853cf1bf0a83a5ef2d123d5511bba6e2a3df338c044d6e53
Its two-line decoding change accepts browser-decoded compressed data without
requiring identity encoding or decoded-byte equality with the wire length. It
retains the mandatory same-origin Date, no-store/cache checks, typed wire-length
ceiling, 262144-byte decoded cap, exact envelope/session/snapshot and foreground
checks. The exact independently reviewed eight decoding tests are copied unchanged.

Data response compression boundary
The derived same-origin view still requires strict Date/cache metadata and
independently bounds advertised wire length and decoded bytes. The composition adds no-transform to the ACTUAL outgoing
Cache-Control after frozen host buffering validates its original header map.
The per-response setHeader shim is restored in finally. It changes no body and
does not invent/remove Date, Content-Encoding, Content-Length or Age. The same
directive applies to bootstrap, denials and static HTTP headers. A new test proves
the outgoing header delta with identical frozen response bytes and five reads.
Vercel documents automatic JSON compression. The derived view handles native
browser decoding, so compatibility does not depend on a platform compression
opt-out. Actual protected HTTP/cache/protection behavior still needs observation:
https://vercel.com/docs/how-vercel-cdn-works/compression
https://www.rfc-editor.org/rfc/rfc9111.html#section-5.2.2.6

Other HTTP controls
Actual HTTP CSP limits connect-src to self plus the fixed recovery target, and
adds frame-ancestors 'none'. X-Frame-Options:DENY, no-referrer, noindex/nofollow,
nosniff, browser/CDN no-store and cancellation apply to this isolated root. There
is no wildcard CORS, redirect, cookie-bypass value or extra deployment dependency.
https://vercel.com/docs/project-configuration/vercel-json

NEW local evidence
33 focused tests pass: 13 composition + 12 reviewed Auth-fork + 8 decoding tests. No old frozen
suite/native group was replayed. New integration uses the actual public scripts,
new bootstrap/transport and frozen server, with explicitly fictional HTTP only:
CORS-like Auth has no Date/Cache-Control; both Auth and same-origin data decoded
bodies differ from wire length (the latter retains actual Date/no-store metadata);
one Open yields one data GET, five backend reads and one 204 cleanup. It also
proves duplicate bootstrap does not reset Open. This is local composition evidence,
not actual identity-provider, deployment-protection, backup or recovery acceptance.

Remaining hosted actions are separate and held
  1. Review/authorize publishing and deploying the exact CLOSED isolated branch
     root; verify actual project/branch/revision/protection and absent runtime
     enrollment. No key/profile installation implied by that publication.
  2. Separately authorize real private custody, branch-only Secret inputs and one
     profiled owner/window after the restore source/target is verified. Provider
     protection is an independently read fact, not this loader's literal claim.
  3. Observe actual same-origin JSON/cache metadata and real browser Auth behavior;
     perform one explicitly authorized owner drill, verify records/current-session
     checks and confirmed local logout, then close/remove temporary configuration.
Automatic photo scheduling/custody, a complete restored-site acceptance and the
production launch remain separate unfinished operational work. This preparation
does not create or attest backups, restore source/data, delivery or live readiness.
