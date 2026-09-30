'use client';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ChevronsLeft, ChevronsRight, Copy, Gauge, KeyRound, LayoutList, Menu as MenuIcon, MoreHorizontal, PencilLine, PenLine, Pin, Plus, ScrollText, ShieldCheck, SlidersHorizontal, Sparkles, Tags, Trash2, UserRound, Users, Wallet, type LucideIcon } from 'lucide-react';
import { useLocale } from '@/lib/client/locale';
import { useHash } from '@/lib/client/hash';
import { tierName } from '@/lib/client/quota';
import { useWritingStyles } from '@/lib/client/styles-store';
import { libraryFilter, LIBRARY_CHANGED_EVENT, modeCount, publishLibraryCounts, useLibraryCounts, type LibraryCounts } from '@/lib/navigation/library';
import { request } from '@/lib/client/api';
import { DOC_TYPES, docTypeShort, type DocType } from '@/lib/writing/doc-types';
import { adminTabFromHash, settingsRoute, type Section } from '@/lib/navigation/sections';
import { clampSidebarWidth, sidebarCookie, sidebarKeyStep, SIDEBAR_MAX_WIDTH, SIDEBAR_MIN_WIDTH, type SidebarPreferences } from '@/lib/navigation/sidebar';
import { STYLE_LIMIT } from '@/lib/writing/styles';
import { Avatar } from '@/components/ui/Avatar';
import { Drawer } from '@/components/ui/Drawer';
import { HashLink } from '@/components/ui/HashLink';
import { LinkPending } from '@/components/ui/LinkPending';
import { Menu } from '@/components/ui/Menu';
import { MODES, modeIcon, modeLabel } from '@/components/writing/modes';
import { StyleMark } from '@/components/writing/StyleMark';
import { styleTemplates } from '@/components/writing/style-form';
import { requestSkillAction } from '@/components/skills/skill-events';
import { useEntitlements, useShell } from './AppShell';

// ── Width and collapse, shared by every page and seeded from the cookie the server layout read ──────────
let preferences: SidebarPreferences | null = null;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
function savePreferences(next: SidebarPreferences) {
  preferences = { width: clampSidebarWidth(next.width), collapsed: next.collapsed };
  document.cookie = sidebarCookie(preferences);
  for (const listener of listeners) listener();
}
const useSidebarPreferences = (initial: SidebarPreferences) => useSyncExternalStore(subscribe, () => preferences ?? initial, () => initial);

