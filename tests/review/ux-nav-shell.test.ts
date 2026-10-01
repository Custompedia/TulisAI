import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/client/api';
import { compactCharacters, daysLeft, planLine, planNoticeCopy, planNoticeFor, quotaLevel } from '@/lib/client/quota';
import { balanceRows, orderStatus } from '@/lib/client/usage-view';
import { filterCommands, moveActive, normalizeQuery, type Command } from '@/lib/navigation/commands';
import { libraryFilter, libraryQuery, modeCount } from '@/lib/navigation/library';
import { adminTabFromHash, hasContextSidebar, railActive, sectionFor, settingsRoute, type RailId } from '@/lib/navigation/sections';
import { clampSidebarWidth, parseSidebarCookie, sidebarCookie, sidebarKeyStep, SIDEBAR_DEFAULT_WIDTH, SIDEBAR_MAX_WIDTH, SIDEBAR_MIN_WIDTH } from '@/lib/navigation/sidebar';
import { skillSelection } from '@/components/skills/skill-events';
import { shortcutGroups } from '@/components/app/ShortcutsDialog';

const id = (value: string) => value;
const en = (_: string, value: string) => value;
const params = (entries: Record<string, string>) => new URLSearchParams(entries);

describe('sidebar cookie', () => {
  it('parses width:collapsed and falls back on anything malformed', () => {
    expect(parseSidebarCookie('300:1')).toEqual({ width: 300, collapsed: true });
    expect(parseSidebarCookie('300:0')).toEqual({ width: 300, collapsed: false });
    expect(parseSidebarCookie(undefined)).toEqual({ width: SIDEBAR_DEFAULT_WIDTH, collapsed: false });
    expect(parseSidebarCookie('')).toEqual({ width: 260, collapsed: false });
    expect(parseSidebarCookie('abc:1')).toEqual({ width: 260, collapsed: true });
    expect(parseSidebarCookie('300.5:0').width).toBe(260);
    // Out of range is a stale or hand-edited cookie: back to the default, not clamped.
    expect(parseSidebarCookie('120:0').width).toBe(260);
    expect(parseSidebarCookie('900:0').width).toBe(260);
    expect(parseSidebarCookie(`${SIDEBAR_MIN_WIDTH}:0`).width).toBe(190);
    expect(parseSidebarCookie(`${SIDEBAR_MAX_WIDTH}:0`).width).toBe(480);
  });

  it('serializes for one year on the whole site, clamped', () => {
    expect(sidebarCookie({ width: 300, collapsed: true })).toBe('tulis_sidebar=300:1; Path=/; Max-Age=31536000; SameSite=Lax');
    expect(sidebarCookie({ width: 50, collapsed: false })).toMatch(/^tulis_sidebar=190:0;/);
    expect(sidebarCookie({ width: 9999, collapsed: false })).toMatch(/^tulis_sidebar=480:0;/);
    const round = sidebarCookie({ width: 333.4, collapsed: true }).split(';')[0]!.split('=')[1];
    expect(parseSidebarCookie(round)).toEqual({ width: 333, collapsed: true });
  });

  it('clamps drag widths to 190–480', () => {
    expect(clampSidebarWidth(100)).toBe(190);
    expect(clampSidebarWidth(1000)).toBe(480);
    expect(clampSidebarWidth(300.6)).toBe(301);
    expect(clampSidebarWidth(Number.NaN)).toBe(260);
  });

  it('moves the edge with the keyboard like a separator', () => {
    expect(sidebarKeyStep(260, 'ArrowRight')).toBe(276);
    expect(sidebarKeyStep(260, 'ArrowLeft')).toBe(244);
    expect(sidebarKeyStep(260, 'ArrowRight', true)).toBe(324);
    expect(sidebarKeyStep(470, 'ArrowRight')).toBe(480);
    expect(sidebarKeyStep(195, 'ArrowLeft')).toBe(190);
    expect(sidebarKeyStep(300, 'Home')).toBe(190);
    expect(sidebarKeyStep(300, 'End')).toBe(480);
    expect(sidebarKeyStep(300, 'Enter')).toBeNull();
  });
});

