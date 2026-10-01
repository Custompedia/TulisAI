'use client';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { Filter, House, LayoutGrid, List, Lock, NotebookPen, Plus, Search, SearchX, Upload, X } from 'lucide-react';
import { useLocale } from '@/lib/client/locale';
import { errorText, request } from '@/lib/client/api';
import { PageHeader, useEntitlements, useSessionGuard, type DocumentSummary } from '@/components/app/AppShell';
import { NotebookCard, NotebookCardSkeleton } from '@/components/app/NotebookCard';
import { ImportDocxDialog } from '@/components/app/ImportDocxDialog';
import { useRequiredTierName } from '@/components/app/PaidLock';
import { requestNewWriting, showLockedFeature } from '@/components/app/shell-events';
import { modeLabel } from '@/components/writing/modes';
import { filterByMode, libraryMode, publishLibrary } from '@/lib/navigation/library';
import { requiredTierFor } from '@/lib/plans';
import { Toast } from '@/components/ui/Toast';
import { Button, buttonClass } from '@/components/ui/Button';
import { inputClass, Segmented } from '@/components/ui/Field';

export default function NotebooksPage() {
  return <Suspense><Notebooks /></Suspense>;
}

const GRID = 'grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-5';
const LIST = 'grid gap-2';
// Grid | Daftar is a per-device choice, so it lives in localStorage rather than on the account.
const VIEW_KEY = 'tulis_library_view';
type View = 'grid' | 'list';
function useLibraryView(): [View, (view: View) => void] {
  const [view, setView] = useState<View>('grid');
  useEffect(() => { try { if (window.localStorage.getItem(VIEW_KEY) === 'list') setView('list'); } catch { /* storage unavailable */ } }, []);
  return [view, (next) => { setView(next); try { window.localStorage.setItem(VIEW_KEY, next); } catch { /* storage unavailable */ } }];
}

