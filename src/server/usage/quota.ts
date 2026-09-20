import { ConfigurationError, runtime } from '../runtime';
import { isAdminRole } from '../auth/auth';
import { asTier, effectiveLimits, FEATURES, PLAN_LIMITS, TIERS, type Feature, type PlanLimits, type Tier } from '@/lib/plans';

export { TIERS, asTier };
export type { Tier, Feature, PlanLimits };
// AI request caps per period per tier: an abuse safeguard enforced beside the character allowance, which stays the commercial meter.
export const TIER_LIMITS: Record<Exclude<Tier, 'free'>, number> = { plus: 500, pro: 2000, max: 3000 };
export type UsageSummary = {
  period: string; tier: Tier;
  requestsUsed: number; requestLimit: number; requestsRemaining: number;
  charactersUsed: number; characterLimit: number; charactersRemaining: number;
  // 'account' means the allowance is granted once and never refills; 'period' means it resets each entitlement period.
  characterScope: 'account' | 'period';
  unlimited: boolean; limits: PlanLimits; features: readonly Feature[];
  access: AccessSummary;
};
export type AccessAuthority = 'free' | 'mkl' | 'local_admin' | 'legacy_local' | 'support' | 'test';
export type AccessSummary = {
  tier: Tier; plan: Exclude<Tier, 'free'> | null; authority: AccessAuthority;
  commercialActive: boolean; topupEligible: boolean; features: readonly Feature[];
  linked: boolean; fresh: boolean; staleReason: string | null;
  projectionRevision: number | null; verifiedAt: string | null; freshUntil: string | null; periodEnd: string | null; paidUntil: string | null;
};
export type Entitlement = {
  tier: Tier; role: 'user' | 'admin'; unlimited: boolean;
  requestLimit: number; characterLimit: number; oneTime: boolean;
  limits: PlanLimits; features: readonly Feature[];
  override: number | null; characterOverride: number | null;
  access: AccessSummary;
};

export const periodKey = () => new Date().toISOString().slice(0, 7);

export function monthlyLimit(): number {
  const limit = Number(runtime().AI_MONTHLY_REQUEST_LIMIT ?? '100');
  if (!Number.isSafeInteger(limit) || limit < 1) throw new ConfigurationError('AI_MONTHLY_REQUEST_LIMIT must be a positive integer.');
  return limit;
}
export const tierLimit = (tier: Tier): number => (tier === 'free' ? monthlyLimit() : TIER_LIMITS[tier]);

// Free's one-time trial allowance stays deployment-tunable; paid tiers come from the shared catalogue.
export function freeCharacterAllowance(): number {
  const limit = Number(runtime().AI_FREE_CHARACTER_ALLOWANCE ?? String(PLAN_LIMITS.free.includedCharacters));
  if (!Number.isSafeInteger(limit) || limit < 1) throw new ConfigurationError('AI_FREE_CHARACTER_ALLOWANCE must be a positive integer.');
  return limit;
}
export const characterLimit = (tier: Tier): number => (tier === 'free' ? freeCharacterAllowance() : PLAN_LIMITS[tier].includedCharacters);

type AuthorityRow = {
  role: string | null; tier: string | null; ai_limit_override: number | null; ai_character_limit_override: number | null;
  link_id: string | null; projection_revision: number | null; plan_code: string | null; period_start: string | null; period_end: string | null;
  access_deadline: string | null; verified_at: number | null; fresh_until: number | null; invalidated_at: number | null; invalidation_reason: string | null;
};
type GrantRow = { authority: 'support' | 'test'; capabilities_json: string };
const featureList = (value: string): Feature[] => {
  try { const parsed: unknown = JSON.parse(value); return Array.isArray(parsed) ? parsed.filter((item): item is Feature => typeof item === 'string' && (FEATURES as readonly string[]).includes(item) && item !== 'purchase_topup') : []; }
  catch { return []; }
};
const iso = (value: number | null) => value === null ? null : new Date(value).toISOString();

