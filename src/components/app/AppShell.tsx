'use client';
import { usePathname, useRouter } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { Gauge } from 'lucide-react';
import { useLocale } from '@/lib/client/locale';
import { numberFormat } from '@/lib/client/format';
import { ApiError, errorText, isUnauthenticated, request } from '@/lib/client/api';
import { resetStyles } from '@/lib/client/styles-store';
import { StatusScreen, statusIcons } from '@/components/ui/StatusScreen';
import { Logo } from '@/components/ui/Logo';
import { AccountMenu } from './AccountMenu';
import { PlansDialog } from './PlansDialog';
import { Sidebar } from './Sidebar';
import { LoadingBlock } from '@/components/ui/Spinner';
import { hasFeature, PLAN_LIMITS, type Feature, type PlanLimits, type Tier } from '@/lib/plans';

export type SessionUser = { id: string; name: string; email: string; username?: string | null; image?: string | null; role?: 'user' | 'admin' };
export type UserSettings = { interfaceLanguage: 'id' | 'en'; writingLanguage: 'auto' | 'id' | 'en'; defaultMode: string; primaryUseCase: 'academic' | 'professional' | 'general'; humanizerContext: 'academic' | 'professional' | 'general'; localDrafts: boolean; onboarded: boolean; updatedAt: string | null };
export type Usage = { period: string; requestsUsed: number; requestLimit: number; requestsRemaining: number; charactersUsed: number; characterLimit: number; charactersRemaining: number; characterScope?: 'account' | 'period'; unlimited?: boolean; tier?: Tier; limits?: PlanLimits; features?: Feature[] };
export type DocumentSummary = { id: string; title: string; language: string; revision: number; mode: string | null; color: string | null; icon: string | null; createdAt: string; updatedAt: string };

type Shell = { user: SessionUser; settings: UserSettings; usage: Usage | null; setSettings: (settings: UserSettings) => void; refresh: () => Promise<void> };
const ShellContext = createContext<Shell | null>(null);
export const useShell = () => { const value = useContext(ShellContext); if (!value) throw new Error('useShell must be used inside AppShell'); return value; };

// Limits and gates resolved from the account, with the free plan as the answer until /api/usage has replied.
// Client gates only shape the UI; every paid surface is enforced again on the server.
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
    try { await fetch('/api/auth/sign-out', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', credentials: 'same-origin' }); } finally { resetStyles(); router.replace('/'); router.refresh(); }
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


// bare: provides the session context without top bar, sidebar, or content card.
export function AppShell({ children, requireOnboarding = true, fullBleed = false, bare = false }: { children: React.ReactNode; requireOnboarding?: boolean; fullBleed?: boolean; bare?: boolean }) {
  const { t, locale, setLocale } = useLocale();
  const router = useRouter();
  const guard = useSessionGuard();
  const [state, setState] = useState<{ user: SessionUser; settings: UserSettings; usage: Usage | null } | null>(null);
  const [error, setError] = useState<unknown>(null);

  const load = useCallback(async () => {
    try {
      const [user, settings, usage] = await Promise.all([
        request<SessionUser>('/api/me'), request<UserSettings>('/api/settings'),
        request<Usage>('/api/usage').catch(() => null),
      ]);
      if (requireOnboarding && !settings.onboarded) { router.replace('/onboarding'); return; }
      setLocale(settings.interfaceLanguage);
      setState({ user, settings, usage });
      setError(null);
    } catch (caught) { if (!guard(caught)) setError(caught); }
  }, [guard, requireOnboarding, router, setLocale]);

  useEffect(() => { void load(); }, [load]);

  if (!state) {
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

  const shell: Shell = { ...state, setSettings: (settings) => setState((current) => (current ? { ...current, settings } : current)), refresh: load };
  if (bare) return <ShellContext.Provider value={shell}>{children}</ShellContext.Provider>;
  return (
    <ShellContext.Provider value={shell}>
      <div className={`bg-shell ${fullBleed ? 'flex h-dvh flex-col overflow-hidden' : 'min-h-dvh'}`}>
        <TopBar />
        <Sidebar />
        <div className={`min-w-0 pb-16 pt-14 md:pb-0 md:pl-[72px] md:pr-2 ${fullBleed ? 'flex min-h-0 flex-1 flex-col' : ''}`}>
          <div className={`bg-paper md:rounded-t-[20px] md:border md:border-b-0 md:border-line md:shadow-[0_1px_3px_rgb(31_32_29/0.06)] ${fullBleed ? 'flex min-h-0 flex-1 flex-col overflow-hidden' : 'min-h-[calc(100dvh-3.5rem)]'}`}>{children}</div>
        </div>
      </div>
    </ShellContext.Provider>
  );
}

function TopBar() {
  const { t, locale } = useLocale();
  const { usage } = useShell();
  const [plans, setPlans] = useState(false);
  const low = usage !== null && !usage.unlimited && usage.charactersRemaining <= Math.max(1, Math.round(usage.characterLimit * 0.1));
  // Free's allowance is granted once per account, so the label must not promise a monthly reset.
  const oneTime = usage?.characterScope === 'account';

  return (
    <header className="fixed inset-x-0 top-0 z-30 flex h-14 items-center gap-2 bg-shell px-4 md:pl-[18px]">
      <Logo href="/app" mark="h-9 w-9" />
      <div className="ml-auto flex items-center gap-2.5">
        {usage && (
          <button type="button" onClick={() => setPlans(true)} aria-haspopup="dialog" title={oneTime ? t('Karakter AI sekali pakai yang sudah terpakai', 'One-time AI characters used') : t('Karakter AI terpakai bulan ini', 'AI characters used this month')} className={`hidden h-10 items-center gap-2 rounded-full border px-4 text-[13px] font-medium shadow-[0_1px_2px_rgb(31_32_29/0.05)] transition-colors sm:inline-flex ${low ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-line bg-white text-ink-700 hover:border-line-strong hover:text-ink-900'}`}>
            <Gauge size={16} aria-hidden="true" className={low ? '' : 'text-brand-700'} /><span className="font-semibold tabular-nums text-ink-900">{numberFormat(usage.charactersUsed, locale)}/{usage.unlimited ? '∞' : numberFormat(usage.characterLimit, locale)}</span>{oneTime ? t('karakter sekali pakai', 'one-time characters') : t('karakter bulan ini', 'characters this month')}
          </button>
        )}
        <AccountMenu />
      </div>
      {plans && <PlansDialog onClose={() => setPlans(false)} />}
    </header>
  );
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