describe('navigation active state', () => {
  const active = (pathname: string) => (['new', 'home', 'notebooks', 'skills', 'admin', 'account'] as RailId[]).filter((item) => railActive(item, pathname));

  it('maps each signed-in path to its section', () => {
    expect(sectionFor('/app')).toBe('home');
    expect(sectionFor('/app/')).toBe('home');
    expect(sectionFor('/notebooks')).toBe('notebooks');
    expect(sectionFor('/notebooks/abc-123')).toBe('editor');
    expect(sectionFor('/skills')).toBe('skills');
    expect(sectionFor('/settings')).toBe('account');
    expect(sectionFor('/admin')).toBe('admin');
    expect(sectionFor('/')).toBeNull();
    expect(sectionFor('/login')).toBeNull();
    expect(sectionFor('/notebooks/a/b')).toBeNull();
  });

  it('lights exactly one rail item, never "Tulis baru"', () => {
    expect(active('/app')).toEqual(['home']);
    expect(active('/notebooks')).toEqual(['notebooks']);
    // The editor belongs to the library.
    expect(active('/notebooks/abc')).toEqual(['notebooks']);
    expect(active('/skills')).toEqual(['skills']);
    expect(active('/settings')).toEqual(['account']);
    expect(active('/admin')).toEqual(['admin']);
    expect(active('/onboarding')).toEqual([]);
  });

  it('gives Beranda and the editor no context sidebar', () => {
    expect(hasContextSidebar('home')).toBe(false);
    expect(hasContextSidebar('editor')).toBe(false);
    expect(hasContextSidebar(null)).toBe(false);
    for (const section of ['notebooks', 'skills', 'account', 'admin'] as const) expect(hasContextSidebar(section)).toBe(true);
  });
});

describe('settings and admin hashes', () => {
  it('keeps old /settings hashes working', () => {
    expect(settingsRoute('#skills')).toEqual({ redirect: '/skills' });
    expect(settingsRoute('#bahasa')).toEqual({ tab: 'preferensi' });
    expect(settingsRoute('')).toEqual({ tab: 'profil' });
    expect(settingsRoute('#nope')).toEqual({ tab: 'profil' });
    for (const tab of ['profil', 'keamanan', 'menulis', 'preferensi', 'pemakaian', 'privasi']) expect(settingsRoute(`#${tab}`)).toEqual({ tab });
    expect(settingsRoute('#Pemakaian')).toEqual({ tab: 'pemakaian' });
  });

  it('keeps the admin hashes', () => {
    expect(adminTabFromHash('#payments')).toBe('payments');
    expect(adminTabFromHash('#ai')).toBe('ai');
    expect(adminTabFromHash('#log')).toBe('log');
    expect(adminTabFromHash('')).toBe('database');
    expect(adminTabFromHash('#x')).toBe('database');
  });

  it('reads the Skill page selection from the URL', () => {
    expect(skillSelection(params({ skill: 's1' }))).toEqual({ kind: 'skill', id: 's1' });
    expect(skillSelection(params({ template: '0' }))).toEqual({ kind: 'template', index: 0 });
    expect(skillSelection(params({ template: 'x' }))).toBeNull();
    expect(skillSelection(params({}))).toBeNull();
  });
});

