import type { Tier } from '@/lib/plans';
import { ApiError } from './api';

type T = (id: string, en: string) => string;
type Locale = 'id' | 'en';

// ── Quota level: the rail dot and the pill colour share one rule ──────────────────────────────
export type QuotaLevel = 'ok' | 'low' | 'empty';

export function quotaLevel(usage: { charactersRemaining: number; characterLimit: number } | null): QuotaLevel | null {
  if (!usage) return null;
  if (usage.charactersRemaining <= 0) return 'empty';
  return usage.charactersRemaining <= Math.max(1, Math.round(usage.characterLimit * 0.1)) ? 'low' : 'ok';
}

// "1,2rb" on a phone instead of "1.234/3.000 karakter".
export function compactCharacters(value: number, locale: Locale): string {
  const abs = Math.abs(value);
  const [divisor, suffix] = abs >= 1_000_000 ? [1_000_000, locale === 'en' ? 'M' : 'jt'] : abs >= 1_000 ? [1_000, locale === 'en' ? 'k' : 'rb'] : [1, ''];
  if (divisor === 1) return new Intl.NumberFormat(locale).format(value);
  const scaled = value / divisor;
  const digits = Math.abs(scaled) < 10 ? 1 : 0;
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: digits, minimumFractionDigits: 0 }).format(Math.floor(scaled * 10 ** digits) / 10 ** digits)}${suffix}`;
}

export const tierName = (tier: Tier, t: T) => (tier === 'free' ? t('Gratis', 'Free') : `${tier[0]!.toUpperCase()}${tier.slice(1)}`);

export const shortDate = (value: string | number | Date, locale: Locale) => new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' }).format(new Date(value));

const DAY = 86_400_000;
// Whole days left, counting today's remainder as a day; never negative.
export const daysLeft = (until: string, now = Date.now()) => Math.max(0, Math.ceil((new Date(until).getTime() - now) / DAY));

// The account menu's plan line: "Gratis · sisa 1.800 karakter sekali pakai" or "Pro · berlaku s.d. 31 Okt".
export function planLine(input: { tier: Tier; admin: boolean; oneTime: boolean; remaining: number | null; paidUntil: string | null }, t: T, locale: Locale): string {
  const name = tierName(input.tier, t);
  if (input.admin) return `${name} · ${t('akun admin', 'admin account')}`;
  if (input.tier === 'free' || input.oneTime) {
    if (input.remaining === null) return name;
    const amount = new Intl.NumberFormat(locale).format(input.remaining);
    return `${name} · ${t(`sisa ${amount} karakter sekali pakai`, `${amount} one-time characters left`)}`;
  }
  return input.paidUntil ? `${name} · ${t(`berlaku s.d. ${shortDate(input.paidUntil, 'id')}`, `valid until ${shortDate(input.paidUntil, 'en')}`)}` : name;
}

// ── Plan and rate-limit notices ───────────────────────────────────────────────────────────────
// A plan limit offers "Lihat paket". Hitting the per-minute burst cap does not: it is the same for every
// plan, admins included, so a bigger plan would not help.
export const PLAN_LIMIT_CODES = ['QUOTA_EXCEEDED', 'REQUEST_LIMIT_REACHED', 'FEATURE_LOCKED'] as const;
export type PlanNoticeKind = 'plan' | 'rate';
export type PlanNotice = { kind: PlanNoticeKind; code: string; requiredTier?: Tier | null };

export function planNoticeFor(error: unknown): PlanNotice | null {
  if (!(error instanceof ApiError)) return null;
  const code = error.code.toUpperCase();
  if (code === 'RATE_LIMITED') return { kind: 'rate', code };
  if (!(PLAN_LIMIT_CODES as readonly string[]).includes(code)) return null;
  const details = error.details && typeof error.details === 'object' ? error.details as { requiredTier?: unknown } : null;
  const requiredTier = typeof details?.requiredTier === 'string' && ['plus', 'pro', 'max'].includes(details.requiredTier) ? details.requiredTier as Tier : null;
  return { kind: 'plan', code, requiredTier };
}

export function planNoticeCopy(notice: PlanNotice, t: T, oneTime: boolean): { title: string; message: string; showPlans: boolean } {
  if (notice.kind === 'rate') return { title: t('Terlalu cepat', 'Too fast'), message: t('Terlalu banyak permintaan AI dalam 1 menit. Tunggu sebentar lalu coba lagi.', 'Too many AI requests in one minute. Wait a moment and try again.'), showPlans: false };
  switch (notice.code) {
    case 'QUOTA_EXCEEDED': return {
      title: oneTime ? t('Karakter sekali pakai sudah habis', 'One-time characters used up') : t('Karakter bulan ini habis', 'This month’s characters are used up'),
      message: t('Tulisanmu tetap bisa dibuka, diedit, dan disimpan. Fitur AI berhenti sampai kuota terisi lagi.', 'Your writing stays open, editable, and saved. AI pauses until the allowance refills.'), showPlans: true,
    };
    case 'REQUEST_LIMIT_REACHED': return { title: t('Batas permintaan tercapai', 'Request limit reached'), message: t('Batas permintaan AI bulan ini untuk paketmu sudah tercapai.', 'Your plan’s AI request limit for this month has been reached.'), showPlans: true };
    default: {
      const tier = notice.requiredTier ? tierName(notice.requiredTier, t) : null;
      return { title: t('Fitur terkunci', 'Feature locked'), message: tier ? t(`Fitur ini ada di paket ${tier}.`, `This feature is part of ${tier}.`) : t('Fitur ini ada di paket berbayar.', 'This feature is part of a paid plan.'), showPlans: true };
    }
  }
}
