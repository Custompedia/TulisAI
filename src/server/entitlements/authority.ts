import { runtime, type RuntimeEnv } from "../runtime";
import type { ExternalIdentityLink } from "../identity/links";
import type { Tier } from "@/lib/plans";

export const ENTITLEMENT_FRESHNESS_MS = 15 * 60 * 1000;
export const SUPPORTED_PLAN_VERSION = "pricing-v1";
const STATUSES = new Set(["pending", "active", "suspended", "revoked", "expired"]);
const PLANS = new Set<Tier>(["plus", "pro", "max"]);

export type AuthorityProvenance = {
  clientId: string;
  appKey: string;
  catalogItemId: string;
  issuer: string;
  subject: string;
  organizationId: string;
};

export type NormalizedCandidate = {
  entitlement_id: string;
  status: string;
  plan_code: Exclude<Tier, "free">;
  plan_version: typeof SUPPORTED_PLAN_VERSION;
  period_start: string;
  period_end: string;
  access_deadline: string;
  commercial_kind: "access";
  created_at: string;
};

export type NormalizedAuthority = {
  revision: number;
  serverTime: string;
  application: { client_id: string; app_key: string; catalog_item_id: string };
  holder: { subject: string; organization_id: string };
  candidates: NormalizedCandidate[];
  active: NormalizedCandidate | null;
  payloadHash: string;
};

export class AuthorityError extends Error {
  constructor(public code: string, message: string, public status = 409) {
    super(message); this.name = "AuthorityError";
  }
}

const object = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new AuthorityError("authority_malformed", `${field} is required.`);
  return value;
}