describe('command palette filtering', () => {
  const actions: Command[] = [
    { id: 'new', group: 'actions', label: 'Tulis baru', keywords: 'buat notebook' },
    { id: 'usage', group: 'actions', label: 'Pemakaian & paket', keywords: 'kuota karakter' },
  ];
  const notebooks: Command[] = Array.from({ length: 30 }, (_, index) => ({ id: `doc:${index}`, group: 'notebooks', label: index === 3 ? 'Esai Bab 2 — Kajian' : `Catatan ${index}` }));
  const skills: Command[] = [{ id: 'skill:1', group: 'skills', label: 'Email klien', description: 'Profesional' }];
  const all = [...skills, ...notebooks, ...actions];

  it('keeps the group order and trims long groups when idle', () => {
    const idle = filterCommands(all, '');
    expect(idle.map((item) => item.group).filter((group, index, list) => list.indexOf(group) === index)).toEqual(['actions', 'notebooks', 'skills']);
    expect(idle.filter((item) => item.group === 'actions')).toHaveLength(2);
    expect(idle.filter((item) => item.group === 'notebooks')).toHaveLength(6);
  });

  it('matches every word across label, description and keywords, ignoring case and accents', () => {
    expect(filterCommands(all, 'esai kajian').map((item) => item.id)).toEqual(['doc:3']);
    expect(filterCommands(all, 'KUOTA').map((item) => item.id)).toEqual(['usage']);
    expect(filterCommands(all, 'email profesional').map((item) => item.id)).toEqual(['skill:1']);
    expect(filterCommands([{ id: 'x', group: 'notebooks', label: 'Résumé' }], 'resume')).toHaveLength(1);
    expect(filterCommands(all, 'tidak-ada')).toEqual([]);
    expect(normalizeQuery('  Café ')).toBe('cafe');
  });

  it('caps a matching list group at 20', () => {
    expect(filterCommands(all, 'catatan')).toHaveLength(20);
  });

  it('wraps arrow-key movement', () => {
    expect(moveActive(0, 3, 'ArrowDown')).toBe(1);
    expect(moveActive(2, 3, 'ArrowDown')).toBe(0);
    expect(moveActive(0, 3, 'ArrowUp')).toBe(2);
    expect(moveActive(1, 3, 'End')).toBe(2);
    expect(moveActive(1, 0, 'ArrowDown')).toBe(0);
  });
});

describe('plan and rate-limit toasts', () => {
  it.each(['QUOTA_EXCEEDED', 'REQUEST_LIMIT_REACHED', 'FEATURE_LOCKED'])('offers "Lihat paket" for %s', (code) => {
    const notice = planNoticeFor(new ApiError(code, 429));
    expect(notice?.kind).toBe('plan');
    expect(planNoticeCopy(notice!, id, false).showPlans).toBe(true);
  });

  it('keeps RATE_LIMITED separate and without "Lihat paket"', () => {
    const notice = planNoticeFor(new ApiError('RATE_LIMITED', 429));
    expect(notice).toEqual({ kind: 'rate', code: 'RATE_LIMITED' });
    const copy = planNoticeCopy(notice!, id, false);
    expect(copy.showPlans).toBe(false);
    expect(copy.message).toBe('Terlalu banyak permintaan AI dalam 1 menit. Tunggu sebentar lalu coba lagi.');
  });

  it('ignores every other failure', () => {
    for (const code of ['AI_UNAVAILABLE', 'NETWORK_ERROR', 'PAYMENTS_CLOSED', 'NOT_FOUND']) expect(planNoticeFor(new ApiError(code, 400))).toBeNull();
    expect(planNoticeFor(new Error('QUOTA_EXCEEDED'))).toBeNull();
    expect(planNoticeFor(null)).toBeNull();
  });

  it('names the plan a locked feature needs, when the server says so', () => {
    const notice = planNoticeFor(new ApiError('FEATURE_LOCKED', 403, { feature: 'docx_export', requiredTier: 'pro' }));
    expect(notice).toEqual({ kind: 'plan', code: 'FEATURE_LOCKED', requiredTier: 'pro' });
    expect(planNoticeCopy(notice!, id, false).message).toBe('Fitur ini ada di paket Pro.');
    expect(planNoticeCopy({ kind: 'plan', code: 'FEATURE_LOCKED', requiredTier: null }, id, false).message).toBe('Fitur ini ada di paket berbayar.');
  });

  it('never promises a monthly refill to a one-time allowance', () => {
    const notice = { kind: 'plan' as const, code: 'QUOTA_EXCEEDED' };
    expect(planNoticeCopy(notice, id, true).title).toBe('Karakter sekali pakai sudah habis');
    expect(planNoticeCopy(notice, id, false).title).toBe('Karakter bulan ini habis');
    expect(planNoticeCopy(notice, en, true).title).not.toMatch(/month/);
  });
});

