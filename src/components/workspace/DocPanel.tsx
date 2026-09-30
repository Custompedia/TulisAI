'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import type { Editor } from '@tiptap/react';
import { useEditorState } from '@tiptap/react';
import { ArrowLeft, ChevronDown, ChevronsLeft, Copy, Heading, LockKeyhole, MoreHorizontal, NotebookPen, PenLine, Plus, Search, Sparkles, Target, TextSelect, X } from 'lucide-react';
import { PaidLock } from '@/components/app/PaidLock';
import { useLocale } from '@/lib/client/locale';
import { request } from '@/lib/client/api';
import { numberFormat, relativeTime } from '@/lib/client/format';
import { clampDocPanelWidth, DOC_PANEL_MAX_WIDTH, DOC_PANEL_MIN_WIDTH } from '@/lib/navigation/doc-panel';
import { BRIEF_KEYS, BRIEF_VALUE_LIMIT, WORD_TARGET_MAX, type BriefKey, type NotebookMeta } from '@/lib/writing/notebook-meta';
import { docTypeShort, isDocType } from '@/lib/writing/doc-types';
import { PICKER_SEARCH_DELAY_MS, searchQuery } from '@/lib/navigation/library';
import type { Mode } from '@/lib/writing/settings';
import type { DocumentSummary } from '@/components/app/AppShell';
import { requestNewWriting } from '@/components/app/shell-events';
import { IconButton } from '@/components/ui/Button';
import { inputClass } from '@/components/ui/Field';
import { modeLabel, modeToneClass } from '@/components/writing/modes';
import { outlineSections, type OutlineSection } from './editor-rules';
import type { Term } from './types';

type Props = {
  editor: Editor | null; loaded: boolean; navigable: boolean; text: string; words: number; terms: Term[]; busy: boolean;
  docId: string; title: string; meta: NotebookMeta; mode: Mode;
  onMeta: (patch: NotebookMeta) => void; onUnlock: (term: Term) => void; onOpenAssistant: () => void; onNavigate?: () => void;
  onCopied: (message: string) => void;
  // "Olah bagian ini dengan AI": puts the Asisten on the section under the heading at this position.
  onProcessSection?: (headingPos: number) => void;
  // UX 3, Draf dari brief: "Tulis bagian ini" on a section with no words yet, and "Tulis bagian pertama" under the
  // Brief. `draftLocked` shows both with a padlock that opens the plans. `briefOpen` unfolds the Brief on arrival.
  onDraftSection?: (headingPos: number) => void; onDraftFirst?: () => void; draftLocked?: boolean; briefOpen?: boolean;
  // « on desktop, X in the phone sheet.
  onClose: () => void; sheet?: boolean;
};

const LABEL = 'mb-2 flex items-center justify-between gap-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-500';

