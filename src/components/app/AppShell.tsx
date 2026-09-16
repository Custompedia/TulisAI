'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { Gauge, Menu } from 'lucide-react';
import { useLocale } from '@/lib/client/locale';
import { errorText, isUnauthenticated, request } from '@/lib/client/api';
import { Logo } from '@/components/ui/Logo';
import { Button } from '@/components/ui/Button';
import { AccountMenu } from './AccountMenu';
import { Sidebar, SIDEBAR_ID } from './Sidebar';
import { LoadingBlock } from '@/components/ui/Spinner';
import { Alert } from '@/components/ui/Alert';

export type SessionUser = { id: string; name: string; email: string; image?: string | null };
export type UserSettings = { interfaceLanguage: 'id' | 'en'; writingLanguage: 'auto' | 'id' | 'en'; defaultMode: string; primaryUseCase: 'academic' | 'professional' | 'general'; humanizerContext: 'academic' | 'professional' | 'general'; localDrafts: boolean; onboarded: boolean; updatedAt: string | null };
export type Usage = { period: string; requestsUsed: number; requestLimit: number; requestsRemaining: number };
export type DocumentSummary = { id: string; title: string; language: string; revision: number; mode: string | null; createdAt: string; updatedAt: string };

type Shell = { user: SessionUser; settings: UserSettings; usage: Usage | null; recent: DocumentSummary[]; setSettings: (settings: UserSettings) => void; refresh: () => Promise<void> };
const ShellContext = createContext<Shell | null>(null);
export const useShell = () => { const value = useContext(ShellContext); if (!value) throw new Error('useShell must be used inside AppShell'); return value; };

export function useSignOut() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const signOut = useCallback(async () => {
    setBusy(true);
    try { await fetch('/api/auth/sign-out', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', credentials: 'same-origin' }); } finally { router.replace('/login'); router.refresh(); }
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

const EXPANDED_KEY = 'sidebar-expanded';

export function AppShell({ children, requireOnboarding = true, fullBleed = false }: { children: React.ReactNode; requireOnboarding?: boolean; fullBleed?: boolean }) {
  const { t, locale, setLocale } = useLocale();
  const router = useRouter();
  const guard = useSessionGuard();
  const [state, setState] = useState<{ user: SessionUser; settings: UserSettings; usage: Usage | null; recent: DocumentSummary[] } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [expanded, setExpanded] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const pathname = usePathname();

  const load = useCallback(async () => {
    try {
      const [user, settings, usage, recent] = await Promise.all([
        request<SessionUser>('/api/me'), request<UserSettings>('/api/settings'),
        request<Usage>('/api/usage').catch(() => null), request<{ items: DocumentSummary[] }>('/api/documents?limit=6'),
      ]);
      if (requireOnboarding && !settings.onboarded) { router.replace('/onboarding'); return; }
      setLocale(settings.interfaceLanguage);
      setState({ user, settings, usage, recent: recent.items });
      setError(null);
    } catch (caught) { if (!guard(caught)) setError(caught); }
  }, [guard, requireOnboarding, router, setLocale]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { try { setExpanded(localStorage.getItem(EXPANDED_KEY) === '1'); } catch { /* storage unavailable */ } }, []);
  useEffect(() => { setDrawer(false); }, [pathname]);
  useEffect(() => {
    const query = window.matchMedia('(min-width: 768px)');
    const onChange = () => { if (query.matches) setDrawer(false); };
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);
  const closeDrawer = useCallback(() => setDrawer(false), []);

  if (!state) {
    return (
      <main className="grid min-h-dvh place-items-center bg-paper px-4">
        {error ? (
          <div className="w-full max-w-md"><Alert tone="error" title={t('Tidak bisa memuat akun', 'Could not load your account')} actions={<Button size="sm" onClick={() => { setError(null); void load(); }}>{t('Coba lagi', 'Retry')}</Button>}>{errorText(error, locale === 'en')}</Alert></div>
        ) : <LoadingBlock label={t('Menyiapkan ruang kerja…', 'Preparing your workspace…')} />}
      </main>
    );
  }

  const toggleMenu = () => {
    if (!window.matchMedia('(min-width: 768px)').matches) { setDrawer(!drawer); return; }
    const next = !expanded; setExpanded(next);
    try { localStorage.setItem(EXPANDED_KEY, next ? '1' : '0'); } catch { /* storage unavailable */ }
  };
  const shell: Shell = { ...state, setSettings: (settings) => setState((current) => (current ? { ...current, settings } : current)), refresh: load };
  return (
    <ShellContext.Provider value={shell}>
      <div className={`bg-paper ${fullBleed ? 'flex h-dvh flex-col overflow-hidden' : 'min-h-dvh'}`}>
        <TopBar menuOpen={drawer || expanded} onMenu={toggleMenu} />
        <Sidebar expanded={expanded} drawer={drawer} recent={state.recent} onCloseDrawer={closeDrawer} />
        <div className={`min-w-0 pt-14 transition-[padding] duration-200 ${expanded ? 'md:pl-60' : 'md:pl-[72px]'} ${fullBleed ? 'flex min-h-0 flex-1 flex-col' : ''}`}>{children}</div>
      </div>
    </ShellContext.Provider>
  );
}

function TopBar({ menuOpen, onMenu }: { menuOpen: boolean; onMenu: () => void }) {
  const { t } = useLocale();
  const { usage } = useShell();
  const low = usage !== null && usage.requestsRemaining <= Math.max(1, Math.round(usage.requestLimit * 0.1));

  return (
    <header className="fixed inset-x-0 top-0 z-30 flex h-14 items-center gap-2 border-b border-line bg-white px-3 sm:px-4">
      <button type="button" onClick={onMenu} aria-label={t('Buka/tutup navigasi', 'Toggle navigation')} aria-expanded={menuOpen} aria-controls={SIDEBAR_ID} className="grid h-9 w-9 place-items-center rounded-lg text-ink-600 hover:bg-paper-deep hover:text-ink-900"><Menu size={20} /></button>
      <Logo href="/app" />
      <div className="ml-auto flex items-center gap-2">
        {usage && (
          <Link href="/settings#pemakaian" onClick={(event) => { if (window.location.pathname === '/settings') { event.preventDefault(); window.location.hash = 'pemakaian'; } }} title={t('Pemakaian AI bulan ini', 'AI usage this month')} className={`hidden h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold sm:inline-flex ${low ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-brand-100 bg-brand-50 text-brand-800'}`}>
            <Gauge size={14} aria-hidden="true" />{usage.requestsUsed}/{usage.requestLimit} {t('AI bulan ini', 'AI this month')}
          </Link>
        )}
        <AccountMenu />
      </div>
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
