import { runtime } from "../runtime";
import { CHARACTER_MEASUREMENT_VERSION } from "./measurement";

export const FREE_GRANT_AMOUNT = 3_000;
export const INCLUDED_AMOUNTS = { plus: 25_000, pro: 100_000, max: 350_000 } as const;
export const APPROVED_TOP_UP_FIXTURES = { pack_15000: 15_000, pack_45000: 45_000, pack_100000: 100_000 } as const;
// Provider timeout is 30s. One main call + one repair + 30s for validation and
// durable persistence is the longest valid execution path: 30 + 30 + 30 = 90s.
export const EXECUTION_LEASE_MS = 90_000;

type PaidPlan = keyof typeof INCLUDED_AMOUNTS;
type WalletMode = "free" | "paid";
type AllocationKind = "free_grant" | "included_grant" | "purchased_lot";
type ReservationState = "allocating" | "reserved" | "extending" | "settling" | "releasing" | "settled" | "released" | "voided";

export class WalletError extends Error {
  constructor(public code: string, message: string, public status = 409) {
    super(message); this.name = "WalletError";
  }
}

type Projection = {
  identity_link_id: string; entitlement_id: string; plan_code: PaidPlan; plan_version: string;
  period_start: string; period_end: string; access_deadline: string; scope_revision: number;
  authority_payload_hash: string; application_app_key: string; catalog_item_id: string;
  fresh_until: number; invalidated_at: number | null;
};
type ReservationRow = {
  id: string; owner_id: string; idempotency_key: string; request_fingerprint: string; operation: string;
  source_characters: number; current_hold: number; settled_amount: number; state: ReservationState;
  lease_deadline: number; fencing_token: number; mode: WalletMode; entitlement_id: string | null;
  entitlement_period_start: string | null; entitlement_period_end: string | null; authority_revision: number | null;
  application_app_key: string | null; eligibility_snapshot_json: string; result_reference: string | null;
  created_at: number;
};
type Candidate = { kind: AllocationKind; id: string; available: number; ordinal: number };
type Allocation = Candidate & { quantity: number };

async function runBatch(statements: D1PreparedStatement[]) {
  const db = runtime().DB;
  // Real D1 always provides atomic batch(). A few legacy unit adapters expose
  // only statements; keep them usable without changing the production path.
  if (typeof db.batch === "function") return db.batch(statements);
  const results = [];
  for (const statement of statements) results.push(await statement.run());
  return results;
}

const validInstant = (value: string, field: string): number => {
  if (!/(?:Z|[+-]\d\d:\d\d)$/i.test(value)) throw new WalletError("WALLET_FACT_INVALID", `${field} must be an ISO instant.`);
  const millis = Date.parse(value);
  if (!Number.isFinite(millis)) throw new WalletError("WALLET_FACT_INVALID", `${field} must be an ISO instant.`);
  return millis;
};
const positiveInteger = (value: number, field: string) => {
  if (!Number.isSafeInteger(value) || value <= 0) throw new WalletError("WALLET_FACT_INVALID", `${field} must be a positive safe integer.`);
};

async function activeProjection(ownerId: string, now: number): Promise<Projection | null> {
  const row = await runtime().DB.prepare(`SELECT p.identity_link_id,p.entitlement_id,p.plan_code,p.plan_version,p.period_start,p.period_end,
      p.access_deadline,p.scope_revision,p.authority_payload_hash,p.application_app_key,p.catalog_item_id,p.fresh_until,p.invalidated_at
    FROM mkl_entitlement_projection p JOIN external_identity_link l ON l.id=p.identity_link_id AND l.user_id=p.user_id
      AND l.issuer=p.issuer AND l.subject=p.subject AND l.organization_id=p.organization_id
    WHERE p.user_id=? AND p.status='active' AND p.plan_version='pricing-v1' AND p.plan_code IN ('plus','pro','max')
      AND p.invalidated_at IS NULL AND p.fresh_until>? AND p.period_start<=? AND p.access_deadline>?`)
    .bind(ownerId, now, new Date(now).toISOString(), new Date(now).toISOString()).first<Projection>();
  return row ?? null;
}

export async function ensureFreeGrant(ownerId: string, now = Date.now()): Promise<void> {
  const account = await runtime().DB.prepare("SELECT free_grant_state FROM character_wallet_account WHERE owner_id=?").bind(ownerId).first<{ free_grant_state: string }>();
  if (account) return;
  const grantId = crypto.randomUUID();
  try {
    await runBatch([
      runtime().DB.prepare("INSERT INTO character_wallet_account (owner_id,free_grant_state,legacy_reason,created_at,updated_at) VALUES (?,'issued','account created after B4 cutover',?,?)").bind(ownerId, now, now),
      runtime().DB.prepare(`INSERT INTO character_grants (id,owner_id,kind,original_amount,reserved_amount,settled_amount,state,measurement_version,created_at,updated_at)
        VALUES (?,?,'free',?,0,0,'active',?,?,?)`).bind(grantId, ownerId, FREE_GRANT_AMOUNT, CHARACTER_MEASUREMENT_VERSION, now, now),
      runtime().DB.prepare(`INSERT INTO character_wallet_events (id,owner_id,event_type,grant_id,quantity,causal_reference,metadata_json,created_at)
        VALUES (?,?,'free_grant_issued',?,?,?,'{}',?)`).bind(crypto.randomUUID(), ownerId, grantId, FREE_GRANT_AMOUNT, `free-once:${ownerId}`, now),
    ]);
  } catch (error) {
    const raced = await runtime().DB.prepare("SELECT free_grant_state FROM character_wallet_account WHERE owner_id=?").bind(ownerId).first();
    if (!raced) throw error;
  }
}

