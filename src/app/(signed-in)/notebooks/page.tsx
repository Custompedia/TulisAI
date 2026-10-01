'use client';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArchiveRestore, Filter, House, LayoutGrid, List, Lock, NotebookPen, Plus, Search, SearchX, Trash2, Upload, X } from 'lucide-react';
import { useLocale } from '@/lib/client/locale';
import { errorText, newKey, request } from '@/lib/client/api';
import { numberFormat } from '@/lib/client/format';
import { PageHeader, useEntitlements, useSessionGuard, type DocumentSummary } from '@/components/app/AppShell';
import { NotebookCard, NotebookCardSkeleton, type CardRemoval } from '@/components/app/NotebookCard';
import { ImportDocxDialog } from '@/components/app/ImportDocxDialog';
import { useRequiredTierName } from '@/components/app/PaidLock';
import { requestNewWriting, showLockedFeature } from '@/components/app/shell-events';
import { modeLabel } from '@/components/writing/modes';
import { libraryFilter, libraryQuery, notifyLibraryChanged, publishLibraryCounts, type LibraryCounts, type LibrarySort } from '@/lib/navigation/library';
import { docTypeShort, isDocType } from '@/lib/writing/doc-types';
import { requiredTierFor } from '@/lib/plans';
import { Toast } from '@/components/ui/Toast';
import { Button, buttonClass } from '@/components/ui/Button';
import { HintSelect } from '@/components/ui/HintSelect';
import { inputClass, Segmented } from '@/components/ui/Field';

export default function NotebooksPage() {
  return <Suspense><Notebooks /></Suspense>;
}

const GRID = 'grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-5';
const LIST = 'grid gap-2';
// Grid | Daftar is a per-device choice, so it lives in localStorage rather than on the account.
const VIEW_KEY = 'tulis_library_view';
// Typing waits this long before the server is asked, so a word costs one request, not one per letter.
const SEARCH_DELAY_MS = 300;
type View = 'grid' | 'list';
type Page = { items: DocumentSummary[]; nextCursor: string | null; total: number; counts?: LibraryCounts };
function useLibraryView(): [View, (view: View) => void] {
  const [view, setView] = useState<View>('grid');
  useEffect(() => { try { if (window.localStorage.getItem(VIEW_KEY) === 'list') setView('list'); } catch { /* storage unavailable */ } }, []);
  return [view, (next) => { setView(next); try { window.localStorage.setItem(VIEW_KEY, next); } catch { /* storage unavailable */ } }];
}