function instant(value: unknown, field: string): string {
  if (typeof value !== "string" || !/(?:Z|[+-]\d\d:\d\d)$/i.test(value)) throw new AuthorityError("authority_malformed", `${field} must be an ISO instant.`);
  const millis = Date.parse(value);
  if (!Number.isFinite(millis)) throw new AuthorityError("authority_malformed", `${field} must be an ISO instant.`);
  return new Date(millis).toISOString();
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Parse the complete MKL candidate set. Compatibility singleton fields are
 * intentionally never read: they are not conflict-complete authority.
 */
export async function normalizeAuthority(input: unknown, expected: AuthorityProvenance): Promise<NormalizedAuthority> {
  const root = object(input);
  if (!root) throw new AuthorityError("authority_malformed", "MKL entitlement authority must be an object.");
  if (root.access_entitlements_complete !== true) throw new AuthorityError("authority_incomplete", "MKL did not return a complete entitlement candidate set.");
  const revision = root.access_entitlements_revision;
  if (!Number.isSafeInteger(revision) || Number(revision) < 0) throw new AuthorityError("authority_revision_invalid", "MKL entitlement revision is invalid.");
  if (root.cancellation_semantics !== "no_separate_cancellation_state") throw new AuthorityError("authority_malformed", "MKL cancellation semantics are unsupported.");

  const application = object(root.application); const holder = object(root.holder);
  if (!application || !holder) throw new AuthorityError("authority_provenance_mismatch", "MKL authority provenance is missing.");
  const actualApplication = {
    client_id: requiredString(application.client_id, "application.client_id"),
    app_key: requiredString(application.app_key, "application.app_key"),
    catalog_item_id: requiredString(application.catalog_item_id, "application.catalog_item_id"),
  };
  const actualHolder = {
    subject: requiredString(holder.subject, "holder.subject"),
    organization_id: requiredString(holder.organization_id, "holder.organization_id"),
  };
  if (actualApplication.client_id !== expected.clientId || actualApplication.app_key !== expected.appKey || actualApplication.catalog_item_id !== expected.catalogItemId ||
      actualHolder.subject !== expected.subject || actualHolder.organization_id !== expected.organizationId) {
    throw new AuthorityError("authority_provenance_mismatch", "MKL authority provenance does not match the verified application and identity.");
  }

  const serverTime = instant(root.server_time, "server_time"); const serverMillis = Date.parse(serverTime);
  if (!Array.isArray(root.access_entitlements)) throw new AuthorityError("authority_incomplete", "MKL entitlement candidates are missing.");
  const ids = new Set<string>();
  const candidates = root.access_entitlements.map((value, index): NormalizedCandidate => {
    const row = object(value);
    if (!row) throw new AuthorityError("authority_malformed", `access_entitlements[${index}] is invalid.`);
    const entitlementId = requiredString(row.entitlement_id, `access_entitlements[${index}].entitlement_id`);
    if (ids.has(entitlementId)) throw new AuthorityError("authority_duplicate_candidate", "MKL returned duplicate entitlement IDs.");
    ids.add(entitlementId);
    const status = requiredString(row.status, `access_entitlements[${index}].status`);
    if (!STATUSES.has(status)) throw new AuthorityError("authority_malformed", `Unsupported entitlement status: ${status}.`);
    if (typeof row.active !== "boolean") throw new AuthorityError("authority_malformed", "Entitlement active must be boolean.");
    if (row.commercial_kind !== "access") throw new AuthorityError("authority_malformed", "Only access entitlements may appear in the access candidate set.");
    if (typeof row.plan_code !== "string" || !PLANS.has(row.plan_code as Tier) || row.plan_code === "free") {
      throw new AuthorityError("unsupported_plan", "MKL returned an unsupported paid plan.");
    }
    if (row.plan_version !== SUPPORTED_PLAN_VERSION) throw new AuthorityError("unsupported_plan", "MKL returned an unsupported plan version.");
    if (row.period_start === null || row.period_end === null || row.access_deadline === null) throw new AuthorityError("authority_malformed", "Paid entitlements must be termed.");
    const periodStart = instant(row.period_start, "period_start");
    const periodEnd = instant(row.period_end, "period_end");
    const deadline = instant(row.access_deadline, "access_deadline");
    const createdAt = instant(row.created_at, "created_at");
    if (Date.parse(periodStart) >= Date.parse(periodEnd)) throw new AuthorityError("authority_malformed", "Entitlement period must have positive duration.");
    if (periodEnd !== deadline) throw new AuthorityError("authority_fact_conflict", "MKL period end and access deadline disagree.");
    const derivedActive = status === "active" && serverMillis < Date.parse(deadline);
    if (row.active !== derivedActive) throw new AuthorityError("authority_fact_conflict", "MKL active, status, and deadline facts disagree.");
    if (row.active && serverMillis < Date.parse(periodStart)) throw new AuthorityError("authority_fact_conflict", "A future entitlement period cannot be currently active.");
    return {
      entitlement_id: entitlementId,
      status,
      plan_code: row.plan_code as Exclude<Tier, "free">,
      plan_version: SUPPORTED_PLAN_VERSION,
      period_start: periodStart,
      period_end: periodEnd,
      access_deadline: deadline,
      commercial_kind: "access",
      created_at: createdAt,
    };
  }).sort((left, right) => left.created_at.localeCompare(right.created_at) || left.entitlement_id.localeCompare(right.entitlement_id));

  // Recompute effective state after normalization. Never pick array-first,
  // newest, highest, or most expensive when MKL contains a conflict.
  const active = candidates.filter((candidate) => candidate.status === "active" && serverMillis >= Date.parse(candidate.period_start) && serverMillis < Date.parse(candidate.access_deadline));
  if (active.length > 1) throw new AuthorityError("authority_conflict", "MKL returned multiple effective active access entitlements.");
  const canonical = JSON.stringify({ application: actualApplication, holder: actualHolder, candidates });
  return { revision: Number(revision), serverTime, application: actualApplication, holder: actualHolder, candidates, active: active[0] ?? null, payloadHash: await sha256Hex(canonical) };
}

type ProjectionCheckpoint = {
  scope_revision: number; authority_payload_hash: string; issuer: string; subject: string; organization_id: string;
  application_client_id: string; application_app_key: string; catalog_item_id: string;
};
export type ProjectionAcceptance = "forward" | "replay";

/** Store the projection and replay checkpoint in one atomic row mutation. */
export async function persistAuthority(userId: string, link: ExternalIdentityLink, authority: NormalizedAuthority, verifiedAt = Date.now()): Promise<ProjectionAcceptance> {
  if (!link.organizationId || link.organizationId !== authority.holder.organization_id) throw new AuthorityError("authority_provenance_mismatch", "The verified identity organization changed.");
  const db = runtime().DB; const existing = await db.prepare("SELECT scope_revision,authority_payload_hash,issuer,subject,organization_id,application_client_id,application_app_key,catalog_item_id FROM mkl_entitlement_projection WHERE user_id=?").bind(userId).first<ProjectionCheckpoint>();
  const sameScope = Boolean(existing && existing.issuer === link.issuer && existing.subject === link.subject && existing.organization_id === link.organizationId &&
    existing.application_client_id === authority.application.client_id && existing.application_app_key === authority.application.app_key && existing.catalog_item_id === authority.application.catalog_item_id);
  if (sameScope && existing && authority.revision < existing.scope_revision) throw new AuthorityError("stale_authority", "An older MKL authority revision was rejected.");
  if (sameScope && existing && authority.revision === existing.scope_revision && authority.payloadHash !== existing.authority_payload_hash) {
    await invalidateProjection(userId, "authority_inconsistency", verifiedAt);
    throw new AuthorityError("authority_inconsistency", "The same MKL revision contained different authority facts.");
  }
  const active = authority.active;
  const freshUntil = verifiedAt + ENTITLEMENT_FRESHNESS_MS;
  const inactiveStatus = !active ? authority.candidates.find((candidate) => candidate.status === "revoked" || candidate.status === "suspended")?.status ?? null : null;
  const invalidatedAt = inactiveStatus ? verifiedAt : null;
  const result = await db.prepare(`INSERT INTO mkl_entitlement_projection (
      user_id,identity_link_id,issuer,subject,organization_id,application_client_id,application_app_key,catalog_item_id,
      scope_revision,authority_payload_hash,entitlement_id,status,plan_code,plan_version,period_start,period_end,access_deadline,
      commercial_kind,entitlement_created_at,server_time,verified_at,fresh_until,invalidated_at,invalidation_reason,updated_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(user_id) DO UPDATE SET
      identity_link_id=excluded.identity_link_id,issuer=excluded.issuer,subject=excluded.subject,organization_id=excluded.organization_id,
      application_client_id=excluded.application_client_id,application_app_key=excluded.application_app_key,catalog_item_id=excluded.catalog_item_id,
      scope_revision=excluded.scope_revision,authority_payload_hash=excluded.authority_payload_hash,entitlement_id=excluded.entitlement_id,
      status=excluded.status,plan_code=excluded.plan_code,plan_version=excluded.plan_version,period_start=excluded.period_start,
      period_end=excluded.period_end,access_deadline=excluded.access_deadline,commercial_kind=excluded.commercial_kind,
      entitlement_created_at=excluded.entitlement_created_at,server_time=excluded.server_time,verified_at=excluded.verified_at,
      fresh_until=excluded.fresh_until,invalidated_at=excluded.invalidated_at,invalidation_reason=excluded.invalidation_reason,updated_at=excluded.updated_at
    WHERE excluded.issuer <> mkl_entitlement_projection.issuer OR excluded.subject <> mkl_entitlement_projection.subject OR
      excluded.organization_id <> mkl_entitlement_projection.organization_id OR excluded.application_client_id <> mkl_entitlement_projection.application_client_id OR
      excluded.application_app_key <> mkl_entitlement_projection.application_app_key OR excluded.catalog_item_id <> mkl_entitlement_projection.catalog_item_id OR
      excluded.scope_revision > mkl_entitlement_projection.scope_revision OR
      (excluded.scope_revision = mkl_entitlement_projection.scope_revision AND excluded.authority_payload_hash = mkl_entitlement_projection.authority_payload_hash)`)
    .bind(userId, link.id, link.issuer, link.subject, link.organizationId, authority.application.client_id, authority.application.app_key,
      authority.application.catalog_item_id, authority.revision, authority.payloadHash, active?.entitlement_id ?? null, active?.status ?? null,
      active?.plan_code ?? null, active?.plan_version ?? null, active?.period_start ?? null, active?.period_end ?? null,
      active?.access_deadline ?? null, active?.commercial_kind ?? null, active?.created_at ?? null, authority.serverTime,
      verifiedAt, freshUntil, invalidatedAt, inactiveStatus, verifiedAt).run();
  if ((result.meta.changes ?? 0) !== 1) {
    const current = await db.prepare("SELECT scope_revision,authority_payload_hash,issuer,subject,organization_id,application_client_id,application_app_key,catalog_item_id FROM mkl_entitlement_projection WHERE user_id=?").bind(userId).first<ProjectionCheckpoint>();
    if (current && authority.revision === current.scope_revision && authority.payloadHash !== current.authority_payload_hash) {
      await invalidateProjection(userId, "authority_inconsistency", verifiedAt);
      throw new AuthorityError("authority_inconsistency", "The same MKL revision contained different authority facts.");
    }
    throw new AuthorityError("stale_authority", "An older MKL authority revision was rejected.");
  }
  return sameScope && existing && authority.revision === existing.scope_revision ? "replay" : "forward";
}

export async function invalidateProjection(userId: string, reason: string, at = Date.now()): Promise<void> {
  await runtime().DB.prepare("UPDATE mkl_entitlement_projection SET invalidated_at=?,invalidation_reason=?,updated_at=? WHERE user_id=?")
    .bind(at, reason.slice(0, 80), at, userId).run();
}

export function configuredAuthorityProvenance(env: RuntimeEnv, identity: { issuer: string; subject: string; organizationId: string }): AuthorityProvenance {
  const clientId = env.MKL_CLIENT_ID?.trim(); const appKey = env.MKL_APP_KEY?.trim(); const catalogItemId = env.MKL_CATALOG_ITEM_ID?.trim();
  if (!clientId || !appKey || !catalogItemId) throw new AuthorityError("MKL_ENTITLEMENTS_NOT_CONFIGURED", "MKL entitlement provenance is not configured.", 503);
  return { clientId, appKey, catalogItemId, issuer: identity.issuer, subject: identity.subject, organizationId: identity.organizationId };
}

/**
 * Refresh only during a fresh, verified OIDC ceremony. The raw ID token is
 * forwarded once to MKL and is never persisted.
 */
export async function refreshMklAuthority(userId: string, link: ExternalIdentityLink, idToken: string, fetcher: typeof fetch = fetch): Promise<ProjectionAcceptance> {
  const env = runtime(); const secret = env.MKL_APP_API_SECRET?.trim();
  if (!secret) throw new AuthorityError("MKL_ENTITLEMENTS_NOT_CONFIGURED", "MKL application API secret is not configured.", 503);
  if (!link.organizationId) throw new AuthorityError("authority_provenance_mismatch", "The verified MKL organization is missing.");
  const expected = configuredAuthorityProvenance(env, { issuer: link.issuer, subject: link.subject, organizationId: link.organizationId });
  let response: Response;
  try {
    response = await fetcher(new URL("/app/v1/entitlements", `${link.issuer}/`), { method: "GET", redirect: "error", headers: {
      accept: "application/json", "MKL-Client-Id": expected.clientId, Authorization: `Bearer ${secret}`, "MKL-Id-Token": idToken,
    } });
  } catch { throw new AuthorityError("MKL_ENTITLEMENTS_UNAVAILABLE", "MKL entitlement authority is temporarily unavailable.", 503); }
  if (!response.ok) throw new AuthorityError("MKL_ENTITLEMENTS_UNAVAILABLE", "MKL entitlement authority rejected the refresh.", 503);
  let body: unknown;
  try { body = await response.json(); }
  catch { await invalidateProjection(userId, "authority_malformed"); throw new AuthorityError("authority_malformed", "MKL returned invalid entitlement JSON."); }
  let authority: NormalizedAuthority;
  try { authority = await normalizeAuthority(body, expected); }
  catch (error) {
    if (error instanceof AuthorityError && error.code !== "stale_authority") await invalidateProjection(userId, error.code);
    throw error;
  }
  return persistAuthority(userId, link, authority);
}