/** Exactly-once issuance from the persisted B3 projection, never from local tier state. */
export async function issueIncludedGrantFromProjection(ownerId: string, now = Date.now()): Promise<string | null> {
  const projection = await activeProjection(ownerId, now);
  if (!projection?.entitlement_id || !(projection.plan_code in INCLUDED_AMOUNTS)) return null;
  const amount = INCLUDED_AMOUNTS[projection.plan_code];
  const id = crypto.randomUUID();
  const result = await runtime().DB.prepare(`INSERT OR IGNORE INTO character_grants (
      id,owner_id,kind,identity_link_id,entitlement_id,application_app_key,catalog_item_id,plan_code,plan_version,
      period_start,period_end,period_start_ms,period_end_ms,authority_revision,authority_payload_hash,original_amount,reserved_amount,settled_amount,
      state,measurement_version,created_at,updated_at
    ) VALUES (?,?, 'included',?,?,?,?,?,?,?,?,?,?,?,?,?,0,0,'active',?,?,?)`)
    .bind(id, ownerId, projection.identity_link_id, projection.entitlement_id, projection.application_app_key, projection.catalog_item_id,
      projection.plan_code, projection.plan_version, projection.period_start, projection.period_end, Date.parse(projection.period_start), Date.parse(projection.period_end), projection.scope_revision,
      projection.authority_payload_hash, amount, CHARACTER_MEASUREMENT_VERSION, now, now).run();
  if ((result.meta.changes ?? 0) === 1) {
    await runtime().DB.prepare(`INSERT INTO character_wallet_events (id,owner_id,event_type,grant_id,quantity,causal_reference,metadata_json,created_at)
      VALUES (?,?,'included_grant_issued',?,?,?, ?,?)`)
      .bind(crypto.randomUUID(), ownerId, id, amount, `entitlement:${projection.entitlement_id}:${projection.period_start}:${projection.period_end}`,
        JSON.stringify({ planCode: projection.plan_code, planVersion: projection.plan_version, authorityRevision: projection.scope_revision }), now).run();
    return id;
  }
  const existing = await runtime().DB.prepare(`SELECT id,plan_code,plan_version,original_amount,authority_payload_hash FROM character_grants WHERE owner_id=? AND kind='included' AND entitlement_id=?
    AND application_app_key=? AND period_start=? AND period_end=?`).bind(ownerId, projection.entitlement_id, projection.application_app_key, projection.period_start, projection.period_end)
    .first<{ id: string; plan_code: string; plan_version: string; original_amount: number; authority_payload_hash: string }>();
  // A later authority revision may change capability facts mid-period. The
  // wallet deliberately preserves the original period grant instead of
  // replenishing or resizing it; only a new authoritative period can issue.
  return existing?.id ?? null;
}

async function refreshLotStates(ownerId: string, paid: boolean, now: number): Promise<void> {
  await runBatch([
    runtime().DB.prepare(`UPDATE character_purchased_lots SET state='expired',updated_at=? WHERE owner_id=?
      AND state IN ('active','frozen') AND expires_at_ms<=?`).bind(now, ownerId, now),
    runtime().DB.prepare(`UPDATE character_purchased_lots
      SET state=CASE WHEN ?=1 AND fulfilled_at_ms<=? THEN 'active' ELSE 'frozen' END,updated_at=?
      WHERE owner_id=? AND state IN ('active','frozen') AND expires_at_ms>? AND reversal_state='none'`)
      .bind(paid ? 1 : 0, now, now, ownerId, now),
    runtime().DB.prepare(`UPDATE character_grants SET state='expired',updated_at=? WHERE owner_id=? AND kind='included'
      AND state='active' AND period_end_ms<=?`).bind(now, ownerId, now),
  ]);
}

async function candidates(ownerId: string, mode: WalletMode, projection: Projection | null, now: number): Promise<Candidate[]> {
  if (mode === "free") {
    const result = await runtime().DB.prepare(`SELECT 'free_grant' AS kind,id,original_amount-reserved_amount-settled_amount AS available,0 AS ordinal
      FROM character_grants WHERE owner_id=? AND kind='free' AND state='active' AND measurement_version=?
      AND original_amount>reserved_amount+settled_amount`).bind(ownerId, CHARACTER_MEASUREMENT_VERSION).all<Candidate>();
    return result.results ?? [];
  }
  if (!projection?.entitlement_id) return [];
  const result = await runtime().DB.prepare(`SELECT kind,id,available,
      ROW_NUMBER() OVER (ORDER BY source_order,expiry,purchased,id)-1 AS ordinal FROM (
        SELECT 'included_grant' AS kind,g.id,g.original_amount-g.reserved_amount-g.settled_amount AS available,
          0 AS source_order,g.period_end_ms AS expiry,0 AS purchased
        FROM character_grants g WHERE g.owner_id=? AND g.kind='included' AND g.state='active'
          AND g.entitlement_id=? AND g.application_app_key=? AND g.period_start=? AND g.period_end=?
          AND g.measurement_version=? AND g.original_amount>g.reserved_amount+g.settled_amount
        UNION ALL
        SELECT 'purchased_lot',l.id,l.original_amount-l.reserved_amount-l.settled_amount,
          1,l.expires_at_ms,l.fulfilled_at_ms
        FROM character_purchased_lots l WHERE l.owner_id=? AND l.application_app_key=? AND l.state='active'
          AND l.reversal_state='none' AND l.fulfilled_at_ms<=? AND l.expires_at_ms>? AND l.measurement_version=?
          AND l.original_amount>l.reserved_amount+l.settled_amount
      ) ORDER BY source_order,expiry,purchased,id`)
    .bind(ownerId, projection.entitlement_id, projection.application_app_key, projection.period_start, projection.period_end,
      CHARACTER_MEASUREMENT_VERSION, ownerId, projection.application_app_key, now, now, CHARACTER_MEASUREMENT_VERSION).all<Candidate>();
  return result.results ?? [];
}

