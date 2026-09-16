'use client';
import { useCallback, useEffect, useState } from 'react';
import { Database, Gauge, ScrollText, type LucideIcon } from 'lucide-react';
import { useLocale } from '@/lib/client/locale';
import { PageHeader, useShell } from '@/components/app/AppShell';
import { StatusScreen } from '@/components/ui/StatusScreen';
import { Toast } from '@/components/ui/Toast';
import type { AdminSummary, UsersPage } from './admin-shared';
import { AiMonitor } from './AiMonitor';
import { AdminLog } from './AdminLog';
import { UserDatabase } from './UserDatabase';
import { UserDetailModal } from './UserDetailModal';

type Tab = 'ai' | 'database' | 'log';
type Notice = { tone: 'success' | 'error'; message: string };
const TABS: Tab[] = ['database', 'ai', 'log'];
const tabFromHash = (hash: string): Tab => { const value = hash.replace(/^#/, ''); return (TABS as string[]).includes(value) ? value as Tab : 'database'; };

export function AdminView() {
  const { t } = useLocale();
  const { user } = useShell();
  const [tab, setTab] = useState<Tab>('database');
  const [summary, setSummary] = useState<AdminSummary | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    const sync = () => setTab(tabFromHash(window.location.hash));
    sync(); window.addEventListener('hashchange', sync);
    return () => window.removeEventListener('hashchange', sync);
  }, []);
  const select = (next: Tab) => { setTab(next); window.history.replaceState(window.history.state, '', `${window.location.pathname}${window.location.search}#${next}`); };
  const onPage = useCallback((page: UsersPage) => setSummary(page.summary), []);
  const notify = useCallback((next: Notice) => setNotice(next), []);
  const refresh = useCallback(() => setRefreshKey((value) => value + 1), []);

  if (user.role !== 'admin') {
    return <StatusScreen kind="error" title={t('Halaman khusus admin', 'Admins only')} description={t('Akunmu tidak punya akses ke panel admin.', 'Your account does not have access to the admin panel.')} secondary={{ label: t('Kembali ke beranda', 'Back to home'), href: '/app' }} />;
  }

  const tabs: Array<{ id: Tab; icon: LucideIcon; label: string }> = [{ id: 'database', icon: Database, label: 'Database' }, { id: 'ai', icon: Gauge, label: 'Monitoring AI' }, { id: 'log', icon: ScrollText, label: 'Log' }];

  return (
    <main className="mx-auto w-full max-w-7xl px-4 pb-12 pt-8 sm:px-6">
      <PageHeader title={t('Panel admin', 'Admin panel')} />
      <div role="tablist" aria-label={t('Bagian panel admin', 'Admin panel sections')} className="mt-5 inline-flex w-full rounded-xl border border-line-strong bg-paper p-1 sm:w-auto">
        {tabs.map(({ id, icon: Icon, label }) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => select(id)}
            className={`inline-flex h-9 flex-1 items-center justify-center gap-2 rounded-lg px-4 text-[13.5px] font-semibold transition-colors sm:flex-none ${tab === id ? 'bg-white text-ink-900 shadow-sm ring-1 ring-line' : 'text-ink-500 hover:text-ink-900'}`}>
            <Icon size={16} aria-hidden="true" className={tab === id ? 'text-brand-700' : ''} />{label}
          </button>
        ))}
      </div>

      <div className="mt-5">
        {tab === 'ai' && <AiMonitor summary={summary} onOpenUser={setSelected} />}
        {tab === 'database' && <UserDatabase onOpenUser={setSelected} onPage={onPage} refreshKey={refreshKey} notify={notify} />}
        {tab === 'log' && <AdminLog onOpenUser={setSelected} refreshKey={refreshKey} />}
      </div>

      {notice && <Toast tone={notice.tone} duration={notice.tone === 'error' ? undefined : 4000} onDismiss={() => setNotice(null)} dismissLabel={t('Tutup', 'Dismiss')}>{notice.message}</Toast>}
      {selected && <UserDetailModal userId={selected} summary={summary} onClose={() => setSelected(null)} onChange={refresh} onDeleted={() => { refresh(); }} notify={notify} />}
    </main>
  );
}
