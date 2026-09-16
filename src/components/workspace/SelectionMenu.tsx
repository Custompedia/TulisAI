'use client';
import { useEffect, useRef, useState } from 'react';
import type { Editor } from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';
import { BriefcaseBusiness, Ellipsis, Feather, GraduationCap, LockKeyhole, LockKeyholeOpen, Minimize2, Repeat2, ScanText, SlidersHorizontal, Smile, WandSparkles, type LucideIcon } from 'lucide-react';
import { useLocale } from '@/lib/client/locale';
import { numberFormat } from '@/lib/client/format';
import { INLINE_LIMIT, SELECTION_LIMIT } from '@/lib/writing/settings';
import type { InlineAction } from './types';

export type SelectionCommand = InlineAction | 'humanize' | 'academic' | 'lock' | 'unlock' | 'custom';

const keep = (event: React.MouseEvent) => event.preventDefault();

function Action({ icon: Icon, label, onRun, disabled, title }: { icon: LucideIcon; label: string; onRun: () => void; disabled?: boolean; title?: string }) {
  return (
    <button type="button" disabled={disabled} title={title} onMouseDown={keep} onClick={onRun}
      className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-[13px] font-medium text-ink-700 transition-colors hover:bg-paper-deep hover:text-ink-900 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent">
      <Icon size={14} aria-hidden="true" />{label}
    </button>
  );
}

function MenuAction({ icon: Icon, label, onRun, disabled }: { icon: LucideIcon; label: string; onRun: () => void; disabled?: boolean }) {
  return (
    <button type="button" role="menuitem" disabled={disabled} onMouseDown={keep} onClick={onRun}
      className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-[13px] text-ink-700 hover:bg-paper disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent">
      <Icon size={15} aria-hidden="true" />{label}
    </button>
  );
}

type Props = { editor: Editor; locked: boolean; disabled: boolean; chars: number; onCommand: (command: SelectionCommand) => void };

export function SelectionMenu({ editor, locked, disabled, chars, onCommand }: Props) {
  const { t, locale } = useLocale();
  const [more, setMore] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const overInline = chars > INLINE_LIMIT; const overSelection = chars > SELECTION_LIMIT;
  const limit = overSelection ? SELECTION_LIMIT : INLINE_LIMIT;
  const hint = overInline ? t(`${numberFormat(chars, 'id')}/${numberFormat(limit, 'id')} karakter — persingkat pilihan`, `${numberFormat(chars, 'en')}/${numberFormat(limit, 'en')} characters — shorten the selection`) : '';

  useEffect(() => {
    const reset = () => setMore(false);
    editor.on('selectionUpdate', reset);
    return () => { editor.off('selectionUpdate', reset); };
  }, [editor]);
  useEffect(() => {
    if (!more) return;
    const close = (event: MouseEvent | KeyboardEvent) => { if (event instanceof KeyboardEvent ? event.key === 'Escape' : !ref.current?.contains(event.target as Node)) setMore(false); };
    document.addEventListener('mousedown', close); document.addEventListener('keydown', close);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', close); };
  }, [more]);

  const run = (command: SelectionCommand) => () => { setMore(false); onCommand(command); };
  const inline: Array<[InlineAction, LucideIcon, string]> = [
    ['paraphrase', Repeat2, t('Parafrase', 'Paraphrase')], ['shorter', Minimize2, t('Lebih singkat', 'Shorter')], ['clearer', ScanText, t('Lebih jelas', 'Clearer')],
    ['formal', BriefcaseBusiness, t('Lebih formal', 'More formal')], ['natural', Smile, t('Lebih natural', 'More natural')], ['alternatives', WandSparkles, t('Alternatif', 'Alternatives')],
  ];

  return (
    <BubbleMenu
      editor={editor}
      options={{ placement: 'top', offset: 10, flip: true, shift: { padding: 12 } }}
      shouldShow={({ editor: e, from, to }) => e.isEditable && to - from > 0 && e.state.doc.textBetween(from, to, ' ').trim().length > 0}
      className="z-30"
    >
      <div ref={ref} className="relative max-w-[92vw]">
        <div role="toolbar" aria-label={t('Aksi untuk teks terpilih', 'Actions for selected text')} className="rounded-2xl border border-line bg-white p-1 shadow-[0_2px_6px_rgb(0_0_0/0.05),0_12px_28px_-12px_rgb(0_0_0/0.18)]">
          {locked ? (
            <Action icon={LockKeyholeOpen} label={t('Buka kunci istilah', 'Unlock term')} disabled={disabled} onRun={run('unlock')} />
          ) : (
            <div className="flex items-center gap-0.5">
              <div className="scrollbar-thin flex min-w-0 items-center gap-0.5 overflow-x-auto">
                {inline.map(([command, icon, label]) => <Action key={command} icon={icon} label={label} disabled={disabled || overInline} title={overInline ? hint : undefined} onRun={run(command)} />)}
              </div>
              <span aria-hidden="true" className="mx-0.5 h-5 w-px shrink-0 bg-line" />
              <span className={`shrink-0 px-1.5 text-[11px] tabular-nums ${overInline ? 'font-semibold text-amber-700' : 'text-ink-400'}`} aria-label={t(`${chars} karakter dipilih`, `${chars} characters selected`)}>{numberFormat(chars, locale)}</span>
              <button type="button" aria-label={t('Aksi lainnya', 'More actions')} title={t('Aksi lainnya', 'More actions')} aria-haspopup="menu" aria-expanded={more} onMouseDown={keep} onClick={() => setMore(!more)}
                className={`grid h-8 w-8 shrink-0 place-items-center rounded-full transition-colors ${more ? 'bg-paper-deep text-ink-900' : 'text-ink-600 hover:bg-paper-deep hover:text-ink-900'}`}>
                <Ellipsis size={16} aria-hidden="true" />
              </button>
            </div>
          )}
          {hint && !locked && <p role="status" className="border-t border-line px-2.5 pb-0.5 pt-1.5 text-[11px] font-medium text-amber-800">{hint}</p>}
        </div>
        {more && !locked && (
          <div role="menu" className="absolute right-0 top-full z-40 mt-1.5 w-52 rounded-xl border border-line bg-white p-1 shadow-lg animate-fade-up">
            <MenuAction icon={Feather} label="Humanize" disabled={disabled || overSelection} onRun={run('humanize')} />
            <MenuAction icon={GraduationCap} label={t('Akademik', 'Academic')} disabled={disabled || overSelection} onRun={run('academic')} />
            <MenuAction icon={SlidersHorizontal} label={t('Kustom', 'Custom')} disabled={disabled || overSelection} onRun={run('custom')} />
            <div className="my-1 h-px bg-line" />
            <MenuAction icon={LockKeyhole} label={t('Kunci Istilah', 'Lock Term')} disabled={disabled} onRun={run('lock')} />
          </div>
        )}
      </div>
    </BubbleMenu>
  );
}
