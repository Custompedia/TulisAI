import { describe, expect, it } from 'vitest';
import { clampPreferenceValues, copyPreferences, metaLimit, storedParts } from '@/lib/writing/notebook-meta';
import { defaults, normalizeSettings, SAMPLE_LIMIT } from '@/lib/writing/settings';
import { DocumentCreateSchema, DocumentPatchSchema } from '@/lib/contracts';

describe('UX 4 finding 4: a Max writing sample keeps its 1,000 characters through every copy path', () => {
  const sample = 'a'.repeat(SAMPLE_LIMIT);
  it('survives copyPreferences, storedParts and clampPreferenceValues', () => {
    expect(metaLimit('sample')).toBe(SAMPLE_LIMIT);
    const settings = normalizeSettings({ ...defaults, sample });
    const copied = copyPreferences({ settings, layout: {}, advanced: false, meta: {} }, { advancedNotebook: true, savedStyles: true });
    expect(copied.sample).toBe(sample);
    expect(copyPreferences(storedParts({ ...copied }), { advancedNotebook: false, savedStyles: false }).sample).toBe(sample);
    expect(clampPreferenceValues({ sample: `${sample}b` }).sample).toBe(sample);
    expect(clampPreferenceValues({ other: sample }).other).toHaveLength(500);
  });
  it('is accepted by the create and PATCH schemas up to SAMPLE_LIMIT and no further', () => {
    expect(DocumentCreateSchema.safeParse({ preferences: { sample } }).success).toBe(true);
    expect(DocumentPatchSchema.safeParse({ expectedRevision: 0, preferences: { sample } }).success).toBe(true);
    expect(DocumentCreateSchema.safeParse({ preferences: { sample: `${sample}b` } }).success).toBe(false);
    expect(DocumentCreateSchema.safeParse({ preferences: { tone: 'a'.repeat(501) } }).success).toBe(false);
  });
});

