// Which part of the signed-in app a path belongs to. The rail lights up from this, and the context
// sidebar picks its content from it. Pure so it can be tested without a router.
export type Section = 'home' | 'notebooks' | 'editor' | 'skills' | 'admin' | 'account';
export type RailId = 'new' | 'home' | 'notebooks' | 'skills' | 'admin' | 'account';

const trim = (pathname: string) => (pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname);

export function sectionFor(pathname: string): Section | null {
  const path = trim(pathname);
  if (path === '/app') return 'home';
  if (path === '/notebooks') return 'notebooks';
  if (/^\/notebooks\/[^/]+$/.test(path)) return 'editor';
  if (path === '/skills') return 'skills';
  if (path === '/admin' || path.startsWith('/admin/')) return 'admin';
  if (path === '/settings' || path.startsWith('/settings/')) return 'account';
  return null;
}

// "Tulis baru" is an action, never a place, so it is never the active item.
// Notebook stays lit inside a notebook: the editor belongs to the library.
export function railActive(id: RailId, pathname: string): boolean {
  const section = sectionFor(pathname);
  switch (id) {
    case 'new': return false;
    case 'home': return section === 'home';
    case 'notebooks': return section === 'notebooks' || section === 'editor';
    case 'skills': return section === 'skills';
    case 'admin': return section === 'admin';
    case 'account': return section === 'account';
  }
}

// Home has no second column: everything it would list is already on the page. The editor gets its own
// Dokumen panel later (UX 1c) instead of the library sidebar.
export const hasContextSidebar = (section: Section | null) => section === 'notebooks' || section === 'skills' || section === 'account' || section === 'admin';

export const SETTINGS_TABS = ['profil', 'keamanan', 'menulis', 'preferensi', 'pemakaian', 'privasi'] as const;
export type SettingsTab = (typeof SETTINGS_TABS)[number];

// Old /settings hashes keep working: #bahasa is the display tab, #skills moved to its own page.
export function settingsRoute(hash: string): { tab: SettingsTab } | { redirect: string } {
  const value = hash.replace(/^#/, '').toLowerCase();
  if (value === 'skills') return { redirect: '/skills' };
  if (value === 'bahasa') return { tab: 'preferensi' };
  return { tab: (SETTINGS_TABS as readonly string[]).includes(value) ? value as SettingsTab : 'profil' };
}

export const ADMIN_TABS = ['database', 'payments', 'ai', 'log'] as const;
export type AdminTab = (typeof ADMIN_TABS)[number];
export const adminTabFromHash = (hash: string): AdminTab => {
  const value = hash.replace(/^#/, '');
  return (ADMIN_TABS as readonly string[]).includes(value) ? value as AdminTab : 'database';
};
