# B5 MKL commerce bridge

Status: **SOURCE IMPLEMENTED ON `codex/b5-mkl-commerce`; NOT DEPLOYED; NOT
COMMISSIONED; NO PAYMENT OR SANDBOX TRANSACTION PERFORMED.**

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
`requires_active_access=true`. Unknown, wrong-version, duplicate, mismatched,
or cross-catalog offers fail closed.

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
`terminal`, and `reconciliation_required`. A paid historical order cannot
remain a fake local pending order.

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

Pending orders grant nothing. `expired`, `cancelled`, and `failed` become
terminal. Paid access becomes `paid_awaiting_authority`; a fresh OIDC ceremony
must make B3 observe the exact plan before reconciliation. B3 then issues B4's
included-period grant idempotently. Browser navigation never writes a tier or
grant.

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
older or same-revision/different-payload authority is rejected.

If MKL reports `corrections_complete=false`, or a previously accepted purchase
later conflicts at the same revision/provenance/price boundary, B5 invokes the
B4 fail-closed reconciliation fence. The lot becomes non-spendable and holds
are released. A later complete consistent envelope may restore a non-corrected
lot to frozen state; fresh paid B3 authority remains required before B4
activates it. A verified correction remains terminal.

## Server contract

- `POST /api/commerce/intents` — authenticated same-origin creation with
  `Idempotency-Key` and `{kind, planCode, planVersion, buyerPhone}`.
- `GET /api/commerce/intents` — owner-safe recovery list.
- `GET /api/commerce/intents/:id` — owner-scoped order/purchase refresh.
- `POST /api/auth/mkl/commerce/start` — purchase OIDC start with
  `{purchaseId, returnTo?}`.
- `GET /api/commerce/mkl/return` — cookie-bound recovery signal.

B6 may build truthful UI over these states. It must not introduce browser-side
price authority or treat navigation as settlement.

## Evidence boundary

The B5 suite covers exact offers, identity/provenance, stable intent/order
replay, eligibility, terminal replacement, browser-return non-authority, paid
access reconciliation, exact expiry retention, concurrent recovery, correction
replay/order/conflict, no-debt/hold release, and incomplete-authority fencing.
B2/B3/B4 regression suites remain in the full run.

Passing fixtures means **SOURCE COMPLETE only**. It does not mean the MKL
generic closure is deployed, TulisAI is registered, a return URI is configured,
an authenticated live refresh works, a Sandbox purchase exists, or a real
purchased lot has been fulfilled.
