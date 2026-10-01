import { AppFrame } from '@/components/app/AppFrame';
import { AppShell } from '@/components/app/AppShell';
import { readSidebarPreferences } from '@/lib/navigation/sidebar-server';

// One shell for every signed-in page (/app, /notebooks, /notebooks/[id], /skills, /settings, /admin).
// The server reads only the sidebar cookie, so the first paint already has the saved width; the session,
// onboarding redirect and error screens stay in the client shell, which now mounts once instead of per page.
export default async function SignedInLayout({ children }: { children: React.ReactNode }) {
  const sidebar = await readSidebarPreferences();
  return <AppShell><AppFrame initialSidebar={sidebar}>{children}</AppFrame></AppShell>;
}
