import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { characterUsage, collectAllPages, USER_CSV_HEADER, usersCsv, type AdminUser } from '@/components/admin/admin-shared';
import { LockedFeatureRow } from '@/components/app/PaidLock';
import { formatOptions, requestSummary, usesAudience } from '@/components/writing/modes';
import { LocaleScope } from '@/lib/client/locale';
import { PLAN_LIMITS, TIERS } from '@/lib/plans';
import { composerRun, firstRunCustomKey, firstRunOverride, quotaEmptyText, stashCustom } from '@/lib/writing/composer';
import { accountDefaultMode, DEFAULT_MODE_PROMPTS, DISPLAY_PREFERENCE_KEYS, groupChanged, resetGroup, WRITING_PREFERENCE_KEYS } from '@/lib/writing/preferences';
import { AI_SCOPE_LIMIT, defaults, runtimeControls } from '@/lib/writing/settings';

const id = (value: string) => value;
const en = (_: string, value: string) => value;

describe('composer autorun decision', () => {
  it.each(TIERS)('runs AI by itself only within the %s per-run limit', (tier) => {
    const { runLimit } = PLAN_LIMITS[tier];
    expect(composerRun(runLimit, runLimit)).toEqual({ autorun: true, limit: runLimit });
    expect(composerRun(runLimit + 1, runLimit)).toEqual({ autorun: false, limit: runLimit });
  });

  it('opens text between the per-run limit and the scope cap without autorun', () => {
    // Before UX 1a this band (1.001–20.000 on Free) always started a run that the notebook then refused.
    expect(composerRun(1_500, PLAN_LIMITS.free.runLimit).autorun).toBe(false);
    expect(composerRun(1_500, PLAN_LIMITS.plus.runLimit).autorun).toBe(true);
    expect(composerRun(AI_SCOPE_LIMIT + 1, Number.MAX_SAFE_INTEGER)).toEqual({ autorun: false, limit: AI_SCOPE_LIMIT });
  });

  it('names a one-time allowance differently from a monthly one', () => {
    expect(quotaEmptyText(true, id)).toBe('Karakter sekali pakai sudah habis.');
    expect(quotaEmptyText(false, id)).toBe('Karakter bulan ini habis.');
    expect(quotaEmptyText(true, en)).not.toMatch(/month/);
  });
});

describe('first-run Sesuaikan hand-off', () => {
  const custom = { ...defaults, mode: 'standard' as const, format: 'table', length: 'shorter', audience: 'client' as const, focus: ['clarity'], customized: true };

  it('stashes the Sesuaikan block only when it was applied', () => {
    expect(stashCustom(defaults)).toBeNull();
    expect(JSON.parse(stashCustom(custom)!)).toEqual({ format: 'table', length: 'shorter', audience: 'client', focus: ['clarity'], extra: '' });
    expect(firstRunCustomKey('doc-1')).toBe('writing-generate-custom:doc-1');
  });

  it('rebuilds the first run with the block on top of the stored notebook settings', () => {
    // What the notebook loads below Max: the server dropped the block and the flag.
    const stored = { ...defaults, mode: 'standard' as const, strength: 'strong' as const };
    const override = firstRunOverride(stored, stashCustom(custom));
    expect(override).toMatchObject({ mode: 'standard', strength: 'strong', format: 'table', length: 'shorter', audience: 'client', focus: ['clarity'], customized: true });
    // …so the run actually carries the request block again.
    expect(runtimeControls(override!, 'id').custom_request).toMatchObject({ format: 'table', length: 'shorter', audience: 'client' });
  });

  it('ignores a missing or unreadable stash', () => {
    expect(firstRunOverride(defaults, null)).toBeNull();
    expect(firstRunOverride(defaults, 'not json')).toBeNull();
    expect(firstRunOverride(defaults, '[1,2]')).toBeNull();
    expect(firstRunOverride(defaults, '{"format":7,"focus":"x"}')).toMatchObject({ format: 'paragraph', focus: [], customized: true });
  });
});

describe('Sesuaikan controls match the backend', () => {
  it('offers the table format the backend already supports', () => {
    expect(formatOptions(id).map((option) => option.value)).toContain('table');
    expect(requestSummary({ ...defaults, mode: 'standard', format: 'table', customized: true }, id)).toContain('tabel');
  });

  it('hides the reader for Profesional and Sederhanakan, which ignore it', () => {
    expect(usesAudience('professional')).toBe(false);
    expect(usesAudience('simplify')).toBe(false);
    expect(usesAudience('academic')).toBe(true);
    expect(requestSummary({ ...defaults, mode: 'professional', recipient: 'klien', customized: true, audience: 'lecturer' }, id)).not.toContain('pembaca');
    expect(requestSummary({ ...defaults, mode: 'academic', customized: true, audience: 'lecturer' }, id)).toContain('pembaca dosen');
  });
});

describe('plan-named locks', () => {
  it.each([['persistent_personalization', 'Max'], ['style_reference', 'Max'], ['saved_styles', 'Plus'], ['docx_import', 'Pro']] as const)('names %s as %s', (feature, tier) => {
    const html = renderToStaticMarkup(createElement(LockedFeatureRow, { feature, label: 'Catatan untuk AI', onUpgrade: vi.fn() }));
    expect(html).toContain(`Buka dengan ${tier}`);
    expect(renderToStaticMarkup(createElement(LocaleScope, { locale: 'en' }, createElement(LockedFeatureRow, { feature, label: 'x', onUpgrade: vi.fn() })))).toContain(`Unlock with ${tier}`);
  });
});

