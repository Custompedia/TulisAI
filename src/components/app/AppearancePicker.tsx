'use client';
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { Check, Search, X } from 'lucide-react';
import { useLocale } from '@/lib/client/locale';
import { errorText, newKey, request } from '@/lib/client/api';
import { NOTEBOOK_COLORS, NOTEBOOK_ICON_NAMES, formatNotebookIcon, notebookTone, parseNotebookIcon, type NotebookAppearance, type NotebookColor } from '@/lib/notebook/appearance';
import { toneClass } from '@/components/writing/modes';
import { NOTEBOOK_ICONS } from './NotebookIcon';
import { useSessionGuard } from './AppShell';

const EMOJI: Array<[string, string]> = [
  ['📘', 'buku biru book blue'], ['📗', 'buku hijau book green'], ['📙', 'buku oranye book orange'], ['📕', 'buku merah book red'], ['📓', 'notebook catatan notes'], ['📔', 'jurnal journal diary'], ['📒', 'buku besar ledger'], ['📚', 'buku perpustakaan books library'],
  ['📝', 'catatan tulis memo write'], ['✍️', 'menulis tangan writing hand'], ['🖊️', 'pena pen'], ['✏️', 'pensil pencil'], ['🖋️', 'pena tinta fountain pen'], ['📄', 'dokumen halaman document page'], ['📃', 'halaman gulung page curl'], ['📑', 'penanda tab bookmark'],
  ['📰', 'koran berita newspaper news'], ['🗞️', 'koran gulung rolled newspaper'], ['📋', 'papan klip clipboard'], ['📌', 'pin tanda pushpin'], ['📎', 'klip paperclip'], ['🔖', 'penanda bookmark'], ['🗂️', 'map folder dividers'], ['📁', 'folder map'],
  ['🎓', 'wisuda kuliah akademik graduation academic'], ['🏫', 'sekolah school'], ['🔬', 'mikroskop riset science research'], ['🧪', 'lab eksperimen experiment'], ['📐', 'penggaris segitiga ruler math'], ['🧮', 'sempoa hitung abacus math'], ['🌍', 'dunia bumi world globe'], ['🗺️', 'peta map'],
  ['💼', 'kerja bisnis tas work business briefcase'], ['📊', 'grafik data chart'], ['📈', 'naik tren growth chart up'], ['💰', 'uang keuangan money finance'], ['🏦', 'bank'], ['🤝', 'kerja sama deal handshake'], ['📧', 'email surel mail'], ['✉️', 'surat amplop letter envelope'],
  ['📅', 'kalender jadwal calendar'], ['⏰', 'alarm waktu clock time'], ['🗓️', 'agenda planner'], ['✅', 'selesai cek done check'], ['🎯', 'target tujuan goal'], ['🚀', 'roket peluncuran launch rocket'], ['💡', 'ide lampu idea light'], ['🧠', 'otak pikir brain think'],
  ['⭐', 'bintang favorit star favorite'], ['✨', 'kilau ajaib sparkles magic'], ['🔥', 'api panas fire hot'], ['❤️', 'hati cinta heart love'], ['🌟', 'bersinar glowing star'], ['🎉', 'pesta rayakan party celebrate'], ['🏆', 'piala juara trophy win'], ['👑', 'mahkota crown'],
  ['🎨', 'seni lukis art paint'], ['🎭', 'teater drama theater'], ['🎬', 'film video movie'], ['🎵', 'musik lagu music song'], ['📷', 'foto kamera photo camera'], ['🎙️', 'podcast mikrofon microphone'], ['📣', 'pengumuman megaphone announce'], ['💬', 'obrolan chat comment'],
  ['☕', 'kopi coffee'], ['🍵', 'teh tea'], ['🌱', 'tumbuh tanaman sprout plant'], ['🌿', 'daun herbal leaf'], ['🌸', 'bunga sakura flower'], ['🌙', 'bulan malam moon night'], ['☀️', 'matahari sun'], ['🌊', 'ombak laut wave sea'],
  ['🏠', 'rumah home house'], ['✈️', 'pesawat perjalanan travel plane'], ['🧳', 'koper liburan luggage trip'], ['💻', 'laptop komputer computer'], ['⚙️', 'pengaturan gear settings'], ['🔒', 'kunci privat lock private'], ['⚖️', 'hukum adil law scale'], ['🏛️', 'pemerintah museum government'],
];
const EMOJI_COLS = 8;
const ICON_COLS = 7;
const WIDTH = 320;

type Appearance = { color: string | null; icon: string | null };

// Optimistic save: applies locally, PATCHes, reverts to the last confirmed value on failure.
export function useAppearanceSave(id: string, current: Appearance, apply: (next: Appearance) => void, onSaved?: () => void) {
  const { locale } = useLocale();
  const guard = useSessionGuard();
  const [error, setError] = useState('');
  const confirmed = useRef<Appearance>(current);
  const latest = useRef(0);
  const save = useCallback(async (next: NotebookAppearance) => {
    const seq = ++latest.current; setError(''); apply(next);
    try {
      const saved = await request<Appearance>(`/api/documents/${id}/appearance`, 'PATCH', next, newKey());
      confirmed.current = { color: saved.color, icon: saved.icon };
      if (seq === latest.current) onSaved?.();
    } catch (caught) {
      if (seq !== latest.current) return;
      apply(confirmed.current);
      if (!guard(caught)) setError(errorText(caught, locale === 'en'));
    }
  }, [apply, guard, id, locale, onSaved]);
  return { save, error, clearError: () => setError('') };
}

