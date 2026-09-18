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
    expect(html).toMatch(/<p style="[^"]*text-align:right[^"]*"[^>]*>Kanan<\/p>/);
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

// Copying used to drop fonts, colours, spacing and list types, so a paste into Docs or Word no longer matched
// the canvas. Explicit node attrs now travel as inline CSS layered on top of the mode profile.
describe('review: copying carries every format the canvas can show', () => {
  const styled = (text: string, marks: unknown[]) => ({ type: 'text', text, marks });

  it('writes fonts, colours, highlight, strike and scripts', () => {
    const html = documentHtml(doc({ type: 'paragraph', content: [
      styled('Serif', [{ type: 'textStyle', attrs: { fontFamily: 'Times New Roman', fontSize: '14pt', color: '#ff0000', backgroundColor: null } }]),
      styled('Stabilo', [{ type: 'highlight', attrs: { color: '#fef08a' } }]),
      styled('Coret', [{ type: 'strike' }]),
      styled('2', [{ type: 'superscript' }]),
      styled('i', [{ type: 'subscript' }]),
    ] }), { mode: 'paged' });
    expect(html).toContain('<span style="font-family:Times New Roman;font-size:14pt;color:#ff0000;">Serif</span>');
    expect(html).toContain('<mark data-color="#fef08a" style="background-color:#fef08a;color:inherit;">Stabilo</mark>');
    expect(html).toMatch(/<s style="text-decoration:line-through">Coret<\/s>/);
    expect(html).toContain('<sup>2</sup>');
    expect(html).toContain('<sub>i</sub>');
  });

  it('never writes an unsafe value into a style attribute', () => {
    const html = documentHtml(doc({ type: 'paragraph', content: [styled('x', [{ type: 'textStyle', attrs: { fontFamily: 'a;background:url(https://evil.test)', color: 'red;x' } }])] }));
    expect(html).not.toContain('evil');
    expect(html).toContain('>x<');
  });

  it('layers paragraph spacing, indents and line height over the profile', () => {
    const html = documentHtml(doc(paragraph('Rapat', { lineHeight: '1.5', spaceBefore: '12pt', spaceAfter: '6pt', indentLeft: '36pt', indentRight: '0pt', indentFirstLine: '-18pt', textAlign: 'justify' })), { mode: 'paged' });
    const style = /<p style="([^"]*)"/u.exec(html)![1]!;
    // Explicit attrs come after the profile margin so they win in CSS.
    expect(style.indexOf('margin:0 0')).toBeLessThan(style.indexOf('margin-top:12pt'));
    expect(style).toContain('line-height:1.5;margin-top:12pt;margin-bottom:6pt;margin-left:36pt;margin-right:0pt;text-indent:-18pt;text-align:justify;');
  });

  it('writes list types, bullet styles, start numbers and task checkboxes', () => {
    const html = documentHtml(doc(
      { type: 'orderedList', attrs: { start: 4, type: 'i' }, content: [{ type: 'listItem', content: [paragraph('Empat'), { type: 'bulletList', attrs: { listStyle: 'square' }, content: [{ type: 'listItem', content: [paragraph('Anak')] }] }] }] },
      { type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: true }, content: [paragraph('Selesai')] }, { type: 'taskItem', attrs: { checked: false }, content: [paragraph('Belum')] }] },
    ));
    expect(html).toMatch(/<ol start="4" type="i" style="[^"]*list-style-type:lower-roman;"/u);
    expect(html).toMatch(/<li><p[^>]*>Empat<\/p><ul style="[^"]*list-style-type:square;"/u);
    expect(html).toContain('\u2611 </span>Selesai');
    expect(html).toContain('\u2610 </span>Belum');
    expect(html).toContain('list-style-type:none');
  });

  it('writes column widths, spans, shading and page breaks', () => {
    const cell = (text: string, attrs: Record<string, unknown>) => ({ type: 'tableCell', attrs, content: [paragraph(text)] });
    const html = documentHtml(doc(
      { type: 'table', content: [{ type: 'tableRow', content: [cell('A', { colwidth: [120] }), cell('B', { colspan: 2, colwidth: [80, 100], background: '#fce5cd', verticalAlign: 'middle' })] }] },
      { type: 'pageBreak' },
      paragraph('Halaman dua'),
    ), { mode: 'paged' });
    expect(html).toContain('<colgroup><col width="120" style="width:120px" /><col width="80" style="width:80px" /><col width="100" style="width:100px" /></colgroup>');
    expect(html).toMatch(/<td colspan="2" colwidth="80,100" width="180" style="[^"]*width:180px;background-color:#fce5cd;vertical-align:middle;"/u);
    expect(html).toContain('<br clear="all" style="mso-special-character:line-break;page-break-before:always" />');
  });
});