// The editor's left column: back to the library, switch notebook, what this notebook is, its outline (with the
// words in each section), locked terms, and the writer's own brief. AI runs only from the explicit section actions.
export function DocPanelContent({ editor, loaded, navigable, text, words, terms, busy, docId, title, meta, mode, onMeta, onUnlock, onOpenAssistant, onNavigate, onCopied, onProcessSection, onDraftSection, onDraftFirst, draftLocked = false, briefOpen = false, onClose, sheet = false }: Props) {
  const { t } = useLocale();
  const tone = modeToneClass(mode);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex h-12 shrink-0 items-center gap-1 border-b border-line pl-4 pr-2">
        <h2 className="min-w-0 flex-1 truncate text-[13px] font-semibold text-ink-900">{t('Dokumen', 'Document')}</h2>
        <IconButton size="sm" icon={sheet ? X : ChevronsLeft} label={sheet ? t('Tutup', 'Close') : t('Tutup panel Dokumen', 'Close the Document panel')} onClick={onClose} />
      </header>
      <div className="scrollbar-thin min-h-0 flex-1 space-y-6 overflow-y-auto px-3 pb-6 pt-3">
        <div className="space-y-2">
          <Link href="/notebooks" className="flex h-8 items-center gap-2 rounded-lg px-2 text-[13px] font-medium text-ink-600 transition-colors hover:bg-paper-deep hover:text-ink-900"><ArrowLeft size={15} aria-hidden="true" />{t('Semua notebook', 'All notebooks')}</Link>
          <Switcher docId={docId} title={title} />
          <div className="flex flex-wrap items-center gap-1.5 px-1">
            <span className="rounded-md border border-line bg-paper px-2 py-0.5 text-[11.5px] font-semibold text-ink-700">{isDocType(meta.docType) ? docTypeShort(meta.docType, t) : t('Tanpa jenis', 'No type')}</span>
            <span aria-hidden="true" className="text-ink-300">·</span>
            <button type="button" onClick={onOpenAssistant} title={t('Buka Asisten', 'Open Assistant')} className={`rounded-md border px-2 py-0.5 text-[11.5px] font-semibold transition-colors hover:brightness-95 ${tone.edge} ${tone.light} ${tone.ink}`}>{modeLabel(mode, t)}</button>
          </div>
          <WordTarget words={words} target={meta.wordTarget} onChange={(wordTarget) => onMeta({ wordTarget })} />
        </div>

        <section aria-label={t('Kerangka', 'Outline')}>
          <h3 className={LABEL}><span className="inline-flex items-center gap-1.5"><Heading size={13} aria-hidden="true" />{t('Kerangka', 'Outline')}</span></h3>
          {!loaded || !editor ? <div className="space-y-2" role="status"><div className="h-3 w-3/4 animate-pulse rounded bg-paper-deep" /><div className="h-3 w-1/2 animate-pulse rounded bg-paper-deep" /></div>
            : <Outline editor={editor} navigable={navigable} busy={busy} onNavigate={onNavigate} onCopied={onCopied} onProcess={onProcessSection} onDraft={onDraftSection} draftLocked={draftLocked} />}
        </section>

        <section aria-label={t('Istilah dikunci', 'Locked terms')}>
          <h3 className={LABEL}><span className="inline-flex items-center gap-1.5"><LockKeyhole size={13} aria-hidden="true" />{t('Istilah dikunci', 'Locked terms')}</span><span className="rounded-md bg-paper-deep px-1.5 text-[11px] font-semibold normal-case tracking-normal text-ink-600">{terms.length}</span></h3>
          {terms.length === 0 ? (
            <p className="px-1 text-xs leading-relaxed text-ink-500">{t('Blok istilah di editor lalu pilih kunci di gelembung seleksi. Sitasi seperti (Davis, 1989) otomatis dilindungi; gaya nomor [1] belum dikenali.', 'Select a term in the editor, then the lock in the selection bubble. Citations like (Davis, 1989) are protected automatically; numbered [1] style is not recognised yet.')}</p>
          ) : (
            <ul className="space-y-1.5">
              {terms.map((term) => (
                <li key={term.id} className="flex items-center gap-1.5 rounded-lg border border-line bg-white py-0.5 pl-3 pr-0.5">
                  <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink-800" title={term.term}>{term.term}{!text.includes(term.term) && <span className="ml-1 text-[11px] font-normal text-ink-500">· {t('tidak ada di teks', 'not in text')}</span>}</span>
                  <IconButton size="sm" icon={X} label={`${t('Buka kunci', 'Unlock')} ${term.term}`} disabled={busy} onClick={() => onUnlock(term)} />
                </li>
              ))}
            </ul>
          )}
        </section>

        <Brief meta={meta} onMeta={onMeta} open={briefOpen} busy={busy} locked={draftLocked} onDraftFirst={onDraftFirst} />
      </div>
    </div>
  );
}

