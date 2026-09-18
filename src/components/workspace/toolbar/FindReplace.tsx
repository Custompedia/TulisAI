'use client';
import { useEffect, useRef, useState } from 'react';
import type { Editor } from '@tiptap/react';
import { TextSelection } from '@tiptap/pm/state';
import { CaseSensitive, ChevronDown, ChevronUp, X } from 'lucide-react';
import { useLocale } from '@/lib/client/locale';
import { Button } from '@/components/ui/Button';
import { inputClass } from '@/components/ui/Field';
import { replaceAll, replaceCurrent, searchState, setSearch, stepSearch } from '@/lib/editor/extensions/search';
import { ACTIVE, CONTROL, IDLE } from './Popover';

type Props = { editor: Editor; replace: boolean; focusKey: number; disabled: boolean; onClose: () => void };

// Floating find & replace, anchored under the toolbar's right edge; matches are editor decorations.
export function FindReplace({ editor, replace, focusKey, disabled, onClose }: Props) {
  const { t, locale } = useLocale();
  const [query, setQuery] = useState(() => {
    const { from, to, empty } = editor.state.selection;
    const selected = empty ? '' : editor.state.doc.textBetween(from, to, ' ');
    return selected.length <= 100 && !selected.includes('\n') ? selected : '';
  });
  const [replacement, setReplacement] = useState('');
  const [matchCase, setMatchCase] = useState(false);
  const [showReplace, setShowReplace] = useState(replace);
  const [notice, setNotice] = useState('');
  const [, bump] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => { if (replace) setShowReplace(true); input.current?.focus(); input.current?.select(); }, [replace, focusKey]);
  useEffect(() => {
    const refresh = () => bump((value) => value + 1);
    editor.on('transaction', refresh);
    return () => { editor.off('transaction', refresh); };
  }, [editor]);
  useEffect(() => { setSearch(editor.view, query, matchCase); setNotice(''); }, [editor, query, matchCase]);
  useEffect(() => () => { if (!editor.isDestroyed) setSearch(editor.view, '', false); }, [editor]);

  const { matches, index } = searchState(editor.state);
  const count = matches.length;
  const locked = disabled || !editor.isEditable;

  function close() {
    const match = searchState(editor.state).matches[searchState(editor.state).index];
    setSearch(editor.view, '', matchCase);
    if (match) editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, match.from, match.to)));
    editor.commands.focus();
    onClose();
  }
  function onKey(event: React.KeyboardEvent) {
    if (event.key === 'Escape') { event.preventDefault(); close(); }
  }
  function onFindKey(event: React.KeyboardEvent) {
    if (event.key === 'Enter') { event.preventDefault(); stepSearch(editor.view, event.shiftKey ? -1 : 1); }
  }
  function all() {
    const replaced = replaceAll(editor.view, replacement);
    setNotice(t(`${replaced} kecocokan diganti`, `${replaced} ${replaced === 1 ? 'match' : 'matches'} replaced`));
  }

  const position = count ? t(`${(index + 1).toLocaleString(locale)} dari ${count.toLocaleString(locale)}`, `${(index + 1).toLocaleString(locale)} of ${count.toLocaleString(locale)}`) : query ? t('Tidak ada', 'No results') : '';

  return (
    <div role="search" aria-label={t('Cari dan ganti', 'Find and replace')} onKeyDown={onKey}
      className="absolute right-3 top-full z-30 mt-2 w-[min(24rem,calc(100%-1.5rem))] rounded-xl border border-line bg-white p-3 shadow-[0_12px_32px_-8px_rgb(31_32_29/0.22)]">
      <div className="flex items-center gap-1.5">
        <div className="relative min-w-0 flex-1">
          <input ref={input} value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={onFindKey}
            aria-label={t('Cari', 'Find')} placeholder={t('Cari di dokumen', 'Find in document')} className={`${inputClass} h-9 pr-16`} />
          <span aria-live="polite" className={`pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-xs tabular-nums ${query && !count ? 'text-amber-700' : 'text-ink-500'}`}>{position}</span>
        </div>
        <button type="button" title={t('Cocokkan huruf besar/kecil', 'Match case')} aria-label={t('Cocokkan huruf besar/kecil', 'Match case')} aria-pressed={matchCase} onClick={() => setMatchCase(!matchCase)} className={`${CONTROL} ${matchCase ? ACTIVE : IDLE}`}><CaseSensitive size={16} aria-hidden="true" /></button>
        <button type="button" title={t('Sebelumnya (Shift+Enter)', 'Previous (Shift+Enter)')} aria-label={t('Sebelumnya', 'Previous')} disabled={!count} onClick={() => stepSearch(editor.view, -1)} className={`${CONTROL} ${IDLE}`}><ChevronUp size={16} aria-hidden="true" /></button>
        <button type="button" title={t('Berikutnya (Enter)', 'Next (Enter)')} aria-label={t('Berikutnya', 'Next')} disabled={!count} onClick={() => stepSearch(editor.view, 1)} className={`${CONTROL} ${IDLE}`}><ChevronDown size={16} aria-hidden="true" /></button>
        <button type="button" title={t('Tutup (Esc)', 'Close (Esc)')} aria-label={t('Tutup', 'Close')} onClick={close} className={`${CONTROL} ${IDLE}`}><X size={16} aria-hidden="true" /></button>
      </div>
      {showReplace ? (
        <div className="mt-2 space-y-2">
          <input value={replacement} onChange={(event) => setReplacement(event.target.value)} disabled={locked}
            onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); replaceCurrent(editor.view, replacement); } }}
            aria-label={t('Ganti dengan', 'Replace with')} placeholder={t('Ganti dengan', 'Replace with')} className={`${inputClass} h-9`} />
          <div className="flex items-center justify-between gap-2">
            <span role="status" className="min-w-0 truncate text-xs text-brand-700">{notice}</span>
            <div className="flex shrink-0 gap-2">
              <Button size="sm" disabled={locked || !count} onClick={() => replaceCurrent(editor.view, replacement)}>{t('Ganti', 'Replace')}</Button>
              <Button size="sm" variant="primary" disabled={locked || !count} onClick={all}>{t('Ganti semua', 'Replace all')}</Button>
            </div>
          </div>
        </div>
      ) : (
        <button type="button" onClick={() => setShowReplace(true)} className="mt-2 text-xs font-semibold text-brand-700 hover:text-brand-900">{t('Ganti…', 'Replace…')}</button>
      )}
    </div>
  );
}
