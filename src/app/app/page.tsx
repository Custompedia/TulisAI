'use client';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { ArrowRight, FolderOpen } from 'lucide-react';
import { useLocale } from '@/lib/client/locale';
import { errorText, request } from '@/lib/client/api';
import { AppShell, useSessionGuard, useShell, type DocumentSummary } from '@/components/app/AppShell';
import { DocumentRow } from '@/components/app/DocumentCard';
import { Composer } from '@/components/compose/Composer';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { LoadingBlock } from '@/components/ui/Spinner';

export default function DashboardPage() {
  return <AppShell><Dashboard /></AppShell>;
}

function Dashboard() {
  const { t, locale } = useLocale();
  const { user } = useShell();
  const guard = useSessionGuard();
  const [docs, setDocs] = useState<DocumentSummary[] | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    try { setDocs((await request<{ items: DocumentSummary[] }>('/api/documents?limit=6')).items); }
    catch (caught) { if (!guard(caught)) setError(errorText(caught, locale === 'en')); }
  }, [guard, locale]);
  useEffect(() => { void load(); }, [load]);

  const hour = new Date().getHours();
  const greeting = hour < 11 ? t('Selamat pagi', 'Good morning') : hour < 15 ? t('Selamat siang', 'Good afternoon') : hour < 19 ? t('Selamat sore', 'Good evening') : t('Selamat malam', 'Good evening');

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6 sm:py-12">
      <header className="mb-7 animate-fade-up">
        <p className="text-sm font-medium text-ink-500">{greeting}, {user.name.split(' ')[0]}</p>
        <h1 className="mt-1 font-serif text-3xl font-semibold tracking-tight text-ink-950 sm:text-[34px]">{t('Apa yang ingin kamu perbaiki hari ini?', 'What would you like to improve today?')}</h1>
      </header>

      <Composer />

      <section className="mt-12" aria-labelledby="recent-title">
        <div className="mb-3 flex items-center justify-between">
          <h2 id="recent-title" className="text-base font-semibold text-ink-900">{t('Dokumen terbaru', 'Recent documents')}</h2>
          {docs && docs.length > 0 && <Link href="/documents" className="inline-flex items-center gap-1 text-sm font-semibold text-brand-700 hover:text-brand-800">{t('Lihat semua', 'View all')}<ArrowRight size={15} /></Link>}
        </div>
        {error ? <Alert tone="error" actions={<Button size="sm" onClick={() => void load()}>{t('Coba lagi', 'Retry')}</Button>}>{error}</Alert>
          : docs === null ? <div className="rounded-2xl border border-line bg-white"><LoadingBlock label={t('Memuat dokumen…', 'Loading documents…')} /></div>
          : docs.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-line-strong bg-white/60 px-6 py-10 text-center">
              <FolderOpen size={28} className="mx-auto text-ink-300" aria-hidden="true" />
              <p className="mt-3 text-sm font-semibold text-ink-800">{t('Belum ada dokumen', 'No documents yet')}</p>
              <p className="mt-1 text-sm text-ink-500">{t('Tulisan yang kamu perbaiki akan tersimpan di sini.', 'Documents you work on will appear here.')}</p>
            </div>
          ) : <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-white">{docs.map((doc) => <DocumentRow key={doc.id} doc={doc} />)}</ul>}
      </section>
    </main>
  );
}
