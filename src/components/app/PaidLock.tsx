'use client';
import { Lock } from 'lucide-react';
import { useLocale } from '@/lib/client/locale';
import { requiredTierFor, type Feature } from '@/lib/plans';

// One treatment for every paid-but-locked surface: a grey padlock, muted text, and a way to see the plans.
// A locked feature is always shown rather than hidden, so nothing silently disappears on the free plan.
export function PaidLock({ size = 14, className = '' }: { size?: number; className?: string }) {
  return <Lock size={size} aria-hidden="true" className={`shrink-0 text-ink-400 ${className}`} />;
}

const TIER_NAMES: Record<string, [string, string]> = {
  plus: ['Plus', 'Plus'], pro: ['Pro', 'Pro'], team: ['Tim', 'Team'], free: ['Gratis', 'Free'],
};

// "Plus" rather than a hardcoded plan name, read from the catalogue so copy cannot drift from the gate.
export function useRequiredTierName(feature: Feature): string {
  const { locale } = useLocale();
  const tier = requiredTierFor(feature);
  const [id, en] = TIER_NAMES[tier] ?? [tier, tier];
  return locale === 'en' ? en : id;
}

// The muted row used where a locked feature sits inline with working controls.
export function LockedFeatureRow({ feature, label, onUpgrade, className = '' }: { feature: Feature; label: string; onUpgrade: () => void; className?: string }) {
  const { t } = useLocale();
  const tier = useRequiredTierName(feature);
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <PaidLock />
      <p className="min-w-0 flex-1 truncate text-[12px] text-ink-500">{label}</p>
      <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={onUpgrade}
        className="shrink-0 rounded-full px-2 py-0.5 text-[12px] font-semibold text-ink-600 underline decoration-line-strong underline-offset-2 transition-colors hover:text-ink-900 hover:decoration-ink-500">
        {t(`Buka dengan ${tier}`, `Unlock with ${tier}`)}
      </button>
    </div>
  );
}
