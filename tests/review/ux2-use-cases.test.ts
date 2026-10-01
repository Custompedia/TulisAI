import { describe, expect, it } from 'vitest';
import { DOC_TYPES, skeletonOrder } from '@/lib/writing/doc-types';
import { asUseCase, defaultModeFor, humanizerContextFor, USE_CASES } from '@/lib/writing/use-cases';

describe('UX 2: finer onboarding use cases', () => {
  it('keeps the original three and adds content, article and paraphrase', () => {
    expect(USE_CASES).toEqual(['academic', 'professional', 'general', 'content', 'article', 'paraphrase']);
    expect(asUseCase('poetry')).toBe('general');
    expect(asUseCase(null)).toBe('general');
  });
  it('maps each use case to a starting mode and a Humanize context the settings API accepts', () => {
    expect(USE_CASES.map((value) => defaultModeFor(value))).toEqual(['P02_ACADEMIC', 'P04_PROFESSIONAL', 'P03_HUMANIZER', 'P05_CREATIVE', 'P01_STANDARD_REWRITE', 'P01_STANDARD_REWRITE']);
    expect(USE_CASES.map((value) => humanizerContextFor(value))).toEqual(['academic', 'professional', 'general', 'general', 'general', 'general']);
    expect(defaultModeFor('unknown')).toBe('P03_HUMANIZER');
  });
  it('orders the Beranda outline chips for each use case, always listing every kind once', () => {
    expect(skeletonOrder('content').slice(0, 2)).toEqual(['script', 'caption']);
    expect(skeletonOrder('article')[0]).toBe('article');
    expect(skeletonOrder('paraphrase')[0]).toBe('essay');
    expect(skeletonOrder('academic')[0]).toBe('essay');
    expect(skeletonOrder('unknown').slice(0, 2)).toEqual(['article', 'script']);
    for (const useCase of [...USE_CASES, null]) expect([...skeletonOrder(useCase)].sort()).toEqual([...DOC_TYPES].sort());
  });
});
