'use client';
import type { Editor } from '@tiptap/react';
import { useEditorState } from '@tiptap/react';
import { Heading, LockKeyhole, X } from 'lucide-react';
import { useLocale } from '@/lib/client/locale';
import { numberFormat } from '@/lib/client/format';
import { changePercentage, countCharacters, countWords, readingMinutes } from '@/lib/editor/metrics';
import { IconButton } from '@/components/ui/Button';
import type { Term } from './types';

type OutlineItem = { level: number; text: string; pos: number };
type Props = { editor: Editor | null; loaded: boolean; navigable: boolean; text: string; original: string | null; hasChanges: boolean; terms: Term[]; busy: boolean; onUnlock: (term: Term) => void; onNavigate?: () => void };

const Title = ({ children, count }: { children: React.ReactNode; count?: number }) => (
  <h3 className="mb-2 flex items-center justify-between text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-400">{children}{count !== undefined && <span className="rounded bg-paper-deep px-1.5 font-semibold normal-case tracking-normal text-ink-600">{count}</span>}</h3>
);

function Outline({ editor, navigable, onNavigate }: { editor: Editor; navigable: boolean; onNavigate?: () => void }) {
  const { t } = useLocale();
  const items = useEditorState({
    editor,
    selector: ({ editor: e }) => {
      const found: OutlineItem[] = [];
      e.state.doc.descendants((node, pos) => {
        if (node.type.name !== 'heading') return !node.isTextblock && found.length < 200;
        if (node.textContent.trim()) found.push({ level: Number(node.attrs.level) || 1, text: node.textContent.trim(), pos });
        return false;
      });
      return found;
    },
  });
  function go(item: OutlineItem) {
    const dom = editor.view.nodeDOM(item.pos);
    if (dom instanceof HTMLElement) dom.scrollIntoView({ block: 'start', behavior: 'smooth' });
    if (editor.isEditable) editor.chain().setTextSelection(item.pos + 1).focus(undefined, { scrollIntoView: false }).run();
    onNavigate?.();
  }
  if (!items.length) return <p className="text-xs leading-relaxed text-ink-500">{t('Belum ada judul. Pakai "Judul 1–3" di toolbar untuk membuat kerangka.', 'No headings yet. Use "Heading 1–3" in the toolbar to build an outline.')}</p>;
  return (
    <ul className="space-y-0.5">
      {items.map((item) => (
        <li key={item.pos}>
          <button type="button" disabled={!navigable} onClick={() => go(item)} style={{ paddingLeft: `${(item.level - 1) * 12 + 8}px` }}
            className={`flex w-full items-center gap-1.5 truncate rounded-md py-1.5 pr-2 text-left text-[13px] transition-colors hover:bg-paper-deep disabled:cursor-default disabled:opacity-50 disabled:hover:bg-transparent ${item.level === 1 ? 'font-semibold text-ink-900' : 'text-ink-700'}`}>
            <span className="truncate">{item.text}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

export function ProjectPanel({ editor, loaded, navigable, text, original, hasChanges, terms, busy, onUnlock, onNavigate }: Props) {
  const { t, locale } = useLocale();
  const n = (value: number) => numberFormat(value, locale);
  const stats: Array<[string, string]> = [
    [t('Kata', 'Words'), n(countWords(text))], [t('Karakter', 'Characters'), n(countCharacters(text))], [t('Waktu baca', 'Reading time'), `≈ ${readingMinutes(text)} ${t('mnt', 'min')}`],
    [t('Berubah dari Original', 'Changed from Original'), original === null ? '—' : hasChanges ? `${changePercentage(original, text)}%` : '0%'],
  ];

  return (
    <div className="scrollbar-thin h-full space-y-6 overflow-y-auto p-4">
      <section aria-label={t('Kerangka', 'Outline')}>
        <Title><span className="inline-flex items-center gap-1.5"><Heading size={12} aria-hidden="true" />{t('Kerangka', 'Outline')}</span></Title>
        {!loaded || !editor ? <div className="space-y-2" role="status"><div className="h-3 w-3/4 animate-pulse rounded bg-paper-deep" /><div className="h-3 w-1/2 animate-pulse rounded bg-paper-deep" /></div> : <Outline editor={editor} navigable={navigable} onNavigate={onNavigate} />}
      </section>

      <section aria-label={t('Istilah dikunci', 'Locked terms')}>
        <Title count={terms.length}><span className="inline-flex items-center gap-1.5"><LockKeyhole size={12} aria-hidden="true" />{t('Istilah dikunci', 'Locked terms')}</span></Title>
        {terms.length === 0 ? (
          <p className="text-xs leading-relaxed text-ink-500">{t('Blok istilah di editor lalu pilih "Kunci Istilah". Sitasi seperti (Davis, 1989) otomatis dilindungi.', 'Select a term in the editor, then choose "Lock Term". Citations like (Davis, 1989) are protected automatically.')}</p>
        ) : (
          <ul className="space-y-1">
            {terms.map((term) => (
              <li key={term.id} className="flex items-center gap-1.5 rounded-md border border-line bg-white py-0.5 pl-2.5 pr-0.5">
                <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink-800" title={term.term}>{term.term}{!text.includes(term.term) && <span className="ml-1 text-[11px] font-normal text-ink-400">· {t('tidak ada di teks', 'not in text')}</span>}</span>
                <IconButton size="sm" icon={X} label={`${t('Buka kunci', 'Unlock')} ${term.term}`} disabled={busy} onClick={() => onUnlock(term)} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-label={t('Statistik dokumen', 'Document stats')}>
        <Title>{t('Statistik', 'Stats')}</Title>
        <dl className="divide-y divide-line rounded-lg border border-line bg-white">
          {stats.map(([label, value]) => <div key={label} className="flex items-center justify-between gap-2 px-3 py-2 text-[13px]"><dt className="text-ink-500">{label}</dt><dd className="font-semibold text-ink-900">{value}</dd></div>)}
        </dl>
      </section>
    </div>
  );
}
