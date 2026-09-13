'use client';
import Link from 'next/link';
import { ArrowUpRight, Clock3, FileText, Trash2 } from 'lucide-react';
import { useLocale } from '@/lib/client/locale';
import { relativeTime } from '@/lib/client/format';
import { isMode } from '@/lib/writing/settings';
import { modeIcon, modeLabel } from '@/components/writing/modes';
import type { DocumentSummary } from './AppShell';

export function ModeBadge({ mode }: { mode: string | null }) {
  const { t } = useLocale();
  if (!isMode(mode)) return null;
  const Icon = modeIcon[mode];
  return <span className="inline-flex items-center gap-1 rounded-md bg-brand-50 px-2 py-0.5 text-[11px] font-semibold text-brand-700"><Icon size={12} aria-hidden="true" />{modeLabel(mode, t)}</span>;
}

export function DocumentRow({ doc, onDelete }: { doc: DocumentSummary; onDelete?: (doc: DocumentSummary) => void }) {
  const { t, locale } = useLocale();
  const language = doc.language === 'id' ? 'ID' : doc.language === 'en' ? 'EN' : 'Auto';
  return (
    <li className="group relative flex items-center gap-4 px-4 py-3.5 transition-colors hover:bg-paper/70 sm:px-5">
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-paper-deep text-ink-500"><FileText size={18} aria-hidden="true" /></span>
      <div className="min-w-0 flex-1">
        <Link href={`/documents/${doc.id}`} className="block truncate text-sm font-semibold text-ink-900 after:absolute after:inset-0 hover:text-brand-700">{doc.title}</Link>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-500">
          <span className="inline-flex items-center gap-1"><Clock3 size={12} aria-hidden="true" />{t('Diedit', 'Edited')} {relativeTime(doc.updatedAt, locale)}</span>
          <span>{language}</span>
          <ModeBadge mode={doc.mode} />
        </div>
      </div>
      {onDelete && (
        <button type="button" onClick={() => onDelete(doc)} aria-label={`${t('Hapus', 'Delete')} ${doc.title}`} className="relative z-10 grid h-9 w-9 place-items-center rounded-lg text-ink-400 opacity-100 hover:bg-red-50 hover:text-red-600 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100"><Trash2 size={16} /></button>
      )}
      <ArrowUpRight size={16} aria-hidden="true" className="shrink-0 text-ink-300 transition-colors group-hover:text-brand-600" />
    </li>
  );
}
