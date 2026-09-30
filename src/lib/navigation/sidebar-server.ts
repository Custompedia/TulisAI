import { cookies } from 'next/headers';
import { parseSidebarCookie, SIDEBAR_COOKIE } from './sidebar';

// The saved sidebar state for this request, so the first paint already matches the user's last choice.
export async function readSidebarPreferences() {
  return parseSidebarCookie((await cookies()).get(SIDEBAR_COOKIE)?.value);
}
