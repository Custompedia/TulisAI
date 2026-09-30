import { cookies } from 'next/headers';
import { parseDocPanelCookie, DOC_PANEL_COOKIE } from './doc-panel';
import { parseSidebarCookie, SIDEBAR_COOKIE } from './sidebar';

// The saved sidebar state for this request, so the first paint already matches the user's last choice.
export async function readSidebarPreferences() {
  return parseSidebarCookie((await cookies()).get(SIDEBAR_COOKIE)?.value);
}

// The editor's Dokumen panel, or null when the writer never chose (the viewport decides then).
export async function readDocPanelPreferences() {
  return parseDocPanelCookie((await cookies()).get(DOC_PANEL_COOKIE)?.value);
}
