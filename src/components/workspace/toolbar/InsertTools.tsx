'use client';
import { useState } from 'react';
import type { Editor } from '@tiptap/react';
import { ListTree, Omega, StickyNote, Trash2 } from 'lucide-react';
import { useLocale } from '@/lib/client/locale';
import { MAX_FOOTNOTE_CHARS, footnoteText } from '@/lib/editor/extensions/footnote';
import { ChoiceList, CONTROL, keepSelection, Popover } from './Popover';

// The characters a writer reaches for that no keyboard has; grouped the way Word's own dialog groups them.
const CHARACTERS: Array<{ id: string; en: string; glyphs: string }> = [
  { id: 'Umum', en: 'General', glyphs: '©®™§¶†‡•…–—‘’“”«»‹›°′″¿¡№&@#~¬' },
  { id: 'Mata uang', en: 'Currency', glyphs: '$€£¥₩₫₹¢₽₺₦₱' },
  { id: 'Matematika', en: 'Mathematics', glyphs: '±×÷≈≠≤≥√∞∑∏∫∂∆πµ‰¼½¾¹²³⁴₀₁₂₃∈∉∪∩⊂⊃' },
  { id: 'Panah', en: 'Arrows', glyphs: '←→↑↓↔↕⇐⇒⇔↵⇑⇓' },
  { id: 'Yunani', en: 'Greek', glyphs: 'αβγδεζηθικλμνξορστυφχψωΓΔΘΛΞΠΣΦΨΩ' },
  { id: 'Huruf beraksen', en: 'Accented letters', glyphs: 'áàâäãåéèêëíìîïóòôöõúùûüñçøæœßÁÉÍÓÚÑÇ' },
  { id: 'Tanda', en: 'Marks', glyphs: '✓✗☐☒★☆♦♣♥♠☺☹⚠' },
];

export function SpecialCharacterButton({ editor, disabled }: { editor: Editor; disabled: boolean }) {
  const { t } = useLocale();
  return (
    <Popover label={t('Karakter khusus', 'Special characters')} disabled={disabled} role="dialog" focusFirst={false} triggerClassName={CONTROL}
      trigger={<Omega size={15} aria-hidden="true" />}>
      {(close) => (
        <div className="w-[17.5rem] p-1">
          {CHARACTERS.map((group) => (
            <div key={group.id} className="mb-1.5 last:mb-0">
              <div className="px-1 pb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-400">{t(group.id, group.en)}</div>
              <div className="grid grid-cols-10 gap-0.5">
                {[...group.glyphs].map((glyph) => (
                  <button key={glyph} type="button" title={glyph} aria-label={glyph} onMouseDown={keepSelection}
                    onClick={() => { close(); editor.chain().focus().insertContent(glyph).run(); }}
                    className="grid h-7 w-7 place-items-center rounded-md text-[15px] text-ink-800 hover:bg-paper-deep">{glyph}</button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </Popover>
  );
}

// One button for both jobs: it writes a new note, or edits the one the caret sits on.
export function FootnoteButton({ editor, disabled }: { editor: Editor; disabled: boolean }) {
  const { t } = useLocale();
  const active = editor.isActive('footnote');
  const current = footnoteText(editor.getAttributes('footnote').text);
  const [draft, setDraft] = useState('');
  return (
    <Popover label={active ? t('Ubah catatan kaki', 'Edit footnote') : t('Sisipkan catatan kaki', 'Insert footnote')} disabled={disabled}
      role="dialog" focusFirst={false} active={active} triggerClassName={CONTROL} onOpen={() => setDraft(active ? current : '')}
      trigger={<StickyNote size={15} aria-hidden="true" />}>
      {(close) => (
        <div className="w-72 p-1.5">
          <label htmlFor="footnote-text" className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-ink-400">
            {t('Isi catatan kaki', 'Footnote text')}
          </label>
          <textarea id="footnote-text" rows={3} value={draft} maxLength={MAX_FOOTNOTE_CHARS} autoFocus
            onChange={(event) => setDraft(event.target.value)}
            className="w-full resize-none rounded-lg border border-line-strong bg-white px-2 py-1.5 text-[13px] text-ink-900 focus:border-brand-400 focus:outline-none focus:ring-3 focus:ring-brand-100" />
          <div className="mt-1.5 flex items-center justify-between gap-2">
            {active ? (
              <button type="button" onMouseDown={keepSelection} onClick={() => { close(); editor.chain().focus().deleteSelection().run(); }}
                className="inline-flex h-7 items-center gap-1.5 rounded-lg px-2 text-[12.5px] font-semibold text-red-700 hover:bg-red-50">
                <Trash2 size={13} aria-hidden="true" />{t('Hapus', 'Delete')}
              </button>
            ) : <span className="text-[11.5px] text-ink-400">{t('Muncul di kaki halaman di Word.', 'Sits at the page foot in Word.')}</span>}
            <button type="button" disabled={!draft.trim()} onMouseDown={keepSelection}
              onClick={() => { close(); const text = draft.trim(); if (active) editor.chain().focus().updateFootnote(text).run(); else editor.chain().focus().setFootnote(text).run(); }}
              className="inline-flex h-7 items-center rounded-lg bg-brand-700 px-2.5 text-[12.5px] font-semibold text-white hover:bg-brand-800 disabled:opacity-40">
              {active ? t('Simpan', 'Save') : t('Sisipkan', 'Insert')}
            </button>
          </div>
        </div>
      )}
    </Popover>
  );
}

export function TocButton({ editor, disabled }: { editor: Editor; disabled: boolean }) {
  const { t } = useLocale();
  const exists = (() => { let found = false; editor.state.doc.descendants((node) => { if (node.type.name === 'tableOfContents') found = true; return !found; }); return found; })();
  return (
    <Popover label={t('Daftar isi', 'Table of contents')} disabled={disabled} triggerClassName={CONTROL} trigger={<ListTree size={15} aria-hidden="true" />}>
      {(close) => <div className="w-60"><ChoiceList close={close} checkable={false} items={[
        { key: 'insert', label: exists ? t('Ganti daftar isi di sini', 'Replace the table of contents') : t('Sisipkan daftar isi', 'Insert table of contents'), onSelect: () => editor.chain().focus().insertTableOfContents().run() },
        { key: 'refresh', label: t('Perbarui daftar isi', 'Update table of contents'), disabled: !exists, onSelect: () => editor.chain().focus().refreshTableOfContents().run() },
      ]} /></div>}
    </Popover>
  );
}
