import { describe, expect, it } from 'vitest';
import { Schema } from '@tiptap/pm/model';
import { gutterTargets } from '../../src/components/workspace/paragraph-gutter';

// The same node set the editor uses, reduced to what the gutter has to reason about.
const schema = new Schema({
  nodes: {
    doc: { content: 'block+' }, text: { group: 'inline' },
    paragraph: { group: 'block', content: 'inline*' },
    heading: { group: 'block', content: 'inline*', attrs: { level: { default: 1 } } },
    blockquote: { group: 'block', content: 'block+' },
    horizontalRule: { group: 'block' },
    bulletList: { group: 'block', content: 'listItem+' },
    listItem: { content: 'paragraph block*' },
  },
  marks: {},
});

const doc = (...content: unknown[]) => schema.nodeFromJSON({ type: 'doc', content });
const paragraph = (text?: string) => ({ type: 'paragraph', ...(text ? { content: [{ type: 'text', text }] } : {}) });

describe('review: the paragraph gutter targets real blocks only', () => {
  it('offers one target per top-level block that holds text', () => {
    const targets = gutterTargets(doc(paragraph('Satu'), { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Dua' }] }));
    expect(targets).toHaveLength(2);
  });

  it('skips blank paragraphs and blocks with no text of their own', () => {
    expect(gutterTargets(doc(paragraph(), paragraph('   '), { type: 'horizontalRule' }, paragraph('Ada isi')))).toHaveLength(1);
  });

  it('selects exactly the block text, never the block boundary', () => {
    const document = doc(paragraph('Satu'), paragraph('Dua'));
    const [first, second] = gutterTargets(document);
    expect(document.textBetween(first!.from, first!.to)).toBe('Satu');
    expect(document.textBetween(second!.from, second!.to)).toBe('Dua');
  });

  it('treats a list and a quote as single targets, not one per line', () => {
    const list = { type: 'bulletList', content: [
      { type: 'listItem', content: [paragraph('Poin satu')] },
      { type: 'listItem', content: [paragraph('Poin dua')] },
    ] };
    const quote = { type: 'blockquote', content: [paragraph('Kutipan')] };
    const targets = gutterTargets(doc(list, quote));
    expect(targets).toHaveLength(2);
  });

  it('keeps offsets valid after the document grows', () => {
    const document = doc(paragraph('Satu'), paragraph('Dua'), paragraph('Tiga'));
    for (const target of gutterTargets(document)) {
      expect(target.from).toBeGreaterThan(0);
      expect(target.to).toBeLessThanOrEqual(document.content.size);
      expect(document.textBetween(target.from, target.to).trim()).not.toBe('');
    }
  });
});
