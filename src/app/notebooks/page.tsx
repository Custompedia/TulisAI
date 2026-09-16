'use client';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { NotebookPen, Plus, Search, SearchX, X } from 'lucide-react';
import { useLocale } from '@/lib/client/locale';
import { errorText, request } from '@/lib/client/api';
import { AppShell, PageHeader, useSessionGuard, type DocumentSummary } from '@/components/app/AppShell';
import { NotebookCard, NotebookCardSkeleton } from '@/components/app/NotebookCard';
import { Toast } from '@/components/ui/Toast';
import { Button, buttonClass } from '@/components/ui/Button';
import { inputClass } from '@/components/ui/Field';

export default function NotebooksPage() {
  return <AppShell><Notebooks /></AppShell>;
}

const GRID = 'grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-5';

function Notebooks() {
  const { t, locale } = useLocale();
  const guard = useSessionGuard();
  const [docs, setDocs] = useState<DocumentSummary[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');

  const load = useCallback(async (next?: string) => {
    setError(''); if (next) setLoadingMore(true);
    try {
      const page = await request<{ items: DocumentSummary[]; nextCursor: string | null }>(`/api/documents?limit=20${next ? `&cursor=${encodeURIComponent(next)}` : ''}`);
      setDocs((current) => (next && current ? [...current, ...page.items] : page.items)); setCursor(page.nextCursor);
    } catch (caught) { if (!guard(caught)) setError(errorText(caught, locale === 'en')); }
    finally { setLoadingMore(false); }
  }, [guard, locale]);
  useEffect(() => { void load(); }, [load]);

  const term = query.trim().toLowerCase();
  const visible = useMemo(() => (docs && term ? docs.filter((doc) => doc.title.toLowerCase().includes(term)) : docs), [docs, term]);
  const newNotebook = <Link href="/app#compose" className={buttonClass('primary')}><Plus size={17} aria-hidden="true" />{t('Notebook baru', 'New notebook')}</Link>;

  return (
    <main className="mx-auto w-full max-w-6xl px-4 pb-12 pt-8 sm:px-6">
      <PageHeader title={t('Notebook', 'Notebooks')} actions={newNotebook} />
      <div className="mt-5 flex flex-wrap items-center gap-3">
        <div className="relative w-full sm:max-w-xs">
          <Search size={16} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
          <input type="search" aria-label={t('Cari notebook', 'Search notebooks')} value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('Cari judul notebook…', 'Search notebook titles…')} className={`${inputClass} pl-9 pr-9`} disabled={!docs?.length} />
          {query && <button type="button" onClick={() => setQuery('')} aria-label={t('Hapus pencarian', 'Clear search')} className="absolute right-1.5 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-md text-ink-400 hover:bg-paper-deep hover:text-ink-900"><X size={14} /></button>}
        </div>
      </div>

      <div className="mt-5">
        {error && <Toast tone="error" onDismiss={() => setError('')} dismissLabel={t('Tutup', 'Dismiss')} title={t('Notebook tidak bisa dimuat', 'Could not load notebooks')} actions={<Button size="sm" onClick={() => void load(docs ? cursor ?? undefined : undefined)}>{t('Coba lagi', 'Retry')}</Button>}>{error}</Toast>}
        {docs === null ? (<div className={GRID} role="status" aria-label={t('Memuat notebook…', 'Loading notebooks…')}>{Array.from({ length: 8 }, (_, index) => <NotebookCardSkeleton key={index} />)}</div>)
          : docs.length === 0 ? (
            <div className="flex flex-col items-center rounded-2xl border border-dashed border-line-strong bg-white px-6 py-10 text-center">
              <span className="grid h-12 w-12 place-items-center rounded-xl bg-brand-50 text-brand-700"><NotebookPen size={22} aria-hidden="true" /></span>
              <p className="mt-3 font-semibold text-ink-900">{t('Belum ada notebook', 'No notebooks yet')}</p>
              <p className="mt-1 text-sm text-ink-500">{t('Tempel draft di beranda untuk membuat notebook pertamamu.', 'Paste a draft on the home page to create your first notebook.')}</p>
              <div className="mt-4">{newNotebook}</div>
            </div>
          ) : visible && visible.length === 0 ? (
            <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-white px-5 py-4 text-sm text-ink-600">
              <SearchX size={18} aria-hidden="true" className="text-ink-400" />
              <span className="min-w-0 flex-1">{t(`Tidak ada notebook yang cocok dengan “${query.trim()}”.`, `No notebooks match “${query.trim()}”.`)}{cursor ? t(' Muat lebih banyak untuk mencari notebook lama.', ' Load more to search older notebooks.') : ''}</span>
              <Button size="sm" onClick={() => setQuery('')}>{t('Hapus pencarian', 'Clear search')}</Button>
            </div>
          ) : (
            <div className={GRID}>
              {visible?.map((doc) => <NotebookCard key={doc.id} doc={doc} onChange={(next) => setDocs((current) => current?.map((item) => (item.id === next.id ? next : item)) ?? null)} onDelete={(id) => setDocs((current) => current?.filter((item) => item.id !== id) ?? null)} />)}
            </div>
          )}
        {cursor && docs && <div className="mt-5 text-center"><Button loading={loadingMore} onClick={() => void load(cursor)}>{t('Muat lebih banyak', 'Load more')}</Button></div>}
      </div>
    </main>
  );
}
