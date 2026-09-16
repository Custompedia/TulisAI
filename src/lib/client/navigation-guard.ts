// Returns true when the guard took over the navigation (e.g. opened an unsaved-changes prompt).
export type LeaveGuard = (href: string) => boolean;
export type LinkClick = { button: number; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean; defaultPrevented: boolean; href: string | null; target: string | null; download: boolean };
export type Place = { href: string; origin: string; pathname: string };

let guard: LeaveGuard | null = null;

export function setLeaveGuard(fn: LeaveGuard | null) {
  guard = fn;
  return () => { if (guard === fn) guard = null; };
}

export function requestLeave(href: string, navigate: (href: string) => void) {
  if (guard?.(href)) return false;
  navigate(href); return true;
}

export const guardedPush = (router: { push: (href: string) => void }, href: string) => requestLeave(href, (next) => router.push(next));

// Same-origin in-app destination to intercept, or null when the click should pass through.
export function leaveHref(click: LinkClick, place: Place): string | null {
  if (click.defaultPrevented || click.button !== 0 || click.metaKey || click.ctrlKey || click.shiftKey || click.altKey || click.download || !click.href) return null;
  if (click.target && click.target.toLowerCase() !== '_self') return null;
  let url: URL;
  try { url = new URL(click.href, place.href); } catch { return null; }
  if (url.origin !== place.origin || (url.protocol !== 'http:' && url.protocol !== 'https:') || url.pathname === place.pathname) return null;
  return `${url.pathname}${url.search}${url.hash}`;
}

export function leavesPath(href: string, place: Place) {
  try { return new URL(href, place.href).pathname !== place.pathname; } catch { return false; }
}
