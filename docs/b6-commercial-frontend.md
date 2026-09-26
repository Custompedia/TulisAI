# B6 TulisAI commercial frontend

Status: **SOURCE IMPLEMENTED ON `feat/b6-commercial-frontend`, stacked on B5
(`codex/b5-mkl-commerce`). NOT DEPLOYED; NOT COMMISSIONED; NO PAYMENT OR
SANDBOX TRANSACTION PERFORMED.** It inherits B5's dependency on MKL PR #22.

B6 is the buyer-facing layer over the B5 server contract. It adds no payment
logic, no price authority, and no state of its own: every buy control, status,
and notice is rendered from what the TulisAI server read from MKL.

## What the buyer sees

| Surface | Behavior |
| --- | --- |
| Plans & AI allowance (`PlansDialog`) | Plan cards and top-up packs keep the locked catalogue text, but each buy control comes from `GET /api/commerce/offers`. Only an `available` product gets a real button; every other state is explained in words, links to where it can be fixed, or offers a reload. |
| Checkout step (`CheckoutPanel`) | Shows product, price, period/validity rules, and asks only for the phone number MKL's checkout needs. Then: create the intent, start the purchase OIDC ceremony, and go to MKL. Price, quantity, and period are never sent from the browser. |
| Return from MKL (`PurchaseReturn`) | `/app?purchase=<id>` is read once and removed from the URL. The status is re-read through the owner-scoped recovery route, never taken from the URL, and re-read automatically at 5s/10s/20s/40s while MKL has not decided. Success is shown only for `reconciled`. |
| Settings › Purchases (`PurchasesCard`) | Every purchase, newest first, with its status in words and the actions that make sense for it: continue at MKL, open MKL's payment page, or check the status again. |
| Settings › AI usage | Paid accounts see the MKL plan period and the split between plan allowance and top-up characters, including frozen top-ups. |

Copy that implied a UTC calendar-month reset or automatic refills was replaced:
a paid plan lasts one calendar month from when MKL records the payment
(OD-12), there is no automatic renewal, and a new plan is bought after the
current period ends (no early renewal or mid-period switch).

## Catalog states

`GET /api/commerce/offers` (`src/server/commerce/catalog.ts`) answers with one
state per product, in the order the purchase path would refuse it:

| State | Meaning |
| --- | --- |
| `checkout_closed` | `TULISAI_COMMERCE_CHECKOUT_ENABLED` is not `"true"`. MKL is not called. |
| `not_configured` | This deployment has no MKL application commerce credentials. |
| `mkl_unavailable` | MKL's catalog could not be read. Nothing is known. |
| `unavailable` | MKL has no offer for the product, or one that breaks the locked contract. Judged per product, from one read of MKL (`discoverOffers`). |
| `link_required` | Purchases are bound to a linked MKL identity. |
| `purchase_open` | A purchase of the same kind is already in progress (`openPurchaseId` names it). Mirrors the 0014 one-open-purchase indexes; an unbound draft does not block. |
| `active_access` | Paid access is active; no early renewal or plan switch. |
| `paid_access_required` | Top-ups need fresh Plus, Pro, or Max access. |
| `available` | The server would accept a new purchase now. |

The server still enforces every one of these again when a purchase is created;
the catalog only describes them.

## Purchase ceremony failures

A failure in the purchase OIDC callback (MKL cancelled, token invalid, identity
mismatch, offer changed, MKL rejected checkout) now returns to
`/app?purchase=<id>&purchase_error=<code>` instead of the sign-in page, where
the purchase would be lost from view. A session mismatch still goes to sign-in.
The purchase ID grants nothing; the app reads it back through the owner-scoped
recovery route.

## Shape pins

Browser code never imports server modules. `src/server/commerce/client-shapes.ts`
holds compile-time assertions that the browser's copies of the catalog, intent,
outcome, access, and wallet shapes match the server's, so `pnpm typecheck` fails
on drift.

## Evidence boundary

`tests/review/b6-commercial-frontend.test.ts` covers every catalog state
(including no MKL call while closed, one MKL read, and per-product contract
failures), the client's status wording (success only for `reconciled`), the
phone check, a specific message for every `CommerceError` code in the server,
and the rendered buy control and checkout step.
`tests/review/mkl-identity-bridge.test.ts` covers the cancelled purchase
ceremony returning to the app.

Passing these means **SOURCE COMPLETE only**: no live MKL catalog, return URI,
checkout, or payment has been exercised.
