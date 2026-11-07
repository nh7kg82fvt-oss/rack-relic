# Rack Command

Rack Command is Rack Relic's private practice workspace. Real payments, refunds
and seller payouts remain off. CCP Command and its records stay separate.

## Sign in

Bookmark this address:
https://rack-relic-git-codex-prelaunch-seller-protections-rack-relic.vercel.app/api/command-center

Enter your Rack owner email and existing Rack password, then choose **Open Rack
Command**. This is your Rack account password, not your Vercel, Microsoft email
or database password. A password manager can fill the normal sign-in fields.
Never put passwords or sign-in links in chat or follow-up notes.

On your own device, select **Keep me signed in on this device**. The app uses
Secure, HttpOnly, same-site cookies and checks your account again with Supabase
before loading private records. Cookie retention is up to seven days at a time;
provider session limits, sign-out, revocation and browser privacy settings can
require sign-in sooner. It does not require a new email for each visit while
that session is valid. Without the option, the sign-in uses browser-session
cookies; browser session-restore settings may preserve them.

If you forgot the Rack password, enter your email and expand **Forgot your
password or prefer an email link?** Request one link and open the newest email
once in the same browser profile. It returns directly to Rack Command. After
signing in, expand **Account** to enter and save your own new password. An
uncertain password-change result is shown honestly; try the new password before
attempting another change. No passkey has been enrolled by this update.

**Sign out** clears this device's active Command cookies and asks Supabase to
revoke that session. If the provider does not confirm the request, the page says
so; it never claims every session on every device was revoked. Delayed refresh
or sign-out responses for an older session cannot overwrite a newer selected
session. Provider credentials are not returned to Command's JavaScript or
stored in its local/session storage.

## Daily flow

1. Start with **Needs your attention**. Follow the related order or case link.
   Recent lists are bounded; this is not a complete live operations queue.
2. Use **Draft follow-up** to put an order/case reference into a new note. Review
   it and choose **Save follow-up** yourself. Opening a draft sends no save.
3. Finish an existing draft before starting another. When a save is uncertain,
   check or retry the same original request; do not create a replacement.
4. **Companies, connections and last updates** distinguishes saved information
   from an actual provider check. Database/archive shortcuts are fixed Rack
   resources; a shortcut does not prove a working backup or completed restore.

Private details are hidden on sign-out, access loss and inactive/hidden pages.
Follow-ups retain only opaque pending-save references in browser session storage,
not passwords, session credentials or note contents. Server requests still use
fresh sole-owner checks and the existing original-save/version safeguards.

Completing a task never changes an order, sends a message, issues a refund,
buys postage, pays a seller or clears a financial hold. Live customer/seller
profiles, case feeds, provider health and backup/restore acceptance still require
their own verified connections. This sign-in update does not grant live authority.