// Drag with mouse, pen or touch (pointer events), or focus the edge and use the arrow keys (role=separator).
// « collapses the column to nothing; a floating » brings it back.
export function ResizableSidebar({ initial, label, children }: { initial: SidebarPreferences; label: string; children: React.ReactNode }) {
  const { t } = useLocale();
  const saved = useSidebarPreferences(initial);
  const [drag, setDrag] = useState<number | null>(null);
  const start = useRef<{ x: number; width: number } | null>(null);
  const latest = useRef<number | null>(null);
  const width = drag ?? saved.width;

  useEffect(() => {
    if (drag === null) return;
    document.body.style.cursor = 'col-resize'; document.body.style.userSelect = 'none';
    return () => { document.body.style.cursor = ''; document.body.style.userSelect = ''; };
  }, [drag === null]); // eslint-disable-line react-hooks/exhaustive-deps -- only the start and end of a drag matter

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    start.current = { x: event.clientX, width }; latest.current = width; setDrag(width);
  };
  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!start.current) return;
    const next = clampSidebarWidth(start.current.width + event.clientX - start.current.x);
    latest.current = next; setDrag(next);
  };
  const onPointerEnd = useCallback(() => {
    if (!start.current) return;
    start.current = null;
    if (latest.current !== null) savePreferences({ width: latest.current, collapsed: false });
    latest.current = null; setDrag(null);
  }, []);
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    // From the stored width, so presses that land before the next render still add up.
    const next = sidebarKeyStep(preferences?.width ?? width, event.key, event.shiftKey);
    if (next === null) return;
    event.preventDefault(); savePreferences({ width: next, collapsed: false });
  };

  if (saved.collapsed) {
    return (
      <div className="relative hidden w-0 shrink-0 md:block">
        <button type="button" onClick={() => savePreferences({ ...saved, collapsed: false })} aria-label={t('Buka sidebar', 'Open sidebar')} title={t('Buka sidebar', 'Open sidebar')}
          className="sticky top-[4.25rem] z-20 ml-1.5 grid h-8 w-8 place-items-center rounded-lg border border-line bg-white text-ink-500 shadow-[0_1px_3px_rgb(31_32_29/0.12)] transition-colors hover:text-ink-900">
          <ChevronsRight size={15} aria-hidden="true" />
        </button>
      </div>
    );
  }

  return (
    <aside aria-label={label} style={{ width }} className="sticky top-14 hidden h-[calc(100dvh-3.5rem)] shrink-0 md:block">
      <div className="scrollbar-thin h-full overflow-y-auto pb-6 pl-1 pr-4 pt-3">{children}</div>
      <button type="button" onClick={() => savePreferences({ ...saved, collapsed: true })} aria-label={t('Tutup sidebar', 'Close sidebar')} title={t('Tutup sidebar', 'Close sidebar')}
        className="absolute right-3 top-3 grid h-7 w-7 place-items-center rounded-md text-ink-400 transition-colors hover:bg-white hover:text-ink-900">
        <ChevronsLeft size={15} aria-hidden="true" />
      </button>
      <div role="separator" aria-orientation="vertical" aria-label={t('Ubah lebar sidebar', 'Resize sidebar')} aria-valuemin={SIDEBAR_MIN_WIDTH} aria-valuemax={SIDEBAR_MAX_WIDTH} aria-valuenow={width} tabIndex={0}
        title={t('Tarik atau pakai tombol panah untuk mengubah lebar', 'Drag or use the arrow keys to resize')}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerEnd} onPointerCancel={onPointerEnd} onLostPointerCapture={onPointerEnd} onKeyDown={onKeyDown}
        className="group absolute -right-1.5 bottom-0 top-0 z-10 flex w-3 cursor-col-resize touch-none justify-center outline-none">
        <span className={`h-full w-0.5 rounded-full transition-colors group-hover:bg-brand-300 group-focus-visible:bg-brand-600 ${drag !== null ? 'bg-brand-400' : ''}`} />
      </div>
    </aside>
  );
}

// ── Shared pieces ─────────────────────────────────────────────────────────────────────────────────
const ROW = 'relative flex h-9 w-full min-w-0 items-center gap-2.5 rounded-lg px-2.5 text-[13.5px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-brand-300';
const rowTone = (active: boolean) => (active ? 'bg-white font-semibold text-ink-900 shadow-[0_1px_2px_rgb(31_32_29/0.06)]' : 'font-medium text-ink-600 hover:bg-white/70 hover:text-ink-900');

