import { AppFrame } from '@/components/app/AppFrame';
import { AppShell } from '@/components/app/AppShell';
import { readDocPanelPreferences, readSidebarPreferences } from '@/lib/navigation/sidebar-server';

// One shell for every signed-in page (/app, /notebooks, /notebooks/[id], /skills, /settings, /admin).
// The server reads only the sidebar and Dokumen panel cookies, so the first paint already has the saved widths;
// the session, onboarding redirect and error screens stay in the client shell, which mounts once instead of per page.
export default async function SignedInLayout({ children }: { children: React.ReactNode }) {
  const [sidebar, docPanel] = await Promise.all([readSidebarPreferences(), readDocPanelPreferences()]);
  return <AppShell><AppFrame initialSidebar={sidebar} initialDocPanel={docPanel}>{children}</AppFrame></AppShell>;
}
