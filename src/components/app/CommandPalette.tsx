'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { FileText, Gauge, Keyboard, NotebookPen, Plus, Search, ShieldCheck, Sparkles, Upload, type LucideIcon } from 'lucide-react';
import { useLocale } from '@/lib/client/locale';
import { request } from '@/lib/client/api';
import { relativeTime } from '@/lib/client/format';
import { guardedPush } from '@/lib/client/navigation-guard';
import { useWritingStyles } from '@/lib/client/styles-store';
import { filterCommands, moveActive, PALETTE_NOTEBOOK_LIMIT, type Command, type CommandGroup } from '@/lib/navigation/commands';
import { requiredTierFor } from '@/lib/plans';
import { Spinner } from '@/components/ui/Spinner';
import { useEntitlements, useShell, type DocumentSummary } from './AppShell';
import { ImportDocxDialog } from './ImportDocxDialog';
import { OPEN_PALETTE_EVENT, openShortcuts, requestNewWriting, showLockedFeature } from './shell-events';

type Entry = Command & { icon: LucideIcon; run: () => void };

export const isPaletteShortcut = (event: KeyboardEvent) => (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'k';

// Ctrl K (⌘K): quick actions, the 50 most recent notebooks, and saved skills. Arrow keys move, Enter opens,
// Esc closes. Notebook search covers the recent list only; server search arrives in a later phase.
export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (isPaletteShortcut(event)) { event.preventDefault(); setOpen((value) => !value); } };
    const onOpen = () => setOpen(true);
    window.addEventListener('keydown', onKey); window.addEventListener(OPEN_PALETTE_EVENT, onOpen);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener(OPEN_PALETTE_EVENT, onOpen); };
  }, []);
  return (
    <>
      {open && <PaletteDialog onClose={() => setOpen(false)} onImport={() => { setOpen(false); setImporting(true); }} />}
      {importing && <ImportDocxDialog onClose={() => setImporting(false)} />}
    </>
  );
}