function allocate(rows: Candidate[], amount: number): Allocation[] {
  let remaining = amount; const allocations: Allocation[] = [];
  for (const row of rows) {
    if (remaining <= 0) break;
    const quantity = Math.min(remaining, row.available);
    if (quantity > 0) allocations.push({ ...row, quantity });
    remaining -= quantity;
  }
  if (remaining > 0) throw new WalletError("QUOTA_EXCEEDED", "AI character allowance reached. Shorten the text or review your usage.", 429);
  return allocations;
}

const reservationByKey = (ownerId: string, key: string) => runtime().DB.prepare(`SELECT id,owner_id,idempotency_key,request_fingerprint,operation,
  source_characters,current_hold,settled_amount,state,lease_deadline,fencing_token,mode,entitlement_id,entitlement_period_start,
  entitlement_period_end,authority_revision,application_app_key,eligibility_snapshot_json,result_reference FROM character_reservations WHERE owner_id=? AND idempotency_key=?`)
  .bind(ownerId, key).first<ReservationRow>();

export type ReserveInput = { ownerId: string; idempotencyKey: string; fingerprint: string; operation: string; sourceCharacters: number; hold?: number; now?: number };
export async function reserveCharacters(input: ReserveInput): Promise<{ reservation: ReservationRow; created: boolean }> {
  const now = input.now ?? Date.now(); const hold = input.hold ?? input.sourceCharacters;
  positiveInteger(input.sourceCharacters, "sourceCharacters"); positiveInteger(hold, "hold");
  if (hold < input.sourceCharacters) throw new WalletError("WALLET_FACT_INVALID", "The initial hold cannot be below the source charge.");
  const previous = await reservationByKey(input.ownerId, input.idempotencyKey);
  if (previous) {
    if (previous.request_fingerprint !== input.fingerprint) throw new WalletError("IDEMPOTENCY_CONFLICT", "This request key belongs to a different customer operation.");
    return { reservation: previous, created: false };
  }
  await ensureFreeGrant(input.ownerId, now);
  const projection = await activeProjection(input.ownerId, now);
  if (projection) await issueIncludedGrantFromProjection(input.ownerId, now);
  const mode: WalletMode = projection ? "paid" : "free";
  await refreshLotStates(input.ownerId, mode === "paid", now);
  const eligible = await candidates(input.ownerId, mode, projection, now);
  const plan = allocate(eligible, hold);
  const id = crypto.randomUUID(); const lease = now + EXECUTION_LEASE_MS; const statements: D1PreparedStatement[] = [];
  const authorityGuard = mode === "paid" ? `EXISTS (SELECT 1 FROM mkl_entitlement_projection p JOIN external_identity_link l
    ON l.id=p.identity_link_id AND l.user_id=p.user_id AND l.issuer=p.issuer AND l.subject=p.subject AND l.organization_id=p.organization_id
    WHERE p.user_id=? AND p.entitlement_id=? AND p.scope_revision=? AND p.authority_payload_hash=? AND p.invalidated_at IS NULL
      AND p.fresh_until>? AND p.period_start<=? AND p.access_deadline>?)`
    : `EXISTS (SELECT 1 FROM character_wallet_account a JOIN character_grants g ON g.owner_id=a.owner_id AND g.kind='free'
      WHERE a.owner_id=? AND a.free_grant_state IN ('issued','reconciled') AND g.state='active')`;
  const guardValues = mode === "paid"
    ? [input.ownerId, projection!.entitlement_id, projection!.scope_revision, projection!.authority_payload_hash, now, new Date(now).toISOString(), new Date(now).toISOString()]
    : [input.ownerId];
  statements.push(runtime().DB.prepare(`INSERT INTO character_reservations (id,owner_id,idempotency_key,request_fingerprint,operation,
      source_characters,measurement_version,current_hold,settled_amount,state,lease_deadline,fencing_token,mode,entitlement_id,
      application_app_key,entitlement_period_start,entitlement_period_end,authority_revision,eligibility_snapshot_json,created_at,updated_at)
    SELECT ?,?,?,?,?,?,?,?,0,'allocating',?,1,?,?,?,?,?,?,?,?,? WHERE ${authorityGuard}
      AND NOT EXISTS (SELECT 1 FROM character_reservations WHERE owner_id=? AND idempotency_key=?)`)
    .bind(id, input.ownerId, input.idempotencyKey, input.fingerprint, input.operation, input.sourceCharacters,
      CHARACTER_MEASUREMENT_VERSION, hold, lease, mode, projection?.entitlement_id ?? null, projection?.application_app_key ?? null,
      projection?.period_start ?? null, projection?.period_end ?? null, projection?.scope_revision ?? null,
      // Capture every source eligible at creation, not only the sources needed
      // by the initial hold. An exact-output extension may use this fixed set,
      // but can never migrate into a later fulfillment or entitlement period.
      JSON.stringify(eligible.map(({ kind, id }) => ({ kind, id }))), now, now, ...guardValues, input.ownerId, input.idempotencyKey));
  for (const item of plan) statements.push(runtime().DB.prepare(`INSERT INTO character_allocations (id,reservation_id,owner_id,source_kind,
    source_id,ordinal,reserved_amount,settled_amount,released_amount,measurement_version,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,0,0,?,?,?)`).bind(crypto.randomUUID(), id, input.ownerId, item.kind, item.id, item.ordinal, item.quantity, CHARACTER_MEASUREMENT_VERSION, now, now));
  statements.push(runtime().DB.prepare("UPDATE character_reservations SET state='reserved',updated_at=? WHERE id=? AND state='allocating'").bind(now, id));
  statements.push(runtime().DB.prepare(`INSERT INTO character_wallet_events (id,owner_id,event_type,reservation_id,quantity,causal_reference,metadata_json,created_at)
    VALUES (?,?,'reservation_created',?,?,?,'{}',?)`).bind(crypto.randomUUID(), input.ownerId, id, hold, input.idempotencyKey, now));
  try { await runBatch(statements); }
  catch {
    const raced = await reservationByKey(input.ownerId, input.idempotencyKey);
    if (raced) {
      if (raced.request_fingerprint !== input.fingerprint) throw new WalletError("IDEMPOTENCY_CONFLICT", "This request key belongs to a different customer operation.");
      return { reservation: raced, created: false };
    }
    throw new WalletError("QUOTA_EXCEEDED", "The wallet changed while this request was reserving characters. Try again.", 429);
  }
  const reservation = await reservationByKey(input.ownerId, input.idempotencyKey);
  if (!reservation) throw new WalletError("WALLET_UNAVAILABLE", "The character reservation could not be persisted.", 503);
  return { reservation, created: true };
}

