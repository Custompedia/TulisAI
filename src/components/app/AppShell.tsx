'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { FilePlus2, FileText, House, LogOut, Menu, Settings as SettingsIcon, X, type LucideIcon } from 'lucide-react';
import { useLocale } from '@/lib/client/locale';
import { errorText, isUnauthenticated, request } from '@/lib/client/api';
import { Logo } from '@/components/ui/Logo';
import { Button, buttonClass } from '@/components/ui/Button';
import { LoadingBlock } from '@/components/ui/Spinner';
import { Alert } from '@/components/ui/Alert';

export type SessionUser = { id: string; name: string; email: string };
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

export function AppShell({ children, requireOnboarding = true }: { children: React.ReactNode; requireOnboarding?: boolean }) {
  const { t, locale, setLocale } = useLocale();
  const router = useRouter();
  const guard = useSessionGuard();
  const [state, setState] = useState<{ user: SessionUser; settings: UserSettings; usage: Usage | null; recent: DocumentSummary[] } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [menu, setMenu] = useState(false);
  const pathname = usePathname();

  const load = useCallback(async () => {
    try {
      const [user, settings, usage, recent] = await Promise.all([
        request<SessionUser>('/api/me'), request<UserSettings>('/api/settings'),
        request<Usage>('/api/usage').catch(() => null), request<{ items: DocumentSummary[] }>('/api/documents?limit=5'),
      ]);
      if (requireOnboarding && !settings.onboarded) { router.replace('/onboarding'); return; }
      setLocale(settings.interfaceLanguage);
      setState({ user, settings, usage, recent: recent.items });
      setError(null);
    } catch (caught) { if (!guard(caught)) setError(caught); }
  }, [guard, requireOnboarding, router, setLocale]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { setMenu(false); }, [pathname]);

  if (!state) {
    return (
      <main className="grid min-h-dvh place-items-center bg-paper px-4">
        {error ? (
          <div className="w-full max-w-md"><Alert tone="error" title={t('Tidak bisa memuat akun', 'Could not load your account')} actions={<Button size="sm" onClick={() => { setError(null); void load(); }}>{t('Coba lagi', 'Retry')}</Button>}>{errorText(error, locale === 'en')}</Alert></div>
        ) : <LoadingBlock label={t('Menyiapkan ruang kerja…', 'Preparing your workspace…')} />}
      </main>
    );
  }

  const shell: Shell = { ...state, setSettings: (settings) => setState({ ...state, settings }), refresh: load };
  return (
    <ShellContext.Provider value={shell}>
      <div className="min-h-dvh bg-paper lg:pl-64">
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between bg-ink-950 px-4 lg:hidden">
          <Logo href="/app" tone="light" />
          <button type="button" onClick={() => setMenu(true)} aria-label={t('Buka menu', 'Open menu')} aria-expanded={menu} className="grid h-9 w-9 place-items-center rounded-lg text-white hover:bg-white/10"><Menu size={20} /></button>
        </header>
        {menu && <div className="fixed inset-0 z-40 bg-ink-950/50 lg:hidden" onClick={() => setMenu(false)} aria-hidden="true" />}
        <Sidebar open={menu} onClose={() => setMenu(false)} />
        <div className="min-w-0">{children}</div>
      </div>
    </ShellContext.Provider>
  );
}

function Sidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useLocale();
  const { user, usage, recent } = useShell();
  const { signOut, busy } = useSignOut();
  const pathname = usePathname();
  const nav: Array<{ href: string; label: string; icon: LucideIcon; match: (path: string) => boolean }> = [
    { href: '/app', label: t('Beranda', 'Home'), icon: House, match: (path) => path === '/app' },
    { href: '/documents', label: t('Dokumen', 'Documents'), icon: FileText, match: (path) => path === '/documents' },
    { href: '/settings', label: t('Pengaturan', 'Settings'), icon: SettingsIcon, match: (path) => path.startsWith('/settings') },
  ];
  const initials = user.name.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase() || 'U';
  const used = usage ? Math.min(100, Math.round((usage.requestsUsed / Math.max(1, usage.requestLimit)) * 100)) : 0;

  return (
    <aside aria-label={t('Navigasi utama', 'Main navigation')} className={`fixed inset-y-0 left-0 z-50 flex w-64 flex-col bg-ink-950 text-ink-200 transition-transform lg:translate-x-0 ${open ? 'translate-x-0' : '-translate-x-full'}`}>
      <div className="flex h-16 items-center justify-between px-5">
        <Logo href="/app" tone="light" />
        <button type="button" onClick={onClose} aria-label={t('Tutup menu', 'Close menu')} className="grid h-8 w-8 place-items-center rounded-lg hover:bg-white/10 lg:hidden"><X size={18} /></button>
      </div>
      <div className="px-4 pb-2">
        <Link href="/documents/new" className={buttonClass('primary', 'md', 'w-full')}><FilePlus2 size={17} aria-hidden="true" />{t('Tulisan baru', 'New document')}</Link>
      </div>
      <nav className="mt-3 space-y-0.5 px-3">
        {nav.map(({ href, label, icon: Icon, match }) => {
          const active = match(pathname);
          return (
            <Link key={href} href={href} aria-current={active ? 'page' : undefined} className={`flex h-10 items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors ${active ? 'bg-white/10 text-white' : 'text-ink-300 hover:bg-white/5 hover:text-white'}`}>
              <Icon size={18} aria-hidden="true" className={active ? 'text-brand-300' : ''} />{label}
            </Link>
          );
        })}
      </nav>
      <div className="mt-6 min-h-0 flex-1 overflow-y-auto px-3 scrollbar-thin">
        <p className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-400">{t('Terbaru', 'Recent')}</p>
        {recent.length === 0 ? <p className="px-3 text-[13px] text-ink-400">{t('Belum ada dokumen.', 'No documents yet.')}</p> : recent.map((doc) => (
          <Link key={doc.id} href={`/documents/${doc.id}`} className="flex h-9 items-center gap-2.5 rounded-lg px-3 text-[13px] text-ink-300 hover:bg-white/5 hover:text-white">
            <FileText size={14} aria-hidden="true" className="shrink-0 text-ink-500" /><span className="truncate">{doc.title}</span>
          </Link>
        ))}
      </div>
      {usage && (
        <div className="mx-4 mb-3 rounded-xl bg-white/5 p-3">
          <div className="flex items-center justify-between text-xs"><span className="text-ink-300">{t('Pemakaian AI bulan ini', 'AI usage this month')}</span><span className="font-semibold text-white">{usage.requestsUsed}/{usage.requestLimit}</span></div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10"><div className={`h-full rounded-full ${used >= 90 ? 'bg-amber-400' : 'bg-brand-400'}`} style={{ width: `${used}%` }} /></div>
        </div>
      )}
      <div className="flex items-center gap-3 border-t border-white/10 px-4 py-3.5">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand-600 text-xs font-bold text-white">{initials}</span>
        <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold text-white">{user.name}</p><p className="truncate text-xs text-ink-400">{user.email}</p></div>
        <button type="button" onClick={() => void signOut()} disabled={busy} aria-label={t('Keluar', 'Sign out')} title={t('Keluar', 'Sign out')} className="grid h-8 w-8 place-items-center rounded-lg text-ink-300 hover:bg-white/10 hover:text-white disabled:opacity-50"><LogOut size={17} /></button>
      </div>
    </aside>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-2xl font-bold tracking-tight text-ink-950 sm:text-[28px]">{title}</h1>
        {description && <p className="mt-1 text-sm text-ink-500">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}
