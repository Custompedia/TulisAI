'use client';
import { useCallback, useState } from 'react';
import { useLocale } from '@/lib/client/locale';
import { setHash, useHash } from '@/lib/client/hash';
import { adminTabFromHash, type AdminTab } from '@/lib/navigation/sections';
import { PageHeader, useShell } from '@/components/app/AppShell';
import { useAdminNav } from '@/components/app/ContextSidebar';
import { StatusScreen } from '@/components/ui/StatusScreen';
import { Toast } from '@/components/ui/Toast';
import type { AdminSummary, UsersPage } from './admin-shared';
import { AiMonitor } from './AiMonitor';
import { AdminLog } from './AdminLog';
import { UserDatabase } from './UserDatabase';
import { PaymentsPanel } from './PaymentsPanel';
import { UserDetailModal } from './UserDetailModal';

type Notice = { tone: 'success' | 'error'; message: string };

// The sections are listed in the context sidebar on desktop (Pusat kontrol + Kelola) and as tabs on phones.
// The hashes (#database, #payments, #ai, #log) are unchanged.
export function AdminView() {
  const { t } = useLocale();
  const { user } = useShell();
  const tab: AdminTab = adminTabFromHash(useHash());
  const nav = useAdminNav();
  const [summary, setSummary] = useState<AdminSummary | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const onPage = useCallback((page: UsersPage) => setSummary(page.summary), []);
  const notify = useCallback((next: Notice) => setNotice(next), []);
  const refresh = useCallback(() => setRefreshKey((value) => value + 1), []);

  if (user.role !== 'admin') {
    return <StatusScreen kind="error" title={t('Halaman khusus admin', 'Admins only')} description={t('Akunmu tidak punya akses ke panel admin.', 'Your account does not have access to the admin panel.')} secondary={{ label: t('Kembali ke beranda', 'Back to home'), href: '/app' }} />;
  }

  const current = nav.find((item) => item.id === tab) ?? nav[0];

  return (
    <main className="mx-auto w-full max-w-7xl px-4 pb-12 pt-8 sm:px-6">
      <PageHeader title={current.label} description={t('Panel admin', 'Admin panel')} />
      <div role="tablist" aria-label={t('Bagian panel admin', 'Admin panel sections')} className="mt-5 flex w-full overflow-x-auto rounded-xl border border-line-strong bg-paper p-1 md:hidden">
        {nav.map(({ id, icon: Icon, label }) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setHash(id)}
            className={`inline-flex h-9 flex-1 shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-lg px-3 text-[13px] font-semibold transition-colors ${tab === id ? 'bg-white text-ink-900 shadow-sm ring-1 ring-line' : 'text-ink-500 hover:text-ink-900'}`}>
            <Icon size={15} aria-hidden="true" className={tab === id ? 'text-brand-700' : ''} />{label}
          </button>
        ))}
      </div>

      <div className="mt-5">
        {tab === 'ai' && <AiMonitor summary={summary} onOpenUser={setSelected} />}
        {tab === 'database' && <UserDatabase onOpenUser={setSelected} onPage={onPage} refreshKey={refreshKey} notify={notify} />}
        {tab === 'payments' && <PaymentsPanel onOpenUser={setSelected} />}
        {tab === 'log' && <AdminLog onOpenUser={setSelected} refreshKey={refreshKey} />}
      </div>

      {notice && <Toast tone={notice.tone} duration={notice.tone === 'error' ? undefined : 4000} onDismiss={() => setNotice(null)} dismissLabel={t('Tutup', 'Dismiss')}>{notice.message}</Toast>}
      {selected && <UserDetailModal userId={selected} summary={summary} onClose={() => setSelected(null)} onChange={refresh} onDeleted={() => { refresh(); }} notify={notify} />}
    </main>
  );
}