const subscribe = () => () => {};

// Tabs, colour swatches, and emoji/icon grids; shared by the popover and the new-notebook dialog.
export function AppearanceFields({ color, icon, mode, onSelect, trailing, gridHeight = 'max-h-52' }: { color: string | null; icon: string | null; mode: string | null; onSelect: (next: NotebookAppearance) => void; trailing?: React.ReactNode; gridHeight?: string }) {
  const { t } = useLocale();
  const id = useId();
  const parsed = parseNotebookIcon(icon);
  const [tab, setTab] = useState<'emoji' | 'icon'>(parsed?.kind === 'icon' ? 'icon' : 'emoji');
  const [query, setQuery] = useState('');
  const storedColor = NOTEBOOK_COLORS.find((value) => value === color) ?? null;
  const tone = notebookTone(color, mode);
  const term = query.trim().toLowerCase();
  const emoji = useMemo(() => (term ? EMOJI.filter(([char, words]) => words.includes(term) || char === term) : EMOJI), [term]);

  // Arrow keys move focus within a grid of buttons.
  const gridKeys = (cols: number) => (event: React.KeyboardEvent<HTMLDivElement>) => {
    const step = ({ ArrowRight: 1, ArrowLeft: -1, ArrowDown: cols, ArrowUp: -cols } as Record<string, number>)[event.key]; if (!step) return;
    const nodes = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button')); const index = nodes.indexOf(document.activeElement as HTMLButtonElement); if (index < 0) return;
    event.preventDefault(); nodes[Math.min(Math.max(index + step, 0), nodes.length - 1)]?.focus();
  };

  const cell = 'grid h-9 w-9 place-items-center rounded-lg outline-none transition-colors hover:bg-paper-deep focus-visible:bg-paper-deep focus-visible:ring-2 focus-visible:ring-brand-400';
  const tabClass = (active: boolean) => `h-8 rounded-md px-2.5 text-[13px] font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-brand-400 ${active ? 'bg-paper-deep text-ink-900' : 'text-ink-500 hover:text-ink-900'}`;

  return (
    <>
      <div className="flex items-center gap-1 border-b border-line px-2 pt-2 pb-1.5">
        <div role="tablist" aria-label={t('Jenis ikon', 'Icon type')} className="flex gap-1">
          <button type="button" role="tab" id={`${id}-emoji`} aria-selected={tab === 'emoji'} aria-controls={`${id}-panel`} onClick={() => setTab('emoji')} className={tabClass(tab === 'emoji')}>Emoji</button>
          <button type="button" role="tab" id={`${id}-icon`} aria-selected={tab === 'icon'} aria-controls={`${id}-panel`} onClick={() => setTab('icon')} className={tabClass(tab === 'icon')}>{t('Ikon', 'Icons')}</button>
        </div>
        <div className="ml-auto flex items-center gap-1">{trailing}</div>
      </div>

      <div className="border-b border-line px-3 py-2.5">
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-400">{t('Warna', 'Colour')}</p>
        <div role="radiogroup" aria-label={t('Warna folder', 'Folder colour')} className="flex items-center justify-between">
          {NOTEBOOK_COLORS.map((value: NotebookColor) => {
            const selected = storedColor === value;
            return (
              <button key={value} type="button" role="radio" aria-checked={selected} aria-label={colorName(value, t)} title={colorName(value, t)} onClick={() => onSelect({ color: value, icon: parsed ? icon : null })}
                className={`grid h-8 w-8 place-items-center rounded-full border-2 outline-none transition-transform hover:scale-110 focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:ring-offset-1 ${toneClass[value].fill} ${toneClass[value].edge} ${toneClass[value].ink}`}>
                {selected && <Check size={15} strokeWidth={2.6} aria-hidden="true" />}
              </button>
            );
          })}
        </div>
      </div>

      <div id={`${id}-panel`} role="tabpanel" aria-labelledby={`${id}-${tab}`} className="p-2">
        {tab === 'emoji' ? (
          <>
            <div className="relative mb-2">
              <Search size={14} aria-hidden="true" className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-400" />
              <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('Cari emoji…', 'Search emoji…')} aria-label={t('Cari emoji', 'Search emoji')}
                className="h-8 w-full rounded-lg border border-line bg-paper pl-8 pr-2 text-[13px] text-ink-900 outline-none placeholder:text-ink-400 focus:border-brand-400 focus:bg-white" />
            </div>
            {emoji.length === 0 ? <p className="px-2 py-6 text-center text-[13px] text-ink-500">{t(`Tidak ada emoji untuk “${query.trim()}”.`, `No emoji for “${query.trim()}”.`)}</p> : (
              <div onKeyDown={gridKeys(EMOJI_COLS)} className={`scrollbar-thin grid ${gridHeight} grid-cols-8 justify-items-center overflow-y-auto`}>
                {emoji.map(([char, words]) => {
                  const selected = parsed?.kind === 'emoji' && parsed.value === char;
                  return <button key={char} type="button" aria-label={words.split(' ')[0]} aria-pressed={selected} onClick={() => onSelect({ color: storedColor, icon: formatNotebookIcon({ kind: 'emoji', value: char }) })} className={`${cell} text-[22px] leading-none ${selected ? 'bg-paper-deep ring-1 ring-line-strong' : ''}`}>{char}</button>;
                })}
              </div>
            )}
          </>
        ) : (
          <div onKeyDown={gridKeys(ICON_COLS)} className={`scrollbar-thin grid ${gridHeight} grid-cols-7 justify-items-center gap-y-1 overflow-y-auto`}>
            {NOTEBOOK_ICON_NAMES.map((name) => {
              const Icon = NOTEBOOK_ICONS[name]; const selected = parsed?.kind === 'icon' && parsed.name === name;
              return <button key={name} type="button" aria-label={name} title={name} aria-pressed={selected} onClick={() => onSelect({ color: storedColor, icon: formatNotebookIcon({ kind: 'icon', name }) })} className={`${cell} ${toneClass[tone].ink} ${selected ? `${toneClass[tone].fill} ring-1 ring-line-strong` : ''}`}><Icon size={19} aria-hidden="true" /></button>;
            })}
          </div>
        )}
      </div>
    </>
  );
}