// One resolver owns commercial and non-commercial authority. A linked account
// never falls back to user.tier when its MKL projection is absent or stale.
export async function entitlement(ownerId: string): Promise<Entitlement> {
  const db = runtime().DB; const now = Date.now();
  const [row, grantsResult] = await Promise.all([
    db.prepare(`SELECT u.role,u.tier,u.ai_limit_override,u.ai_character_limit_override,l.id AS link_id,
        p.scope_revision AS projection_revision,p.plan_code,p.period_start,p.period_end,p.access_deadline,
        p.verified_at,p.fresh_until,p.invalidated_at,p.invalidation_reason
      FROM user u LEFT JOIN external_identity_link l ON l.provider='mkl' AND l.user_id=u.id
      LEFT JOIN mkl_entitlement_projection p ON p.user_id=u.id AND p.identity_link_id=l.id
        AND p.issuer=l.issuer AND p.subject=l.subject AND p.organization_id=l.organization_id
      WHERE u.id=? LIMIT 1`).bind(ownerId).first<AuthorityRow>(),
    db.prepare("SELECT authority,capabilities_json FROM capability_grants WHERE user_id=? AND revoked_at IS NULL AND expires_at>?").bind(ownerId, now).all<GrantRow>(),
  ]);
  const role = isAdminRole(row?.role) ? 'admin' : 'user'; const linked = Boolean(row?.link_id);
  const grantRows = grantsResult.results ?? []; const grantFeatures = [...new Set(grantRows.flatMap((grant) => featureList(grant.capabilities_json)))];
  const grantAuthority = grantRows.some((grant) => grant.authority === 'support') ? 'support' : grantRows.some((grant) => grant.authority === 'test') ? 'test' : null;
  const projectedTier = asTier(row?.plan_code); const periodStart = row?.period_start ? Date.parse(row.period_start) : NaN; const periodEnd = row?.access_deadline ? Date.parse(row.access_deadline) : NaN;
  const freshUntil = row?.fresh_until ?? null;
  const projectionFresh = linked && row?.invalidated_at === null && typeof freshUntil === 'number' && now < freshUntil && Number.isFinite(periodStart) && now >= periodStart && Number.isFinite(periodEnd) && now < periodEnd && projectedTier !== 'free';
  let tier: Tier; let authority: AccessAuthority; let commercialActive = false; let baseFeatures: readonly Feature[]; let unlimited = false;
  if (role === 'admin') {
    tier = 'max'; authority = 'local_admin'; unlimited = true; baseFeatures = FEATURES.filter((feature) => feature !== 'purchase_topup');
  } else if (linked) {
    tier = projectionFresh ? projectedTier : 'free'; authority = projectionFresh ? 'mkl' : (grantAuthority ?? 'free'); commercialActive = projectionFresh; baseFeatures = PLAN_LIMITS[tier].features;
  } else {
    tier = asTier(row?.tier); authority = tier === 'free' ? (grantAuthority ?? 'free') : 'legacy_local'; baseFeatures = PLAN_LIMITS[tier].features.filter((feature) => feature !== 'purchase_topup');
  }
  const features = [...new Set([...baseFeatures, ...grantFeatures])];
  const positive = (value: number | null | undefined) => (typeof value === 'number' && value > 0 ? value : null);
  const override = positive(row?.ai_limit_override); const characterOverride = positive(row?.ai_character_limit_override);
  // Admins resolve to the top plan, not to their tier column, so every limit matches the access they already have.
  const limits = { ...effectiveLimits(tier, unlimited), features };
  const staleReason = linked && !projectionFresh ? (row?.invalidation_reason ?? (row?.projection_revision == null ? 'unverified' : (typeof freshUntil === 'number' && now >= freshUntil ? 'stale' : 'inactive'))) : null;
  const access: AccessSummary = {
    tier, plan: commercialActive && tier !== 'free' ? tier : null, authority, commercialActive,
    topupEligible: commercialActive && features.includes('purchase_topup'), features, linked, fresh: projectionFresh,
    staleReason, projectionRevision: row?.projection_revision ?? null, verifiedAt: iso(row?.verified_at ?? null),
    freshUntil: iso(row?.fresh_until ?? null), periodEnd: row?.period_end ?? null,
    paidUntil: commercialActive && typeof freshUntil === 'number' ? new Date(Math.min(freshUntil, periodEnd)).toISOString() : null,
  };
  return {
    tier, role, unlimited, limits, override, characterOverride, access,
    features,
    // A granted override is a refilling quota: only the untouched free allowance is counted once per account.
    oneTime: limits.oneTime && characterOverride === null,
    requestLimit: override ?? tierLimit(tier),
    characterLimit: characterOverride ?? (unlimited ? limits.includedCharacters : characterLimit(tier)),
  };
}

export async function usageSummary(ownerId: string): Promise<UsageSummary> {
  const period = periodKey();
  const rights = await entitlement(ownerId);
  // No status filter: every ledger row is reserved/completed/failed, and charge_characters is already zero for the ones that cost nothing.
  // That keeps both statements on the covering index usage_owner_period_charge_idx, whose owner_id prefix also serves the account-wide sum.
  const [requests, characters] = await Promise.all([
    // Our own repair pass is excluded here for the same reason the request cap ignores it: the writer did not ask for it.
    runtime().DB.prepare("SELECT COUNT(1) AS total FROM usage_ledger WHERE owner_id=? AND period_key=? AND operation<>'repair'").bind(ownerId, period).first<{ total: number }>(),
    rights.oneTime
      ? runtime().DB.prepare('SELECT COALESCE(SUM(charge_characters),0) AS characters FROM usage_ledger WHERE owner_id=?').bind(ownerId).first<{ characters: number }>()
      : runtime().DB.prepare('SELECT COALESCE(SUM(charge_characters),0) AS characters FROM usage_ledger WHERE owner_id=? AND period_key=?').bind(ownerId, period).first<{ characters: number }>(),
  ]);
  const requestsUsed = requests?.total ?? 0; const charactersUsed = characters?.characters ?? 0;
  const remaining = (used: number, limit: number) => (rights.unlimited ? limit : Math.max(0, limit - used));
  return {
    period, tier: rights.tier, unlimited: rights.unlimited, limits: rights.limits, features: rights.features, access: rights.access,
    requestsUsed, requestLimit: rights.requestLimit, requestsRemaining: remaining(requestsUsed, rights.requestLimit),
    charactersUsed, characterLimit: rights.characterLimit, charactersRemaining: remaining(charactersUsed, rights.characterLimit),
    characterScope: rights.oneTime ? 'account' : 'period',
  };
}
