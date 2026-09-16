'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { NotebookPen, Plus, Settings as SettingsIcon, type LucideIcon } from 'lucide-react';
import { useLocale } from '@/lib/client/locale';
import { raisedGreen } from '@/components/ui/Button';

export const COMPOSER_FOCUS_EVENT = 'composer:focus';

type NavItem = { href: string; label: string; icon: LucideIcon; active: boolean; onClick?: () => void; primary?: boolean };

function RailLink({ href, label, icon: Icon, active, onClick, primary }: NavItem) {
  const box = primary ? `${raisedGreen} group-hover:bg-brand-900` : active ? 'bg-white text-brand-800 shadow-[0_1px_2px_rgb(31_32_29/0.08)]' : 'text-ink-500 group-hover:bg-white/70 group-hover:text-ink-900';
  return (
    <Link href={href} onClick={onClick} aria-current={active ? 'page' : undefined} title={label}
      className="group flex w-full flex-col items-center gap-1 rounded-lg py-1.5 text-[10.5px] font-semibold text-ink-600 outline-none transition-colors hover:text-ink-900 focus-visible:ring-2 focus-visible:ring-brand-300">
      <span className={`grid h-9 w-9 place-items-center rounded-lg transition-colors ${box}`}><Icon size={primary ? 17 : 18} aria-hidden="true" /></span>
      <span className={active ? 'text-ink-900' : ''}>{label}</span>
    </Link>
  );
}

// Fixed icon rail on desktop, bottom bar on mobile.
export function Sidebar() {
  const { t } = useLocale();
  const pathname = usePathname();
  const focusComposer = () => { if (pathname === '/app') window.dispatchEvent(new Event(COMPOSER_FOCUS_EVENT)); };
  const items: NavItem[] = [
    { href: '/app#compose', label: t('Baru', 'New'), icon: Plus, active: false, onClick: focusComposer, primary: true },
    { href: '/notebooks', label: t('Notebook', 'Notebooks'), icon: NotebookPen, active: pathname.startsWith('/notebooks') },
  ];
  const settings: NavItem = { href: '/settings', label: t('Pengaturan', 'Settings'), icon: SettingsIcon, active: pathname.startsWith('/settings') };

  return (
    <nav aria-label={t('Navigasi utama', 'Main navigation')}>
      <div className="fixed bottom-0 left-0 top-14 z-20 hidden w-[72px] flex-col items-center gap-1 bg-brand-50 px-2 pb-3 pt-3 md:flex">
        {items.map((item) => <RailLink key={item.href} {...item} />)}
        <div className="mt-auto w-full"><RailLink {...settings} /></div>
      </div>
      <div className="fixed inset-x-0 bottom-0 z-30 flex h-16 items-stretch justify-around border-t border-line bg-brand-50/95 px-4 pb-[env(safe-area-inset-bottom)] backdrop-blur-sm md:hidden">
        {[...items, settings].map((item) => <div key={item.href} className="flex w-20 items-center"><RailLink {...item} /></div>)}
      </div>
    </nav>
  );
}
