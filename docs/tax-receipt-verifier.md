# Tax receipt verification — source proposal

This standalone, **OFF by default** server module retrieves known test Tax
receipts. It is not imported into the website, installed, configured with keys,
or connected to a database/provider. It contains no create/reversal/refund POST,
tax registration, billing setting, transfer or payout operation. No actual
provider request was made while preparing or testing it. Publication and
installation are separate decisions.

The target contract is the existing private tax/refund accounting proposal's
14-key normalized receipt. That SQL remains unchanged and uninstalled. This
module performs provider bookkeeping verification; it does not establish legal
tax obligations, registrations, taxability, filing or remittance, refund policy,
seller eligibility, funded reserves or release authority.

## API and private source authority

`createStripeTestTaxReceiptVerifier()` returns `ready:false`. An explicitly
enabled construction additionally needs a test-only Stripe key, a trusted
private `loadSavedBinding` function, the HTTP transport and clocks. It admits
only the fixed test account `acct_1UXdWBGppSOhWnq8` and sends the explicit new
module API pin `2026-10-28.endive`. Existing clients/receiver pins are unchanged.
Current public primary documentation informed this source; actual receipts on
that pin in this account have **not** been accepted.

The only verification input is `{requestId}`. The browser cannot supply a Tax
ID, amounts, provider URL, account, `verified:true` or a normalized receipt.
The private loader must locate the existing original request and its durable
provider response mapping. Unknown or malformed mappings hold **before any
provider I/O**. There is no reference search or create-to-recover fallback.

The exact internal binding has these fields:

- `version: rr-test-tax-saved-binding-v1`, `requestId`, `orderId`, fixed
  `accountId`, `kind`, `calculationId`, `originalDispatch`, `chain`,
  `policyHash`, `refund`.
- `originalDispatch`: `version: rr-test-tax-original-dispatch-v1`, its exact
  `requestId`, `status: known`, saved `transactionId`, `calculationId`,
  `reference`, `requestBodySha256`. The body hash is SHA256 of canonical JSON
  `{calculation,reference}` for this narrowly supported dispatch format. A
  dispatcher with other business fields must receive a separate reviewed
  contract; it cannot discard them to satisfy this verifier.
- `chain`: exactly the original alone, original plus refund reversal, or
  original plus refund reversal plus its undo. Each contains `kind`,
  `requestId`, `transactionId`, `reference`, `parentTransactionId`,
  `parentLineItemIds`, and `components`.
- Components are the original saved `item` and `buyerFee` line references,
  explicit tax codes, base cents and tax cents, plus shipping cents/tax/code.
  There is no proportional allocation or tax recomputation. Originals use the
  two current order references (`orderId_item`, `orderId_buyer_fee`); this narrow
  proposal keeps those exact saved line references in reversal requests too.
  Other reversal-reference formats are held until explicitly supported.
- Parent line IDs are the exact observed item/fee IDs in the immediate parent.
  `null` is permitted only for an omitted zero component. A present zero-value
  reversal line still needs a real observed parent ID. Transaction line IDs
  cannot reuse any previous transaction ancestor's ID. Calculation and
  transaction line IDs are not assumed to be distinct.
- An original has null policy/refund fields. Other actions require a nonzero
  policy hash and a matching refund ID/current successful or failed/canceled
  status, no review flag, and an event timestamp. The existing SQL's signed
  refund and prepared-action checks remain required.

**The loader is an authority boundary, not an implementation included here.**
A UUID, `status:known`, hash or source tag does not prove a real dispatch,
authenticated owner decision or signed refund. A future private server must
authenticate the sole owner, load the exact prepared action and immutable paid
order, verify the real saved dispatch and current signed refund/policy evidence,
and preserve environment isolation. The loader is re-read after the provider
checks and must return the same complete binding. Browser payloads, synthetic
fixtures or unrelated RPCs must never implement that loader.

## Complete provider reads

Before and after receipt reads, the adapter retrieves `/v1/account` and
`/v1/balance`. The account ID must match the fixed sandbox; `livemode`, if
present on Account, must be false, and Balance must explicitly report false.
Account may omit `livemode`; its omission is not itself mode proof. No
connected-account header or account-switch input exists.

The saved calculation is retrieved independently. Tax Transaction JSON does
not contain a `calculation` field: this module never invents or checks one. The
original calculation-to-transaction relationship depends on the private saved
dispatch mapping above, and retrieved calculation/transaction components must
match it. An original must have been committed **before calculation expiry**;
it does not become invalid just because that expiry is now in the past.
However, Stripe documents retrieval only while a calculation is unexpired.
If it is no longer retrievable, this implementation holds. No retained
calculation-evidence alternative or late-history recovery path is fabricated.