async function reservationAllocations(id: string): Promise<Array<{ id: string; source_kind: AllocationKind; source_id: string; ordinal: number; reserved_amount: number; settled_amount: number; released_amount: number }>> {
  const result = await runtime().DB.prepare(`SELECT id,source_kind,source_id,ordinal,reserved_amount,settled_amount,released_amount
    FROM character_allocations WHERE reservation_id=? ORDER BY ordinal`).bind(id).all<{ id: string; source_kind: AllocationKind; source_id: string; ordinal: number; reserved_amount: number; settled_amount: number; released_amount: number }>();
  return result.results ?? [];
}

async function snapshotCandidates(reservation: ReservationRow): Promise<Candidate[]> {
  let snapshot: Array<{ kind: AllocationKind; id: string }>;
  try { snapshot = JSON.parse(reservation.eligibility_snapshot_json) as Array<{ kind: AllocationKind; id: string }>; }
  catch { throw new WalletError("WALLET_INVARIANT", "Reservation eligibility snapshot is invalid.", 503); }
  const order = new Map(snapshot.map((item, index) => [`${item.kind}:${item.id}`, index]));
  const result = await runtime().DB.prepare(`SELECT kind,id,available FROM (
      SELECT CASE WHEN g.kind='free' THEN 'free_grant' ELSE 'included_grant' END AS kind,g.id,
        g.original_amount-g.reserved_amount-g.settled_amount AS available
      FROM character_grants g WHERE g.owner_id=? AND g.measurement_version=?
        AND ((g.kind='free' AND g.state='active' AND ?='free') OR
          (g.kind='included' AND ?='paid' AND g.state IN ('active','expired') AND g.entitlement_id=?
            AND g.application_app_key=? AND g.period_start=? AND g.period_end=? AND g.period_end_ms>?))
      UNION ALL
      SELECT 'purchased_lot',l.id,l.original_amount-l.reserved_amount-l.settled_amount
      FROM character_purchased_lots l WHERE l.owner_id=? AND ?='paid' AND l.application_app_key=?
        AND l.state IN ('active','frozen','expired') AND l.reversal_state='none' AND l.expires_at_ms>?
        AND l.fulfilled_at_ms<=? AND l.measurement_version=?
    ) WHERE available>0`)
    .bind(reservation.owner_id, CHARACTER_MEASUREMENT_VERSION, reservation.mode, reservation.mode, reservation.entitlement_id,
      reservation.application_app_key, reservation.entitlement_period_start, reservation.entitlement_period_end, reservation.created_at,
      reservation.owner_id, reservation.mode, reservation.application_app_key, reservation.created_at, reservation.created_at,
      CHARACTER_MEASUREMENT_VERSION).all<{ kind: AllocationKind; id: string; available: number }>();
  return (result.results ?? []).filter((row) => order.has(`${row.kind}:${row.id}`))
    .map((row) => ({ ...row, ordinal: order.get(`${row.kind}:${row.id}`)! }))
    .sort((left, right) => left.ordinal - right.ordinal);
}