export function AppearancePicker({ anchor, color, icon, mode, onSelect, onClose }: { anchor: HTMLElement | null; color: string | null; icon: string | null; mode: string | null; onSelect: (next: NotebookAppearance) => void; onClose: () => void }) {
  const { t } = useLocale();
  const mounted = useSyncExternalStore(subscribe, () => true, () => false);
  const panel = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);

  const place = useCallback(() => {
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect(); const height = panel.current?.offsetHeight ?? 380; const margin = 12;
    const left = Math.min(Math.max(margin, rect.right - WIDTH), window.innerWidth - WIDTH - margin);
    const below = rect.bottom + 6; const top = below + height > window.innerHeight - margin && rect.top - height - 6 > margin ? rect.top - height - 6 : below;
    setPosition({ top: Math.max(margin, top), left: Math.max(margin, left) });
  }, [anchor]);

  useLayoutEffect(() => { place(); }, [place]);
  useEffect(() => {
    const onDown = (event: MouseEvent) => { const target = event.target as Node; if (!panel.current?.contains(target) && !anchor?.contains(target)) onClose(); };
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); onClose(); } };
    document.addEventListener('mousedown', onDown); document.addEventListener('keydown', onKey); window.addEventListener('resize', place); window.addEventListener('scroll', place, true);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); };
  }, [anchor, onClose, place]);
  const placed = position !== null;
  useEffect(() => { if (placed) panel.current?.querySelector<HTMLElement>('input[type="search"], [role="tab"][aria-selected="true"]')?.focus({ preventScroll: true }); }, [placed]);

  if (!mounted) return null;
  return createPortal(
    <div ref={panel} role="dialog" aria-label={t('Ubah ikon & warna', 'Change icon & colour')} onClick={(event) => event.stopPropagation()}
      style={{ top: position?.top ?? -9999, left: position?.left ?? -9999, visibility: position ? 'visible' : 'hidden' }}
      className="fixed z-[60] w-80 max-w-[calc(100vw-1.5rem)] rounded-xl border border-line bg-white shadow-[0_16px_40px_-12px_rgb(31_32_29/0.28)]">
      <AppearanceFields color={color} icon={icon} mode={mode} onSelect={onSelect} trailing={<>
        <button type="button" onClick={() => onSelect({ color: null, icon: null })} disabled={!color && !icon} className="h-8 rounded-md px-2 text-[13px] font-medium text-ink-500 outline-none hover:text-red-700 focus-visible:ring-2 focus-visible:ring-brand-400 disabled:opacity-40 disabled:hover:text-ink-500">{t('Hapus', 'Remove')}</button>
        <button type="button" onClick={onClose} aria-label={t('Tutup', 'Close')} className="grid h-8 w-8 place-items-center rounded-md text-ink-400 outline-none hover:bg-paper-deep hover:text-ink-900 focus-visible:ring-2 focus-visible:ring-brand-400"><X size={15} aria-hidden="true" /></button>
      </>} />
    </div>,
    document.body,
  );
}

function colorName(color: NotebookColor, t: (id: string, en: string) => string) {
  return { green: t('Hijau', 'Green'), blue: t('Biru', 'Blue'), orange: t('Oranye', 'Orange'), slate: t('Abu biru', 'Slate'), pink: t('Merah muda', 'Pink'), gold: t('Emas', 'Gold'), gray: t('Abu-abu', 'Gray') }[color];
}
