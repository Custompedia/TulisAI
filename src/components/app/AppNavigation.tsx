'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { House, NotebookPen, Plus, ShieldCheck, Sparkles, UserRound, type LucideIcon } from 'lucide-react';
import { useLocale } from '@/lib/client/locale';
import { quotaLevel } from '@/lib/client/quota';
import { railActive, sectionFor, type RailId } from '@/lib/navigation/sections';
import { raisedGreen } from '@/components/ui/Button';
import { LinkPending } from '@/components/ui/LinkPending';
import { useShell } from './AppShell';
import { NEW_WRITING_HREF, requestNewWriting } from './shell-events';

type NavItem = { id: RailId; href: string; label: string; icon: LucideIcon };

function useNavItems() {
  const { t } = useLocale();
  const { user } = useShell();
  const newWriting: NavItem = { id: 'new', href: NEW_WRITING_HREF, label: t('Tulis baru', 'New writing'), icon: Plus };
  const home: NavItem = { id: 'home', href: '/app', label: t('Beranda', 'Home'), icon: House };
  const notebooks: NavItem = { id: 'notebooks', href: '/notebooks', label: 'Notebook', icon: NotebookPen };
  const skills: NavItem = { id: 'skills', href: '/skills', label: 'Skill', icon: Sparkles };
  const admin: NavItem | null = user.role === 'admin' ? { id: 'admin', href: '/admin', label: 'Admin', icon: ShieldCheck } : null;
  const account: NavItem = { id: 'account', href: '/settings', label: t('Akun & Paket', 'Account & Plan'), icon: UserRound };
  return { newWriting, home, notebooks, skills, admin, account };
}

// A plain left click hands "Tulis baru" to the shell (which UX 1c turns into a dialog); modified clicks
// still open the fallback link in a new tab.
const onNewWriting = (event: React.MouseEvent<HTMLAnchorElement>) => {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault(); requestNewWriting();
};

// The one badge in the rail: a dot on Akun & Paket, yellow at ≤10% of the characters left, red when empty.
function QuotaDot() {
  const { t } = useLocale();
  const { usage } = useShell();
  const level = quotaLevel(usage);
  if (level !== 'low' && level !== 'empty') return null;
  const label = level === 'empty' ? t('Karakter AI habis', 'AI characters used up') : t('Karakter AI hampir habis', 'AI characters running low');
  return <span role="img" aria-label={label} title={label} className={`absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-shell ${level === 'empty' ? 'bg-red-600' : 'bg-amber-500'}`} />;
}

function RailLink({ item, active, primary = false, dot = false }: { item: NavItem; active: boolean; primary?: boolean; dot?: boolean }) {
  const { href, label, icon: Icon } = item;
  const box = primary ? `${raisedGreen} group-hover:bg-brand-900` : active ? 'bg-white text-brand-800 shadow-[0_1px_2px_rgb(31_32_29/0.08)]' : 'text-ink-500 group-hover:bg-white/70 group-hover:text-ink-900';
  return (
    <Link href={href} onClick={primary ? onNewWriting : undefined} aria-current={active ? 'page' : undefined} title={label}
      className="group flex w-full flex-col items-center gap-1 rounded-lg py-1.5 text-center text-[10.5px] font-semibold leading-tight text-ink-600 outline-none transition-colors hover:text-ink-900 focus-visible:ring-2 focus-visible:ring-brand-300">
      <span className={`relative grid h-9 w-9 place-items-center rounded-lg transition-colors ${box}`}>
        <Icon size={primary ? 17 : 18} aria-hidden="true" />
        {dot && <QuotaDot />}
        {!primary && <LinkPending className="-bottom-1 left-1/2 -translate-x-1/2" />}
      </span>
      <span className={active ? 'font-bold text-ink-900' : ''}>{label}</span>
    </Link>
  );
}

// Fixed icon rail on desktop: Tulis baru, Beranda, Notebook, Skill, then Admin and Akun & Paket pinned low.
export function Rail() {
  const { t } = useLocale();
  const pathname = usePathname();
  const { newWriting, home, notebooks, skills, admin, account } = useNavItems();
  return (
    <nav aria-label={t('Navigasi utama', 'Main navigation')} className="fixed bottom-0 left-0 top-14 z-20 hidden w-[72px] flex-col items-center gap-1 bg-shell px-2 pb-3 pt-3 md:flex">
      <RailLink item={newWriting} active={false} primary />
      <span aria-hidden="true" className="my-1 h-px w-8 bg-line-strong" />
      {[home, notebooks, skills].map((item) => <RailLink key={item.id} item={item} active={railActive(item.id, pathname)} />)}
      <div className="mt-auto flex w-full flex-col gap-1">
        {admin && <RailLink item={admin} active={railActive('admin', pathname)} />}
        <RailLink item={account} active={railActive('account', pathname)} dot />
      </div>
    </nav>
  );
}

// Phone bottom bar: Beranda · Notebook · (+) · Skill · Akun. Admin moves into the account menu, and the
// editor hides the bar so the writing surface keeps the full height.
export function MobileBar() {
  const { t } = useLocale();
  const pathname = usePathname();
  const { newWriting, home, notebooks, skills, account } = useNavItems();
  if (sectionFor(pathname) === 'editor') return null;
  const cell = (item: NavItem, dot = false) => {
    const active = railActive(item.id, pathname); const Icon = item.icon;
    return (
      <Link key={item.id} href={item.href} aria-current={active ? 'page' : undefined}
        className={`flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 text-[10.5px] font-semibold ${active ? 'text-ink-900' : 'text-ink-500'}`}>
        <span className={`relative grid h-8 w-10 place-items-center rounded-lg ${active ? 'bg-white text-brand-800 shadow-[0_1px_2px_rgb(31_32_29/0.08)]' : ''}`}><Icon size={18} aria-hidden="true" />{dot && <QuotaDot />}</span>
        <span className="max-w-full truncate">{item.id === 'account' ? t('Akun', 'Account') : item.label}</span>
      </Link>
    );
  };
  return (
    <nav aria-label={t('Navigasi aplikasi', 'App navigation')} className="fixed inset-x-0 bottom-0 z-30 flex h-16 items-stretch border-t border-line bg-shell/95 px-2 pb-[env(safe-area-inset-bottom)] backdrop-blur-sm md:hidden">
      {cell(home)}{cell(notebooks)}
      <div className="flex flex-1 items-center justify-center">
        <Link href={newWriting.href} onClick={onNewWriting} aria-label={newWriting.label} title={newWriting.label}
          className={`-mt-5 grid h-12 w-12 place-items-center rounded-full shadow-[0_8px_20px_-8px_rgb(66_91_52/0.7)] ring-4 ring-shell ${raisedGreen}`}>
          <Plus size={22} aria-hidden="true" />
        </Link>
      </div>
      {cell(skills)}{cell(account, true)}
    </nav>
  );
}
