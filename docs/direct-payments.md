# Direct Midtrans payments

Status: **SOURCE ONLY — not deployed, no remote migration, no transaction made.**

TulisAI takes payment itself through Midtrans Snap, following Mari Rekap
(owner decision 2026-09-30, after MKL stopped selling for first-party apps).
Access and characters are granted from TulisAI's own records
(`docs/local-access-periods.md`).

## What can be bought

Prices and quantities come from `src/lib/plans.ts` (B0 values) on the server;
the browser only names the item.

| Item | Price | Grant |
| --- | ---: | --- |
| Plus | Rp49.000 | 1 month, 25.000 characters |
| Pro | Rp179.000 | 1 month, 100.000 characters |
| Max | Rp499.000 | 1 month, 350.000 characters |
| Top-up small / medium / large | Rp19.000 / Rp49.000 / Rp99.000 | 15.000 / 45.000 / 100.000 characters, valid 12 calendar months |

- A plan can be bought when no plan runs, or renewed (the same plan) ahead of
  time. The renewal is queued after the last paid day, at most a year ahead.
- Another plan cannot be bought while one runs (`PLAN_ACTIVE`); there is no
  proration.
- Top-ups need a running plan (B0). They add characters only, are used after
  the monthly allowance, and freeze while no plan runs.

## Flow

1. `POST /api/payments/checkout` (`{kind:"plan",plan}` or
   `{kind:"topup",pack}`) freezes price and quantity on a `payment_orders` row
   (`TA-YYYYMMDD-XXXXXXXXXXXX`) and opens a Snap page (24 hours). An unpaid order
   for the same item is reused, not duplicated.
2. Midtrans returns the buyer to `/billing/return?order=…`. That page proves
   nothing on its own: it calls `POST /api/payments/orders/:id/refresh`, which
   reads the status from Midtrans.
3. Midtrans also calls `POST /api/payments/midtrans/notification`. The URL is
   sent with every transaction (`X-Override-Notification`), so no dashboard
   setting is needed. The SHA-512 signature is checked, and then the status is
   read back from Midtrans. The notification body is never trusted.
4. A paid status grants once. The grant, its audit row and the order's
   `fulfilled_at` are written in one batch, each conditioned on the order not
   being fulfilled yet. A notification racing a refresh cannot double-grant.

Safety checks:

- The paid amount must equal the frozen price in IDR; otherwise
  `payment.amount_mismatch` is recorded and nothing is granted.
- A sandbox order never grants under a production key, and the other way round
  (`payment.mode_mismatch`).
- Card captures under fraud review stay pending.
- A later failed or expired answer never unpays a paid order.
- If a different plan started before the payment completed, the order is marked
  paid with `needs_operator` and nothing is guessed.

Refunds and chargebacks:

- **Top-up:** the B4 reversal revokes the characters left, keeps spent characters
  spent, creates no debt, and releases open holds.
- **Plan:** listed for an operator (Admin → Pembayaran → Perlu tindakan). The
  plan can then be ended from Admin → user → Paket.

## Switches and secrets

| Name | Where | Meaning |
| --- | --- | --- |
| `MIDTRANS_SERVER_KEY` | Worker secret | Without it payments are closed (`PAYMENTS_CLOSED`) |
| `MIDTRANS_MODE` | `wrangler.jsonc` var, `"sandbox"` | `sandbox` or `production`; declare it, because newer sandbox keys have no `SB-` prefix |
| `TULISAI_COMMERCE_CHECKOUT_ENABLED` | `wrangler.jsonc` var, `"false"` | TulisAI's own switch for **new** checkouts; refresh, notifications and refunds keep working when it is off |

A sandbox key on `https://tulis.marikitalembur.com` is accepted only when
`MIDTRANS_MODE` is declared `"sandbox"`, so a forgotten test key cannot take real
orders silently. The plans dialog shows a "Mode uji (sandbox)" banner in that
mode.

## Admin → Pembayaran

For each WIB month the tab shows:

- net production revenue: gross minus refunds, with refunds counted in the month
  they were handled;
- plan and top-up counts;
- sandbox orders, as a count only and never as revenue;
- AI cost in USD;
- a "Perlu tindakan" list;
- the latest orders.

A margin figure waits for an agreed accounting exchange rate.

## Commissioning order (owner-approved steps)

1. Apply migrations `0014` and `0015` to the TulisAI D1, then deploy.
2. Put the Midtrans **sandbox** server key in `MIDTRANS_SERVER_KEY` and keep
   `MIDTRANS_MODE="sandbox"`.
3. Set `TULISAI_COMMERCE_CHECKOUT_ENABLED="true"`. Buy a plan and a top-up with
   the Midtrans simulator, then check the return page, the grant and Admin →
   Pembayaran.
4. For real money: replace the key with the production key, set
   `MIDTRANS_MODE="production"`, and deploy.
