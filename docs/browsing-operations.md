# Rack Relic LLC browsing-preview operations

Scope: public browsing, profiles, private drafts, photos, messages and reports. Purchases remain disabled. Fictional demo pieces never become seller inventory. Use Rack Relic mail and accounts only; historical test-login addresses do not make CCP the operator.

## Before opening the preview

- Run the browsing test workflow and the read-only public check: `node scripts/check-browsing-site.cjs https://www.rackrelic.com`.
- Check desktop and phone layouts; sign-in; private drafts; photo upload/replacement/archive; sign-out clearing private views; member-only messages and reports. Do not send test messages to real members or publish fictional seller inventory.
- Confirm support@rackrelic.com receives mail and identify the person checking it. Do not promise a response deadline without staffing.
- In Vercel, inspect failed requests and runtime errors for the photo endpoint. Logs can contain private request information: keep them inside Rack Relic tools and do not publish raw logs.
- In Supabase, inspect database health and authentication errors. Never disable RLS or broaden browser table grants to make a test pass.

## Support and moderation

Wayne is the owner contact at wayne@rackrelic.com and initially handles the support inbox and listing reports, as confirmed by the owner. No response deadline is promised. Review submitted listing reports in the existing private administration tools. A report is an allegation; check evidence and record the reason before acting. Preserve relevant messages and listing references privately. Do not automatically suspend a member based solely on a report.

Review suspected counterfeits, unauthorized replicas and misleading brands in titles, brand fields, descriptions and tags, including names added only for exposure. Compare the listing text, photos and available evidence; an unfamiliar brand, low price or report alone does not establish a counterfeit. Record whether the concern is suspected authenticity, misleading branding or both. Request clarification or use existing moderation controls when supported by evidence; preserve the reason and listing reference privately. Do not claim automated authentication, blocking or removal without verified deployed controls.

For an account concern, verify ownership through the existing account workflow. Never ask for a password or sign-in code by email. Privacy requests require a reviewed process; archiving is not erasure. Do not promise that changing a listing removes copies already seen by visitors.

## Backup and recovery evidence

Source code is versioned in GitHub; this does not back up database rows or uploaded photos. Record the provider's actual backup availability and most recent successful backup before claiming protection. A complete recovery plan must cover database/schema, private object storage, account identities, permission policies and server configuration. Never export secret values into this repository.

Restore only into a separate recovery environment. Verify representative profiles, draft/published/archived visibility, messages, reports and photo access, then confirm anonymous access cannot see private content. Do not overwrite production to test restore. Record backup time, recovery target and verification results privately. A written runbook alone is not restore proof. Paid backup or recovery resources require owner approval.

## Incident response

The public monitor checks all twelve browsing routes, the twelve fictional demo descriptions, the disabled-buy source guard, valid web-manifest JSON and each same-origin JavaScript asset referenced by the home page. A successful HTTP response containing an HTML fallback does not pass a JavaScript asset check. Reads omit credentials, never follow redirects and have per-response time and size limits. These are source/HTTP checks; they do not execute the browser UI or prove authenticated member flows.

For runtime logs, discover the currently available browser connection instead of assuming a stored browser ID remains available. Open only Rack Relic's Vercel project and verify that the production-error filter has finished loading. An unavailable browser is a monitoring coverage gap, not evidence of a website outage. Report the gap once, retain public checks, and record recovery only after the log results are visible. Do not start authentication or change access during scheduled checks. Local monitoring depends on the desktop app and browser being available.

If private content becomes visible, stop affected publishing/photo access through existing controls, preserve evidence privately, and investigate permission checks. Keep checkout closed. If the website breaks after a release, use the last known-good Vercel deployment for website recovery; this does not roll back database changes. Changes to authentication, credentials or paid plans need the appropriate owner action.

## Release separation

Publish browsing-only files on a branch based on main. Do not merge the private marketplace payment-test PR to ship these changes. The browsing workflow uses read-only repository permission and no provider secrets. It runs on proposed changes and main pushes; it is not continuous uptime monitoring. Run the public HTTP smoke check after the public deployment and retain its result with the launch checklist.