function Notebooks() {
  const { t, locale } = useLocale();
  const [importing, setImporting] = useState(false);
  const [view, setView] = useLibraryView();
  const { has } = useEntitlements();
  const guard = useSessionGuard();
  const [docs, setDocs] = useState<DocumentSummary[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  // ?mode= comes from the sidebar's MODE TERAKHIR group and filters the pages already loaded.
  const mode = libraryMode(useSearchParams().get('mode'));

  const load = useCallback(async (next?: string) => {
    setError(''); if (next) setLoadingMore(true);
    try {
      const page = await request<{ items: DocumentSummary[]; nextCursor: string | null }>(`/api/documents?limit=20${next ? `&cursor=${encodeURIComponent(next)}` : ''}`);
      setDocs((current) => { if (!next || !current) return page.items; const seen = new Set(current.map((doc) => doc.id)); return [...current, ...page.items.filter((doc) => !seen.has(doc.id))]; }); setCursor(page.nextCursor);
    } catch (caught) { if (!guard(caught)) setError(errorText(caught, locale === 'en')); }
    finally { setLoadingMore(false); }
  }, [guard, locale]);
  useEffect(() => { void load(); }, [load]);
  // The sidebar counts per mode only once every page is in (nextCursor null).
  useEffect(() => { publishLibrary(docs, docs !== null && cursor === null); }, [cursor, docs]);
  useEffect(() => () => publishLibrary(null, false), []);

  const term = query.trim().toLowerCase();
  const visible = useMemo(() => { if (!docs) return docs; const byMode = filterByMode(docs, mode); return term ? byMode.filter((doc) => doc.title.toLowerCase().includes(term)) : byMode; }, [docs, mode, term]);
  const canImport = has('docx_import');
  const importTier = useRequiredTierName('docx_import');
  // A locked import stays visible and explains itself, rather than hiding the feature from free accounts.
  const importDocx = (
    <Button icon={Upload} iconRight={canImport ? undefined : Lock} onClick={() => (canImport ? setImporting(true) : showLockedFeature(requiredTierFor('docx_import')))}
      className={canImport ? '' : 'text-ink-500'}
      title={canImport ? t('Impor dokumen Word', 'Import a Word document') : t(`Impor DOCX — buka dengan ${importTier}`, `DOCX import — unlock with ${importTier}`)}>
      {t('Impor DOCX', 'Import DOCX')}
    </Button>
  );
  const newNotebook = <Button variant="primary" icon={Plus} onClick={() => requestNewWriting()}>{t('Tulis baru', 'New writing')}</Button>;
  const headerActions = <div className="flex flex-wrap items-center gap-2">{importDocx}{newNotebook}</div>;

  return (
    <main className="mx-auto w-full max-w-6xl px-4 pb-12 pt-8 sm:px-6">
      <PageHeader title={t('Notebook', 'Notebooks')} actions={headerActions} />
      <div className="mt-5 flex flex-wrap items-center gap-3">
        <div className="relative w-full sm:max-w-xs">
          <Search size={16} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
          <input type="search" aria-label={t('Cari notebook', 'Search notebooks')} value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('Cari judul notebook…', 'Search notebook titles…')} className={`${inputClass} pl-9 pr-9`} disabled={!docs?.length} />
          {query && <button type="button" onClick={() => setQuery('')} aria-label={t('Hapus pencarian', 'Clear search')} className="absolute right-1.5 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-md text-ink-400 hover:bg-paper-deep hover:text-ink-900"><X size={14} /></button>}
        </div>
        <div className="ml-auto w-[184px] shrink-0">
          <Segmented<View> size="sm" label={t('Tampilan pustaka', 'Library view')} value={view} onChange={setView}
            options={[{ value: 'grid', label: 'Grid', icon: LayoutGrid }, { value: 'list', label: t('Daftar', 'List'), icon: List }]} />
        </div>
      </div>
      {/* The mode filter works on the pages already loaded, and says so, until the server can filter (Fase 2). */}
      {mode && docs && docs.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-[13px] text-ink-600">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-white px-3 py-1 font-semibold text-ink-800"><Filter size={13} aria-hidden="true" />{t('Mode terakhir', 'Last mode')}: {modeLabel(mode, t)}</span>
          <span>{cursor ? t(`Menyaring ${docs.length} notebook yang sudah dimuat. Muat lebih banyak untuk memeriksa yang lebih lama.`, `Filtering the ${docs.length} notebooks loaded so far. Load more to check older ones.`) : t('Menyaring semua notebook.', 'Filtering all notebooks.')}</span>
          <Link href="/notebooks" className="font-semibold text-brand-800 hover:text-ink-900">{t('Hapus filter', 'Clear filter')}</Link>
        </div>
      )}

      <div className="mt-5">
        {error && <Toast tone="error" onDismiss={() => setError('')} dismissLabel={t('Tutup', 'Dismiss')} title={t('Notebook tidak bisa dimuat', 'Could not load notebooks')} actions={<Button size="sm" onClick={() => void load(docs ? cursor ?? undefined : undefined)}>{t('Coba lagi', 'Retry')}</Button>}>{error}</Toast>}
        {docs === null ? (<div className={GRID} role="status" aria-label={t('Memuat notebook…', 'Loading notebooks…')}>{Array.from({ length: 8 }, (_, index) => <NotebookCardSkeleton key={index} />)}</div>)
          : docs.length === 0 ? (
            <div className="flex flex-col items-center rounded-2xl border border-dashed border-line-strong bg-white px-6 py-10 text-center">
              <span className="grid h-12 w-12 place-items-center rounded-xl bg-brand-50 text-brand-700"><NotebookPen size={22} aria-hidden="true" /></span>
              <p className="mt-3 font-semibold text-ink-900">{t('Belum ada notebook', 'No notebooks yet')}</p>
              <p className="mt-1 text-sm text-ink-500">{t('Mulai dari kerangka, tempel teks yang ingin diolah, atau impor dokumen Word.', 'Start from an outline, paste text to work on, or import a Word document.')}</p>
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                {newNotebook}
                <Link href="/app" className={buttonClass('secondary', 'md')}><House size={17} aria-hidden="true" />{t('Buka Beranda', 'Open Home')}</Link>
                {importDocx}
              </div>
            </div>
          ) : visible && visible.length === 0 ? (
            <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-white px-5 py-4 text-sm text-ink-600">
              <SearchX size={18} aria-hidden="true" className="text-ink-400" />
              <span className="min-w-0 flex-1">{term ? t(`Tidak ada notebook yang cocok dengan “${query.trim()}”.`, `No notebooks match “${query.trim()}”.`) : t('Belum ada notebook dengan mode ini.', 'No notebooks with this mode yet.')}{cursor ? t(' Muat lebih banyak untuk mencari notebook lama.', ' Load more to search older notebooks.') : ''}</span>
              {term ? <Button size="sm" onClick={() => setQuery('')}>{t('Hapus pencarian', 'Clear search')}</Button> : <Link href="/notebooks" className={buttonClass('secondary', 'sm')}>{t('Hapus filter', 'Clear filter')}</Link>}
            </div>
          ) : (
            <div className={view === 'list' ? LIST : GRID}>
              {visible?.map((doc) => <NotebookCard key={doc.id} doc={doc} view={view} onChange={(next) => setDocs((current) => current?.map((item) => (item.id === next.id ? next : item)) ?? null)} onDelete={(id) => setDocs((current) => current?.filter((item) => item.id !== id) ?? null)}
                onDuplicate={(copy) => setDocs((current) => (current ? [copy, ...current] : [copy]))} />)}
            </div>
          )}
        {cursor && docs && <div className="mt-5 text-center"><Button loading={loadingMore} onClick={() => void load(cursor)}>{t('Muat lebih banyak', 'Load more')}</Button></div>}
      </div>
      {importing && <ImportDocxDialog onClose={() => setImporting(false)} />}
    </main>
  );
}
