import { describe, expect, it } from 'vitest';
import { documentHtml } from '../../src/lib/editor/clipboard';
import { LINE_HEIGHT, SPACE_AFTER_TWIPS, twipsToPx } from '../../src/lib/docx/office-defaults';
import { documentText, plainTextDocument } from '../../src/lib/editor/document';

const doc = (...content: unknown[]) => ({ type: 'doc', content });
const paragraph = (text: string, attrs?: Record<string, unknown>) => ({ type: 'paragraph', ...(attrs ? { attrs } : {}), content: [{ type: 'text', text }] });

describe('review: copying keeps the formatting a paste needs', () => {
  it('emits semantic tags for headings, emphasis and links', () => {
    const html = documentHtml(doc(
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Metode' }] },
      { type: 'paragraph', content: [
        { type: 'text', text: 'Hasil ', marks: [{ type: 'bold' }] },
        { type: 'text', text: 'penting', marks: [{ type: 'italic' }, { type: 'underline' }] },
        { type: 'text', text: ' lihat ' },
        { type: 'text', text: 'sumber', marks: [{ type: 'link', attrs: { href: 'https://example.test/a' } }] },
      ] },
    ));
    expect(html).toMatch(/<h2[^>]*>Metode<\/h2>/);
    expect(html).toContain('<strong>Hasil </strong>');
    expect(html).toContain('<em><u>penting</u></em>');
    expect(html).toMatch(/<a href="https:\/\/example\.test\/a"[^>]*>sumber<\/a>/);
  });

  it('emits real list and table structure rather than flattened text', () => {
    const html = documentHtml(doc(
      { type: 'bulletList', content: [{ type: 'listItem', content: [paragraph('Satu')] }, { type: 'listItem', content: [paragraph('Dua')] }] },
      { type: 'orderedList', attrs: { start: 3 }, content: [{ type: 'listItem', content: [paragraph('Tiga')] }] },
      { type: 'table', content: [
        { type: 'tableRow', content: [{ type: 'tableHeader', content: [paragraph('Paket')] }, { type: 'tableHeader', content: [paragraph('Biaya')] }] },
        { type: 'tableRow', content: [{ type: 'tableCell', content: [paragraph('Pro')] }, { type: 'tableCell', content: [paragraph('99rb')] }] },
      ] },
    ));
    expect(html).toMatch(/<ul[^>]*><li><p[^>]*>Satu<\/p><\/li><li><p[^>]*>Dua<\/p><\/li><\/ul>/);
    expect(html).toContain('<ol start="3"');
    expect(html).toMatch(/<th[^>]*><p[^>]*>Paket<\/p><\/th>/);
    expect(html).toMatch(/<td[^>]*><p[^>]*>99rb<\/p><\/td>/);
    // The old plain-text copy turned this table into "Paket | Biaya", which pasted as one line.
    expect(documentText(doc({ type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableCell', content: [paragraph('Paket')] }, { type: 'tableCell', content: [paragraph('Biaya')] }] }] }))).toBe('Paket | Biaya');
  });

  it('keeps alignment, blank lines and rules that a paste would otherwise lose', () => {
    const html = documentHtml(doc(paragraph('Kanan', { textAlign: 'right' }), { type: 'paragraph' }, { type: 'horizontalRule' }, paragraph('Kiri', { textAlign: 'left' })));
    expect(html).toMatch(/<p style="[^"]*text-align:right[^"]*">Kanan<\/p>/);
    expect(html).toMatch(/<p[^>]*>&nbsp;<\/p>/);
    expect(html).toContain('<hr style=');
    // Left is the default, so it is never written out.
    expect(html).not.toContain('text-align:left');
  });

  it('escapes text so pasted content cannot smuggle markup', () => {
    expect(documentHtml(doc(paragraph('a < b & c > d')))).toContain('>a &lt; b &amp; c &gt; d<');
    expect(documentHtml(doc({ type: 'paragraph', content: [{ type: 'text', text: 'x', marks: [{ type: 'link', attrs: { href: 'https://example.test/?a="b"' } }] }] }))).toContain('href="https://example.test/?a=&quot;b&quot;"');
  });

  it('turns a plain AI result into paragraphs so the preview copy pastes cleanly', () => {
    expect(documentHtml(plainTextDocument('Baris satu.\nBaris dua.'))).toMatch(/<p[^>]*>Baris satu\.<\/p><p[^>]*>Baris dua\.<\/p>/);
  });
});

// The paste used to inherit the destination app's spacing, so it never matched the canvas. These lock in that
// the canvas rules travel with the HTML, and that the two canvases produce two different profiles.
describe('review: copying carries the canvas spacing, not the destination default', () => {
  const sample = doc(
    { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Judul' }] },
    paragraph('Satu'),
    { type: 'bulletList', content: [{ type: 'listItem', content: [paragraph('Poin')] }] },
  );

  it('states the font, size and line height once on the wrapper so every block inherits them', () => {
    const paged = documentHtml(sample, { mode: 'paged' });
    expect(paged).toMatch(/^<div style="[^"]*Carlito[^"]*"/);
    expect(paged).toContain(`line-height:${LINE_HEIGHT}`);
    // 11pt is what the DOCX writer emits, so the paste has to say the same.
    expect(paged).toContain('font-size:14.67px');
  });

  it('gives every paragraph Word\'s 8pt space-after in advanced mode', () => {
    const gap = `margin:0 0 ${Number(twipsToPx(SPACE_AFTER_TWIPS).toFixed(2))}px`;
    expect(documentHtml(sample, { mode: 'paged' })).toContain(gap);
    // The same constant the DOCX writer and the paged CSS use; 8pt at 96dpi.
    expect(Number(twipsToPx(SPACE_AFTER_TWIPS).toFixed(2))).toBeCloseTo(10.67, 2);
  });

  it('uses the plain canvas spacing when advanced mode is off', () => {
    const plain = documentHtml(sample, { mode: 'plain' });
    expect(plain).toContain('font-size:16px');
    expect(plain).toContain('line-height:1.75');
    expect(plain).toContain('margin:0 0 12px');
    expect(plain).not.toContain('Carlito');
  });

  it('produces different spacing for the two canvases rather than one generic paste', () => {
    expect(documentHtml(sample, { mode: 'paged' })).not.toBe(documentHtml(sample, { mode: 'plain' }));
  });

  it('keeps list items tight so a list does not gain a blank line per item', () => {
    const paged = documentHtml(sample, { mode: 'paged' });
    // The paragraph inside a list item carries margin:0, not the block gap.
    expect(paged).toMatch(/<li><p style="margin:0;/);
  });

  it('defaults to the plain profile when no mode is given', () => {
    expect(documentHtml(sample)).toBe(documentHtml(sample, { mode: 'plain' }));
  });
});
