import { ConfigurationError, runtime } from '../runtime';
import { isAdminRole } from '../auth/auth';
import { asTier, effectiveLimits, PLAN_LIMITS, TIERS, type Feature, type PlanLimits, type Tier } from '@/lib/plans';

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
};
export type Entitlement = {
  tier: Tier; role: 'user' | 'admin'; unlimited: boolean;
  requestLimit: number; characterLimit: number; oneTime: boolean;
  limits: PlanLimits; features: readonly Feature[];
  override: number | null; characterOverride: number | null;
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

// Admins are unlimited and hold every feature; otherwise a per-user override beats the tier cap. Unknown users fall back to free.
export async function entitlement(ownerId: string): Promise<Entitlement> {
  const row = await runtime().DB.prepare('SELECT role, tier, ai_limit_override, ai_character_limit_override FROM user WHERE id=?').bind(ownerId)
    .first<{ role: string | null; tier: string | null; ai_limit_override: number | null; ai_character_limit_override: number | null }>();
  const tier = asTier(row?.tier); const role = isAdminRole(row?.role) ? 'admin' : 'user';
  const positive = (value: number | null | undefined) => (typeof value === 'number' && value > 0 ? value : null);
  const override = positive(row?.ai_limit_override); const characterOverride = positive(row?.ai_character_limit_override);
  const unlimited = role === 'admin';
  // Admins resolve to the top plan, not to their tier column, so every limit matches the access they already have.
  const limits = effectiveLimits(tier, unlimited);
  return {
    tier, role, unlimited, limits, override, characterOverride,
    features: limits.features,
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
    period, tier: rights.tier, unlimited: rights.unlimited, limits: rights.limits, features: rights.features,
    requestsUsed, requestLimit: rights.requestLimit, requestsRemaining: remaining(requestsUsed, rights.requestLimit),
    charactersUsed, characterLimit: rights.characterLimit, charactersRemaining: remaining(charactersUsed, rights.characterLimit),
    characterScope: rights.oneTime ? 'account' : 'period',
  };
}