describe('quota display', () => {
  it('turns the rail dot yellow at ≤10% and red when empty', () => {
    expect(quotaLevel(null)).toBeNull();
    expect(quotaLevel({ charactersRemaining: 0, characterLimit: 3_000 })).toBe('empty');
    expect(quotaLevel({ charactersRemaining: 300, characterLimit: 3_000 })).toBe('low');
    expect(quotaLevel({ charactersRemaining: 301, characterLimit: 3_000 })).toBe('ok');
    expect(quotaLevel({ charactersRemaining: 1, characterLimit: 5 })).toBe('low');
  });

  it('shortens the phone chip', () => {
    expect(compactCharacters(1_234, 'id')).toBe('1,2rb');
    expect(compactCharacters(12_345, 'id')).toBe('12rb');
    expect(compactCharacters(999, 'id')).toBe('999');
    expect(compactCharacters(1_250_000, 'id')).toBe('1,2jt');
    expect(compactCharacters(1_234, 'en')).toBe('1.2k');
  });

  it('writes the account menu plan line from the real plan', () => {
    expect(planLine({ tier: 'free', admin: false, oneTime: true, remaining: 1_800, paidUntil: null }, id, 'id')).toBe('Gratis · sisa 1.800 karakter sekali pakai');
    expect(planLine({ tier: 'pro', admin: false, oneTime: false, remaining: 5, paidUntil: '2026-10-31T12:00:00.000Z' }, id, 'id')).toBe('Pro · berlaku s.d. 31 Okt');
    expect(planLine({ tier: 'plus', admin: false, oneTime: false, remaining: 5, paidUntil: null }, id, 'id')).toBe('Plus');
    expect(planLine({ tier: 'max', admin: true, oneTime: false, remaining: 5, paidUntil: null }, id, 'id')).toBe('Max · akun admin');
  });

  it('counts whole days left, never negative', () => {
    const now = Date.parse('2026-10-01T00:00:00.000Z');
    expect(daysLeft('2026-10-31T00:00:00.000Z', now)).toBe(30);
    expect(daysLeft('2026-10-01T01:00:00.000Z', now)).toBe(1);
    expect(daysLeft('2026-09-01T00:00:00.000Z', now)).toBe(0);
  });

  it('breaks the balance down without counting frozen or expired top-ups as spendable', () => {
    expect(balanceRows({ mode: 'free', free: { original: 3_000, remaining: 1_800 }, included: null, purchased: { available: 0, frozen: 0, expired: 0 } }, id))
      .toEqual([expect.objectContaining({ id: 'free', value: 1_800, of: 3_000, spendable: true })]);
    const paid = balanceRows({ mode: 'paid', free: null, included: { original: 100_000, remaining: 40_000, periodEnd: '2026-10-31' }, purchased: { available: 5_000, frozen: 2_000, expired: 1_000 } }, id);
    expect(paid.map((row) => [row.id, row.spendable])).toEqual([['plan', true], ['topup', true], ['frozen', false], ['expired', false]]);
    expect(balanceRows({ mode: 'paid', free: null, included: null, purchased: { available: 0, frozen: 0, expired: 0 } }, id).map((row) => row.id)).toEqual(['topup']);
    expect(balanceRows(undefined, id)).toEqual([]);
  });

  it('labels order statuses', () => {
    expect(orderStatus('paid', id).label).toBe('Lunas');
    expect(orderStatus('pending', id).tone).toBe('wait');
    expect(orderStatus('failed', id).tone).toBe('bad');
    expect(orderStatus('expired', en).label).toBe('Expired');
  });
});

