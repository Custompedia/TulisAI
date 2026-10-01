import { describe, expect, it } from 'vitest';
import { planNoticeCopy } from '@/lib/client/quota';
import { shownTitle, STORED_UNTITLED } from '@/lib/writing/title';
import { styleTemplates } from '@/components/writing/style-form';
import { contextOptions, preservationOptions, recipientOptions } from '@/components/writing/modes';
import { normalizeSettings } from '@/lib/writing/settings';

const id = (value: string) => value;
const en = (_: string, value: string) => value;

describe('UX 4 finding 10: copy', () => {
  it('tells Free its one-time characters are gone and only paid plans to wait for a refill', () => {
    const notice = { kind: 'plan', code: 'QUOTA_EXCEEDED', requiredTier: null } as const;
    expect(planNoticeCopy(notice, id, true).message).toContain('Karakter sekali pakai sudah habis.');
    expect(planNoticeCopy(notice, id, true).message).not.toContain('terisi lagi');
    expect(planNoticeCopy(notice, en, true).message).not.toMatch(/refill/);
    expect(planNoticeCopy(notice, id, false).message).toContain('sampai kuota terisi lagi');
  });

  it('shows the stored English default and an empty title as "Tanpa judul" without changing the data', () => {
    expect(STORED_UNTITLED).toBe('Untitled document');
    expect(shownTitle('Untitled document', id)).toBe('Tanpa judul');
    expect(shownTitle('  ', id)).toBe('Tanpa judul');
    expect(shownTitle(null, en)).toBe('Untitled');
    expect(shownTitle('Esai Bab 2', id)).toBe('Esai Bab 2');
  });

  it('offers the mode-only skill templates with valid options, and marks only the email template as Max', () => {
    const templates = styleTemplates(id);
    expect(templates.map((template) => template.name)).toEqual(['Email profesional', 'Caption santai', 'Parafrase skripsi', 'Pesan ke klien', 'Humanize profesional']);
    expect(templates.filter((template) => template.tier).map((template) => [template.name, template.tier])).toEqual([['Email profesional', 'max']]);
    for (const template of templates.slice(1)) {
      // Mode and options only: nothing a plan below Max would drop, and every value survives normalisation.
      expect(template.settings).toMatchObject({ customized: false, extra: '', sample: '', format: 'paragraph' });
      expect(normalizeSettings(template.settings as unknown as Record<string, unknown>)).toEqual(template.settings);
    }
    const [, caption, thesis, client, humanize] = templates;
    expect(caption!.settings).toMatchObject({ mode: 'creative', strength: 'light' });
    expect(thesis!.settings).toMatchObject({ mode: 'academic', academic: 'thesis' });
    expect(client!.settings).toMatchObject({ mode: 'professional', recipient: 'klien' });
    expect(humanize!.settings).toMatchObject({ mode: 'humanize', context: 'professional', preservation: 'balanced' });
    expect(recipientOptions(id).some((option) => option.value === 'klien')).toBe(true);
    expect(contextOptions(id).some((option) => option.value === 'professional')).toBe(true);
    expect(preservationOptions(id).find((option) => option.value === 'balanced')?.label).toContain('30%');
  });
});