// Ganti notebook ▾: the 20 most recent, or a title search over every notebook on the server, with "Tulis baru"
// at the bottom (the same dialog as everywhere).
function Switcher({ docId, title }: { docId: string; title: string }) {
  const { t, locale } = useLocale();
  const [open, setOpen] = useState(false);
  const [docs, setDocs] = useState<DocumentSummary[] | null>(null);
  const [query, setQuery] = useState('');
  const root = useRef<HTMLDivElement>(null);
  const trimmed = query.trim();
  useEffect(() => {
    if (!open) return;
    let live = true;
    const timer = setTimeout(() => {
      request<{ items: DocumentSummary[] }>(`/api/documents?${searchQuery(trimmed, 20)}`).then((page) => { if (live) setDocs(page.items); }, () => { if (live) setDocs([]); });
    }, trimmed ? PICKER_SEARCH_DELAY_MS : 0);
    return () => { live = false; clearTimeout(timer); };
  }, [open, trimmed]);
  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown); document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);
  const shown = (docs ?? []).filter((doc) => doc.id !== docId);
  return (
    <div ref={root} className="relative">
      <button type="button" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(!open)}
        className="flex h-9 w-full items-center gap-2 rounded-lg border border-line bg-white px-2.5 text-left text-[13px] font-semibold text-ink-900 transition-colors hover:border-line-strong">
        <NotebookPen size={15} aria-hidden="true" className="shrink-0 text-brand-700" /><span className="min-w-0 flex-1 truncate">{title || t('Notebook tanpa judul', 'Untitled notebook')}</span><ChevronDown size={14} aria-hidden="true" className="shrink-0 text-ink-400" />
      </button>
      {open && (
        <div role="dialog" aria-label={t('Ganti notebook', 'Switch notebook')} className="absolute inset-x-0 top-full z-40 mt-1 rounded-xl border border-line bg-white p-1.5 shadow-[0_12px_32px_-8px_rgb(31_32_29/0.18)] animate-fade-up">
          <div className="relative mb-1">
            <Search size={14} aria-hidden="true" className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-400" />
            <input autoFocus type="search" value={query} onChange={(event) => setQuery(event.target.value)} aria-label={t('Cari notebook', 'Search notebooks')} placeholder={t('Cari semua notebook…', 'Search all notebooks…')} className={`${inputClass} h-8 pl-8 text-[13px]`} />
          </div>
          <ul className="scrollbar-thin max-h-64 overflow-y-auto">
            {docs === null ? <li role="status" className="px-2.5 py-2 text-xs text-ink-500">{t('Memuat…', 'Loading…')}</li>
              : shown.length === 0 ? <li className="px-2.5 py-2 text-xs text-ink-500">{trimmed ? t(`Tidak ada notebook yang cocok dengan “${trimmed}”.`, `No notebooks match “${trimmed}”.`) : t('Tidak ada notebook lain.', 'No other notebooks.')}</li>
              : shown.map((doc) => (
                <li key={doc.id}><Link href={`/notebooks/${doc.id}`} onClick={() => setOpen(false)} className="block rounded-lg px-2.5 py-1.5 transition-colors hover:bg-paper-deep">
                  <span className="block truncate text-[13px] font-medium text-ink-900">{doc.title}</span>
                  <span className="block truncate text-[11px] text-ink-500">{t('Diedit', 'Edited')} {relativeTime(doc.updatedAt, locale)}</span>
                </Link></li>
              ))}
          </ul>
          <button type="button" onClick={() => { setOpen(false); requestNewWriting(); }} className="mt-1 flex h-9 w-full items-center gap-2 rounded-lg border-t border-line px-2.5 text-[13px] font-semibold text-brand-800 transition-colors hover:bg-brand-50">
            <Plus size={15} aria-hidden="true" />{t('Tulis baru', 'New writing')}
          </button>
        </div>
      )}
    </div>
  );
}

function WordTarget({ words, target, onChange }: { words: number; target?: number; onChange: (target: number | undefined) => void }) {
  const { t, locale } = useLocale();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const commit = () => {
    const value = Number(draft.replace(/[^\d]/g, ''));
    onChange(Number.isInteger(value) && value > 0 ? Math.min(value, WORD_TARGET_MAX) : undefined);
    setEditing(false);
  };
  if (editing) {
    return (
      <form onSubmit={(event) => { event.preventDefault(); commit(); }} className="flex items-center gap-1.5 px-1">
        <Target size={14} aria-hidden="true" className="shrink-0 text-ink-400" />
        <input autoFocus inputMode="numeric" value={draft} onChange={(event) => setDraft(event.target.value)} onBlur={commit} onKeyDown={(event) => { if (event.key === 'Escape') setEditing(false); }}
          aria-label={t('Target kata', 'Word target')} placeholder={t('Mis. 1500', 'E.g. 1500')} className={`${inputClass} h-8 text-[13px]`} />
      </form>
    );
  }
  if (!target) {
    return <button type="button" onClick={() => { setDraft(''); setEditing(true); }} className="flex h-8 items-center gap-2 rounded-lg px-2 text-[12.5px] font-medium text-ink-500 transition-colors hover:bg-paper-deep hover:text-ink-900"><Target size={14} aria-hidden="true" />{t('Tambah target kata', 'Add a word target')}</button>;
  }
  const percent = Math.min(100, Math.round((words / target) * 100));
  return (
    <button type="button" onClick={() => { setDraft(String(target)); setEditing(true); }} title={t('Ubah target kata', 'Change the word target')} className="block w-full rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-paper-deep">
      <span className="flex items-center justify-between text-[12px] text-ink-600"><span className="inline-flex items-center gap-1.5"><Target size={13} aria-hidden="true" />{t('Target', 'Target')}</span><span className="tabular-nums"><b className="font-semibold text-ink-900">{numberFormat(words, locale)}</b> / {numberFormat(target, locale)}</span></span>
      <span className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-paper-deep"><span className={`block h-full rounded-full ${percent >= 100 ? 'bg-brand-600' : 'bg-brand-400'}`} style={{ width: `${percent}%` }} /></span>
    </button>
  );
}

