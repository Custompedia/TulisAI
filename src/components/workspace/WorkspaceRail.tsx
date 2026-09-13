'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { Clock3, FilePlus2, FileText, Feather, House, Settings, type LucideIcon } from 'lucide-react';
import { useLocale } from '@/lib/client/locale';
import { request } from '@/lib/client/api';
import { relativeTime } from '@/lib/client/format';

type Recent = { id: string; title: string; updatedAt: string };

function RailLink({ href, icon: Icon, label }: { href: string; icon: LucideIcon; label: string }) {
  return (
    <Link href={href} aria-label={label} title={label} className="grid h-10 w-10 place-items-center rounded-lg text-ink-300 transition-colors hover:bg-white/10 hover:text-white"><Icon size={19} aria-hidden="true" /></Link>
  );
}

export function WorkspaceRail({ currentId }: { currentId: string }) {
  const { t, locale } = useLocale();
  const [open, setOpen] = useState(false);
  const [recent, setRecent] = useState<Recent[] | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    if (recent === null) request<{ items: Recent[] }>('/api/documents?limit=8').then((page) => setRecent(page.items)).catch(() => setRecent([]));
    const close = (event: MouseEvent | KeyboardEvent) => { if (event instanceof KeyboardEvent ? event.key === 'Escape' : !ref.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close); document.addEventListener('keydown', close);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', close); };
  }, [open, recent]);

  return (
    <nav aria-label={t('Navigasi', 'Navigation')} className="relative z-40 hidden w-14 shrink-0 flex-col items-center gap-1 bg-ink-950 py-3 md:flex" ref={ref}>
      <Link href="/app" aria-label={t('Beranda', 'Home')} className="mb-3 grid h-9 w-9 place-items-center rounded-lg bg-white text-ink-950"><Feather size={17} strokeWidth={2.2} aria-hidden="true" /></Link>
      <RailLink href="/documents/new" icon={FilePlus2} label={t('Tulisan baru', 'New document')} />
      <RailLink href="/app" icon={House} label={t('Beranda', 'Home')} />
      <RailLink href="/documents" icon={FileText} label={t('Dokumen', 'Documents')} />
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} aria-label={t('Dokumen terbaru', 'Recent documents')} title={t('Terbaru', 'Recent')} className={`grid h-10 w-10 place-items-center rounded-lg transition-colors ${open ? 'bg-white/10 text-white' : 'text-ink-300 hover:bg-white/10 hover:text-white'}`}><Clock3 size={19} aria-hidden="true" /></button>
      <div className="mt-auto"><RailLink href="/settings" icon={Settings} label={t('Pengaturan', 'Settings')} /></div>
      {open && (
        <div className="absolute left-full top-3 ml-2 w-72 rounded-xl border border-line bg-white p-2 shadow-xl animate-fade-up">
          <p className="px-2.5 pb-1.5 pt-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-400">{t('Terbaru', 'Recent')}</p>
          {recent === null ? <p className="px-2.5 py-3 text-sm text-ink-500">{t('Memuat…', 'Loading…')}</p> : recent.length === 0 ? <p className="px-2.5 py-3 text-sm text-ink-500">{t('Belum ada dokumen.', 'No documents yet.')}</p> : (
            <ul>{recent.map((doc) => (
              <li key={doc.id}><Link href={`/documents/${doc.id}`} onClick={() => setOpen(false)} aria-current={doc.id === currentId ? 'page' : undefined} className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm ${doc.id === currentId ? 'bg-brand-50 text-brand-800' : 'text-ink-700 hover:bg-paper'}`}>
                <FileText size={15} className="shrink-0 text-ink-400" aria-hidden="true" /><span className="min-w-0 flex-1 truncate font-medium">{doc.title}</span><span className="shrink-0 text-[11px] text-ink-400">{relativeTime(doc.updatedAt, locale)}</span>
              </Link></li>
            ))}</ul>
          )}
        </div>
      )}
    </nav>
  );
}
