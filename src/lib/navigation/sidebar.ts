// Kept in a cookie, not localStorage, so the server layout renders the saved width and the page never jumps.
export const SIDEBAR_COOKIE = 'tulis_sidebar';
export const SIDEBAR_MIN_WIDTH = 190;
export const SIDEBAR_MAX_WIDTH = 480;
export const SIDEBAR_DEFAULT_WIDTH = 260;
// One arrow press moves the edge this far; Shift moves it four times as far.
export const SIDEBAR_KEY_STEP = 16;
const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

export type SidebarPreferences = { width: number; collapsed: boolean };

export const DEFAULT_SIDEBAR: SidebarPreferences = { width: SIDEBAR_DEFAULT_WIDTH, collapsed: false };

export const clampSidebarWidth = (width: number) =>
  Number.isFinite(width) ? Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, Math.round(width))) : SIDEBAR_DEFAULT_WIDTH;

// The value is `width:collapsed`, e.g. `300:1`. A malformed or out-of-range width falls back to the default
// rather than being clamped, so a stale or hand-edited cookie never opens a surprising sidebar.
export function parseSidebarCookie(value: string | null | undefined): SidebarPreferences {
  const [rawWidth = '', rawCollapsed] = (value ?? '').split(':');
  const width = /^\d+$/.test(rawWidth) ? Number.parseInt(rawWidth, 10) : Number.NaN;
  return {
    width: Number.isInteger(width) && width >= SIDEBAR_MIN_WIDTH && width <= SIDEBAR_MAX_WIDTH ? width : SIDEBAR_DEFAULT_WIDTH,
    collapsed: rawCollapsed === '1',
  };
}

export function sidebarCookie(preferences: SidebarPreferences) {
  return `${SIDEBAR_COOKIE}=${clampSidebarWidth(preferences.width)}:${preferences.collapsed ? 1 : 0}; Path=/; Max-Age=${ONE_YEAR_SECONDS}; SameSite=Lax`;
}

// Keyboard control for the role=separator edge. Returns null for keys the separator does not handle.
export function sidebarKeyStep(width: number, key: string, shift = false): number | null {
  const step = SIDEBAR_KEY_STEP * (shift ? 4 : 1);
  switch (key) {
    case 'ArrowLeft': return clampSidebarWidth(width - step);
    case 'ArrowRight': return clampSidebarWidth(width + step);
    case 'Home': return SIDEBAR_MIN_WIDTH;
    case 'End': return SIDEBAR_MAX_WIDTH;
    default: return null;
  }
}