function SidebarTitle({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return <div className="mb-2 flex min-h-8 items-center gap-2 pr-8"><h2 className="min-w-0 flex-1 truncate px-2.5 text-[15px] font-semibold tracking-tight text-ink-950">{children}</h2>{action}</div>;
}
const GroupLabel = ({ children }: { children: React.ReactNode }) => <p className="mb-1 mt-5 px-2.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-500">{children}</p>;

function NavRow({ href, icon: Icon, label, active, count, hash = false }: { href: string; icon: LucideIcon; label: string; active: boolean; count?: number | null; hash?: boolean }) {
  const body = <><Icon size={16} aria-hidden="true" className={`shrink-0 ${active ? 'text-brand-700' : 'text-ink-400'}`} /><span className="min-w-0 flex-1 truncate">{label}</span>{typeof count === 'number' && <span className="shrink-0 text-[12px] font-medium tabular-nums text-ink-400">{count}</span>}{!hash && <LinkPending className="right-1.5 top-1/2 -translate-y-1/2" />}</>;
  const props = { href, 'aria-current': active ? 'page' as const : undefined, className: `${ROW} ${rowTone(active)}` };
  return hash ? <HashLink {...props}>{body}</HashLink> : <Link {...props}>{body}</Link>;
}

// ── Notebook ──────────────────────────────────────────────────────────────────────────────────────
// Every number here comes from the server (GET /api/documents?counts=1), so it is exact whatever the page has loaded.
function NotebooksSidebar() {
  const { t } = useLocale();
  const params = useSearchParams();
  const counts = useLibraryCounts();
  const filter = libraryFilter(params);
  useEffect(() => {
    let live = true;
    const load = () => { request<{ counts?: LibraryCounts }>('/api/documents?limit=1&counts=1').then((page) => { if (live && page.counts) publishLibraryCounts(page.counts); }, () => undefined); };
    load();
    window.addEventListener(LIBRARY_CHANGED_EVENT, load);
    return () => { live = false; window.removeEventListener(LIBRARY_CHANGED_EVENT, load); };
  }, []);
  const plain = !filter.trash && !filter.pinned && !filter.mode && !filter.docType;
  const types = counts ? [...DOC_TYPES.filter((type) => (counts.docTypes[type] ?? 0) > 0), ...((counts.docTypes.none ?? 0) > 0 ? ['none'] : [])] : [];
  return (
    <>
      <SidebarTitle>Notebook</SidebarTitle>
      <NavRow href="/notebooks" icon={LayoutList} label={t('Semua notebook', 'All notebooks')} active={plain} count={counts?.all ?? null} />
      <NavRow href="/notebooks?pinned=1" icon={Pin} label={t('Disematkan', 'Pinned')} active={!!filter.pinned} count={counts?.pinned ?? null} />
      {types.length > 0 && <GroupLabel>{t('Jenis', 'Kind')}</GroupLabel>}
      <ul>
        {types.map((type) => <li key={type}><NavRow href={`/notebooks?type=${type}`} icon={Tags} label={type === 'none' ? t('Tanpa jenis', 'No kind') : docTypeShort(type as DocType, t)} active={filter.docType === type} count={counts?.docTypes[type] ?? 0} /></li>)}
      </ul>
      <GroupLabel>{t('Mode terakhir', 'Last mode')}</GroupLabel>
      <ul>
        {MODES.map((mode) => <li key={mode}><NavRow href={`/notebooks?mode=${mode}`} icon={modeIcon[mode]} label={modeLabel(mode, t)} active={filter.mode === mode} count={modeCount(counts, mode)} /></li>)}
      </ul>
      <p className="mt-2 px-2.5 text-[12px] leading-snug text-ink-500">{t('Mode AI yang terakhir dipakai di tiap notebook.', 'The AI mode last used in each notebook.')}</p>
      <div className="mt-4 border-t border-line pt-3">
        <NavRow href="/notebooks?view=trash" icon={Trash2} label={t('Sampah (30 hari)', 'Trash (30 days)')} active={!!filter.trash} count={counts?.trash ?? null} />
      </div>
    </>
  );
}

// ── Skill ─────────────────────────────────────────────────────────────────────────────────────────
function SkillsSidebar() {
  const { t } = useLocale();
  const params = useSearchParams();
  const { styles, loading } = useWritingStyles();
  const { has } = useEntitlements();
  const locked = !has('saved_styles');
  const full = styles.length >= STYLE_LIMIT;
  const current = params.get('skill');
  const currentTemplate = params.get('template');
  return (
    <>
      <SidebarTitle action={!locked && (
        <button type="button" onClick={() => requestSkillAction({ kind: 'create' })} disabled={full} aria-label={t('Buat skill', 'Create skill')} title={full ? t('Batas 10 skill tercapai', 'The 10-skill limit is reached') : t('Buat skill', 'Create skill')}
          className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-ink-500 transition-colors hover:bg-white hover:text-ink-900 disabled:opacity-40"><Plus size={16} aria-hidden="true" /></button>
      )}>{t('Skill saya', 'My skills')} <span className="font-medium tabular-nums text-ink-400">({styles.length}/{STYLE_LIMIT})</span></SidebarTitle>
      {loading ? <div className="space-y-1.5 px-1">{[0, 1, 2].map((row) => <div key={row} className="h-8 animate-pulse rounded-lg bg-paper-deep" />)}</div>
        : styles.length === 0 ? <p className="px-2.5 text-[13px] text-ink-500">{locked ? t('Belum ada skill tersimpan.', 'No saved skills.') : t('Belum ada skill. Pakai + untuk membuat.', 'No skills yet. Use + to create one.')}</p>
        : (
          <ul className="space-y-0.5">
            {styles.map((style) => {
              const active = current === style.id;
              return (
                <li key={style.id} className="group relative">
                  <Link href={`/skills?skill=${encodeURIComponent(style.id)}`} aria-current={active ? 'page' : undefined} className={`${ROW} pr-9 ${rowTone(active)}`}>
                    <StyleMark style={style} size={20} /><span className="min-w-0 flex-1 truncate">{style.name}</span>
                  </Link>
                  <span className="absolute right-1 top-1/2 -translate-y-1/2"><Menu label={t(`Opsi untuk ${style.name}`, `Options for ${style.name}`)}
                    triggerClassName="grid h-7 w-7 place-items-center rounded-md text-ink-400 transition-colors hover:bg-paper-deep hover:text-ink-900"
                    trigger={<MoreHorizontal size={16} aria-hidden="true" />}
                    items={[
                      { label: t('Ubah', 'Edit'), icon: PencilLine, disabled: locked, onSelect: () => requestSkillAction({ kind: 'edit', id: style.id }) },
                      { label: t('Duplikat', 'Duplicate'), icon: Copy, disabled: locked || full, onSelect: () => requestSkillAction({ kind: 'duplicate', id: style.id }) },
                      { label: t('Hapus', 'Delete'), icon: Trash2, tone: 'danger', onSelect: () => requestSkillAction({ kind: 'delete', id: style.id }) },
                    ]} /></span>
                </li>
              );
            })}
          </ul>
        )}
      <GroupLabel>{t('Template skill', 'Skill templates')}</GroupLabel>
      <ul className="space-y-0.5">
        {styleTemplates(t).map((template, index) => <li key={template.name}><NavRow href={`/skills?template=${index}`} icon={Sparkles} label={template.name} active={currentTemplate === String(index)} /></li>)}
      </ul>
    </>
  );
}

// ── Akun & Paket ──────────────────────────────────────────────────────────────────────────────────
export function useAccountNav() {
  const { t } = useLocale();
  return [
    { id: 'profil', icon: UserRound, label: t('Profil', 'Profile') },
    { id: 'keamanan', icon: KeyRound, label: t('Keamanan', 'Security') },
    { id: 'menulis', icon: PenLine, label: t('Preferensi menulis', 'Writing preferences') },
    { id: 'preferensi', icon: SlidersHorizontal, label: t('Tampilan & perangkat', 'Display & device') },
    { id: 'pemakaian', icon: Gauge, label: t('Pemakaian & paket', 'Usage & plan') },
    { id: 'privasi', icon: ShieldCheck, label: t('Privasi & data', 'Privacy & data') },
  ] as const;
}

function AccountSidebar() {
  const { t } = useLocale();
  const { user } = useShell();
  const { tier } = useEntitlements();
  const hash = useHash();
  const route = settingsRoute(hash);
  const current = 'tab' in route ? route.tab : null;
  const nav = useAccountNav();
  return (
    <>
      <SidebarTitle>{t('Akun & Paket', 'Account & Plan')}</SidebarTitle>
      <div className="mb-3 flex items-center gap-3 rounded-xl border border-line bg-white px-3 py-3">
        <Avatar name={user.name} image={user.image} size={40} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13.5px] font-semibold text-ink-900">{user.name}</p>
          <p className="truncate text-[12px] text-ink-500">{user.email}</p>
          <span className="mt-1 inline-flex rounded-md bg-brand-50 px-1.5 py-0.5 text-[11px] font-semibold text-brand-800">{tierName(tier, t)}{user.role === 'admin' ? ` · ${t('admin', 'admin')}` : ''}</span>
        </div>
      </div>
      <ul className="space-y-0.5">
        {nav.map((item) => <li key={item.id}><NavRow hash href={`/settings#${item.id}`} icon={item.icon} label={item.label} active={current === item.id} /></li>)}
      </ul>
    </>
  );
}