describe('notebook library filters (server-side since UX 2)', () => {
  const params = (value: string) => new URLSearchParams(value);
  it('reads the page URL and ignores anything unknown', () => {
    expect(libraryFilter(params('mode=custom&type=essay&sort=title&pinned=1'))).toEqual({ mode: 'standard', docType: 'essay', pinned: true, sort: 'title' });
    expect(libraryFilter(params('mode=nope&type=poem&sort=random'))).toEqual({ mode: null, docType: null, pinned: false, sort: 'updated' });
    expect(libraryFilter(params('view=trash&mode=academic'))).toEqual({ trash: true });
  });
  it('turns a filter into the API query', () => {
    expect(libraryQuery({ mode: 'academic', docType: 'none', sort: 'created', q: '  bab 1 ' }, { limit: 20, counts: true })).toBe('limit=20&mode=academic&docType=none&sort=created&q=bab+1&counts=1');
    expect(libraryQuery({ trash: true, mode: 'academic' }, { cursor: '5:x' })).toBe('cursor=5%3Ax&trash=1');
    expect(libraryQuery({ sort: 'updated', pinned: false })).toBe('');
  });
  it('shows a mode count only once the server counts are in', () => {
    expect(modeCount(null, 'humanize')).toBeNull();
    expect(modeCount({ all: 3, pinned: 0, trash: 0, docTypes: {}, modes: { humanize: 2 } }, 'humanize')).toBe(2);
    expect(modeCount({ all: 3, pinned: 0, trash: 0, docTypes: {}, modes: { humanize: 2 } }, 'academic')).toBe(0);
  });
});

describe('keyboard shortcuts', () => {
  it('lists the palette shortcut and only real bindings', () => {
    const keys = shortcutGroups(id).flatMap((group) => group.items.map((item) => item.keys.join('+')));
    expect(keys).toContain('Mod+K');
    expect(keys).toContain('Mod+S');
    // Mode fokus and the Perintah AI dock are real bindings since UX 1c.
    expect(keys).toContain('Mod+.');
    expect(keys).toContain('Mod+/');
  });
});

describe('shared shell wiring', () => {
  const files = (dir: string): string[] => readdirSync(dir).flatMap((name) => { const path = join(dir, name); return statSync(path).isDirectory() ? files(path) : /\.tsx?$/.test(name) ? [path] : []; });
  const read = (path: string) => readFileSync(path, 'utf8');

  it('mounts AppShell once, in the signed-in layout', () => {
    const pages = files(join('src', 'app', '(signed-in)')).filter((path) => path.endsWith('page.tsx'));
    expect(pages.length).toBeGreaterThanOrEqual(6);
    for (const page of pages) expect(read(page), page).not.toContain('<AppShell');
    expect(read(join('src', 'app', '(signed-in)', 'layout.tsx'))).toContain('readSidebarPreferences');
  });

  it('no longer refetches the account in the editor', () => {
    const workspace = read('src/components/workspace/Workspace.tsx');
    expect(workspace).not.toContain("'/api/me'");
    expect(workspace).not.toContain("'/api/settings'");
    expect(workspace).toContain('useShell()');
  });

  it('renders the plans dialog in one place', () => {
    const hosts = [...files('src/components'), ...files('src/app')].filter((path) => read(path).includes('<PlansDialog'));
    expect(hosts).toEqual([join('src', 'components', 'app', 'ShellHosts.tsx')]);
  });

  it('removes the unused /api/access twin of /api/usage', () => {
    expect(existsSync(join('src', 'app', 'api', 'access', 'route.ts'))).toBe(false);
  });

  it('sends the billing return back to Pemakaian & paket', () => {
    expect(read('src/components/billing/BillingReturnView.tsx')).toContain("BILLING_RETURN_HREF = '/settings#pemakaian'");
  });
});
