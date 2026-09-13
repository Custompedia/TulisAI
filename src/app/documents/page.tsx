'use client';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { FilePlus2, FolderOpen } from 'lucide-react';
import { del } from 'idb-keyval';
import { useLocale } from '@/lib/client/locale';
import { errorText, newKey, request } from '@/lib/client/api';
import { AppShell, PageHeader, useSessionGuard, useShell, type DocumentSummary } from '@/components/app/AppShell';
import { DocumentRow } from '@/components/app/DocumentCard';
import { Alert } from '@/components/ui/Alert';
import { Button, buttonClass } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/Modal';
import { LoadingBlock } from '@/components/ui/Spinner';

export default function DocumentsPage() {
  return <AppShell><Documents /></AppShell>;
}

function Documents() {
  const { t, locale } = useLocale();
  const { user, refresh } = useShell();
  const guard = useSessionGuard();
  const [docs, setDocs] = useState<DocumentSummary[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [target, setTarget] = useState<DocumentSummary | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async (next?: string) => {
    setError(''); if (next) setLoadingMore(true);
    try {
      const page = await request<{ items: DocumentSummary[]; nextCursor: string | null }>(`/api/documents?limit=20${next ? `&cursor=${encodeURIComponent(next)}` : ''}`);
      setDocs((current) => (next && current ? [...current, ...page.items] : page.items)); setCursor(page.nextCursor);
    } catch (caught) { if (!guard(caught)) setError(errorText(caught, locale === 'en')); }
    finally { setLoadingMore(false); }
  }, [guard, locale]);
  useEffect(() => { void load(); }, [load]);

  async function remove() {
    if (!target) return;
    setDeleting(true);
    try {
      await request(`/api/documents/${target.id}`, 'DELETE', {}, newKey());
      await del(`writing-draft:${user.id}:${target.id}`).catch(() => undefined);
      setDocs((current) => current?.filter((doc) => doc.id !== target.id) ?? null); setTarget(null); void refresh();
    } catch (caught) { if (!guard(caught)) setError(errorText(caught, locale === 'en')); setTarget(null); }
    finally { setDeleting(false); }
  }

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6 sm:py-12">
      <PageHeader title={t('Dokumen', 'Documents')} description={t('Semua tulisanmu, privat untuk akunmu.', 'All your writing, private to your account.')}
        actions={<Link href="/documents/new" className={buttonClass('primary')}><FilePlus2 size={17} aria-hidden="true" />{t('Tulisan baru', 'New document')}</Link>} />
      <div className="mt-7">
        {error && <Alert tone="error" className="mb-4" actions={<Button size="sm" onClick={() => void load()}>{t('Coba lagi', 'Retry')}</Button>}>{error}</Alert>}
        {docs === null && !error ? <div className="rounded-2xl border border-line bg-white"><LoadingBlock label={t('Memuat dokumen…', 'Loading documents…')} /></div>
          : docs && docs.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-line-strong bg-white/60 px-6 py-14 text-center">
              <FolderOpen size={32} className="mx-auto text-ink-300" aria-hidden="true" />
              <p className="mt-3 font-semibold text-ink-800">{t('Belum ada dokumen', 'No documents yet')}</p>
              <p className="mt-1 text-sm text-ink-500">{t('Mulai dari tulisan baru atau tempel draft di beranda.', 'Start a new document or paste a draft on the home page.')}</p>
              <Link href="/documents/new" className={buttonClass('primary', 'md', 'mt-5')}><FilePlus2 size={17} aria-hidden="true" />{t('Tulisan baru', 'New document')}</Link>
            </div>
          ) : docs && (
            <>
              <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-white">{docs.map((doc) => <DocumentRow key={doc.id} doc={doc} onDelete={setTarget} />)}</ul>
              {cursor && <div className="mt-4 text-center"><Button loading={loadingMore} onClick={() => void load(cursor)}>{t('Muat lebih banyak', 'Load more')}</Button></div>}
            </>
          )}
      </div>
      {target && (
        <ConfirmDialog title={t('Hapus dokumen?', 'Delete document?')} tone="danger" busy={deleting} confirmLabel={t('Hapus permanen', 'Delete permanently')} onClose={() => setTarget(null)} onConfirm={() => void remove()}>
          <p>{t('Dokumen', 'The document')} <b className="text-ink-900">“{target.title}”</b> {t('beserta semua versi dan pratinjaunya akan dihapus. Tindakan ini tidak bisa dibatalkan.', 'and all its versions and previews will be deleted. This cannot be undone.')}</p>
        </ConfirmDialog>
      )}
    </main>
  );
}
