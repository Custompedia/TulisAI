// The editor's Dokumen panel keeps its own cookie, separate from the library sidebar: it is narrower, and it
// starts closed below 1440px so the page canvas keeps its room. Read by the server layout so it never jumps.
export const DOC_PANEL_COOKIE = 'tulis_doc_panel';
export const DOC_PANEL_MIN_WIDTH = 190;
export const DOC_PANEL_MAX_WIDTH = 360;
export const DOC_PANEL_DEFAULT_WIDTH = 260;
// Below this viewport width the panel starts closed unless the writer opened it before.
export const DOC_PANEL_OPEN_FROM = 1440;
const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

export type DocPanelPreferences = { width: number; collapsed: boolean };

export const clampDocPanelWidth = (width: number) =>
  Number.isFinite(width) ? Math.min(DOC_PANEL_MAX_WIDTH, Math.max(DOC_PANEL_MIN_WIDTH, Math.round(width))) : DOC_PANEL_DEFAULT_WIDTH;

// `width:collapsed`, like tulis_sidebar. No cookie means "never chosen", so the viewport decides.
export function parseDocPanelCookie(value: string | null | undefined): DocPanelPreferences | null {
  if (!value) return null;
  const [rawWidth = '', rawCollapsed] = value.split(':');
  const width = /^\d+$/.test(rawWidth) ? Number.parseInt(rawWidth, 10) : Number.NaN;
  return {
    width: Number.isInteger(width) && width >= DOC_PANEL_MIN_WIDTH && width <= DOC_PANEL_MAX_WIDTH ? width : DOC_PANEL_DEFAULT_WIDTH,
    collapsed: rawCollapsed === '1',
  };
}

export function docPanelCookie(preferences: DocPanelPreferences) {
  return `${DOC_PANEL_COOKIE}=${clampDocPanelWidth(preferences.width)}:${preferences.collapsed ? 1 : 0}; Path=/; Max-Age=${ONE_YEAR_SECONDS}; SameSite=Lax`;
}

// The saved choice wins; without one the panel is open only on wide screens.
export function docPanelState(saved: DocPanelPreferences | null, viewportWidth: number): DocPanelPreferences {
  return saved ?? { width: DOC_PANEL_DEFAULT_WIDTH, collapsed: viewportWidth < DOC_PANEL_OPEN_FROM };
}