export async function extendReservation(id: string, exactCharge: number, now = Date.now()): Promise<void> {
  positiveInteger(exactCharge, "exactCharge");
  const reservation = await runtime().DB.prepare(`SELECT id,owner_id,current_hold,state,lease_deadline,fencing_token,mode,entitlement_id,
    application_app_key,entitlement_period_start,entitlement_period_end,authority_revision,eligibility_snapshot_json,created_at FROM character_reservations WHERE id=?`).bind(id).first<ReservationRow>();
  if (!reservation || reservation.state !== "reserved" || reservation.lease_deadline < now) throw new WalletError("RESERVATION_EXPIRED", "The character reservation can no longer be extended.", 409);
  if (exactCharge <= reservation.current_hold) return;
  const existing = await reservationAllocations(id); const nextOrdinal = existing.reduce((max, row) => Math.max(max, row.ordinal), -1) + 1;
  // OD-8 permits a pre-expiry operation to finish against the exact source set
  // captured at reservation creation. Newly fulfilled lots and new entitlement
  // periods are deliberately absent from this snapshot; verified reversals are
  // still excluded and fence the reservation.
  const rows = await snapshotCandidates(reservation);
  const delta = exactCharge - reservation.current_hold; const plan = allocate(rows, delta);
  const bySource = new Map(existing.map((row) => [`${row.source_kind}:${row.source_id}`, row]));
  let ordinal = nextOrdinal; const statements: D1PreparedStatement[] = [runtime().DB.prepare(`UPDATE character_reservations SET state='extending',current_hold=?,updated_at=?
    WHERE id=? AND state='reserved' AND current_hold=? AND fencing_token=? AND lease_deadline>=?`).bind(exactCharge, now, id, reservation.current_hold, reservation.fencing_token, now)];
  for (const item of plan) {
    const allocated = bySource.get(`${item.kind}:${item.id}`);
    if (allocated) statements.push(runtime().DB.prepare(`UPDATE character_allocations SET reserved_amount=reserved_amount+?,updated_at=? WHERE id=?`).bind(item.quantity, now, allocated.id));
    else statements.push(runtime().DB.prepare(`INSERT INTO character_allocations (id,reservation_id,owner_id,source_kind,source_id,ordinal,
      reserved_amount,settled_amount,released_amount,measurement_version,created_at,updated_at) VALUES (?,?,?,?,?,?,?,0,0,?,?,?)`)
      .bind(crypto.randomUUID(), id, reservation.owner_id, item.kind, item.id, ordinal++, item.quantity, CHARACTER_MEASUREMENT_VERSION, now, now));
  }
  statements.push(runtime().DB.prepare("UPDATE character_reservations SET state='reserved',updated_at=? WHERE id=? AND state='extending' AND fencing_token=? AND current_hold=?")
    .bind(now, id, reservation.fencing_token, exactCharge));
  statements.push(runtime().DB.prepare(`INSERT INTO character_wallet_events (id,owner_id,event_type,reservation_id,quantity,causal_reference,metadata_json,created_at)
    SELECT ?,?,'reservation_extended',?,?,?,'{}',? WHERE EXISTS (SELECT 1 FROM character_reservations WHERE id=? AND current_hold=?)`)
    .bind(crypto.randomUUID(), reservation.owner_id, id, delta, `hold:${exactCharge}`, now, id, exactCharge));
  try { await runBatch(statements); }
  catch { throw new WalletError("QUOTA_EXCEEDED", "There is not enough character balance for the validated output.", 429); }
  const confirmed = await runtime().DB.prepare("SELECT current_hold,state FROM character_reservations WHERE id=?").bind(id).first<{ current_hold: number; state: string }>();
  if (confirmed?.state !== "reserved" || confirmed.current_hold !== exactCharge) throw new WalletError("RESERVATION_EXPIRED", "The character reservation changed before it could be extended.");
}

export async function settleReservation(id: string, exactCharge: number, resultReference: string, providerRequestId?: string | null, now = Date.now(), commitStatements: D1PreparedStatement[] = []): Promise<void> {
  positiveInteger(exactCharge, "exactCharge");
  const reservation = await runtime().DB.prepare("SELECT * FROM character_reservations WHERE id=?").bind(id).first<ReservationRow>();
  if (!reservation) throw new WalletError("RESERVATION_NOT_FOUND", "Character reservation not found.", 404);
  if (exactCharge < reservation.source_characters) throw new WalletError("WALLET_FACT_INVALID", "The exact charge cannot be below the measured source characters.");
  if (reservation.state === "settled") {
    if (reservation.settled_amount === exactCharge && reservation.result_reference === resultReference) return;
    throw new WalletError("SETTLEMENT_CONFLICT", "The reservation already has another terminal result.");
  }
  if (reservation.state !== "reserved" || reservation.lease_deadline < now) throw new WalletError("RESERVATION_EXPIRED", "The character reservation lease expired before delivery.");
  if (exactCharge > reservation.current_hold) await extendReservation(id, exactCharge, now);
  const fresh = await runtime().DB.prepare("SELECT fencing_token,current_hold,state,lease_deadline FROM character_reservations WHERE id=?").bind(id).first<{ fencing_token: number; current_hold: number; state: string; lease_deadline: number }>();
  if (!fresh || fresh.state !== "reserved" || fresh.lease_deadline < now || exactCharge > fresh.current_hold) throw new WalletError("RESERVATION_EXPIRED", "The reservation is no longer settleable.");
  const allocations = await reservationAllocations(id); let remaining = exactCharge;
  const targets = allocations.map((allocation) => { const settled = Math.min(remaining, allocation.reserved_amount); remaining -= settled; return { ...allocation, settle: settled, release: allocation.reserved_amount - settled }; });
  if (remaining !== 0) throw new WalletError("WALLET_INVARIANT", "Reservation allocations do not cover settlement.", 503);
  const statements: D1PreparedStatement[] = [runtime().DB.prepare(`UPDATE character_reservations SET state='settling',updated_at=?
    WHERE id=? AND state='reserved' AND current_hold=? AND fencing_token=? AND lease_deadline>=?`).bind(now, id, fresh.current_hold, fresh.fencing_token, now)];
  // Allocation order settles from the front; therefore excess is released from
  // the final allocation(s), preserving the required reverse-release rule.
  for (const target of targets) statements.push(runtime().DB.prepare(`UPDATE character_allocations SET settled_amount=?,released_amount=?,updated_at=? WHERE id=?`)
    .bind(target.settle, target.release, now, target.id));
  statements.push(...commitStatements);
  statements.push(runtime().DB.prepare(`UPDATE character_reservations SET state='settled',settled_amount=?,provider_request_id=?,result_reference=?,settled_at=?,updated_at=?
    WHERE id=? AND state='settling' AND fencing_token=?`).bind(exactCharge, providerRequestId ?? null, resultReference, now, now, id, fresh.fencing_token));
  statements.push(runtime().DB.prepare(`INSERT INTO character_wallet_events (id,owner_id,event_type,reservation_id,quantity,causal_reference,metadata_json,created_at)
    VALUES (?,?,'reservation_settled',?,?,?,'{}',?)`).bind(crypto.randomUUID(), reservation.owner_id, id, exactCharge, resultReference, now));
  try { await runBatch(statements); }
  catch { throw new WalletError("SETTLEMENT_RETRY_REQUIRED", "Settlement did not commit; the result must not be delivered yet.", 503); }
}