describe('admin character columns', () => {
  const user = (overrides: Partial<AdminUser> = {}): AdminUser => ({
    id: 'u1', name: 'Ada', email: 'ada@example.test', username: 'ada', image: null, role: 'user', tier: 'free', emailVerified: true, createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z',
    banned: false, banReason: null, banExpires: null, aiLimitOverride: null, aiCharacterLimitOverride: null, adminNote: null, requestLimit: 100, characterLimit: 3_000, charactersUsed: 1_200, characterScope: 'account', unlimited: false,
    requestsThisMonth: 4, failedThisMonth: 0, tokensThisMonth: 900, lastActiveAt: null, documents: 2, plan: { code: null, source: null, periodEnd: null, paidThrough: null }, ...overrides,
  });

  it('shows characters used against the balance, labelled by scope', () => {
    expect(characterUsage(user(), id)).toEqual({ used: 1_200, limit: 3_000, scope: 'sekali pakai', share: 0.4 });
    expect(characterUsage(user({ tier: 'pro', characterScope: 'period', characterLimit: 100_000, charactersUsed: 0 }), id).scope).toBe('bulan ini');
    // Admins are charged characters, so they get the same meter and never an unlimited marker.
    expect(characterUsage(user({ role: 'admin', unlimited: true, characterScope: 'period', characterLimit: 350_000 }), id)).toMatchObject({ limit: 350_000, scope: 'bulan ini' });
  });

  it('exports character columns and never an "unlimited" limit', () => {
    const csv = usersCsv([user({ role: 'admin', unlimited: true, characterScope: 'period', characterLimit: 350_000 }), user({ name: 'Grace, "G"' })]);
    const [header, admin, second] = csv.split('\n');
    expect(header!.split(',')).toEqual(USER_CSV_HEADER);
    expect(admin).toContain(',350000,period,');
    expect(csv).not.toContain('unlimited');
    expect(second).toContain('"Grace, ""G"""');
  });

  it('collects every page for the export, not just the page on screen', async () => {
    const pages = [[1, 2], [3, 4], [5]];
    const load = vi.fn(async (page: number) => ({ items: pages[page - 1]!, pageInfo: { page, pageSize: 2, total: 5, pages: 3 } }));
    expect(await collectAllPages(load)).toEqual([1, 2, 3, 4, 5]);
    expect(load.mock.calls.map(([page]) => page)).toEqual([1, 2, 3]);
  });
});

describe('writing preferences in settings', () => {
  const saved = { interfaceLanguage: 'id', writingLanguage: 'auto', defaultMode: 'P03_HUMANIZER', primaryUseCase: 'general', humanizerContext: 'general', localDrafts: true };

  it('offers exactly the six account-default modes the settings API accepts', () => {
    expect(DEFAULT_MODE_PROMPTS).toEqual(['P03_HUMANIZER', 'P01_STANDARD_REWRITE', 'P02_ACADEMIC', 'P04_PROFESSIONAL', 'P05_CREATIVE', 'P06_SIMPLIFY']);
    expect(accountDefaultMode('P04_PROFESSIONAL')).toBe('P04_PROFESSIONAL');
    // A legacy custom-transform default is shown and saved as Parafrase instead of failing the save.
    expect(accountDefaultMode('P08_CUSTOM_TRANSFORM')).toBe('P01_STANDARD_REWRITE');
    expect(accountDefaultMode('garbage')).toBe('P03_HUMANIZER');
  });

  it('keeps each card’s dirty state and discard to its own fields', () => {
    const form = { ...saved, defaultMode: 'P02_ACADEMIC', interfaceLanguage: 'en' };
    expect(groupChanged(form, saved, WRITING_PREFERENCE_KEYS)).toBe(true);
    expect(groupChanged(form, saved, DISPLAY_PREFERENCE_KEYS)).toBe(true);
    const discarded = resetGroup(form, saved, WRITING_PREFERENCE_KEYS);
    expect(discarded).toEqual({ ...saved, interfaceLanguage: 'en' });
    expect(groupChanged(discarded, saved, WRITING_PREFERENCE_KEYS)).toBe(false);
  });
});

describe('user copy', () => {
  const files = (dir: string): string[] => readdirSync(dir).flatMap((name) => { const path = join(dir, name); return statSync(path).isDirectory() ? files(path) : /\.tsx?$/.test(name) ? [path] : []; });
  const sources = [...files('src/components'), ...files('src/app')].filter((path) => !path.includes(`${join('src', 'app', 'api')}`)).map((path) => [path, readFileSync(path, 'utf8')] as const);

  it('calls the free-form feature "Perintah AI", never "AI Mode"', () => {
    for (const [path, source] of sources) expect(source.includes('AI Mode'), path).toBe(false);
  });

  it('never renders an unlimited ∞ for AI usage', () => {
    for (const [path, source] of sources) expect(/'∞'|"∞"/.test(source), path).toBe(false);
  });

  it('keeps the old humanizer-only canvas placeholder out of the editor', () => {
    const workspace = readFileSync('src/components/workspace/Workspace.tsx', 'utf8');
    expect(workspace).not.toContain('Tulis atau tempel teks yang terasa seperti tulisan AI');
    expect(workspace).toContain('Mulai menulis, atau tempel teks yang ingin diolah');
  });
});
