import { describe, expect, it } from 'vitest';
import { compileControlBlock, normalizeRuntime, validateGeneration, validateProtectedContent } from '../../src/server/ai/core';
import { lengthBand, paragraphsPreserved } from '../../src/server/ai/core/validators';
import { stripListMarkers } from '../../src/server/ai/core/numeric';
import { formatOptions, requestSummary } from '../../src/components/writing/modes';
import { defaults, runtimeControls } from '../../src/lib/writing/settings';

const id = (value: string) => value;
const base = { sourceText: 'Produk ini hemat energi. Harganya terjangkau untuk keluarga.', language: 'id' as const, protectedTerms: [], protectedCitations: [] };
const transform = (text: string) => ({ transformed_text: text, change_categories: [], warnings: [], no_change_needed: false });

describe('UX 2: script and thread output formats', () => {
  it('reach the P01–P06 control block through Sesuaikan', () => {
    const runtime = normalizeRuntime('P05_CREATIVE', { ...base, strength: 'balanced', ...runtimeControls({ ...defaults, mode: 'creative', customized: true, format: 'thread' }, 'id') });
    expect(runtime.request).toMatchObject({ format: 'thread' });
    const block = compileControlBlock(runtime.request as never);
    expect(block).toContain("Format: a social media thread");
    expect(block).toContain("'1/', '2/'");
    const script = compileControlBlock(normalizeRuntime('P01_STANDARD_REWRITE', { ...base, strength: 'balanced', request: { format: 'script', focus: [] } }).request as never);
    expect(script).toContain('Format: a script to be read aloud');
    expect(script).toContain('one idea per line');
  });

  it('re-break lines, so the paragraph and length checks step aside', () => {
    expect(paragraphsPreserved('Satu paragraf.', '1/ Satu.\n2/ Dua.', 'thread')).toBe(true);
    expect(paragraphsPreserved('Satu paragraf.', 'Satu.\nDua.', 'script')).toBe(true);
    expect(lengthBand('P01_STANDARD_REWRITE', { format: 'script', length: 'sama' })).toBeNull();
    expect(lengthBand('P01_STANDARD_REWRITE', { format: 'thread' })).toBeNull();
  });

  it('treat a thread number as layout, never as an invented figure, while a fraction stays a number', () => {
    expect(stripListMarkers('1/ Hemat energi.\n2/ Harga terjangkau.')).toBe('Hemat energi.\nHarga terjangkau.');
    expect(stripListMarkers('1/2 cangkir gula')).toBe('1/2 cangkir gula');
    expect(validateProtectedContent('Produk ini hemat energi.', '1/ Produk ini hemat energi.\n2/ Cocok untuk keluarga.', [], []).valid).toBe(true);
    expect(validateProtectedContent('Produk ini hemat energi.', '1/ Produk ini hemat 30% energi.', [], []).valid).toBe(false);
  });

  it('pass the generation validator with a numbered thread', () => {
    const runtime = normalizeRuntime('P05_CREATIVE', { ...base, strength: 'balanced', request: { format: 'thread', focus: [] } });
    const output = validateGeneration('P05_CREATIVE', base.sourceText, transform('1/ Produk ini hemat energi.\n2/ Harganya terjangkau untuk keluarga.'), { ...base, request: runtime.request } as never);
    expect(output.transformed_text).toContain('2/ Harganya');
  });

  it('are offered in Sesuaikan only for Script konten and Caption/Post', () => {
    const values = (docType?: string | null, current?: string) => formatOptions(id, docType, current).map((option) => option.value);
    expect(values('script')).toEqual(expect.arrayContaining(['script', 'thread']));
    expect(values('caption')).toEqual(expect.arrayContaining(['script', 'thread']));
    expect(values('essay')).not.toContain('thread');
    expect(values(null)).not.toContain('script');
    // A value a skill already carries stays visible instead of a blank select.
    expect(values('essay', 'thread')).toContain('thread');
    expect(requestSummary({ ...defaults, mode: 'creative', customized: true, format: 'thread' }, id)).toContain('thread');
  });
});
