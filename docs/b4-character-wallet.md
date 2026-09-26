# B4 character wallet — source-complete implementation

Status: source-complete; when this document is present on `main`, B4 is merged
from B3 main `59edeb36d5a1703dc9019d6932f964b537c300c6`. No remote migration, deployment,
MKL commissioning, offer, client, secret, checkout, payment, webhook, or
purchased-fulfillment transport is part of this change.

## Authority and measurement

`character_grants`, `character_purchased_lots`, `character_reservations`, and
`character_allocations` are commercial character authority. `usage_ledger`
continues to record request/provider/token/cost/latency/error telemetry and the
calendar abuse controls, but its character sum no longer grants or resets B4
inventory. New commercial values use `unicode_code_points_v1` (`Array.from`
iteration): `abc` = 3, `😀` = 1, and `a😀b` = 3. Historical rows retain their
original semantics.

Free is one durable grant of exactly 3,000 characters. It is independent of
identity link churn and paid periods. Paid operations allocate only from the
current included grant and purchased lots, never Free. Included values are
25,000 / 100,000 / 350,000 for Plus / Pro / Max `pricing-v1` and are unique on
owner, authoritative entitlement identity, application, and exact verified
period. A later refresh or authority revision cannot resize or replenish an
already-issued period grant; a genuinely new period may issue once.

## Safe legacy cutover

Migration `0013_b4_character_wallet.sql` does not blanket-grant existing users.
It grants a reconciled Free wallet only when the existing account is locally
Free, has no `ai_character_limit_override`, and has no `usage_ledger` rows. That
is the only existing state that demonstrates an untouched allowance from the
available evidence. Every account with historical usage evidence, a legacy
paid tier, or a character override is recorded as `legacy_pending` and receives
no invented wallet value. Accounts created after the migration lazily receive
their once-only Free grant. Legacy/admin overrides and support/test capability
grants never become wallet inventory.

## Reservation and allocation state machine

Each customer operation has a stable owner-scoped idempotency key and a SHA-256
fingerprint over bounded normalized metadata: owner, operation/prompt,
document/revision/anchor, code-point source count, source hash, instruction
hash, and normalized runtime hash. Wallet tables do not persist raw document,
source, sample, or instruction text.

Reservation batches insert the reservation and ordered allocation rows as one
D1 batch. Allocation triggers re-prove ownership, measurement version,
authority snapshot, source state, expiry, and available quantity inside the
write transaction, then move source counters. A failed source in a multi-source
reservation aborts the entire batch. Unique owner/idempotency and
reservation/source constraints prevent replay and duplicate allocation.

The order for paid requests is the exact active-period included grant, then
purchased lots by authoritative expiry, fulfillment time, and stable lot ID.
Free requests allocate only from the original Free grant. One reservation can
span any number of eligible sources.

Terminal transitions use internal `settling` and `releasing` fence states
inside an atomic batch:

- settlement moves required quantities from the first allocations and releases
  excess from the final allocations first;
- a required increase (AI Mode output above source) obtains another guarded
  allocation before preview persistence;
- preview insertion and exact settlement commit in the same batch, so a billed
  preview cannot be missing and an unbilled preview cannot be delivered;
- provider or validation failure releases every allocation and charges zero;
- successful preview delivery remains settled if later Apply fails;
- repair calls retain provider telemetry but create no wallet reservation;
- release/settlement database failures surface as retry-required errors rather
  than being swallowed.

## Execution lease and recovery

The execution lease is exactly 90 seconds. The current provider timeout is 30
seconds. A valid path can make one 30-second main request and one 30-second
repair request; 30 further seconds are reserved for validation and atomic
persistence: `30 + 30 + 30 = 90 seconds`. It is bounded and is unrelated to the
24-hour preview payload retention.

A reservation created before source expiry may settle against its recorded
allocations within that lease. It cannot settle after the deadline or migrate
to a new entitlement period. The hourly maintenance path reaps expired holds.
Reaping CAS-checks the fencing token, increments it, releases exactly once, and
audits the cause. A late worker cannot pass the reserved-state/fence guards once
the reaper wins. Released quantities do not make an expired source spendable.

## Purchased-lot B5 boundary and corrections

`acceptVerifiedPurchasedLot` is an internal server primitive with no HTTP or
admin route. It requires a stable fulfillment identity, owner/identity and
application binding, quantity, authoritative fulfillment and expiry instants,
offer/version provenance when supplied, and verification revision/hash.
TulisAI never calculates expiry. The approved 15k / 45k / 100k quantities exist
only as local contract fixtures; this phase implements no price or purchase.

Lots freeze whenever fresh active paid authority is absent, unfreeze only when
fresh authority returns, and expire at the original authoritative instant even
while frozen. They grant no capability.

`applyVerifiedLotCorrection` is likewise internal-only. Correction identity and
revision are replay-protected. A verified reversal/refund atomically fences and
releases every outstanding reservation that touches the lot, revokes all
remaining unspent quantity, preserves consumed quantity without debt, and
appends causal audit/provenance. Conflicting or out-of-order corrections fail
closed for reconciliation. B5 now supplies the source-level verified
fulfillment/correction transport described in `docs/b5-mkl-commerce.md`; live
commissioning remains pending.

## API shape

`GET /api/usage` remains compatible and adds canonical `wallet` truth:
measurement version; Free original/remainder; current included period amounts;
purchased available/reserved/frozen/expired/settled totals; mode; and total
spendable characters. It does not expose MKL subject/customer identifiers.

Real purchased-lot fulfillment is **integrated in B5 source against local
fixtures only**. It has not been commissioned or exercised against live MKL or
Sandbox. B4/B5 source completion is not Sandbox or Production readiness.
