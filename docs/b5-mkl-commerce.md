# B5 MKL commerce bridge

Status: **SOURCE IMPLEMENTED AND HARDENED ON `codex/b5-mkl-commerce`; NOT
DEPLOYED; NOT COMMISSIONED; NO PAYMENT OR SANDBOX TRANSACTION PERFORMED.
BLOCKED ON MKL PR #22 (consumable authority, migration `0029`) BEING MERGED
AND DEPLOYED.**

MKL's merged `/app/v1/offers` and `/app/v1/purchases` responses do not yet
carry `consumable_validity_unit`, `consumable_validity_count`,
`requires_active_access`, `application`, `holder`, `fulfillment_id`,
`fulfilled_at`, `consumable_expires_at`, `purchase_revision`,
`corrections_complete`, or `corrections`. Those fields exist only in MKL
PR #22. Until it is live, B5 discovery and purchase reads fail closed with
`MKL_RESPONSE_INVALID` for every product, access included. Do not merge or
enable B5 before that dependency is available.

This is the TulisAI consumer of MKL's generic first-party application commerce
contract. It contains no Midtrans code, webhook, invoice, financial journal,
payment-provider secret, remote migration, production offer, or production
credential. The source contract is fixture-tested only. Authenticated B3/MKL
live integration, registered return URI, client/secret provisioning, offers,
Sandbox acceptance, and every deployment action remain follow-ups.

## Authority split and exact products

MKL owns the active/public offer, sold price, frozen offer snapshot, order and
payment state, holder/application binding, fulfillment identity/time, calendar
expiry, monotonic purchase revision, and complete ordered corrections. TulisAI
owns the exact semantic mapping to capabilities/characters, durable recovery
state, B3 access projection, and B4 wallet spending.

| Code | Version | Kind | Locked MKL price | Local effect |
| --- | --- | --- | ---: | ---: |
| `plus` | `pricing-v1` | access | Rp49.000 | B3 access; B4 25.000 included |
| `pro` | `pricing-v1` | access | Rp179.000 | B3 access; B4 100.000 included |
| `max` | `pricing-v1` | access | Rp499.000 | B3 access; B4 350.000 included |
| `topup_15k` | `pricing-v1` | consumable | Rp19.000 | B4 15.000 purchased |
| `topup_45k` | `pricing-v1` | consumable | Rp49.000 | B4 45.000 purchased |
| `topup_100k` | `pricing-v1` | consumable | Rp99.000 | B4 100.000 purchased |

TulisAI verifies MKL's discovered price against the locked contract but never
sends a price to checkout and never maps characters from price. Access offers
must be exactly one calendar month. Consumables must have no access term,
exactly 12 calendar months of MKL-owned validity, and
`requires_active_access=true`.

Discovery validates only catalog entries whose `plan_code` and
`plan_version` equal the requested TulisAI product. Unrelated, unplanned
(`plan_code: null`), other-version, or malformed entries are ignored, so a
Control edit to another offer cannot stop TulisAI sales. A matching entry that
breaks the locked contract (price, kind, term, validity, access prerequisite,
catalog binding) or appears twice still fails closed.

**Repricing is a coordinated TulisAI release.** MKL treats offer prices as
editable in Control, but B0 locks these prices. Changing a TulisAI offer price
in MKL without a matching TulisAI release makes that product unavailable
(`OFFER_CONTRACT_MISMATCH`) and closes unbound intents for it. It never
silently accepts the new price.

