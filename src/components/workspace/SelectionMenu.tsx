'use client';
import { useEffect, useRef, useState } from 'react';
import type { Editor } from '@tiptap/react';
import { PluginKey } from '@tiptap/pm/state';
import { BubbleMenu } from '@tiptap/react/menus';
import { BriefcaseBusiness, Ellipsis, Feather, GraduationCap, LockKeyhole, LockKeyholeOpen, Minimize2, ScanText, Shuffle, SlidersHorizontal, Smile, type LucideIcon } from 'lucide-react';
import { useLocale } from '@/lib/client/locale';
import { numberFormat } from '@/lib/client/format';
import { INLINE_LIMIT } from '@/lib/writing/settings';
import { useEntitlements } from '@/components/app/AppShell';
import type { WritingStyle } from '@/lib/writing/styles';
import { StyleMark } from '@/components/writing/StyleMark';
import { commandLabel, type SelectionCommand } from './selection-commands';
import type { InlineAction } from './types';
import { useAutoSide } from '@/components/ui/placement';

const MENU_KEY = new PluginKey('selectionMenu');
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

// Hidden while an inline result is open so the two never stack on the same text.
type Props = { editor: Editor; locked: boolean; disabled: boolean; hidden: boolean; chars: number; styles: WritingStyle[]; onCommand: (command: SelectionCommand) => void; onStyle: (style: WritingStyle) => void };
const INLINE: Array<[InlineAction, LucideIcon]> = [['alternatives', Shuffle], ['shorter', Minimize2], ['clearer', ScanText], ['formal', BriefcaseBusiness], ['natural', Smile]];

export function SelectionMenu({ editor, locked, disabled, hidden, chars, styles, onCommand, onStyle }: Props) {
  const { t, locale } = useLocale();
  const [more, setMore] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const moreRef = useRef<HTMLDivElement>(null);
  const placement = useAutoSide(more, ref, moreRef);
  const { limits } = useEntitlements();
  const overInline = chars > INLINE_LIMIT; const overSelection = chars > limits.runLimit;
  const limit = overSelection ? limits.runLimit : INLINE_LIMIT;
  const hint = overInline ? t(`${numberFormat(chars, 'id')}/${numberFormat(limit, 'id')} karakter — persingkat pilihan`, `${numberFormat(chars, 'en')}/${numberFormat(limit, 'en')} characters — shorten the selection`) : '';

  useEffect(() => {
    const reset = () => setMore(false);
    editor.on('selectionUpdate', reset);
    return () => { editor.off('selectionUpdate', reset); };
  }, [editor]);
  // The plugin only re-checks visibility on selection or document changes, so hiding is driven explicitly.
  useEffect(() => {
    if (hidden) { setMore(false); editor.view.dispatch(editor.state.tr.setMeta(MENU_KEY, 'hide')); return; }
    const { from, to } = editor.state.selection;
    if (editor.isEditable && to > from && editor.state.doc.textBetween(from, to, ' ').trim()) editor.view.dispatch(editor.state.tr.setMeta(MENU_KEY, 'show'));
  }, [editor, hidden]);
  useEffect(() => {
    if (!more) return;
    const close = (event: MouseEvent | KeyboardEvent) => { if (event instanceof KeyboardEvent ? event.key === 'Escape' : !ref.current?.contains(event.target as Node)) setMore(false); };
    document.addEventListener('mousedown', close); document.addEventListener('keydown', close);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', close); };
  }, [more]);

  const run = (command: SelectionCommand) => () => { setMore(false); onCommand(command); };
  const runStyle = (style: WritingStyle) => () => { setMore(false); onStyle(style); };

  return (
    <BubbleMenu
      editor={editor}
      pluginKey={MENU_KEY}
      options={{ placement: 'top', offset: 10, flip: true, shift: { padding: 12 } }}
      shouldShow={({ editor: e, from, to }) => !hidden && e.isEditable && to - from > 0 && e.state.doc.textBetween(from, to, ' ').trim().length > 0}
      className="z-30"
    >
      <div ref={ref} className="relative max-w-[92vw]">
        <div role="toolbar" aria-label={t('Aksi untuk teks terpilih', 'Actions for selected text')} className="rounded-2xl border border-line bg-white p-1 shadow-[0_2px_6px_rgb(0_0_0/0.05),0_12px_28px_-12px_rgb(0_0_0/0.18)]">
          {locked ? (
            <Action icon={LockKeyholeOpen} label={commandLabel('unlock', t)} disabled={disabled} onRun={run('unlock')} />
          ) : (
            <div className="flex items-center gap-0.5">
              <div className="scrollbar-thin flex min-w-0 items-center gap-0.5 overflow-x-auto">
                {INLINE.map(([command, icon]) => <Action key={command} icon={icon} label={commandLabel(command, t)} disabled={disabled || overInline} title={overInline ? hint : undefined} onRun={run(command)} />)}
              </div>
              <span aria-hidden="true" className="mx-0.5 h-5 w-px shrink-0 bg-line" />
              <button type="button" aria-label={t('Aksi lainnya', 'More actions')} title={t('Aksi lainnya', 'More actions')} aria-haspopup="menu" aria-expanded={more} onMouseDown={keep} onClick={() => setMore(!more)}
                className={`grid h-8 w-8 shrink-0 place-items-center rounded-full transition-colors ${more ? 'bg-paper-deep text-ink-900' : 'text-ink-600 hover:bg-paper-deep hover:text-ink-900'}`}>
                <Ellipsis size={16} aria-hidden="true" />
              </button>
            </div>
          )}
          {hint && !locked && <p role="status" className="border-t border-line px-2.5 pb-0.5 pt-1.5 text-[11px] font-medium text-amber-800">{hint}</p>}
        </div>
        {more && !locked && (
          <div ref={moreRef} role="menu" style={{ maxHeight: placement.maxHeight }} className={`scrollbar-thin absolute right-0 z-40 w-56 overflow-y-auto rounded-xl border border-line bg-white p-1 shadow-lg animate-fade-up ${placement.side === 'bottom' ? 'top-full mt-1.5' : 'bottom-full mb-1.5'}`}>
            <MenuAction icon={Feather} label={commandLabel('humanize', t)} disabled={disabled || overSelection} onRun={run('humanize')} />
            <MenuAction icon={GraduationCap} label={commandLabel('academic', t)} disabled={disabled || overSelection} onRun={run('academic')} />
            {styles.length > 0 && (
              <>
                <div className="my-1 h-px bg-line" />
                <p className="px-2.5 pb-1 pt-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-400">{t('Skills', 'Skills')}</p>
                {styles.map((style) => (
                  <button key={style.id} type="button" role="menuitem" disabled={disabled || overSelection} onMouseDown={keep} onClick={runStyle(style)}
                    className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-[13px] text-ink-700 hover:bg-paper disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent">
                    <StyleMark style={style} size={22} /><span className="min-w-0 truncate">{style.name}</span>
                  </button>
                ))}
              </>
            )}
            <div className="my-1 h-px bg-line" />
            <MenuAction icon={SlidersHorizontal} label={commandLabel('customize', t)} disabled={disabled || overSelection} onRun={run('customize')} />
            <MenuAction icon={LockKeyhole} label={commandLabel('lock', t)} disabled={disabled} onRun={run('lock')} />
            <p className="px-2.5 pb-1 pt-1.5 text-[11px] text-ink-500">{t(`${numberFormat(chars, locale)} karakter dipilih`, `${numberFormat(chars, locale)} characters selected`)}</p>
          </div>
        )}
      </div>
    </BubbleMenu>
  );
}
