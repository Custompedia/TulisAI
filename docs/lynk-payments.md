# Buying through Lynk

Status: **live since 2026-11-13** (owner: "lanjut sampai live").

- PR Custompedia/TulisAI#25 is merged (main d4a5312).
- Migration `0019` is applied to the remote D1.
- Worker `tulisai` version ca3d3f7c is deployed, with `LYNK_MERCHANT_KEY` and `RESEND_API_KEY` set.
- Ruang KOL forwards non-Ruang-KOL payments (Worker d459a1ca).
- The nine products are shown on lynk.id/custompedia.

Checks on the live Worker:

- `test_event` → 200;
- a forged signature → 401, with nothing recorded.

No real signed payment had gone through yet when the products were shown.

Owner decisions, 2026-11-13:

- Tulis Lab is sold in the custompedia store, lynk.id/custompedia, next to Ruang KOL.
- The store has one webhook URL, and it belongs to Ruang KOL (`https://kol.marikitalembur.com/api/lynk/webhook`). Ruang
  KOL forwards to Tulis Lab every payment that holds a product that is not its own. The URL and the merchant key stay
  as they are.
- Email goes through Resend, from `noreply@mail.marikitalembur.com`, like Ruang KOL.

## Products

`src/lib/lynk-products.ts` maps each Lynk product to a grant. The plans dialog links to the same pages. If you change or
add a product on Lynk, change it there too.

| Key | On Lynk | Grant | Price |
| --- | --- | --- | ---: |
| `plus-1m` | Tulis Lab Plus – Bulanan, lynk.id/custompedia/qljvgomx30w7 | Plus, 1 month | Rp49.000 |
| `pro-1m` | Tulis Lab Pro – Bulanan, lynk.id/custompedia/8p2z1xk8z78p | Pro, 1 month | Rp179.000 |
| `max-1m` | Tulis Lab Max – Bulanan, lynk.id/custompedia/z5lo0dll2zgq | Max, 1 month | Rp499.000 |
| `plus-12m` | Tulis Lab Plus – Tahunan, lynk.id/custompedia/g4xmyjo8wy65 | Plus, 12 monthly periods | Rp390.000 |
| `pro-12m` | Tulis Lab Pro – Tahunan, lynk.id/custompedia/3mv46o4v7v6r | Pro, 12 monthly periods | Rp1.430.000 |
| `max-12m` | Tulis Lab Max – Tahunan, lynk.id/custompedia/kmyr0911nxe8 | Max, 12 monthly periods | Rp3.990.000 |
| `topup-small` | Tulis Lab Tambahan 15.000 Karakter, lynk.id/custompedia/z4vqoqdowj41 | 15.000 characters, 12 months | Rp19.000 |
| `topup-medium` | Tulis Lab Tambahan 45.000 Karakter, lynk.id/custompedia/3d1r6rd8mm57 | 45.000 characters, 12 months | Rp49.000 |
| `topup-large` | Tulis Lab Tambahan 100.000 Karakter, lynk.id/custompedia/ze7gqgyklwyw | 100.000 characters, 12 months | Rp99.000 |

Settings shared by every product:

- digital product;
- one per checkout;
- delivers a link to `https://tulis.marikitalembur.com/app`;
- asks for the buyer's name (optional);
- an after-purchase message that explains the activation.

Each product has a 1024×1024 image drawn in the Tulis Lab palette.