Every calculation and transaction line-item list is retrieved through its own
fixed endpoint, ignoring inline arrays as proof of completeness. Pagination is
bounded, with exact list URLs/cursors, unique IDs and at most two supported
item/fee roles. Missing/extra/duplicate/substituted lines or incorrect optional
`total_count` hold. One-line and shipping-only zero-line reversals are allowed
only when their complete component inventories and real parent mappings agree.

Originals require USD, exclusive item/fee/shipping tax treatment, explicit saved
tax codes, exact amounts and null reversal ancestry. Reversals must match the
known parent, opposite signed amounts and parent line IDs. Undo is supported
only as the full positive reversal of the known negative refund receipt, with
the same exact components and that negative receipt's line IDs. It cannot
point directly to the original sale or invent a new allocation.

The public custom integration guide explicitly documents positive amounts when
undoing a partial refund. The generic reversal-creation parameter text says
negative amounts for partial input. This module never creates either kind:
it verifies only the complete known receipt chain. The documented positive
undo shape still needs actual pinned-account provider acceptance.

All calculation, transaction and complete line inventories are read twice and
must agree, then the saved private mapping and account/mode are checked again.
This detects observed changes; GET reads are not an atomic provider lock and
do not exclude changes after verification. The original SQL, sticky holds,
signed events, reconciliation and later reads remain mandatory.

## Transport and privacy bounds

All requests are finite fixed-origin GETs to `https://api.stripe.com`, with
manual redirects, no-store/no-cache requests, requested identity encoding and
the explicit API pin. Non-identity response encodings hold, avoiding Node's
transparent decompression versus compressed Content-Length mismatch. Responses
must have exact final URLs, HTTP200, JSON, a fresh HTTP Date, no redirect or
cached-hit evidence, canonical bounded length (when present), and bounded
streamed UTF8/JSON content. Each response is at most256KiB; each list has a
three-page ceiling; each request is limited to5 seconds and the entire
verification to20 seconds. Wall-clock rollback and monotonic expiry hold.
The timeout does not establish when a remote provider operation completed;
there are no provider writes here. Transports that ignore AbortSignal cannot
deliver late accepted evidence. Concurrent verification and closed instances
are denied.

Only these14 keys leave a successful verification:
`test, accountId, source, transactionId, parentTransactionId, reference,
currency, type, itemCents, buyerFeeCents, shippingCents, taxCents, totalCents,
observedAt`. Addresses, tax IDs, customer/IP details, provider metadata, raw
responses, key values and provider error messages are not returned. Errors are
uniform held errors. A normalized receipt is not a payment/refund/release
instruction, and the accounting proposal remains held/funding-unverified.

Zero tax, an actual `not_collecting` calculation, or internally consistent
receipt totals cannot establish tax compliance. This verifier confirms matching
saved/provider bookkeeping only. The prior quote's supported taxability checks,
owner/professional policy decisions and registration/filing acceptance are not
replaced by this module.

## Evidence and publication boundaries

The public candidate consists of this document, the additive server module,
the fictional local transport fixture and its focused Node tests. No new
dependency, runtime import, schema/grant, source key, live financial observation
or actual customer record is included.

The separate `private-checks/accounting-contract.integration.test.cjs` is NOT a
publication candidate. It depends on the preserved local accounting SQL proposal
and its fixture, runs only in disposable PGlite, and verifies original,
reversal and positive undo outputs against that unchanged contract. It checks
receipt replay, balanced reclassification, preserved jobs around each booking,
and continuing ordinary-money/global-claim holds. It is not native PostgreSQL,
an installed migration, sole-owner hosted authorization, a provider receipt or
live acceptance. Source/job snapshots changed by the existing signed-refund
fixture remain appropriate holds; booking itself does not dispatch them.

The standalone focused suite also covers complete pagination, account/mode,
unknown-ID zero-I/O, amount/ancestry substitution, copied line IDs, null parents,
PII stripping, mutable responses/private bindings, caching, body limits,
encoding, timers, closure and concurrency. No full inherited suite is claimed
or required merely to inspect this additive standalone source slice.

## Primary documentation reviewed

Root retrieved these current public official documents using the official
CLI's documentation capability with fresh no-credential local config. The
planning capability was tried but did not provide this focused guide; MCP
API/doc search returned unrelated resources. No unrelated API operation was
used as a substitute. This is a documented capability gap, not evidence that
an actual Stripe API operation succeeded or failed.

- https://docs.stripe.com/api/tax/transactions/object
- https://docs.stripe.com/api/tax/transactions/retrieve
- https://docs.stripe.com/api/tax/transactions/line_items
- https://docs.stripe.com/api/tax/transactions/create_from_calculation
- https://docs.stripe.com/api/tax/transactions/create_reversal
- https://docs.stripe.com/api/tax/calculations/object
- https://docs.stripe.com/api/tax/calculations/retrieve
- https://docs.stripe.com/api/tax/calculations/line_items
- https://docs.stripe.com/tax/payment-intent/custom#reversals-void-refund