export async function releaseReservation(id: string, reason: string, now = Date.now(), expectedFence?: number): Promise<boolean> {
  const reservation = await runtime().DB.prepare("SELECT * FROM character_reservations WHERE id=?").bind(id).first<ReservationRow>();
  if (!reservation || ["settled", "released", "voided"].includes(reservation.state)) return false;
  if (reservation.state !== "reserved" || (expectedFence !== undefined && reservation.fencing_token !== expectedFence)) return false;
  const allocations = await reservationAllocations(id); const nextFence = reservation.fencing_token + 1;
  const statements: D1PreparedStatement[] = [runtime().DB.prepare(`UPDATE character_reservations SET state='releasing',fencing_token=?,failure_reason=?,updated_at=?
    WHERE id=? AND state='reserved' AND current_hold=? AND fencing_token=?`).bind(nextFence, reason.slice(0, 120), now, id, reservation.current_hold, reservation.fencing_token)];
  for (const allocation of allocations) statements.push(runtime().DB.prepare(`UPDATE character_allocations SET released_amount=reserved_amount-settled_amount,updated_at=? WHERE id=?`).bind(now, allocation.id));
  statements.push(runtime().DB.prepare(`UPDATE character_reservations SET state='released',released_at=?,updated_at=? WHERE id=? AND state='releasing' AND fencing_token=?`).bind(now, now, id, nextFence));
  statements.push(runtime().DB.prepare(`INSERT INTO character_wallet_events (id,owner_id,event_type,reservation_id,quantity,causal_reference,metadata_json,created_at)
    VALUES (?,?,'reservation_released',?,?,?,'{}',?)`).bind(crypto.randomUUID(), reservation.owner_id, id, reservation.current_hold - reservation.settled_amount, reason.slice(0, 120), now));
  try { await runBatch(statements); return true; }
  catch { throw new WalletError("RELEASE_RETRY_REQUIRED", "Reservation release did not commit and must be retried.", 503); }
}

export async function reapExpiredReservations(now = Date.now(), limit = 100): Promise<number> {
  const rows = await runtime().DB.prepare(`SELECT id,fencing_token FROM character_reservations WHERE state='reserved' AND lease_deadline<?
    ORDER BY lease_deadline,id LIMIT ?`).bind(now, limit).all<{ id: string; fencing_token: number }>();
  let released = 0;
  for (const row of rows.results ?? []) if (await releaseReservation(row.id, "execution_lease_expired", now, row.fencing_token)) released++;
  return released;
}

