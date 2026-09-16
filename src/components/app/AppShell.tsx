'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { Gauge, Menu } from 'lucide-react';
import { useLocale } from '@/lib/client/locale';
import { ApiError, errorText, isUnauthenticated, request } from '@/lib/client/api';
import { StatusScreen, statusIcons } from '@/components/ui/StatusScreen';
import { Logo } from '@/components/ui/Logo';
import { AccountMenu } from './AccountMenu';
import { Sidebar, SIDEBAR_ID } from './Sidebar';
import { LoadingBlock } from '@/components/ui/Spinner';

export type SessionUser = { id: string; name: string; email: string; image?: string | null };
export type UserSettings = { interfaceLanguage: 'id' | 'en'; writingLanguage: 'auto' | 'id' | 'en'; defaultMode: string; primaryUseCase: 'academic' | 'professional' | 'general'; humanizerContext: 'academic' | 'professional' | 'general'; localDrafts: boolean; onboarded: boolean; updatedAt: string | null };
export type Usage = { period: string; requestsUsed: number; requestLimit: number; requestsRemaining: number };
export type DocumentSummary = { id: string; title: string; language: string; revision: number; mode: string | null; color: string | null; icon: string | null; createdAt: string; updatedAt: string };

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

// bare: provides the session context without top bar, sidebar, or content card.
export function AppShell({ children, requireOnboarding = true, fullBleed = false, bare = false }: { children: React.ReactNode; requireOnboarding?: boolean; fullBleed?: boolean; bare?: boolean }) {
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
    if (!error) return <main className="grid min-h-dvh place-items-center bg-brand-50 px-4"><LoadingBlock label={t('Menyiapkan ruang kerja…', 'Preparing your workspace…')} /></main>;
    const offline = error instanceof ApiError && error.code === 'NETWORK_ERROR';
    return (
      <StatusScreen kind={offline ? 'offline' : 'error'}
        title={offline ? t('Koneksi terputus', 'You are offline') : t('Akunmu belum bisa dimuat', 'Could not load your account')}
        description={offline ? t('Periksa koneksi internet, lalu coba lagi. Tulisan yang sudah tersimpan tetap aman.', 'Check your internet connection and try again. Saved writing is safe.') : `${errorText(error, locale === 'en')} ${t('Tulisan yang sudah tersimpan tetap aman.', 'Saved writing is safe.')}`}
        secondary={{ label: t('Ke halaman utama', 'Go to homepage'), href: '/' }}
        primary={{ label: t('Coba lagi', 'Try again'), icon: statusIcons.retry, onClick: async () => { setError(null); await load(); } }} />
    );
  }

  const toggleMenu = () => {
    if (!window.matchMedia('(min-width: 768px)').matches) { setDrawer(!drawer); return; }
    const next = !expanded; setExpanded(next);
    try { localStorage.setItem(EXPANDED_KEY, next ? '1' : '0'); } catch { /* storage unavailable */ }
  };
  const shell: Shell = { ...state, setSettings: (settings) => setState((current) => (current ? { ...current, settings } : current)), refresh: load };
  if (bare) return <ShellContext.Provider value={shell}>{children}</ShellContext.Provider>;
  return (
    <ShellContext.Provider value={shell}>
      <div className={`bg-brand-50 ${fullBleed ? 'flex h-dvh flex-col overflow-hidden' : 'min-h-dvh'}`}>
        <TopBar menuOpen={drawer || expanded} onMenu={toggleMenu} />
        <Sidebar expanded={expanded} drawer={drawer} recent={state.recent} onCloseDrawer={closeDrawer} />
        <div className={`min-w-0 pt-14 transition-[padding] duration-200 md:pr-2 ${expanded ? 'md:pl-60' : 'md:pl-[72px]'} ${fullBleed ? 'flex min-h-0 flex-1 flex-col' : ''}`}>
          <div className={`bg-paper md:rounded-t-[20px] md:border md:border-b-0 md:border-line md:shadow-[0_1px_3px_rgb(31_32_29/0.06)] ${fullBleed ? 'flex min-h-0 flex-1 flex-col overflow-hidden' : 'min-h-[calc(100dvh-3.5rem)]'}`}>{children}</div>
        </div>
      </div>
    </ShellContext.Provider>
  );
}

function TopBar({ menuOpen, onMenu }: { menuOpen: boolean; onMenu: () => void }) {
  const { t } = useLocale();
  const { usage } = useShell();
  const low = usage !== null && usage.requestsRemaining <= Math.max(1, Math.round(usage.requestLimit * 0.1));

  return (
    <header className="fixed inset-x-0 top-0 z-30 flex h-14 items-center gap-2 bg-brand-50 px-3 sm:px-4">
      <button type="button" onClick={onMenu} aria-label={t('Buka/tutup navigasi', 'Toggle navigation')} aria-expanded={menuOpen} aria-controls={SIDEBAR_ID} className="grid h-9 w-9 place-items-center rounded-lg text-ink-600 hover:bg-white/70 hover:text-ink-900"><Menu size={20} /></button>
      <Logo href="/app" />
      <div className="ml-auto flex items-center gap-2">
        {usage && (
          <Link href="/settings#pemakaian" onClick={(event) => { if (window.location.pathname === '/settings') { event.preventDefault(); window.location.hash = 'pemakaian'; } }} title={t('Pemakaian AI bulan ini', 'AI usage this month')} className={`hidden h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold sm:inline-flex ${low ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-line bg-white text-brand-800 hover:border-line-strong'}`}>
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
