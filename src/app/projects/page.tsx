'use client';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { FolderOpen, Plus, Search, SearchX, X } from 'lucide-react';
import { useLocale } from '@/lib/client/locale';
import { errorText, request } from '@/lib/client/api';
import { AppShell, PageHeader, useSessionGuard, type DocumentSummary } from '@/components/app/AppShell';
import { ProjectCard, ProjectCardSkeleton } from '@/components/app/ProjectCard';
import { Toast } from '@/components/ui/Toast';
import { Button, buttonClass } from '@/components/ui/Button';
import { inputClass } from '@/components/ui/Field';

export default function ProjectsPage() {
  return <AppShell><Projects /></AppShell>;
}

const GRID = 'grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4';

function Projects() {
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
  const newProject = <Link href="/app#compose" className={buttonClass('primary')}><Plus size={17} aria-hidden="true" />{t('Proyek baru', 'New project')}</Link>;

  return (
    <main className="mx-auto w-full max-w-6xl px-4 pb-12 pt-8 sm:px-6">
      <PageHeader title={t('Proyek', 'Projects')} description={t('Semua tulisanmu, privat untuk akunmu.', 'All your writing, private to your account.')} actions={newProject} />
      <div className="mt-5 flex flex-wrap items-center gap-3">
        <div className="relative w-full sm:max-w-xs">
          <Search size={16} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
          <input type="search" aria-label={t('Cari proyek', 'Search projects')} value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('Cari judul proyek…', 'Search project titles…')} className={`${inputClass} pl-9 pr-9`} disabled={!docs?.length} />
          {query && <button type="button" onClick={() => setQuery('')} aria-label={t('Hapus pencarian', 'Clear search')} className="absolute right-1.5 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-md text-ink-400 hover:bg-paper-deep hover:text-ink-900"><X size={14} /></button>}
        </div>
        {docs && docs.length > 0 && <p className="text-xs text-ink-500" aria-live="polite">{term ? t(`${visible?.length ?? 0} dari ${docs.length} proyek dimuat`, `${visible?.length ?? 0} of ${docs.length} loaded projects`) : t(`${docs.length} proyek dimuat`, `${docs.length} projects loaded`)}</p>}
      </div>

      <div className="mt-5">
        {error && <Toast tone="error" onDismiss={() => setError('')} dismissLabel={t('Tutup', 'Dismiss')} title={t('Proyek tidak bisa dimuat', 'Could not load projects')} actions={<Button size="sm" onClick={() => void load(docs ? cursor ?? undefined : undefined)}>{t('Coba lagi', 'Retry')}</Button>}>{error}</Toast>}
        {docs === null ? (<div className={GRID} role="status" aria-label={t('Memuat proyek…', 'Loading projects…')}>{Array.from({ length: 8 }, (_, index) => <ProjectCardSkeleton key={index} />)}</div>)
          : docs.length === 0 ? (
            <div className="flex flex-col items-center rounded-2xl border border-dashed border-line-strong bg-white px-6 py-10 text-center">
              <span className="grid h-12 w-12 place-items-center rounded-xl bg-brand-50 text-brand-700"><FolderOpen size={22} aria-hidden="true" /></span>
              <p className="mt-3 font-semibold text-ink-900">{t('Belum ada proyek', 'No projects yet')}</p>
              <p className="mt-1 text-sm text-ink-500">{t('Tempel draft di beranda untuk membuat proyek pertamamu.', 'Paste a draft on the home page to create your first project.')}</p>
              <div className="mt-4">{newProject}</div>
            </div>
          ) : visible && visible.length === 0 ? (
            <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-white px-5 py-4 text-sm text-ink-600">
              <SearchX size={18} aria-hidden="true" className="text-ink-400" />
              <span className="min-w-0 flex-1">{t(`Tidak ada proyek yang cocok dengan “${query.trim()}”.`, `No projects match “${query.trim()}”.`)}{cursor ? t(' Muat lebih banyak untuk mencari proyek lama.', ' Load more to search older projects.') : ''}</span>
              <Button size="sm" onClick={() => setQuery('')}>{t('Hapus pencarian', 'Clear search')}</Button>
            </div>
          ) : (
            <div className={GRID}>
              {visible?.map((doc) => <ProjectCard key={doc.id} doc={doc} onChange={(next) => setDocs((current) => current?.map((item) => (item.id === next.id ? next : item)) ?? null)} onDelete={(id) => setDocs((current) => current?.filter((item) => item.id !== id) ?? null)} />)}
            </div>
          )}
        {cursor && docs && <div className="mt-5 text-center"><Button loading={loadingMore} onClick={() => void load(cursor)}>{t('Muat lebih banyak', 'Load more')}</Button></div>}
      </div>
    </main>
  );
}
