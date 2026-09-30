import { runtime } from "../runtime";
import { auditStatement } from "../audit";
import { LOCAL_APP_KEY, LOCAL_PLAN_VERSION } from "../access/periods";
import { CHARACTER_MEASUREMENT_VERSION, sha256 } from "./measurement";
import { RequestError } from "../http";

// Hibah karakter (UX 2): an admin credits AI characters for support or a trial. It is an ordinary purchased lot
// with catalog item 'admin_grant' and no identity link, so it follows the lot model to the letter: the allocation
// triggers guard every spend, it is spent after the plan's included grant in expiry order, it expires, and, like a
// top-up, it is frozen while no paid plan is running (it never grants a feature or a tier). No new table or trigger.
// Idempotent per request key: the fulfillment id is "admin_grant:<key>", unique per app, so a retried or doubled
// submit returns the first grant instead of crediting twice; the same key with other facts is refused.
export const ADMIN_GRANT_ITEM = "admin_grant";
export const ADMIN_GRANT_MAX = 500_000;
export const ADMIN_GRANT_MAX_DAYS = 365;
const DAY_MS = 86_400_000;

export type AdminGrantInput = { actorId: string; ownerId: string; amount: number; validityDays: number; note: string; requestKey: string; now?: number };
export type AdminGrant = { id: string; amount: number; remaining: number; state: string; grantedAt: string; expiresAt: string };

export async function grantAdminCharacters(input: AdminGrantInput): Promise<{ lotId: string; replayed: boolean; expiresAt: string }> {
  const now = input.now ?? Date.now(); const note = input.note.trim();
  if (!Number.isSafeInteger(input.amount) || input.amount < 1 || input.amount > ADMIN_GRANT_MAX) throw new RequestError("GRANT_INVALID", `Grant between 1 and ${ADMIN_GRANT_MAX} characters.`, 422);
  if (!Number.isSafeInteger(input.validityDays) || input.validityDays < 1 || input.validityDays > ADMIN_GRANT_MAX_DAYS) throw new RequestError("GRANT_INVALID", `Validity is 1 to ${ADMIN_GRANT_MAX_DAYS} days.`, 422);
  if (note.length < 3) throw new RequestError("GRANT_INVALID", "A grant needs a note of at least 3 characters.", 422);
  const fulfillmentId = `${ADMIN_GRANT_ITEM}:${input.requestKey}`;
  // The facts a replay must repeat exactly; the time is not one of them, so a retry never moves the expiry.
  const payloadHash = await sha256(JSON.stringify({ kind: ADMIN_GRANT_ITEM, owner: input.ownerId, actor: input.actorId, amount: input.amount, validityDays: input.validityDays, note }));
  const replay = async () => {
    const existing = await runtime().DB.prepare("SELECT id,owner_id,verification_payload_hash,expires_at FROM character_purchased_lots WHERE application_app_key=? AND fulfillment_id=?")
      .bind(LOCAL_APP_KEY, fulfillmentId).first<{ id: string; owner_id: string; verification_payload_hash: string; expires_at: string }>();
    if (!existing) return null;
    if (existing.owner_id !== input.ownerId || existing.verification_payload_hash !== payloadHash) throw new RequestError("IDEMPOTENCY_CONFLICT", "This grant request key was already used for a different grant.", 409);
    return { lotId: existing.id, replayed: true, expiresAt: existing.expires_at };
  };
  const previous = await replay();
  if (previous) return previous;
  const lotId = crypto.randomUUID(); const expiresMs = now + input.validityDays * DAY_MS;
  const fulfilledAt = new Date(now).toISOString(); const expiresAt = new Date(expiresMs).toISOString();
  const bindingHash = await sha256(JSON.stringify({ owner: input.ownerId, grant: fulfillmentId }));
  const db = runtime().DB;
  try {
    await db.batch([
      db.prepare(`INSERT INTO character_purchased_lots (id,owner_id,identity_link_id,fulfillment_id,customer_binding_hash,application_app_key,
          catalog_item_id,offer_id,offer_version,original_amount,reserved_amount,settled_amount,fulfilled_at,expires_at,fulfilled_at_ms,expires_at_ms,
          verification_revision,verification_payload_hash,state,reversal_state,measurement_version,created_at,updated_at)
        VALUES (?,?,NULL,?,?,?,?,NULL,?,?,0,0,?,?,?,?,?,?,'frozen','none',?,?,?)`)
        .bind(lotId, input.ownerId, fulfillmentId, bindingHash, LOCAL_APP_KEY, ADMIN_GRANT_ITEM, LOCAL_PLAN_VERSION, input.amount, fulfilledAt, expiresAt, now, expiresMs,
          "admin_grant.v1", payloadHash, CHARACTER_MEASUREMENT_VERSION, now, now),
      db.prepare(`INSERT INTO character_wallet_events (id,owner_id,event_type,lot_id,quantity,causal_reference,metadata_json,created_at)
        VALUES (?,?,'admin_grant_issued',?,?,?,?,?)`).bind(crypto.randomUUID(), input.ownerId, lotId, input.amount, fulfillmentId,
          JSON.stringify({ actorId: input.actorId, validityDays: input.validityDays }), now),
      auditStatement(db, { actorId: input.actorId, targetUserId: input.ownerId, action: "wallet.admin.grant", createdAt: now,
        details: { amount: input.amount, validityDays: input.validityDays, expiresAt, note, lotId } }),
    ]);
  } catch (error) {
    // A concurrent submit with the same key won the unique fulfillment id; hand back its grant.
    const raced = await replay();
    if (raced) return raced;
    throw error;
  }
  return { lotId, replayed: false, expiresAt };
}

// Newest first, for the admin's user detail: what was granted, what is left, and until when.
export async function listAdminGrants(ownerId: string, limit = 20): Promise<AdminGrant[]> {
  const rows = await runtime().DB.prepare(`SELECT id,original_amount,reserved_amount,settled_amount,state,fulfilled_at,expires_at FROM character_purchased_lots
    WHERE owner_id=? AND catalog_item_id=? ORDER BY created_at DESC,id DESC LIMIT ?`).bind(ownerId, ADMIN_GRANT_ITEM, limit)
    .all<{ id: string; original_amount: number; reserved_amount: number; settled_amount: number; state: string; fulfilled_at: string; expires_at: string }>();
  return (rows.results ?? []).map((row) => ({ id: row.id, amount: row.original_amount, remaining: Math.max(0, row.original_amount - row.reserved_amount - row.settled_amount), state: row.state, grantedAt: row.fulfilled_at, expiresAt: row.expires_at }));
}
