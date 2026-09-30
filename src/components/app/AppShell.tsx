'use client';
import type { UseCase } from '@/lib/writing/use-cases';
import { usePathname, useRouter } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useLocale } from '@/lib/client/locale';
import { ApiError, errorText, isUnauthenticated, request } from '@/lib/client/api';
import { resetStyles } from '@/lib/client/styles-store';
import { resetBilling } from '@/lib/client/billing-store';
import { StatusScreen, statusIcons } from '@/components/ui/StatusScreen';
import { LoadingBlock } from '@/components/ui/Spinner';
import { hasFeature, PLAN_LIMITS, type Feature, type PlanLimits, type Tier } from '@/lib/plans';

export type SessionUser = { id: string; name: string; email: string; username?: string | null; image?: string | null; role?: 'user' | 'admin' };
export type UserSettings = { interfaceLanguage: 'id' | 'en'; writingLanguage: 'auto' | 'id' | 'en'; defaultMode: string; primaryUseCase: UseCase; humanizerContext: 'academic' | 'professional' | 'general'; localDrafts: boolean; onboarded: boolean; updatedAt: string | null };
export type WalletSummary = {
  mode: 'free' | 'paid' | 'unavailable';
  free: { original: number; remaining: number; state: string } | null;
  included: { periodStart: string; periodEnd: string; original: number; reserved: number; settled: number; remaining: number } | null;
  purchased: { available: number; reserved: number; frozen: number; expired: number; settled: number };
  spendableTotal: number;
};
export type Usage = { period: string; requestsUsed: number; requestLimit: number; requestsRemaining: number; charactersUsed: number; characterLimit: number; charactersRemaining: number; characterScope?: 'account' | 'period'; tier?: Tier; access?: { paidUntil: string | null }; limits?: PlanLimits; features?: Feature[]; wallet?: WalletSummary };
// One row of GET /api/documents. docType and pinned arrived with the server-side library (UX 2); deletedAt and
// purgeAt only on the trash list.
export type DocumentSummary = { id: string; title: string; language: string; revision: number; mode: string | null; docType?: string | null; pinned?: boolean; color: string | null; icon: string | null; createdAt: string; updatedAt: string; deletedAt?: string; purgeAt?: string };

type ShellState = { user: SessionUser; settings: UserSettings; usage: Usage | null };
type Shell = ShellState & { setSettings: (settings: UserSettings) => void; refresh: () => Promise<void>; refreshUsage: () => Promise<void> };
const ShellContext = createContext<Shell | null>(null);
export const useShell = () => { const value = useContext(ShellContext); if (!value) throw new Error('useShell must be used inside AppShell'); return value; };

// Limits and gates resolved from the account, with the free plan as the answer until /api/usage has replied.
// Client gates only shape the UI; every paid surface is enforced again on the server.
// GET /api/usage already carries tier, features and access, so this is the only client gate: the unused
// GET /api/access twin was removed in UX 1b rather than adding a fourth request to every page.
export function useEntitlements() {
  const { usage } = useShell();
  const tier: Tier = usage?.tier ?? 'free';
  const limits = usage?.limits ?? PLAN_LIMITS[tier];
  const features = usage?.features ?? limits.features;
  return { tier, limits, features, has: (feature: Feature) => hasFeature(features, feature) };
}

export function useSignOut() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const signOut = useCallback(async () => {
    setBusy(true);
    try { await fetch('/api/auth/sign-out', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', credentials: 'same-origin' }); } finally { resetStyles(); resetBilling(); router.replace('/'); router.refresh(); }
  }, [router]);
  return { signOut, busy };
}

export function useSessionGuard() {
  const router = useRouter(); const pathname = usePathname();
  return useCallback((error: unknown) => {
    if (!isUnauthenticated(error)) return false;
    router.replace(`/login?next=${encodeURIComponent(pathname)}`);
    return true;
  }, [pathname, router]);
}

// Mounted once by the signed-in layout, so moving between Beranda, Notebook, Skill, Akun and Admin keeps the
// session, settings and usage in memory: the full-screen loader only shows on the first entry.
// The layout passes the frame (AppFrame) as children, which keeps this module free of an import cycle.
export function AppShell({ children }: { children: React.ReactNode }) {
  const { t, locale, setLocale } = useLocale();
  const router = useRouter();
  const guard = useSessionGuard();
  const [state, setState] = useState<ShellState | null>(null);
  const [error, setError] = useState<unknown>(null);

  const load = useCallback(async () => {
    try {
      const [user, settings, usage] = await Promise.all([
        request<SessionUser>('/api/me'), request<UserSettings>('/api/settings'),
        request<Usage>('/api/usage').catch(() => null),
      ]);
      if (!settings.onboarded) { router.replace('/onboarding'); return; }
      setLocale(settings.interfaceLanguage);
      setState({ user, settings, usage });
      setError(null);
    } catch (caught) { if (!guard(caught)) setError(caught); }
  }, [guard, router, setLocale]);

  // Only the meter: after an AI run or a payment check the pill and rail dot should move without a reload.
  const refreshUsage = useCallback(async () => {
    const usage = await request<Usage>('/api/usage').catch(() => null);
    if (usage) setState((current) => (current ? { ...current, usage } : current));
  }, []);

  // The session is loaded once per mount; later navigations reuse it.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `load` changes identity with the pathname guard
  useEffect(() => { void load(); }, []);

  const shell = useMemo<Shell | null>(() => (state ? { ...state, setSettings: (settings) => setState((current) => (current ? { ...current, settings } : current)), refresh: load, refreshUsage } : null), [load, refreshUsage, state]);

  if (!shell) {
    if (!error) return <main className="grid min-h-dvh place-items-center bg-shell px-4"><LoadingBlock label={t('Menyiapkan ruang kerja…', 'Preparing your workspace…')} /></main>;
    const offline = error instanceof ApiError && error.code === 'NETWORK_ERROR';
    return (
      <StatusScreen kind={offline ? 'offline' : 'error'}
        title={offline ? t('Koneksi terputus', 'You are offline') : t('Akunmu belum bisa dimuat', 'Could not load your account')}
        description={offline ? t('Periksa koneksi internet, lalu coba lagi. Tulisan yang sudah tersimpan tetap aman.', 'Check your internet connection and try again. Saved writing is safe.') : `${errorText(error, locale === 'en')} ${t('Tulisan yang sudah tersimpan tetap aman.', 'Saved writing is safe.')}`}
        secondary={{ label: t('Ke halaman utama', 'Go to homepage'), href: '/' }}
        primary={{ label: t('Coba lagi', 'Try again'), icon: statusIcons.retry, onClick: async () => { setError(null); await load(); } }} />
    );
  }

  return <ShellContext.Provider value={shell}>{children}</ShellContext.Provider>;
}

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-2xl font-medium tracking-[-0.04em] text-ink-950 sm:text-[28px]">{title}</h1>
        {description && <p className="mt-1 text-sm text-ink-500">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}