function Outline({ editor, navigable, busy, onNavigate, onCopied, onProcess, onDraft, draftLocked }: { editor: Editor; navigable: boolean; busy: boolean; onNavigate?: () => void; onCopied: (message: string) => void; onProcess?: (headingPos: number) => void; onDraft?: (headingPos: number) => void; draftLocked: boolean }) {
  const { t, locale } = useLocale();
  const [menu, setMenu] = useState<number | null>(null);
  const items = useEditorState({
    editor,
    selector: ({ editor: e }) => {
      const blocks: Array<{ type: string; level?: number; text: string; pos: number; size: number }> = [];
      e.state.doc.forEach((node, offset) => { if (blocks.length < 2000) blocks.push({ type: node.type.name, level: Number(node.attrs.level) || undefined, text: node.textContent, pos: offset, size: node.nodeSize }); });
      return outlineSections(blocks).slice(0, 200);
    },
    equalityFn: (a, b) => JSON.stringify(a) === JSON.stringify(b),
  });
  useEffect(() => {
    if (menu === null) return;
    const close = (event: MouseEvent | KeyboardEvent) => { if (event instanceof KeyboardEvent ? event.key === 'Escape' : !(event.target as Element | null)?.closest?.('[data-outline-menu]')) setMenu(null); };
    document.addEventListener('mousedown', close); document.addEventListener('keydown', close);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', close); };
  }, [menu]);
  function go(item: OutlineSection) {
    const dom = editor.view.nodeDOM(item.pos);
    if (dom instanceof HTMLElement) dom.scrollIntoView({ block: 'start', behavior: 'smooth' });
    if (editor.isEditable) editor.chain().setTextSelection(item.pos + 1).focus(undefined, { scrollIntoView: false }).run();
    onNavigate?.();
  }
  // Selects the heading and everything under it, so the selection bubble (and its actions) appears on the section.
  function select(item: OutlineSection) {
    setMenu(null);
    editor.chain().focus().setTextSelection({ from: item.pos + 1, to: Math.max(item.pos + 1, item.end - 1) }).run();
    onNavigate?.();
  }
  function copy(item: OutlineSection) {
    setMenu(null);
    const value = editor.state.doc.textBetween(item.pos, item.end, '\n', ' ');
    void navigator.clipboard.writeText(value).then(() => onCopied(t('Bagian disalin.', 'Section copied.')), () => onCopied(t('Bagian tidak bisa disalin. Izinkan akses papan klip.', 'The section could not be copied. Allow clipboard access.')));
  }
  if (!items.length) return <p className="px-1 text-xs leading-relaxed text-ink-500">{t('Belum ada judul. Ketik ## lalu spasi, atau pakai Judul di toolbar.', 'No headings yet. Type ## and a space, or use Heading in the toolbar.')}</p>;
  return (
    <ul className="space-y-0.5">
      {items.map((item) => (
        <li key={item.pos} className="group/row relative flex items-center" data-outline-menu={menu === item.pos ? '' : undefined}>
          <button type="button" disabled={!navigable} onClick={() => go(item)} style={{ paddingLeft: `${(item.level - 1) * 12 + 8}px` }}
            className={`flex min-w-0 flex-1 items-center gap-2 rounded-md py-1.5 pr-8 text-left text-[13px] transition-colors hover:bg-paper-deep disabled:cursor-default disabled:opacity-50 disabled:hover:bg-transparent ${item.level === 1 ? 'font-medium text-ink-900' : 'text-ink-700'}`}>
            <span className="min-w-0 flex-1 truncate">{item.text}</span>
            <span className="shrink-0 text-[11px] tabular-nums text-ink-400">{numberFormat(item.words, locale)}</span>
          </button>
          <button type="button" disabled={!navigable} aria-haspopup="menu" aria-expanded={menu === item.pos} aria-label={t(`Opsi bagian ${item.text}`, `Options for ${item.text}`)} onClick={() => setMenu(menu === item.pos ? null : item.pos)}
            className={`absolute right-0.5 grid h-7 w-7 place-items-center rounded-md text-ink-400 transition-opacity hover:bg-white hover:text-ink-900 disabled:opacity-0 ${menu === item.pos ? 'opacity-100' : 'opacity-0 focus-visible:opacity-100 group-hover/row:opacity-100 [@media(hover:none)]:opacity-100'}`}>
            <MoreHorizontal size={15} aria-hidden="true" />
          </button>
          {menu === item.pos && (
            <div role="menu" className="absolute right-0 top-full z-30 mt-1 w-48 rounded-xl border border-line bg-white p-1 shadow-[0_12px_32px_-8px_rgb(31_32_29/0.18)]">
              <button type="button" role="menuitem" onClick={() => select(item)} className="flex h-8 w-full items-center gap-2 rounded-lg px-2.5 text-[13px] font-medium text-ink-700 hover:bg-paper-deep"><TextSelect size={14} aria-hidden="true" />{t('Pilih bagian ini', 'Select this section')}</button>
              <button type="button" role="menuitem" onClick={() => copy(item)} className="flex h-8 w-full items-center gap-2 rounded-lg px-2.5 text-[13px] font-medium text-ink-700 hover:bg-paper-deep"><Copy size={14} aria-hidden="true" />{t('Salin bagian', 'Copy section')}</button>
              {onProcess && item.words > 0 && <button type="button" role="menuitem" disabled={busy} onClick={() => { setMenu(null); onProcess(item.pos); }} className="flex h-8 w-full items-center gap-2 rounded-lg px-2.5 text-[13px] font-medium text-brand-800 hover:bg-brand-50 disabled:opacity-50"><Sparkles size={14} aria-hidden="true" />{t('Olah bagian ini dengan AI', 'Work on this section with AI')}</button>}
              {onDraft && item.words === 0 && <button type="button" role="menuitem" disabled={busy} onClick={() => { setMenu(null); onDraft(item.pos); }} className="flex h-8 w-full items-center gap-2 rounded-lg px-2.5 text-[13px] font-medium text-brand-800 hover:bg-brand-50 disabled:opacity-50"><PenLine size={14} aria-hidden="true" /><span className="flex-1 text-left">{t('Tulis bagian ini', 'Write this section')}</span>{draftLocked && <PaidLock size={12} />}</button>}
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

// The writer's own brief for the piece. Kept with the notebook; Draf dari brief (UX 3) reads it, as data, when it
// writes a section, and nothing else sends it to the AI.
function Brief({ meta, onMeta, open, busy, locked, onDraftFirst }: { meta: NotebookMeta; onMeta: (patch: NotebookMeta) => void; open: boolean; busy: boolean; locked: boolean; onDraftFirst?: () => void }) {
  const { t } = useLocale();
  const ready = !!(meta.briefTopic?.trim() || meta.briefMessage?.trim());
  const fields: Record<BriefKey, [string, string]> = {
    briefTopic: [t('Topik', 'Topic'), t('Mis. cara hemat energi di kos', 'E.g. saving energy in a rented room')],
    briefPlatform: [t('Platform', 'Platform'), t('Mis. Instagram, blog kantor', 'E.g. Instagram, company blog')],
    briefAudience: [t('Pembaca', 'Readers'), t('Mis. mahasiswa tingkat akhir', 'E.g. final-year students')],
    briefMessage: [t('Pesan utama', 'Key message'), t('Satu kalimat yang harus diingat', 'One sentence they should remember')],
    briefCta: [t('Ajakan (CTA)', 'Call to action'), t('Mis. daftar sebelum 10 Okt', 'E.g. sign up before 10 Oct')],
    briefDuration: [t('Durasi', 'Duration'), t('Mis. 60 detik', 'E.g. 60 seconds')],
  };
  const filled = BRIEF_KEYS.some((key) => meta[key]) || !!meta.notes;
  return (
    <details id="notebook-brief" open={filled || open || undefined} className="group/brief">
      <summary className={`${LABEL} cursor-pointer list-none`}><span>{t('Brief / Catatan', 'Brief / Notes')}</span><ChevronDown size={13} aria-hidden="true" className="transition-transform group-open/brief:rotate-180" /></summary>
      <p className="mb-2.5 px-1 text-[11.5px] text-ink-500">{t('Dipakai AI saat menulis draf. Tulis fakta, angka, dan sumbermu di sini; AI tidak menambahkan yang lain.', 'Used by the AI when it writes a draft. Put your facts, figures and sources here; the AI adds none of its own.')}</p>
      <div className="space-y-2.5">
        {BRIEF_KEYS.map((key, index) => (
          <label key={key} className="block px-1 text-[12px] font-semibold text-ink-700">{fields[key][0]}
            <input autoFocus={open && index === 0} value={meta[key] ?? ''} maxLength={BRIEF_VALUE_LIMIT} placeholder={fields[key][1]} onChange={(event) => onMeta({ [key]: event.target.value })} className={`${inputClass} mt-1 h-8 text-[13px] font-normal`} />
          </label>
        ))}
        <label className="block px-1 text-[12px] font-semibold text-ink-700">{t('Catatan', 'Notes')}
          <textarea value={meta.notes ?? ''} maxLength={BRIEF_VALUE_LIMIT} rows={3} placeholder={t('Poin, data, dan sumber yang boleh dipakai', 'Points, data and sources the draft may use')} onChange={(event) => onMeta({ notes: event.target.value })} className={`${inputClass} mt-1 h-auto py-2 text-[13px] font-normal`} />
        </label>
        {onDraftFirst && (
          <div className="space-y-1.5 px-1 pt-1">
            <button type="button" disabled={busy || (!locked && !ready)} onClick={onDraftFirst}
              className="inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-full border border-brand-200 bg-brand-50 px-4 text-[13px] font-semibold text-brand-900 transition-colors hover:bg-brand-100 disabled:cursor-not-allowed disabled:opacity-50">
              <PenLine size={14} aria-hidden="true" />{t('Tulis bagian pertama', 'Write the first section')}{locked && <PaidLock size={12} />}
            </button>
            {!locked && !ready && <p className="text-[11.5px] text-ink-500">{t('Isi Topik atau Pesan utama dulu.', 'Fill in the Topic or the Key message first.')}</p>}
          </div>
        )}
      </div>
    </details>
  );
}

// The desktop column: 190–360px, dragged with a pointer or moved with the arrow keys on its edge (role=separator).
export function DocPanelFrame({ width, onWidth, children }: { width: number; onWidth: (width: number) => void; children: React.ReactNode }) {
  const { t } = useLocale();
  const [drag, setDrag] = useState<number | null>(null);
  const start = useRef<{ x: number; width: number } | null>(null);
  const latest = useRef<number | null>(null);
  const shown = drag ?? width;
  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId);
    start.current = { x: event.clientX, width: shown }; latest.current = shown; setDrag(shown);
  };
  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!start.current) return;
    const next = clampDocPanelWidth(start.current.width + event.clientX - start.current.x);
    latest.current = next; setDrag(next);
  };
  const onPointerEnd = () => {
    if (!start.current) return;
    start.current = null;
    if (latest.current !== null) onWidth(latest.current);
    latest.current = null; setDrag(null);
  };
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 64 : 16;
    const next = event.key === 'ArrowLeft' ? shown - step : event.key === 'ArrowRight' ? shown + step : event.key === 'Home' ? DOC_PANEL_MIN_WIDTH : event.key === 'End' ? DOC_PANEL_MAX_WIDTH : null;
    if (next === null) return;
    event.preventDefault(); onWidth(clampDocPanelWidth(next));
  };
  return (
    <aside aria-label={t('Dokumen', 'Document')} style={{ width: shown }} className="relative mr-3 hidden h-full shrink-0 overflow-hidden rounded-2xl border border-line bg-white lg:block">
      {children}
      <div role="separator" aria-orientation="vertical" aria-label={t('Ubah lebar panel Dokumen', 'Resize the Document panel')} aria-valuemin={DOC_PANEL_MIN_WIDTH} aria-valuemax={DOC_PANEL_MAX_WIDTH} aria-valuenow={shown} tabIndex={0}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerEnd} onPointerCancel={onPointerEnd} onLostPointerCapture={onPointerEnd} onKeyDown={onKeyDown}
        className="group absolute -right-0 bottom-0 top-0 z-10 flex w-2 cursor-col-resize touch-none justify-center outline-none">
        <span className={`h-full w-0.5 rounded-full transition-colors group-hover:bg-brand-300 group-focus-visible:bg-brand-600 ${drag !== null ? 'bg-brand-400' : ''}`} />
      </div>
    </aside>
  );
}
