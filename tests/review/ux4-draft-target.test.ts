import { describe, expect, it } from 'vitest';
import { firstDraftSpot } from '@/components/workspace/editor-rules';

// The Artikel outline: an H1 title above H2 sections, each followed by an empty line.
const article = [
  { type: 'heading', level: 1, text: 'Judul artikel', pos: 0, size: 15 }, { type: 'paragraph', text: '', pos: 15, size: 2 },
  { type: 'heading', level: 2, text: 'Pembuka', pos: 17, size: 9 }, { type: 'paragraph', text: '', pos: 26, size: 2 },
  { type: 'heading', level: 2, text: 'Subjudul 1', pos: 28, size: 12 }, { type: 'paragraph', text: '', pos: 40, size: 2 },
  { type: 'heading', level: 2, text: 'Penutup', pos: 42, size: 9 }, { type: 'paragraph', text: '', pos: 51, size: 2 },
];

describe('UX 4 finding 10: the Asisten draft card targets the first empty section', () => {
  it('skips the title heading above the sections and offers the first section, not the last', () => {
    expect(firstDraftSpot(article)).toEqual({ pos: 18, heading: 'Pembuka', headingPos: 17 });
  });
  it('moves on once a section has text, and still offers a same-level first heading', () => {
    const written = article.map((block) => (block.pos === 26 ? { ...block, text: 'Sudah ditulis.' } : block));
    expect(firstDraftSpot(written)?.heading).toBe('Subjudul 1');
    expect(firstDraftSpot(article.slice(2))?.heading).toBe('Pembuka');
  });
});
