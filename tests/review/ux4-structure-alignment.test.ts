import { describe, expect, it } from 'vitest';
import { documentText, lineSimilarity, linesAligned, replaceBlocksKeepingStructure } from '@/lib/editor/document';
import { EditorDocumentSchema } from '@/lib/contracts';

const text = (value: string) => ({ type: 'text', text: value });
const para = (value: string) => ({ type: 'paragraph', content: [text(value)] });
const heading = (value: string, level = 2) => ({ type: 'heading', attrs: { level }, content: [text(value)] });

describe('UX 4 finding 3: structure-preserving apply checks the alignment, not just the line count', () => {
  const doc = EditorDocumentSchema.parse({ type: 'doc', content: [para('Kalimat pertama.'), para('Kalimat kedua.'), heading('Metode'), para('Paragraf panjang satu. Paragraf panjang dua.')] });
  const full = documentText(doc);

  it('does not move body text into the heading when one line is merged and another split', () => {
    const output = ['Kalimat pertama dan kedua digabung.', 'Metode', 'Paragraf panjang satu.', 'Paragraf panjang dua.'].join('\n');
    const result = replaceBlocksKeepingStructure(doc, 0, full.length, output);
    expect(result).toMatchObject({ content: null, structured: true, misaligned: true });
  });

  it('still keeps the structure for a line-for-line rewrite, including a reworded heading', () => {
    const output = ['Kalimat yang pertama.', 'Kalimat yang kedua.', 'Metodologi', 'Paragraf panjang pertama. Paragraf panjang kedua.'].join('\n');
    const result = replaceBlocksKeepingStructure(doc, 0, full.length, output);
    expect(result.content?.content.map((node) => node.type)).toEqual(['paragraph', 'paragraph', 'heading', 'paragraph']);
    expect(documentText(result.content)).toBe(output);
  });

  it('refuses a heading slot filled with unrelated text and a heading that shifted into a body slot', () => {
    expect(lineSimilarity('Metode', 'Metodologi')).toBeGreaterThanOrEqual(0.5);
    expect(lineSimilarity('Metode', 'Paragraf panjang satu.')).toBeLessThan(0.5);
    const originals = [{ text: 'Kalimat kedua.', heading: false }, { text: 'Metode', heading: true }, { text: 'Isi bagian metode yang panjang.', heading: false }];
    expect(linesAligned(originals, ['Kalimat kedua diubah.', 'Metode penelitian', 'Isi bagian metode yang lebih panjang.'])).toBe(true);
    expect(linesAligned(originals, ['Metode', 'Isi bagian metode yang panjang.', 'Tambahan.'])).toBe(false);
  });
});

