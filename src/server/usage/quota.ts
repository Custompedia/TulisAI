import { ConfigurationError, runtime } from '../runtime';
import { isAdminRole } from '../auth/auth';

export const TIERS = ['free', 'plus', 'pro', 'team'] as const;
export type Tier = (typeof TIERS)[number];
// Monthly AI request caps per tier; free follows AI_MONTHLY_REQUEST_LIMIT so existing deployments keep their number.
export const TIER_LIMITS: Record<Exclude<Tier, 'free'>, number> = { plus: 500, pro: 2000, team: 3000 };
export type UsageSummary = { period: string; requestsUsed: number; requestLimit: number; requestsRemaining: number; unlimited: boolean; tier: Tier };
export type Entitlement = { tier: Tier; role: 'user' | 'admin'; requestLimit: number; unlimited: boolean; override: number | null };

export const periodKey = () => new Date().toISOString().slice(0, 7);
export const asTier = (value: unknown): Tier => (TIERS as readonly string[]).includes(String(value)) ? (value as Tier) : 'free';

export function monthlyLimit(): number {
  const limit = Number(runtime().AI_MONTHLY_REQUEST_LIMIT ?? '100');
  if (!Number.isSafeInteger(limit) || limit < 1) throw new ConfigurationError('AI_MONTHLY_REQUEST_LIMIT must be a positive integer.');
  return limit;
}
export const tierLimit = (tier: Tier): number => (tier === 'free' ? monthlyLimit() : TIER_LIMITS[tier]);

// Admins are unlimited; otherwise a per-user override beats the tier cap. Unknown users fall back to free.
export async function entitlement(ownerId: string): Promise<Entitlement> {
  const row = await runtime().DB.prepare('SELECT role, tier, ai_limit_override FROM user WHERE id=?').bind(ownerId).first<{ role: string | null; tier: string | null; ai_limit_override: number | null }>();
  const tier = asTier(row?.tier); const role = isAdminRole(row?.role) ? 'admin' : 'user';
  const override = typeof row?.ai_limit_override === 'number' && row.ai_limit_override > 0 ? row.ai_limit_override : null;
  return { tier, role, override, unlimited: role === 'admin', requestLimit: override ?? tierLimit(tier) };
}

export async function usageSummary(ownerId: string): Promise<UsageSummary> {
  const period = periodKey();
  const [row, rights] = await Promise.all([
    runtime().DB.prepare("SELECT COUNT(1) AS total FROM usage_ledger WHERE owner_id=? AND period_key=? AND status IN ('reserved','completed','failed')").bind(ownerId, period).first<{ total: number }>(),
    entitlement(ownerId),
  ]);
  const requestsUsed = row?.total ?? 0;
  return { period, requestsUsed, requestLimit: rights.requestLimit, requestsRemaining: rights.unlimited ? rights.requestLimit : Math.max(0, rights.requestLimit - requestsUsed), unlimited: rights.unlimited, tier: rights.tier };
}