export type VerifiedFulfillment = {
  ownerId: string; identityLinkId: string; fulfillmentId: string; customerBindingHash: string;
  applicationAppKey: string; catalogItemId: string; offerId?: string | null; offerVersion?: string | null;
  quantity: number; fulfilledAt: string; expiresAt: string; verificationRevision: string; verificationPayloadHash: string;
};
/** Internal B5-facing primitive. There is intentionally no HTTP route. */
export async function acceptVerifiedPurchasedLot(fact: VerifiedFulfillment, now = Date.now()): Promise<string> {
  positiveInteger(fact.quantity, "quantity"); const fulfilledAt = validInstant(fact.fulfilledAt, "fulfilledAt"); const expiresAt = validInstant(fact.expiresAt, "expiresAt");
  if (expiresAt <= fulfilledAt) throw new WalletError("WALLET_FACT_INVALID", "Purchased-lot expiry must be authoritative and after fulfillment.");
  const binding = await runtime().DB.prepare(`SELECT l.id FROM external_identity_link l WHERE l.id=? AND l.user_id=?
    AND EXISTS (SELECT 1 FROM mkl_entitlement_projection p WHERE p.user_id=l.user_id AND p.identity_link_id=l.id
      AND p.application_app_key=? AND p.catalog_item_id=?)`).bind(fact.identityLinkId, fact.ownerId, fact.applicationAppKey, fact.catalogItemId).first();
  if (!binding) throw new WalletError("FULFILLMENT_BINDING_MISMATCH", "Verified fulfillment does not match the local MKL application binding.");
  const existing = await runtime().DB.prepare("SELECT id,owner_id,verification_payload_hash FROM character_purchased_lots WHERE application_app_key=? AND fulfillment_id=?")
    .bind(fact.applicationAppKey, fact.fulfillmentId).first<{ id: string; owner_id: string; verification_payload_hash: string }>();
  if (existing) {
    if (existing.owner_id !== fact.ownerId || existing.verification_payload_hash !== fact.verificationPayloadHash) throw new WalletError("FULFILLMENT_REPLAY_CONFLICT", "The fulfillment identity was replayed with different facts.");
    return existing.id;
  }
  const id = crypto.randomUUID();
  try {
    await runBatch([
      runtime().DB.prepare(`INSERT INTO character_purchased_lots (id,owner_id,identity_link_id,fulfillment_id,customer_binding_hash,
        application_app_key,catalog_item_id,offer_id,offer_version,original_amount,reserved_amount,settled_amount,fulfilled_at,expires_at,
        fulfilled_at_ms,expires_at_ms,verification_revision,verification_payload_hash,state,reversal_state,measurement_version,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,0,0,?,?,?,?,?,?,'frozen','none',?,?,?)`)
        .bind(id, fact.ownerId, fact.identityLinkId, fact.fulfillmentId, fact.customerBindingHash, fact.applicationAppKey, fact.catalogItemId,
          fact.offerId ?? null, fact.offerVersion ?? null, fact.quantity, new Date(fulfilledAt).toISOString(), new Date(expiresAt).toISOString(),
          fulfilledAt, expiresAt, fact.verificationRevision, fact.verificationPayloadHash, CHARACTER_MEASUREMENT_VERSION, now, now),
      runtime().DB.prepare(`INSERT INTO character_wallet_events (id,owner_id,event_type,lot_id,quantity,causal_reference,metadata_json,created_at)
        VALUES (?,?,'purchased_lot_accepted',?,?,?,? ,?)`).bind(crypto.randomUUID(), fact.ownerId, id, fact.quantity, fact.fulfillmentId,
          JSON.stringify({ offerId: fact.offerId ?? null, offerVersion: fact.offerVersion ?? null, verificationRevision: fact.verificationRevision }), now),
    ]);
    return id;
  } catch (error) {
    const raced = await runtime().DB.prepare("SELECT id,owner_id,verification_payload_hash FROM character_purchased_lots WHERE application_app_key=? AND fulfillment_id=?")
      .bind(fact.applicationAppKey, fact.fulfillmentId).first<{ id: string; owner_id: string; verification_payload_hash: string }>();
    if (raced?.owner_id === fact.ownerId && raced.verification_payload_hash === fact.verificationPayloadHash) return raced.id;
    throw error;
  }
}

export type VerifiedCorrection = { ownerId: string; lotId: string; correctionId: string; revision: number; kind: "reversal" | "refund"; payloadHash: string; reasonCode: string };
export async function applyVerifiedLotCorrection(fact: VerifiedCorrection, now = Date.now()): Promise<void> {
  if (!Number.isSafeInteger(fact.revision) || fact.revision < 0) throw new WalletError("CORRECTION_INVALID", "Correction revision is invalid.");
  const lot = await runtime().DB.prepare("SELECT owner_id,reversal_state FROM character_purchased_lots WHERE id=?").bind(fact.lotId).first<{ owner_id: string; reversal_state: string }>();
  if (!lot || lot.owner_id !== fact.ownerId) throw new WalletError("LOT_NOT_FOUND", "Purchased lot not found.", 404);
  const replay = await runtime().DB.prepare("SELECT correction_revision,kind,verification_payload_hash FROM character_lot_corrections WHERE lot_id=? AND correction_id=?")
    .bind(fact.lotId, fact.correctionId).first<{ correction_revision: number; kind: string; verification_payload_hash: string }>();
  if (replay) {
    if (replay.correction_revision === fact.revision && replay.kind === fact.kind && replay.verification_payload_hash === fact.payloadHash) return;
    throw new WalletError("CORRECTION_CONFLICT", "Correction identity was replayed with different facts.");
  }
  const latest = await runtime().DB.prepare("SELECT MAX(correction_revision) AS revision FROM character_lot_corrections WHERE lot_id=?").bind(fact.lotId).first<{ revision: number | null }>();
  if (latest?.revision !== null && latest?.revision !== undefined && fact.revision <= latest.revision) throw new WalletError("CORRECTION_OUT_OF_ORDER", "Out-of-order correction requires reconciliation.");
  const nextState = fact.kind === "reversal" ? "reversed" : "partially_refunded";
  const statements: D1PreparedStatement[] = [
    runtime().DB.prepare(`UPDATE character_reservations SET state='releasing',fencing_token=fencing_token+1,failure_reason=?,updated_at=?
      WHERE state='reserved' AND id IN (SELECT reservation_id FROM character_allocations WHERE source_kind='purchased_lot' AND source_id=?)`)
      .bind(`verified_${fact.kind}:${fact.reasonCode}`.slice(0, 120), now, fact.lotId),
    runtime().DB.prepare(`UPDATE character_allocations SET released_amount=reserved_amount-settled_amount,updated_at=?
      WHERE reservation_id IN (SELECT id FROM character_reservations WHERE state='releasing')
        AND EXISTS (SELECT 1 FROM character_allocations hit WHERE hit.reservation_id=character_allocations.reservation_id
          AND hit.source_kind='purchased_lot' AND hit.source_id=?)`).bind(now, fact.lotId),
    runtime().DB.prepare(`UPDATE character_reservations SET state='released',released_at=?,updated_at=?
      WHERE state='releasing' AND id IN (SELECT reservation_id FROM character_allocations WHERE source_kind='purchased_lot' AND source_id=?)`).bind(now, now, fact.lotId),
    runtime().DB.prepare(`INSERT INTO character_wallet_events (id,owner_id,event_type,reservation_id,quantity,causal_reference,metadata_json,created_at)
      SELECT lower(hex(randomblob(16))),r.owner_id,'reservation_released',r.id,r.current_hold-r.settled_amount,?,'{}',?
      FROM character_reservations r WHERE r.state='released' AND r.released_at=? AND r.failure_reason=?
        AND r.id IN (SELECT reservation_id FROM character_allocations WHERE source_kind='purchased_lot' AND source_id=?)`)
      .bind(`correction:${fact.correctionId}`, now, now, `verified_${fact.kind}:${fact.reasonCode}`.slice(0, 120), fact.lotId),
    runtime().DB.prepare(`UPDATE character_purchased_lots SET state='reversed',reversal_state=?,updated_at=? WHERE id=? AND owner_id=?`)
      .bind(nextState, now, fact.lotId, fact.ownerId),
    runtime().DB.prepare(`INSERT INTO character_lot_corrections (id,lot_id,owner_id,correction_id,correction_revision,kind,verification_payload_hash,reason_code,created_at)
      VALUES (?,?,?,?,?,?,?,?,?)`).bind(crypto.randomUUID(), fact.lotId, fact.ownerId, fact.correctionId, fact.revision, fact.kind, fact.payloadHash, fact.reasonCode, now),
    runtime().DB.prepare(`INSERT INTO character_wallet_events (id,owner_id,event_type,lot_id,causal_reference,metadata_json,created_at)
      VALUES (?,?,'purchased_lot_corrected',?,?,?,?)`).bind(crypto.randomUUID(), fact.ownerId, fact.lotId, fact.correctionId,
        JSON.stringify({ kind: fact.kind, revision: fact.revision, reasonCode: fact.reasonCode, oldState: lot.reversal_state, newState: nextState }), now),
  ];
  try { await runBatch(statements); }
  catch { throw new WalletError("CORRECTION_RECONCILIATION_REQUIRED", "The verified correction could not be applied atomically.", 409); }
}