// ── Admin ─────────────────────────────────────────────────────────────────────────────────────────
export function useAdminNav() {
  const { t } = useLocale();
  return [
    { id: 'database', icon: Users, label: t('Pengguna', 'Users') },
    { id: 'payments', icon: Wallet, label: t('Pembayaran', 'Payments') },
    { id: 'ai', icon: Gauge, label: 'Monitoring AI' },
    { id: 'log', icon: ScrollText, label: 'Log' },
  ] as const;
}

function AdminSidebar() {
  const { t } = useLocale();
  const { user } = useShell();
  const current = adminTabFromHash(useHash());
  const nav = useAdminNav();
  return (
    <>
      <SidebarTitle>Admin</SidebarTitle>
      <div className="mb-1 rounded-xl border border-line bg-white px-3 py-3">
        <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-brand-800">{t('Pusat kontrol', 'Control centre')}</p>
        <div className="mt-2 flex items-center gap-2.5">
          <Avatar name={user.name} image={user.image} size={30} />
          <div className="min-w-0"><p className="truncate text-[13px] font-semibold text-ink-900">{user.name}</p><p className="truncate text-[11.5px] text-ink-500">{user.email}</p></div>
        </div>
        <p className="mt-2 text-[12px] leading-snug text-ink-500">{t('Akun admin tetap memakai saldo karakter, tanpa batas permintaan bulanan (maks. 10 per menit).', 'Admin accounts still spend characters, with no monthly request cap (max 10 per minute).')}</p>
      </div>
      <GroupLabel>{t('Kelola', 'Manage')}</GroupLabel>
      <ul className="space-y-0.5">
        {nav.map((item) => <li key={item.id}><NavRow hash href={`/admin#${item.id}`} icon={item.icon} label={item.label} active={current === item.id} /></li>)}
      </ul>
    </>
  );
}