// The library is listed on the server (UX 2): the search box, Urutkan and the sidebar filters (?type, ?mode,
// ?pinned, ?view=trash) all reach every notebook, not just the pages loaded so far, and the total is exact.
function Notebooks() {
  const { t, locale } = useLocale();
  const router = useRouter();
  const params = useSearchParams();
  const [importing, setImporting] = useState(false);
  const [view, setView] = useLibraryView();
  const { has } = useEntitlements();
  const guard = useSessionGuard();
  const [docs, setDocs] = useState<DocumentSummary[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const [everything, setEverything] = useState<number | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [undo, setUndo] = useState<DocumentSummary | null>(null);
  const paramKey = params.toString();
  // Rebuilt only when the URL changes, so the load callback below keeps a stable identity.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- paramKey is the URL's value, params is not
  const filter = useMemo(() => libraryFilter(params), [paramKey]);
  const ticket = useRef(0);

  useEffect(() => { const timer = setTimeout(() => setSearch(query.trim()), SEARCH_DELAY_MS); return () => clearTimeout(timer); }, [query]);

  const load = useCallback(async (next?: string) => {
    setError(''); if (next) setLoadingMore(true);
    const mine = ++ticket.current;
    try {
      const page = await request<Page>(`/api/documents?${libraryQuery({ ...filter, q: search }, { limit: 20, cursor: next, counts: !next })}`);
      if (mine !== ticket.current) return;
      setDocs((current) => { if (!next || !current) return page.items; const seen = new Set(current.map((doc) => doc.id)); return [...current, ...page.items.filter((doc) => !seen.has(doc.id))]; });
      setCursor(page.nextCursor); setTotal(page.total);
      if (page.counts) { publishLibraryCounts(page.counts); setEverything(page.counts.all); }
    } catch (caught) { if (mine === ticket.current && !guard(caught)) setError(errorText(caught, locale === 'en')); }
    finally { if (mine === ticket.current) setLoadingMore(false); }
  }, [filter, search, guard, locale]);
  useEffect(() => { setDocs(null); void load(); }, [load]);

  const setSort = (sort: LibrarySort) => {
    const next = new URLSearchParams(paramKey);
    if (sort === 'updated') next.delete('sort'); else next.set('sort', sort);
    router.replace(`/notebooks${next.toString() ? `?${next}` : ''}`);
  };
  const removed = (doc: DocumentSummary, removal: CardRemoval) => {
    setDocs((current) => current?.filter((item) => item.id !== doc.id) ?? null); setTotal((value) => Math.max(0, value - 1));
    setUndo(removal === 'trashed' ? doc : null);
  };
  async function restore(doc: DocumentSummary) {
    setUndo(null);
    try { await request(`/api/documents/${doc.id}/restore`, 'POST', {}, newKey()); notifyLibraryChanged(); void load(); }
    catch (caught) { if (!guard(caught)) setError(errorText(caught, locale === 'en')); }
  }

  const canImport = has('docx_import');
  const importTier = useRequiredTierName('docx_import');
  // A locked import stays visible and explains itself, rather than hiding the feature from free accounts.
  const importDocx = (
    <Button icon={Upload} iconRight={canImport ? undefined : Lock} onClick={() => (canImport ? setImporting(true) : showLockedFeature(requiredTierFor('docx_import')))}
      className={canImport ? '' : 'text-ink-500'}
      title={canImport ? t('Impor dokumen Word', 'Import a Word document') : t(`Impor DOCX — buka dengan ${importTier}`, `DOCX import — unlock with ${importTier}`)}>
      {t('Impor DOCX', 'Import DOCX')}
      {!canImport && <span className="rounded bg-ink-100 px-1.5 py-px text-[11px] font-semibold text-ink-600">{importTier}</span>}
    </Button>
  );
  const newNotebook = <Button variant="primary" icon={Plus} onClick={() => requestNewWriting()}>{t('Tulis baru', 'New writing')}</Button>;
  const headerActions = <div className="flex flex-wrap items-center gap-2">{importDocx}{newNotebook}</div>;
  const filterLabel = filter.pinned ? t('Disematkan', 'Pinned')
    : filter.docType ? `${t('Jenis', 'Kind')}: ${isDocType(filter.docType) ? docTypeShort(filter.docType, t) : t('Tanpa jenis', 'No kind')}`
    : filter.mode ? `${t('Mode terakhir', 'Last mode')}: ${modeLabel(filter.mode, t)}` : null;
  const narrowed = !!filterLabel || !!search;
  const libraryEmpty = !filter.trash && !narrowed && everything === 0;
  const sortOptions: Array<{ value: LibrarySort; label: string }> = [
    { value: 'updated', label: t('Terakhir diedit', 'Last edited') }, { value: 'title', label: t('Judul A–Z', 'Title A–Z') }, { value: 'created', label: t('Terbaru dibuat', 'Newest created') },
  ];

  return (
    <main className="mx-auto w-full max-w-6xl px-4 pb-12 pt-8 sm:px-6">
      <PageHeader title={filter.trash ? t('Sampah', 'Trash') : t('Notebook', 'Notebooks')}
        description={filter.trash ? t('Notebook di Sampah dihapus permanen setelah 30 hari. Pulihkan untuk membukanya lagi.', 'Notebooks in the trash are deleted for good after 30 days. Restore one to open it again.') : undefined}
        actions={filter.trash ? undefined : headerActions} />
      <div className="mt-5 flex flex-wrap items-center gap-3">
        <div className="relative w-full sm:max-w-xs">
          <Search size={16} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
          <input type="search" aria-label={t('Cari notebook', 'Search notebooks')} value={query} onChange={(event) => setQuery(event.target.value)} maxLength={100}
            placeholder={filter.trash ? t('Cari di Sampah…', 'Search the trash…') : t('Cari judul notebook…', 'Search notebook titles…')} className={`${inputClass} pl-9 pr-9`} disabled={libraryEmpty} />
          {query && <button type="button" onClick={() => setQuery('')} aria-label={t('Hapus pencarian', 'Clear search')} className="absolute right-1.5 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-md text-ink-400 hover:bg-paper-deep hover:text-ink-900"><X size={14} /></button>}
        </div>
        {!filter.trash && (
          <div className="w-44 shrink-0"><HintSelect size="sm" label={t('Urutkan', 'Sort')} value={filter.sort ?? 'updated'} onChange={setSort} options={sortOptions} /></div>
        )}
        <div className="ml-auto w-[184px] shrink-0">
          <Segmented<View> size="sm" label={t('Tampilan pustaka', 'Library view')} value={view} onChange={setView}
            options={[{ value: 'grid', label: 'Grid', icon: LayoutGrid }, { value: 'list', label: t('Daftar', 'List'), icon: List }]} />
        </div>
      </div>
      {docs && !libraryEmpty && (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-[13px] text-ink-600">
          {filterLabel && <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-white px-3 py-1 font-semibold text-ink-800"><Filter size={13} aria-hidden="true" />{filterLabel}</span>}
          <span className="tabular-nums">{search ? t(`${numberFormat(total, locale)} cocok dengan “${search}”`, `${numberFormat(total, locale)} matching “${search}”`) : t(`${numberFormat(total, locale)} notebook`, `${numberFormat(total, locale)} notebook${total === 1 ? '' : 's'}`)}</span>
          {filterLabel && <Link href="/notebooks" className="font-semibold text-brand-800 hover:text-ink-900">{t('Hapus filter', 'Clear filter')}</Link>}
        </div>
      )}

      <div className="mt-5">
        {error && <Toast tone="error" onDismiss={() => setError('')} dismissLabel={t('Tutup', 'Dismiss')} title={t('Notebook tidak bisa dimuat', 'Could not load notebooks')} actions={<Button size="sm" onClick={() => void load(docs ? cursor ?? undefined : undefined)}>{t('Coba lagi', 'Retry')}</Button>}>{error}</Toast>}
        {undo && <Toast tone="info" duration={8000} onDismiss={() => setUndo(null)} dismissLabel={t('Tutup', 'Dismiss')} actions={<Button size="sm" icon={ArchiveRestore} onClick={() => void restore(undo)}>{t('Urungkan', 'Undo')}</Button>}>{t(`“${undo.title}” dipindahkan ke Sampah.`, `“${undo.title}” moved to the trash.`)}</Toast>}
        {docs === null ? (<div className={GRID} role="status" aria-label={t('Memuat notebook…', 'Loading notebooks…')}>{Array.from({ length: 8 }, (_, index) => <NotebookCardSkeleton key={index} />)}</div>)
          : libraryEmpty ? (
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
          ) : docs.length === 0 ? (
            <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-white px-5 py-4 text-sm text-ink-600">
              {filter.trash && !search ? <Trash2 size={18} aria-hidden="true" className="text-ink-400" /> : <SearchX size={18} aria-hidden="true" className="text-ink-400" />}
              <span className="min-w-0 flex-1">{search ? t(`Tidak ada notebook yang cocok dengan “${search}”.`, `No notebooks match “${search}”.`) : filter.trash ? t('Sampah kosong.', 'The trash is empty.') : t('Belum ada notebook di sini.', 'No notebooks here yet.')}</span>
              {search ? <Button size="sm" onClick={() => setQuery('')}>{t('Hapus pencarian', 'Clear search')}</Button> : filterLabel ? <Link href="/notebooks" className={buttonClass('secondary', 'sm')}>{t('Hapus filter', 'Clear filter')}</Link> : null}
            </div>
          ) : (
            <div className={view === 'list' ? LIST : GRID}>
              {docs.map((doc) => <NotebookCard key={doc.id} doc={doc} view={view} onChange={(next) => setDocs((current) => current?.map((item) => (item.id === next.id ? next : item)) ?? null)} onDelete={(_, removal) => removed(doc, removal)}
                onDuplicate={(copy) => { setDocs((current) => (current ? [copy, ...current] : [copy])); setTotal((value) => value + 1); }} />)}
            </div>
          )}
        {cursor && docs && <div className="mt-5 text-center"><Button loading={loadingMore} onClick={() => void load(cursor)}>{t('Muat lebih banyak', 'Load more')}</Button></div>}
      </div>
      {importing && <ImportDocxDialog onClose={() => setImporting(false)} />}
    </main>
  );
}
