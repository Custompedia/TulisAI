# Local paid access (after MKL retired)

Status: **SOURCE ONLY — not deployed, no remote migration.**

MKL became a pure landing site on 2026-09-28. Its sign-in, entitlement and
commerce APIs are gone, so TulisAI records paid access itself, following Mari
Rekap's stand-alone pattern (owner decision 2026-09-30).

## Access periods

Migration `0014_local_access_periods.sql` adds `access_periods`. Each row is one
calendar month of Plus, Pro or Max:

- `source` is `admin` (granted from the admin panel) or `payment` (a verified
  direct payment, added in the payments PR). A payment period must carry its
  `payment_order_id`.
- Periods of one owner never overlap. A renewal starts where the last covered
  period ends (enforced in code, inside the same atomic batch).
- Plan, source, owner and dates are immutable (trigger). A period can only move
  from `active` to `ended`, with who, when and why recorded. Nothing is deleted.
- Months are calendar months in UTC anchored to the start day: 31 Jan → 29 Feb
  (leap year) → 31 Mar.

`entitlement()` and the B4 wallet both read the running period first:

- tier and features come from the plan; the access authority is `payment` or
  `admin_grant`;
- the wallet issues the plan's included characters exactly once per period
  (Plus 25.000, Pro 100.000, Max 350.000), keyed by the period id;
- when a queued renewal starts, a fresh allowance is issued for that period;
- when no period is running the account falls back to Free.

The dormant B3/MKL projection is still honoured for any pre-retirement link, but
a local period wins.

The same migration rebuilds `character_grants` and `character_purchased_lots` so
their MKL `identity_link_id` becomes optional. Local periods and direct purchases
have no MKL link, and an admin account can never hold one. Rows and references
are preserved (copy aside, recreate, copy back, inside the migration's
transaction with deferred foreign keys).

## Admin: "Paket"

User detail → **Paket** (after Mari Rekap's "Atur paket"):

- **Aktifkan paket** (no running plan): one month from now.
- **Perpanjang 1 bulan** (same plan): one more month queued after the last
  covered day. This month's allowance is unchanged; the next month's allowance
  starts with its period.
- **Ganti paket** (different plan): the running period and its renewals end now
  and the new plan runs one month from now. The panel warns when the replaced
  plan was paid for.
- **Akhiri paket**: requires a reason and typing `AKHIRI`. Every running and
  queued period ends now. Purchased top-up characters are not removed.

Admin accounts can receive plans too; in TulisAI an admin is not metered for
free, so a plan is how an admin gets an AI character allowance. Every change is
written to the admin audit log (`plan.admin.activated|extended|replaced|ended`)
and shown in the account's action history.

The legacy `user.tier` column is no longer editable (`TIER_READ_ONLY`), and new
accounts are always created on Free. The admin list, tier filter and tier counts
show the effective plan (running period, else the legacy column).
