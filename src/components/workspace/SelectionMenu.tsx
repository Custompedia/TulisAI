'use client';
import type { Editor } from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';
import { Feather, GraduationCap, LockKeyhole, LockKeyholeOpen, Minimize2, Repeat2, ScanText, SlidersHorizontal, WandSparkles, type LucideIcon } from 'lucide-react';
import { useLocale } from '@/lib/client/locale';
import type { InlineAction } from './types';

export type SelectionCommand = InlineAction | 'humanize' | 'academic' | 'lock' | 'unlock' | 'custom';

function Action({ icon: Icon, label, onRun, disabled, accent }: { icon: LucideIcon; label: string; onRun: () => void; disabled?: boolean; accent?: boolean }) {
  return (
    <button type="button" disabled={disabled} onMouseDown={(event) => event.preventDefault()} onClick={onRun}
      className={`inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-[13px] font-semibold transition-colors disabled:opacity-40 ${accent ? 'text-amber-300 hover:bg-white/10' : 'text-ink-100 hover:bg-white/10 hover:text-white'}`}>
      <Icon size={14} aria-hidden="true" />{label}
    </button>
  );
}

export function SelectionMenu({ editor, locked, disabled, onCommand }: { editor: Editor; locked: boolean; disabled: boolean; onCommand: (command: SelectionCommand) => void }) {
  const { t } = useLocale();
  return (
    <BubbleMenu
      editor={editor}
      options={{ placement: 'top', offset: 10, flip: true, shift: { padding: 12 } }}
      shouldShow={({ editor: e, from, to }) => e.isEditable && to - from > 0 && e.state.doc.textBetween(from, to, ' ').trim().length > 0}
      className="z-30"
    >
      <div role="toolbar" aria-label={t('Aksi untuk teks terpilih', 'Actions for selected text')} className="scrollbar-thin flex max-w-[92vw] items-center gap-0.5 overflow-x-auto rounded-xl bg-ink-950 p-1 shadow-xl ring-1 ring-black/10">
        {locked ? (
          <Action icon={LockKeyholeOpen} label={t('Buka kunci istilah', 'Unlock term')} accent disabled={disabled} onRun={() => onCommand('unlock')} />
        ) : (
          <>
            <Action icon={Repeat2} label={t('Parafrase', 'Paraphrase')} disabled={disabled} onRun={() => onCommand('paraphrase')} />
            <Action icon={Minimize2} label={t('Persingkat', 'Shorter')} disabled={disabled} onRun={() => onCommand('shorter')} />
            <Action icon={ScanText} label={t('Perjelas', 'Clearer')} disabled={disabled} onRun={() => onCommand('clearer')} />
            <Action icon={WandSparkles} label={t('Alternatif', 'Alternatives')} disabled={disabled} onRun={() => onCommand('alternatives')} />
            <span aria-hidden="true" className="mx-0.5 h-5 w-px bg-white/15" />
            <Action icon={Feather} label="Humanize" disabled={disabled} onRun={() => onCommand('humanize')} />
            <Action icon={GraduationCap} label={t('Akademik', 'Academic')} disabled={disabled} onRun={() => onCommand('academic')} />
            <Action icon={SlidersHorizontal} label={t('Kustom', 'Custom')} disabled={disabled} onRun={() => onCommand('custom')} />
            <span aria-hidden="true" className="mx-0.5 h-5 w-px bg-white/15" />
            <Action icon={LockKeyhole} label={t('Kunci Istilah', 'Lock Term')} accent disabled={disabled} onRun={() => onCommand('lock')} />
          </>
        )}
      </div>
    </BubbleMenu>
  );
}