export type WalletSummary = {
  measurementVersion: typeof CHARACTER_MEASUREMENT_VERSION; mode: "free" | "paid" | "unavailable";
  free: { original: number; remaining: number; state: string } | null;
  included: { periodStart: string; periodEnd: string; original: number; reserved: number; settled: number; remaining: number } | null;
  purchased: { available: number; reserved: number; frozen: number; expired: number; settled: number };
  spendableTotal: number;
};
export async function walletSummary(ownerId: string, now = Date.now()): Promise<WalletSummary> {
  await ensureFreeGrant(ownerId, now); const projection = await activeProjection(ownerId, now);
  if (projection) await issueIncludedGrantFromProjection(ownerId, now);
  await refreshLotStates(ownerId, Boolean(projection), now);
  const free = await runtime().DB.prepare(`SELECT original_amount,reserved_amount,settled_amount,state FROM character_grants WHERE owner_id=? AND kind='free'`).bind(ownerId).first<{ original_amount: number; reserved_amount: number; settled_amount: number; state: string }>();
  const included = projection ? await runtime().DB.prepare(`SELECT period_start,period_end,original_amount,reserved_amount,settled_amount FROM character_grants
    WHERE owner_id=? AND kind='included' AND entitlement_id=? AND application_app_key=? AND period_start=? AND period_end=?`).bind(ownerId, projection.entitlement_id, projection.application_app_key, projection.period_start, projection.period_end)
    .first<{ period_start: string; period_end: string; original_amount: number; reserved_amount: number; settled_amount: number }>() : null;
  const lots = await runtime().DB.prepare(`SELECT
      COALESCE(SUM(CASE WHEN state='active' THEN original_amount-reserved_amount-settled_amount ELSE 0 END),0) AS available,
      COALESCE(SUM(reserved_amount),0) AS reserved,
      COALESCE(SUM(settled_amount),0) AS settled,
      COALESCE(SUM(CASE WHEN state='frozen' THEN original_amount-reserved_amount-settled_amount ELSE 0 END),0) AS frozen,
      COALESCE(SUM(CASE WHEN state='expired' THEN original_amount-reserved_amount-settled_amount ELSE 0 END),0) AS expired
    FROM character_purchased_lots WHERE owner_id=?`).bind(ownerId).first<{ available: number; reserved: number; frozen: number; expired: number; settled: number }>();
  const freeSummary = free ? { original: free.original_amount, remaining: Math.max(0, free.original_amount - free.reserved_amount - free.settled_amount), state: free.state } : null;
  const includedSummary = included ? { periodStart: included.period_start, periodEnd: included.period_end, original: included.original_amount,
    reserved: included.reserved_amount, settled: included.settled_amount, remaining: Math.max(0, included.original_amount - included.reserved_amount - included.settled_amount) } : null;
  const purchased = lots ?? { available: 0, reserved: 0, frozen: 0, expired: 0, settled: 0 };
  const mode = projection ? "paid" : freeSummary ? "free" : "unavailable";
  const spendableTotal = mode === "paid" ? (includedSummary?.remaining ?? 0) + purchased.available : mode === "free" ? freeSummary?.remaining ?? 0 : 0;
  return { measurementVersion: CHARACTER_MEASUREMENT_VERSION, mode, free: freeSummary, included: includedSummary, purchased, spendableTotal };
}