// ── Per section ───────────────────────────────────────────────────────────────────────────────────
export function SidebarContent({ section }: { section: Section }) {
  return (
    <Suspense>
      {section === 'notebooks' ? <NotebooksSidebar /> : section === 'skills' ? <SkillsSidebar /> : section === 'account' ? <AccountSidebar /> : section === 'admin' ? <AdminSidebar /> : null}
    </Suspense>
  );
}

export function sidebarLabel(section: Section, t: (id: string, en: string) => string) {
  return section === 'notebooks' ? 'Notebook' : section === 'skills' ? 'Skill' : section === 'account' ? t('Akun & Paket', 'Account & Plan') : 'Admin';
}

// Phones: a "☰ Notebook · filter" bar opens the same content in a drawer from the left. It closes by itself
// on navigation because it only stays open for the URL it was opened on.
export function MobileContextBar({ section }: { section: Section }) {
  const { t } = useLocale();
  const pathname = usePathname();
  const params = useSearchParams();
  const url = `${pathname}?${params.toString()}`;
  const [openAt, setOpenAt] = useState<string | null>(null);
  const label = section === 'notebooks' ? t('Notebook · filter', 'Notebooks · filter') : t('Skill saya · template', 'My skills · templates');
  return (
    <div className="border-b border-line bg-shell px-4 py-2 md:hidden">
      <button type="button" onClick={() => setOpenAt(url)} aria-haspopup="dialog" className="inline-flex h-9 items-center gap-2 rounded-lg px-2 text-[13.5px] font-semibold text-ink-800 hover:bg-white">
        <MenuIcon size={17} aria-hidden="true" />{label}
      </button>
      {openAt === url && (
        <Drawer side="left" title={sidebarLabel(section, t)} onClose={() => setOpenAt(null)}>
          <div className="p-3"><SidebarContent section={section} /></div>
        </Drawer>
      )}
    </div>
  );
}