**External contract requirement.** The top-up identities `topup_15k`,
`topup_45k`, `topup_100k` at `pricing-v1` are defined by TulisAI. MKL's
`spec/apps/tulisai-pricing-v1.json` lists only `plus`/`pro`/`max`, and MKL
PR #22 defines the generic consumable envelope but no TulisAI codes. The MKL
spec and the commissioned offers must carry exactly these codes and version
(not, for example, Mari Rekap's `topup-v1`) before top-ups can be sold.

## Durable intent state

Migration `0014_b5_mkl_commerce.sql` adds only
`mkl_purchase_intents`; it is not a payment ledger. One owner-scoped hashed
request key binds an immutable request fingerprint to one purchase ID, one
server-generated MKL idempotency key, one verified offer contract, one identity
link/organization, and—after checkout—one immutable MKL order. Same key/same
request replays; same key/different request is rejected. Order and fulfillment
bindings are immutable, and purchase revisions cannot decrease or change
payload at the same revision.

One payable access intent and one payable top-up intent may be open per owner.
A terminal intent permits a deliberate new key. A reconciled top-up permits a
later same-pack purchase with a new purchase ID/key. Historical top-up
correction reconciliation does not masquerade as a second payable intent and
does not block a deliberate repeat.

Lifecycle values distinguish `created`, `checkout_pending`,
`pending_payment`, `paid_awaiting_authority`, `reconciling`, `reconciled`,
`terminal`, and `reconciliation_required`. Every status write goes through
one transition table in `src/server/commerce/intents.ts`. The allowed-source
check is part of the SQL `UPDATE`, so a concurrent writer can never regress an
intent. The existing schema represents every state, so no migration was added.

- `terminal` is final for both kinds, and `reconciled` is final for access.
  Recovery returns them without calling MKL.
- A reconciled top-up stays re-verifiable because MKL corrections arrive
  later. It may only move between `reconciling`, `reconciled`, and
  `reconciliation_required`, never back to a pre-payment status.
- A deliberate new intent closes older unbound `created` intents of the same
  kind as `terminal`/`superseded_by_new_intent` (they cannot hold a payable
  order) and first tries to resolve older bound ones from current authority.
- A checkout failure returns to `created` only for a definitive MKL 4xx
  refusal, which creates nothing. A network error, 5xx, 429,
  `checkout_already_in_progress`, or an unreadable response may have created
  an order under the stable key, so the intent stays `checkout_pending` and
  only that key is retried.
- Unbound intents whose offer disappeared (`offer_unavailable`), stopped
  matching the locked contract (`offer_contract_mismatch`), or drifted
  (`offer_changed`) become `terminal`. A transient discovery failure changes
  nothing.
- Terminal rows keep `terminal_reason`, `last_error_code`, `order_status`,
  and their bindings. Nothing is deleted.

## OIDC commerce ceremony and checkout

`POST /api/auth/mkl/commerce/start` extends B2 with explicit `purchase` mode.
It requires the current local session, linked non-admin identity, and owned
purchase ID. One-time state binds user, session, purchase, browser-cookie hash,
issuer, client, callback, nonce, PKCE verifier, and bounded expiry.

The callback re-verifies RS256 signature, exact issuer/audience, expiry, nonce,
subject, and organization. Subject/organization must equal the existing link.
The raw ID token exists only in callback memory: it refreshes B3 and is
forwarded once to MKL checkout. It is never persisted, returned, logged by this
code, or placed in a URL. The SSO secret and app API secret remain distinct.

Before creating an order, the callback rediscovers and hashes the offer. Drift
terminalizes an unbound intent so a new deliberate purchase can be created.
Checkout sends only ID token, offer ID, current verified buyer name/email,
intent-bound phone, exact registered return URI, and stable idempotency header.
It never sends price, quantity, commercial time, entitlement, or paid state.

## Return, fulfillment, and corrections

`GET /api/commerce/mkl/return` reads an HttpOnly same-browser purchase cookie,
requires the local session, and invokes the same recovery used by
`GET /api/commerce/intents/:id`. The return URL/cookie are recovery hints,
never payment proof. Lost returns remain recoverable from the durable intent.

Order statuses are handled by what they prove:

| MKL order status | Meaning | Local handling |
| --- | --- | --- |
| `pending_payment` | unpaid | `pending_payment`; contradiction if local state is already post-payment |
| `expired`, `cancelled`, `failed` | unpaid, final | `terminal`; contradiction if local state is already post-payment |
| `paid`, `chargeback_pending`, `charged_back` | post-payment | read `/app/v1/purchases` and reconcile |
| anything else | unknown | no state or wallet change; evidence recorded; outcome `retry` |

A contradiction (for example an order reported pending after payment was
verified) never moves the intent backwards. Access goes to
`reconciliation_required`, and a top-up lot is fenced.

Paid access is decided from B3 authority observed **strictly after** the
order's `paid_at`: fresh, for the same identity link, and not invalidated
except by MKL's revoked/suspended lifecycle.

- The exact plan is active → `reconciled`.
- Another plan is active → `terminal`/`access_superseded`.
- Nothing is active → `terminal`/`access_not_active_after_payment`.
- The order is charged back → `terminal`/`order_charged_back`.

Without such an observation the intent waits in `paid_awaiting_authority`.
Any fresh B3 refresh can decide it: a purchase ceremony, or an ordinary MKL
sign-in followed by a new purchase attempt. An old paid access intent therefore
cannot block a later purchase forever. B3 still issues B4's included-period
grant idempotently. Browser navigation never writes a tier or grant.

Transport failures are not authority. A network error, any non-2xx response
(including 401, 403, 429, and 5xx), or a body that is not JSON changes neither
lifecycle nor wallet. Recovery records `last_error_code` and returns outcome
`retry`. Only successfully received MKL data that is contradictory, explicitly
incomplete, or in conflict with persisted authority fences a lot.

For a paid consumable, TulisAI cross-checks order ID/number/status/paid time and
gross against the frozen purchase; client/app/catalog; holder; offer; exact
code/version/kind; fulfillment ID/time; MKL expiry; 12-month policy facts;
revision; and a complete gap-free correction array. It performs no calendar
arithmetic. Only then does it call `acceptVerifiedPurchasedLot`. The
fulfillment hash excludes later corrections, so higher purchase revisions
reuse the same lot.

Corrections are applied in MKL revision order through
`applyVerifiedLotCorrection`. Partial refund and full reversal both revoke
remaining local inventory, preserve settled characters without debt, and
atomically release reservations touching the lot. Exact replay is inert; an
older or same-revision/different-payload authority is rejected. A lot that
reached `reversed` keeps that label if a refund completes later.

Correction histories are validated with MKL PR #22's arithmetic
(`assertCorrectionArithmetic` in `src/server/commerce/mkl-client.ts`):

- **Refund:** `cumulative_refunded_idr` = previous completed refunds +
  `amount_idr`, never above the price. `final_state` is `reversed` exactly when
  that total reaches the price, otherwise `partially_refunded`.
- **Chargeback reversal:** always `reversed`, at most once per order.
  `cumulative_refunded_idr` stays equal to the completed-refund total, because a
  chargeback is not a refund, and may be `0`. `amount_idr` is the gross not
  already reserved by refunds; it may be `0` and never exceeds price minus
  completed refunds.
- The reversal amount plus all completed refunds never exceeds the price.
- Revision order is the only ordering authority. A chargeback's `corrected_at`
  is the order's last update, so it may predate an earlier refund or the
  fulfillment, and it is not compared.

Any violation is `MKL_CORRECTION_SEQUENCE_INVALID`. That is received authority,
so the lot is fenced and no correction is applied.

If MKL reports `corrections_complete=false`, or a previously accepted purchase
later conflicts at the same revision/provenance/price boundary, B5 invokes the
B4 fail-closed reconciliation fence. The lot becomes non-spendable and holds
are released. A later complete consistent envelope may restore a non-corrected
lot to frozen state; fresh paid B3 authority remains required before B4
activates it. A verified correction remains terminal.

## Local commerce gate

`TULISAI_COMMERCE_CHECKOUT_ENABLED` is TulisAI's own switch for **new**
purchases. It is open only when exactly `"true"`. `wrangler.jsonc` sets
`"false"`, and an unset value is also closed. It is independent of MKL's
per-client `app_commerce_enabled` and global checkout flags.

When closed:

- `POST /api/commerce/intents` refuses new intents with
  `COMMERCE_CHECKOUT_CLOSED`; an exact idempotent replay still returns the
  existing intent.
- `POST /api/auth/mkl/commerce/start` and the callback refuse unbound intents,
  so no MKL checkout is called.
- Recovery, access reconciliation, top-up fulfillment of already-bound orders,
  refund/reversal application, and the B3 projection keep working.

Production commissioning order: deploy with the gate closed; commission MKL
credentials, offers, and B3 entitlements; verify recovery and entitlements; then
open checkout by setting the var to `"true"` in a separate, owner-approved
release. Closing it again never strands paid buyers.

## Server contract

- `POST /api/commerce/intents` — authenticated same-origin creation with
  `Idempotency-Key` and `{kind, planCode, planVersion, buyerPhone}`.
- `GET /api/commerce/intents` — owner-safe recovery list.
- `GET /api/commerce/intents/:id` — owner-scoped order/purchase refresh.
- `POST /api/auth/mkl/commerce/start` — purchase OIDC start with
  `{purchaseId, returnTo?}`.
- `GET /api/commerce/mkl/return` — cookie-bound recovery signal.

Recovery outcomes are `authorization_required`, `pending`, `terminal`,
`reconciled`, `reconciliation_required`, and `retry`. `retry` means MKL could
not be read, or returned a status this release does not support; nothing
changed.

B6 may build truthful UI over these states. It must not introduce browser-side
price authority or treat navigation as settlement.

## Evidence boundary

The B5 suite covers exact offers, identity/provenance, stable intent/order
replay, eligibility, terminal replacement, browser-return non-authority, paid
access reconciliation, exact expiry retention, concurrent recovery, correction
replay/order/conflict, no-debt/hold release, and incomplete-authority fencing.
Hardening regressions cover final-state non-regression; access intents leaving
the blocking set after expiry, supersession, or chargeback; same-instant
observations; `chargeback_pending`; unsupported and contradictory order
statuses; every transport failure class on orders and purchases (no lot or
hold change, exactly-once fulfillment afterwards); stale unbound intents;
repricing; ambiguous versus definitive checkout failures; offer filtering; and
the local gate.
B2/B3/B4 regression suites remain in the full run.

Passing fixtures means **SOURCE COMPLETE only**. It does not mean the MKL
generic closure is deployed, TulisAI is registered, a return URI is configured,
an authenticated live refresh works, a Sandbox purchase exists, or a real
purchased lot has been fulfilled.
