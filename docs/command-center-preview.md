# Rack owner command center

The private Preview has one owner entry at `/api/command-center`, using exactly the same owner session and server authorization as `/api/test-admin`. Sign in through `/api/test-marketplace` using the existing acceptance account and open the owner overview link. No second account is created.

The page puts attention items and next steps first, followed by internal follow-up tasks, held seller amounts, orders, cases and connection evidence. Missing or stale information is explicitly unavailable. It is not a live CRM, mailbox, provider control panel or continuously staffed monitoring service.

Owner task saves require the acceptance-only ADMIN_WORK flag, the already reviewed private work SQL and fresh owner authentication before and after operations. Saves are versioned and request-bound; unknown results are checked under the original request rather than duplicated. No task can change order/provider/financial state. The flag remains off until legitimate owner configuration and hosted acceptance. The SQL is included as source history; this release does not apply migrations.

The optional reserve read panel remains off and has no financial controls. Its uninstalled read wrapper is not installed by this release. Missing reserve/funding data remains unknown.

Modern Supabase server keys use apikey only on service RPCs; explicit user JWTs and validated legacy service JWTs retain their respective Authorization headers. Email errors distinguish a documented project email limit from a bounded Retry-After interval or unknown rate limit without reflecting raw provider messages. A request is never described as delivery or successful login.

This is a substantive private Preview feature release, based on93c5e664 and preserving its alert sign-in expiry repair. It does not repair Vercel account-email recovery, grant production authority, activate checkout or release money. Hosted owner/support denial, sign-out/session-loss and task save/replay acceptance remain required.
