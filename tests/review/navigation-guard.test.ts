import { afterEach, describe, expect, it, vi } from 'vitest';
import { guardedPush, leaveHref, leavesPath, requestLeave, setLeaveGuard, type LinkClick } from '../../src/lib/client/navigation-guard';

const place = { href: 'https://app.test/notebooks/abc?compare=x', origin: 'https://app.test', pathname: '/notebooks/abc' };
const click = (patch: Partial<LinkClick> = {}): LinkClick => ({ button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, defaultPrevented: false, href: '/notebooks', target: null, download: false, ...patch });

describe('leaveHref', () => {
  it('intercepts plain same-origin links that leave the notebook', () => {
    expect(leaveHref(click(), place)).toBe('/notebooks');
    expect(leaveHref(click({ href: 'https://app.test/settings?tab=a#profil', target: '_self' }), place)).toBe('/settings?tab=a#profil');
    expect(leaveHref(click({ href: '../app' }), place)).toBe('/app');
  });
  it('ignores modifier, non-primary, prevented, new-tab and download clicks', () => {
    for (const patch of [{ metaKey: true }, { ctrlKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }, { defaultPrevented: true }, { target: '_blank' }, { download: true }, { href: null }]) expect(leaveHref(click(patch), place)).toBeNull();
  });
  it('ignores hash-only, same-path, external and non-http links', () => {
    for (const href of ['#top', '/notebooks/abc', '/notebooks/abc?panel=history', 'https://other.test/notebooks', 'mailto:a@b.c', 'javascript:void(0)']) expect(leaveHref(click({ href }), place)).toBeNull();
  });
  it('detects path changes for programmatic pushes', () => {
    expect(leavesPath('/notebooks/xyz', place)).toBe(true);
    expect(leavesPath('/notebooks/abc#x', place)).toBe(false);
  });
});

describe('leave guard registry', () => {
  afterEach(() => setLeaveGuard(null));
  it('navigates directly without a guard', () => {
    const push = vi.fn();
    expect(guardedPush({ push }, '/app')).toBe(true);
    expect(push).toHaveBeenCalledWith('/app');
  });
  it('lets the guard block or allow navigation', () => {
    const push = vi.fn(); let block = true;
    setLeaveGuard((href) => block && href === '/app');
    expect(guardedPush({ push }, '/app')).toBe(false);
    expect(push).not.toHaveBeenCalled();
    block = false;
    expect(requestLeave('/app', push)).toBe(true);
    expect(push).toHaveBeenCalledOnce();
  });
  it('only clears the guard it registered', () => {
    const push = vi.fn();
    const clearFirst = setLeaveGuard(() => true);
    setLeaveGuard(() => true);
    clearFirst();
    expect(guardedPush({ push }, '/app')).toBe(false);
  });
});
