'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { FileText, FolderClosed, House, Plus, Settings as SettingsIcon, X, type LucideIcon } from 'lucide-react';
import { useLocale } from '@/lib/client/locale';
import { Logo } from '@/components/ui/Logo';
import { raisedBlack } from '@/components/ui/Button';
import type { DocumentSummary } from './AppShell';

export const COMPOSER_FOCUS_EVENT = 'composer:focus';
export const SIDEBAR_ID = 'app-sidebar';

type NavItem = { href: string; label: string; icon: LucideIcon; match: (path: string) => boolean; onClick?: (event: React.MouseEvent) => void; primary?: boolean };

export function Sidebar({ expanded, drawer, recent, onCloseDrawer }: { expanded: boolean; drawer: boolean; recent: DocumentSummary[]; onCloseDrawer: () => void }) {
  const { t } = useLocale();
  const pathname = usePathname();
  const closeRef = useRef<HTMLButtonElement>(null);
  const wide = expanded || drawer;

  useEffect(() => {
    if (!drawer) return;
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onCloseDrawer(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [drawer, onCloseDrawer]);

  const focusComposer = () => { if (pathname === '/app') window.dispatchEvent(new Event(COMPOSER_FOCUS_EVENT)); onCloseDrawer(); };
  const main: NavItem[] = [
    { href: '/app#compose', label: t('Baru', 'New'), icon: Plus, match: () => false, onClick: focusComposer, primary: true },
    { href: '/app', label: t('Beranda', 'Home'), icon: House, match: (path) => path === '/app' },
    { href: '/projects', label: t('Proyek', 'Projects'), icon: FolderClosed, match: (path) => path === '/projects' },
  ];
  const settings: NavItem = { href: '/settings', label: t('Pengaturan', 'Settings'), icon: SettingsIcon, match: (path) => path.startsWith('/settings') };

  const item = ({ href, label, icon: Icon, match, onClick, primary }: NavItem) => {
    const active = match(pathname);
    const iconBox = primary ? `${raisedBlack} rounded-lg` : active ? 'bg-brand-100 text-brand-800 rounded-lg' : 'text-ink-500 group-hover:text-ink-900 rounded-lg';
    return wide ? (
      <Link key={href} href={href} onClick={onClick} aria-current={active ? 'page' : undefined}
        className={`group flex h-10 items-center gap-3 rounded-lg px-2 text-sm font-medium transition-colors ${active ? 'bg-brand-50 text-brand-800' : 'text-ink-700 hover:bg-paper-deep hover:text-ink-900'}`}>
        <span className={`grid h-7 w-7 shrink-0 place-items-center ${iconBox}`}><Icon size={primary ? 16 : 18} aria-hidden="true" /></span>{label}
      </Link>
    ) : (
      <Link key={href} href={href} onClick={onClick} aria-current={active ? 'page' : undefined} title={label}
        className="group flex w-full flex-col items-center gap-1 rounded-lg py-1.5 text-[10.5px] font-semibold text-ink-600 transition-colors hover:text-ink-900">
        <span className={`grid h-9 w-9 place-items-center transition-colors ${iconBox} ${!primary && !active ? 'group-hover:bg-paper-deep' : ''}`}><Icon size={18} aria-hidden="true" /></span>
        <span className={active ? 'text-brand-800' : ''}>{label}</span>
      </Link>
    );
  };

  return (
    <>
      {drawer && <div className="fixed inset-0 z-40 bg-ink-950/35 md:hidden" onClick={onCloseDrawer} aria-hidden="true" />}
      <aside id={SIDEBAR_ID} aria-label={t('Navigasi utama', 'Main navigation')}
        className={`fixed bottom-0 left-0 top-0 z-50 flex w-64 flex-col border-r border-line bg-white transition-[width,transform] duration-200 md:top-14 md:z-20 md:translate-x-0 ${drawer ? 'translate-x-0 shadow-2xl md:shadow-none' : '-translate-x-full'} ${expanded ? 'md:w-60' : 'md:w-[72px]'}`}>
        <div className="flex h-14 shrink-0 items-center justify-between border-b border-line px-4 md:hidden">
          <Logo href="/app" />
          <button ref={closeRef} type="button" onClick={onCloseDrawer} aria-label={t('Tutup navigasi', 'Close navigation')} className="grid h-9 w-9 place-items-center rounded-lg text-ink-500 hover:bg-paper-deep hover:text-ink-900"><X size={18} /></button>
        </div>
        <nav aria-label={t('Menu', 'Menu')} className={`flex shrink-0 flex-col ${wide ? 'gap-0.5 px-3 pt-3' : 'items-center gap-1 px-2 pt-3'}`}>{main.map(item)}</nav>
        <div className="scrollbar-thin mt-4 min-h-0 flex-1 overflow-y-auto px-3">
          {wide && (
            <>
              <p className="px-2 pb-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-400">{t('Terbaru', 'Recent')}</p>
              {recent.length === 0 ? <p className="px-2 text-[13px] text-ink-400">{t('Belum ada proyek.', 'No projects yet.')}</p> : (
                <ul className="space-y-0.5">
                  {recent.slice(0, 6).map((doc) => {
                    const active = pathname === `/projects/${doc.id}`;
                    return (
                      <li key={doc.id}>
                        <Link href={`/projects/${doc.id}`} onClick={onCloseDrawer} aria-current={active ? 'page' : undefined} className={`flex h-8 items-center gap-2 rounded-lg px-2 text-[13px] transition-colors ${active ? 'bg-brand-50 text-brand-800' : 'text-ink-600 hover:bg-paper-deep hover:text-ink-900'}`}>
                          <FileText size={14} aria-hidden="true" className="shrink-0 text-ink-400" /><span className="truncate">{doc.title}</span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </>
          )}
        </div>
        <div className={`shrink-0 border-t border-line py-2 ${wide ? 'px-3' : 'flex justify-center px-2'}`}>{item(settings)}</div>
      </aside>
    </>
  );
}
