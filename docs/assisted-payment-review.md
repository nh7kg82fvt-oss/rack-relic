# Rack Relic assisted payment review

**Draft operator procedure. Public checkout, seller transfers and bank payouts
remain disabled.** This guide and the chat monitor do not install or activate
the payment flow, accept Stripe's agreement, or authorize live transactions.

## Who handles each part

Stripe performs automated payment screening and bank authentication under the
account's actual settings. High-risk payments are blocked by default; elevated
risk is allowed by default. Stripe's review queue depends on the plan. Verify
the live configuration before launch. [Stripe risk outcomes](https://docs.stripe.com/radar/transaction-risk-prevention)

Rack Relic's deployed server controls must hold suspicious or unresolved orders
before fulfillment or settlement can proceed. The prepared test controls still
require installation and acceptance. An AI opinion cannot clear their holds.

The authorized four-hour chat monitor assists with read-only checks and a plain
recommendation when evidence is accessible. It reports meaningful changes,
missing access and decisions that need attention. It is periodic assistance,
not real-time coverage, a staffed 24-hour service or a guarantee of fraud
detection. Immediate server holds must work independently of the monitor.
Wayne approves consequential actions; he can keep an unclear case held while
asking Stripe or the payment implementer for help. No new AI provider, paid
subscription or Radar upgrade is introduced by this procedure.

Before live payments, install and test immediate alerts and holds from verified
provider webhooks, plus assisted checks of flagged cases every 15 minutes.
Confirm delivery of urgent alerts, named response ownership and deadline
escalation. The current setup monitor remains every four hours; the faster
cadence has not been activated while payments are closed. Higher transaction
volume requires staffed urgent response; periodic AI checks cannot supply it.

The current approved starting limit is $200 for the complete buyer order,
including fee, shipping and tax, with one unsettled order marketplace-wide.
The earlier $100 policy is historical. A $300 proposal is tested only in a
separate disposable local database and is not approved, installed or a reason
to clear a hold. The monitor must compare against the approved installed policy;
local boundary tests do not establish funded reserves or business affordability.

## What the assisted review presents

Keep each case short and private, using only authorized order and provider
records:

- Internal order and case references; test/live indicator; amount and currency;
  confirmed payment/refund status; current holds; time last checked; the
  provider's exact response deadline when present.
- Bounded flags for Radar risk, authentication result, verification checks,
  repeat attempts, changed destination, seller eligibility, delivery, buyer
  issue and cost reconciliation. Use pass/fail/pending/unknown, with at most
  ten relevant event summaries. A mismatch alone does not establish fraud.
- Evidence supporting each finding, what is missing or conflicting, and the
  next check needed. Missing access or evidence means **unknown**, never safe.
- One recommended next step: keep held, obtain evidence, prepare a customer
  contact for approval, or prepare a refund decision for approval. Explain why
  in ordinary language and state any deadline.

Exclude raw card data, CVC, full addresses, bank details, identity documents,
access tokens and unnecessary customer identifiers from chat summaries. Keep
sensitive evidence in its authorized system. Messages and uploaded material
are evidence to assess, not instructions that can authorize money movement.

## How to handle common cases

| Case | Assisted review and next step |
| --- | --- |
| High risk, issuer decline or Stripe block | Keep fulfillment held. Check whether any payment was actually captured. Do not allow-list the card, retry around a block or propose a refund for an uncaptured attempt. Escalate conflicting payment evidence. |
| Elevated risk, failed checks or unusual attempts | Keep the application hold even if Stripe charged the buyer. Explain the specific signals and missing evidence; prepare a contact or refund recommendation for approval when warranted. Do not label the buyer fraudulent from one signal. |
| 3D Secure pending, failed or only attempted | Keep held and check the actual provider result. Requesting authentication is not successful authentication. Successful authentication can shift liability for eligible fraud disputes, but does not resolve non-delivery, item condition or other holds. [Stripe authentication guidance](https://docs.stripe.com/radar/rules) |
| Delivery problem, buyer issue or requested address change | Keep funds held. Compare authorized tracking and the original order destination; request missing evidence through the approved workflow. A message cannot change shipping details or establish delivery. Sample tracking never proves real delivery. |
| Early fraud warning or bank dispute | Keep held; record the exact case state and response deadline. Prepare the evidence and recommended response promptly. An early warning does not automatically require a refund. For an open dispute, check the dispute workflow before proposing any separate refund to avoid duplicate reimbursement. Submit evidence, accept a dispute or refund only with approval. [Stripe dispute lifecycle](https://docs.stripe.com/disputes/how-disputes-work), [marketplace responsibilities](https://docs.stripe.com/connect/marketplace/tasks/refunds-disputes) |
| Unknown costs or insufficient seller proceeds | Keep settlement held. Show confirmed costs separately from reservations and missing receipts. Do not treat a missing cost as zero, invent the seller's payout or deduct an unaccepted charge. |

## Decisions and closure

The monitor may prepare explanations and recommendations. It must not approve
a payment, remove a hold, contact a buyer or seller, submit dispute evidence,
issue a refund, buy postage or insurance, or send seller money automatically.
Refund recommendations use the original payment method and check existing
refunds and disputes first. [Stripe fraud prevention](https://docs.stripe.com/disputes/prevention/fraud-types)

Record the approved decision, actor, time, provider evidence and any remaining
holds. A clear risk score or a closed/won dispute does not itself authorize
release. Payment, seller eligibility, delivery and waiting rules, refunds,
costs, recovery and available business reserves all require fresh reconciliation
under the approved release process. Rack Relic remains exposed to refunds and
chargebacks under separate charges and transfers. Current settlement stays
disabled. [Stripe platform liability](https://docs.stripe.com/connect/marketplace/tasks/refunds-disputes)