They were hidden from the store page ("Show / Hide" off) until the endpoint was live, then shown (owner: "Langsung
tampilkan").

A yearly plan is twelve monthly access periods in a row, each with its own allowance. The periods are anchored to the
first day, so 31 Jan is followed by 29 Feb and then 31 Mar.

## `POST /api/lynk/webhook`

The body and the `X-Lynk-Signature` header arrive exactly as Lynk sent them. The signature is the SHA-256 hex of
`grandTotal + refId + message_id + merchant key`. Tulis Lab checks it with the Worker secret `LYNK_MERCHANT_KEY`, which
is the same key Ruang KOL holds.

| Situation | Answer |
| --- | --- |
| No `LYNK_MERCHANT_KEY` | `503`, so the sender retries |
| A wrong or missing signature | `401` |
| Any event other than `payment.received` (Lynk's "Test URL" sends `test_event`), or an action other than `SUCCESS` | `200 {ignored:"event"}` |
| A payment with no Tulis Lab product | `200 {ignored:"product"}`, kept as `ignored` |
| The same `refId` again | `200 {duplicate:true}` |
| The same `refId` while it is still `processing` | `503`, so the sender retries; after 2 minutes a retry takes over a run that was cut short |
| A grant that failed | `500`, so the sender sends the payment again |

`lynk_payments` keeps every payment once, keyed by `refId`. Its statuses are `processing`, `granted`,
`needs_operator`, `waiting_account`, `ignored` and `failed`.

An item is recognised by its Lynk product id (the first 24 hex characters of `uuid`), or else by its exact title.

**Which account.** The buyer's checkout email (`message_data.customer.email`) decides:

- **It belongs to an account with a verified email** (Google sign-ins are verified): the payment becomes a paid
  `payment_orders` row `LY-<refId>` with `provider='lynk'`, `provider_mode='production'` and `months` 1 or 12. It is
  then granted by the same fulfilment as Midtrans, exactly once.
  - Plans renew after the last paid day.
  - A different running plan becomes `needs_operator`. Nothing is swapped, and the payment is listed under Admin →
    Pembayaran → Perlu tindakan.
  - A top-up is a purchased lot, frozen while no plan runs.
- **Otherwise** the payment is `waiting_account`, and the buyer is emailed a claim link,
  `/billing/lynk?ref=<refId>&t=<HMAC of the refId with BETTER_AUTH_SECRET>`. The purchase is then granted by any of:
  - the signed-in account that opens the link, whatever its email;
  - the next `/api/usage` or `/api/payments/orders` read by an account whose verified email matches;
  - an admin, under Admin → Pembayaran → "Lynk: belum masuk ke akun" → Sambungkan.

**Amount.** The amount is the order total when our product is the only item. When the cart holds other products, it is
our item's own price. A zero total (a 100% coupon) is `needs_operator`, and the owner grants it by hand.

Lynk has a cart. Only one Tulis Lab product per payment is granted automatically; any further one is listed for an
operator.

**Emails** (Resend, bilingual, with an idempotency key per payment):

- plan active;
- top-up added (it says so when no plan runs);
- payment received, with a team follow-up (`needs_operator`);
- activate your purchase (`waiting_account`).

A failed email never undoes a grant. The result is kept in `detail_json.email`.

## What Ruang KOL forwards (the Ruang KOL session builds it)

In `ruang-kol-dashboard/src/worker/lynk.ts`, after the signature check and before the payment is marked `ignored`, a
signed `payment.received` that holds any item that is not a Ruang KOL product is sent on as follows:

- `POST https://tulis.marikitalembur.com/api/lynk/webhook`
- the raw request body, byte for byte;
- the headers `content-type: application/json` and `x-lynk-signature: <the header Lynk sent>`;
- a timeout of about 10 seconds.

If Tulis Lab answers 5xx, or the request fails, Ruang KOL answers Lynk with a 5xx too, so that Lynk retries. Its own
`kol_payments` row must be left in a state a retry takes over. A 2xx from Tulis Lab, including `duplicate` or `ignored`,
means done. Payments that hold only Ruang KOL products are not forwarded.

## Secrets and switches

| Name | Where | Meaning |
| --- | --- | --- |
| `LYNK_MERCHANT_KEY` | Worker secret | The custompedia store's merchant key, copied with Lynk's Copy button. Without it the webhook answers 503 and the plans dialog shows no Lynk buttons. |
| `RESEND_API_KEY` | Worker secret | A Resend key with sending access. With it every Tulis Lab email goes through Resend, including password reset and verification. |
| `EMAIL_FROM` / `EMAIL_REPLY_TO` | `wrangler.jsonc` vars | `Tulis Lab <noreply@mail.marikitalembur.com>` / `marikitalembur@gmail.com` |

When the Midtrans checkout is open it takes precedence. Otherwise the plans dialog links to the Lynk products and tells
buyers to pay with the email of their account.

## Commissioning order (each step needs the owner's OK)

1. Put the secrets on `tulisai`. The owner runs `wrangler secret put RESEND_API_KEY` and
   `wrangler secret put LYNK_MERCHANT_KEY` and pastes the values. Never click Regenerate on Lynk.
2. Apply migration `0019_lynk_payments.sql` to the remote D1, then deploy `tulisai`.
3. Ruang KOL deploys its forwarding.
4. Run a real test purchase of the cheapest product with a known account, and check:
   - the grant;
   - Admin → Pembayaran;
   - the email.
5. Show the nine products on the store page.
