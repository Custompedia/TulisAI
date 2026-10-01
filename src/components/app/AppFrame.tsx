'use client';
import { usePathname } from 'next/navigation';
import { Suspense, useSyncExternalStore } from 'react';
import { Search } from 'lucide-react';
import { useLocale } from '@/lib/client/locale';
import { hasContextSidebar, sectionFor } from '@/lib/navigation/sections';
import type { SidebarPreferences } from '@/lib/navigation/sidebar';
import { Logo } from '@/components/ui/Logo';
import { AccountMenu } from './AccountMenu';
import { useShell } from './AppShell';
import { MobileBar, Rail } from './AppNavigation';
import { CommandPalette } from './CommandPalette';
import { MobileContextBar, ResizableSidebar, SidebarContent, sidebarLabel } from './ContextSidebar';
import { QuotaPill } from './QuotaPill';
import { NewWritingHost, PlansHost, ShortcutsHost } from './ShellHosts';
import { openPalette } from './shell-events';

const subscribe = () => () => {};
const onMac = () => /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

function SearchTrigger() {
  const { t } = useLocale();
  const mac = useSyncExternalStore(subscribe, onMac, () => false);
  const label = t('Cari notebook, skill, atau menu…', 'Search notebooks, skills, or menus…');
  return (
    <>
      <button type="button" onClick={openPalette} aria-haspopup="dialog" aria-keyshortcuts="Control+K Meta+K"
        className="hidden h-10 w-full max-w-[480px] items-center gap-2.5 rounded-full border border-line bg-white px-4 text-left text-[13.5px] text-ink-400 shadow-[0_1px_2px_rgb(31_32_29/0.05)] transition-colors hover:border-line-strong hover:text-ink-600 md:flex">
        <Search size={16} aria-hidden="true" className="shrink-0" /><span className="min-w-0 flex-1 truncate">{label}</span>
        <kbd className="shrink-0 rounded-md border border-line bg-paper px-1.5 py-0.5 font-sans text-[11px] font-medium text-ink-500">{mac ? '⌘K' : 'Ctrl K'}</kbd>
      </button>
      <button type="button" onClick={openPalette} aria-haspopup="dialog" aria-label={label} title={label}
        className="grid h-10 w-10 place-items-center rounded-full border border-line bg-white text-ink-600 shadow-[0_1px_2px_rgb(31_32_29/0.05)] md:hidden">
        <Search size={17} aria-hidden="true" />
      </button>
    </>
  );
}

function TopBar() {
  return (
    <header className="fixed inset-x-0 top-0 z-30 flex h-14 items-center gap-3 bg-shell px-4 md:pl-[18px]">
      <Logo href="/app" mark="h-9 w-9" />
      <div className="flex min-w-0 flex-1 justify-end md:justify-center"><SearchTrigger /></div>
      <div className="flex items-center gap-2.5">
        <QuotaPill />
        <AccountMenu />
      </div>
    </header>
  );
}

// Everything the frame owns beyond the layout: palette, shortcuts, plans and the Tulis baru entry point.
function Hosts() {
  return <><CommandPalette /><ShortcutsHost /><PlansHost /><NewWritingHost /></>;
}

// Three layers from Mari Rekap: top bar, icon rail, and a context sidebar for the sections that have one.
// The editor keeps the rail but supplies its own header in place of the top bar.
export function AppFrame({ children, initialSidebar }: { children: React.ReactNode; initialSidebar: SidebarPreferences }) {
  const { t } = useLocale();
  const pathname = usePathname();
  const { user } = useShell();
  const section = sectionFor(pathname);

  if (section === 'editor') {
    return (
      <div className="h-dvh overflow-hidden bg-shell">
        <Rail />
        {children}
        <Hosts />
      </div>
    );
  }

  // A non-admin who opens /admin sees the refusal screen, not the admin navigation.
  const sidebar = section && hasContextSidebar(section) && (section !== 'admin' || user.role === 'admin') ? section : null;
  return (
    <div className="min-h-dvh bg-shell">
      <TopBar />
      <Rail />
      <div className="flex pb-16 pt-14 md:pb-0 md:pl-[72px] md:pr-2">
        {sidebar && <ResizableSidebar initial={initialSidebar} label={sidebarLabel(sidebar, t)}><SidebarContent section={sidebar} /></ResizableSidebar>}
        <div className="min-w-0 flex-1">
          {(sidebar === 'notebooks' || sidebar === 'skills') && <Suspense><MobileContextBar section={sidebar} /></Suspense>}
          <div className="min-h-[calc(100dvh-3.5rem)] bg-paper md:rounded-t-[20px] md:border md:border-b-0 md:border-line md:shadow-[0_1px_3px_rgb(31_32_29/0.06)]">{children}</div>
        </div>
      </div>
      <MobileBar />
      <Hosts />
    </div>
  );
}