function PaletteDialog({ onClose, onImport }: { onClose: () => void; onImport: () => void }) {
  const { t, locale } = useLocale();
  const router = useRouter();
  const { user } = useShell();
  const { has } = useEntitlements();
  const { styles } = useWritingStyles();
  const ref = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [docs, setDocs] = useState<DocumentSummary[] | null>(null);
  const [failed, setFailed] = useState(false);

  // React's autoFocus runs before showModal(), so the search box is focused once the dialog is open.
  useEffect(() => { const node = ref.current; if (node && !node.open) node.showModal(); input.current?.focus(); return () => node?.close(); }, []);
  useEffect(() => {
    let live = true;
    request<{ items: DocumentSummary[] }>(`/api/documents?limit=${PALETTE_NOTEBOOK_LIMIT}`)
      .then((page) => { if (live) setDocs(page.items); })
      .catch(() => { if (live) { setDocs([]); setFailed(true); } });
    return () => { live = false; };
  }, []);

  const go = (href: string) => { onClose(); guardedPush(router, href); };
  const entries = useMemo<Entry[]>(() => {
    const actions: Entry[] = [
      { id: 'new', group: 'actions', icon: Plus, label: t('Tulis baru', 'New writing'), keywords: 'baru buat notebook tulis new create write', run: () => { onClose(); requestNewWriting(); } },
      { id: 'import', group: 'actions', icon: Upload, label: t('Impor DOCX', 'Import DOCX'), description: has('docx_import') ? undefined : t('Paket Pro', 'Pro plan'), keywords: 'impor import word docx unggah upload', run: () => { if (has('docx_import')) onImport(); else { onClose(); showLockedFeature(requiredTierFor('docx_import')); } } },
      { id: 'skill', group: 'actions', icon: Sparkles, label: t('Buat skill', 'Create skill'), keywords: 'skill gaya style buat create', run: () => go('/skills?new=1') },
      { id: 'usage', group: 'actions', icon: Gauge, label: t('Pemakaian & paket', 'Usage & plan'), keywords: 'kuota karakter paket pemakaian usage plan quota billing pembayaran', run: () => go('/settings#pemakaian') },
      { id: 'shortcuts', group: 'actions', icon: Keyboard, label: t('Pintasan keyboard', 'Keyboard shortcuts'), keywords: 'shortcut pintasan keyboard tombol', run: () => { onClose(); openShortcuts(); } },
      ...(user.role === 'admin' ? [{ id: 'admin', group: 'actions' as const, icon: ShieldCheck, label: t('Panel admin', 'Admin panel'), keywords: 'admin pengguna users pembayaran monitoring log', run: () => go('/admin') }] : []),
    ];
    const notebooks: Entry[] = (docs ?? []).map((doc) => ({ id: `doc:${doc.id}`, group: 'notebooks', icon: NotebookPen, label: doc.title || t('Notebook tanpa judul', 'Untitled notebook'), description: relativeTime(doc.updatedAt, locale), keywords: 'notebook', run: () => go(`/notebooks/${doc.id}`) }));
    const skills: Entry[] = styles.map((style) => ({ id: `skill:${style.id}`, group: 'skills', icon: FileText, label: style.name, description: style.description ?? undefined, keywords: 'skill', run: () => go(`/skills?skill=${encodeURIComponent(style.id)}`) }));
    return [...actions, ...notebooks, ...skills];
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `go` and the callbacks only close over stable values
  }, [docs, has, locale, styles, t, user.role]);
  const results = useMemo(() => filterCommands(entries, query), [entries, query]);
  const current = Math.min(active, Math.max(0, results.length - 1));

  const headings: Record<CommandGroup, string> = { actions: t('Aksi cepat', 'Quick actions'), notebooks: t('Notebook · Terbaru', 'Notebooks · Recent'), skills: 'Skill' };
  const optionId = (index: number) => `${listId}-${index}`;

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    // Home and End stay with the text caret; only the arrows move through the list.
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setActive(moveActive(current, results.length, event.key)); return; }
    if (event.key === 'Enter') { event.preventDefault(); results[current]?.run(); }
  };

  useEffect(() => { document.getElementById(optionId(current))?.scrollIntoView({ block: 'nearest' }); });

  return (
    <dialog ref={ref} aria-label={t('Cari notebook, skill, atau menu', 'Search notebooks, skills, or menus')} onCancel={(event) => { event.preventDefault(); onClose(); }} onClick={(event) => { if (event.target === ref.current) onClose(); }}
      className="mx-auto mb-auto mt-[12vh] w-[calc(100%-2rem)] max-w-xl overflow-hidden rounded-2xl border border-line bg-white p-0 text-ink-900 shadow-2xl">
      <div className="flex items-center gap-3 border-b border-line px-4">
        <Search size={18} aria-hidden="true" className="shrink-0 text-ink-400" />
        <input ref={input} value={query} onChange={(event) => { setQuery(event.target.value); setActive(0); }} onKeyDown={onKeyDown}
          role="combobox" aria-expanded="true" aria-controls={listId} aria-autocomplete="list" aria-activedescendant={results.length ? optionId(current) : undefined}
          aria-label={t('Cari', 'Search')} placeholder={t('Cari notebook, skill, atau menu…', 'Search notebooks, skills, or menus…')}
          className="h-14 min-w-0 flex-1 bg-transparent text-[15px] text-ink-900 placeholder:text-ink-400 focus:outline-none" />
        <kbd className="hidden shrink-0 rounded-md border border-line bg-paper px-1.5 py-0.5 text-[11px] font-medium text-ink-500 sm:inline">Esc</kbd>
      </div>
      <div id={listId} role="listbox" aria-label={t('Hasil', 'Results')} className="scrollbar-thin max-h-[min(60vh,28rem)] overflow-y-auto p-2">
        {results.length === 0 ? (
          <p className="px-3 py-6 text-center text-sm text-ink-500">{docs === null ? t('Memuat…', 'Loading…') : t('Tidak ada yang cocok.', 'Nothing matches.')}</p>
        ) : (['actions', 'notebooks', 'skills'] as const).map((group) => {
          const items = results.filter((item) => item.group === group);
          if (!items.length) return null;
          return (
            <div key={group} role="group" aria-label={headings[group]} className="mb-1">
              <p className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-500">{headings[group]}</p>
              {items.map((item) => {
                const index = results.indexOf(item); const Icon = item.icon; const selected = index === current;
                return (
                  <div key={item.id} id={optionId(index)} role="option" aria-selected={selected} onMouseMove={() => setActive(index)} onClick={() => item.run()}
                    className={`flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 ${selected ? 'bg-paper-deep' : ''}`}>
                    <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${item.group === 'actions' ? 'bg-brand-50 text-brand-700' : 'bg-paper text-ink-500'}`}><Icon size={16} aria-hidden="true" /></span>
                    <span className="min-w-0 flex-1"><span className="block truncate text-[13.5px] font-medium text-ink-900">{item.label}</span>{item.description && <span className="block truncate text-[12px] text-ink-500">{item.description}</span>}</span>
                  </div>
                );
              })}
            </div>
          );
        })}
        {docs === null && results.length > 0 && <p className="flex items-center gap-2 px-3 py-2 text-[12px] text-ink-500"><Spinner size={12} />{t('Memuat notebook terbaru…', 'Loading recent notebooks…')}</p>}
        {failed && <p className="px-3 py-2 text-[12px] text-ink-500">{t('Notebook terbaru belum bisa dimuat.', 'Recent notebooks could not be loaded.')}</p>}
      </div>
      <p className="border-t border-line bg-paper/60 px-4 py-2 text-[11.5px] text-ink-500">{t(`Mencari di ${PALETTE_NOTEBOOK_LIMIT} notebook terbaru. ↑↓ pilih · Enter buka`, `Searching the ${PALETTE_NOTEBOOK_LIMIT} most recent notebooks. ↑↓ select · Enter open`)}</p>
    </dialog>
  );
}
