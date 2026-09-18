// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { generateJSON } from '@tiptap/core';
import { EditorState, TextSelection } from '@tiptap/pm/state';
import { documentExtensions, documentSchema } from '../../src/lib/editor/extensions';
import { documentHtml, selectionDocument } from '../../src/lib/editor/clipboard';
import { normalizePastedHtml } from '../../src/lib/editor/paste-normalize';
import { EditorDocumentSchema } from '../../src/lib/contracts';

const text = (value: string, marks?: unknown[]) => ({ type: 'text', text: value, ...(marks ? { marks } : {}) });
const paragraph = (value: string, attrs?: Record<string, unknown>) => ({ type: 'paragraph', ...(attrs ? { attrs } : {}), content: [text(value)] });
const item = (...content: unknown[]) => ({ type: 'listItem', content });
const cell = (value: string, attrs?: Record<string, unknown>) => ({ type: 'tableCell', ...(attrs ? { attrs } : {}), content: [paragraph(value)] });

const SAMPLE = {
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 2, textAlign: 'center', spaceBefore: '18pt', spaceAfter: '6pt', lineHeight: '1.38' }, content: [text('Judul')] },
    { type: 'paragraph', attrs: { textAlign: 'justify', lineHeight: '1.5', spaceBefore: '12pt', spaceAfter: '0pt', indentLeft: '36pt', indentRight: '12pt', indentFirstLine: '-18pt' }, content: [
      text('Tebal', [{ type: 'bold' }]), text(' miring', [{ type: 'italic' }, { type: 'underline' }]), text(' coret', [{ type: 'strike' }]),
      text('2', [{ type: 'superscript' }]), text('i', [{ type: 'subscript' }]),
      text(' serif', [{ type: 'textStyle', attrs: { fontFamily: 'Times New Roman', fontSize: '14pt', color: '#ff0000', backgroundColor: '#eeeeee' } }]),
      text(' stabilo', [{ type: 'highlight', attrs: { color: '#fef08a' } }]),
      text(' tautan', [{ type: 'link', attrs: { href: 'https://example.test/a', target: '_blank', rel: 'noopener noreferrer nofollow', class: null, title: null } }]),
      { type: 'hardBreak' }, text('baris\tdua  spasi'),
    ] },
    { type: 'paragraph' },
    { type: 'bulletList', attrs: { listStyle: 'circle' }, content: [item(paragraph('Satu'), { type: 'orderedList', attrs: { start: 3, type: 'a' }, content: [item(paragraph('Anak'))] }), item(paragraph('Dua'))] },
    { type: 'orderedList', attrs: { start: 1, type: 'I' }, content: [item(paragraph('Romawi'))] },
    { type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: true }, content: [paragraph('Selesai')] }, { type: 'taskItem', attrs: { checked: false }, content: [paragraph('Belum')] }] },
    { type: 'blockquote', content: [paragraph('Kutipan')] },
    { type: 'horizontalRule' },
    { type: 'table', content: [
      { type: 'tableRow', content: [{ type: 'tableHeader', attrs: { colwidth: [120] }, content: [paragraph('Kolom')] }, { type: 'tableHeader', attrs: { colspan: 2, colwidth: [80, 100] }, content: [paragraph('Nilai')] }] },
      { type: 'tableRow', content: [cell('A', { colwidth: [120], background: '#fce5cd', verticalAlign: 'middle' }), cell('B', { colwidth: [80] }), cell('C', { colwidth: [100], rowspan: 1 })] },
    ] },
    { type: 'pageBreak' },
    paragraph('Halaman dua', { textAlign: 'right' }),
  ],
};

// Stored documents drop null attrs; compare in that same compact form so only real differences show.
const canonical = (value: unknown) => EditorDocumentSchema.parse(documentSchema.nodeFromJSON(EditorDocumentSchema.parse(value)).toJSON());
const pasteBack = (html: string) => canonical(generateJSON(normalizePastedHtml(html), documentExtensions));

describe('review: copying from the canvas and pasting back is lossless', () => {
  for (const mode of ['paged', 'plain'] as const) {
    it(`restores every node, mark and attribute in ${mode} mode`, () => {
      expect(pasteBack(`<meta charset="utf-8">${documentHtml(SAMPLE, { mode })}`)).toEqual(canonical(SAMPLE));
    });
  }

  it('does not turn the mode profile into explicit spacing on paste back', () => {
    const plain = pasteBack(documentHtml({ type: 'doc', content: [paragraph('Polos')] }, { mode: 'plain' }));
    expect(plain.content[0]).toEqual({ type: 'paragraph', content: [{ type: 'text', text: 'Polos' }] });
  });
});

describe('review: Ctrl+C copies the selected slice as a valid document', () => {
  const state = (json: unknown) => EditorState.create({ doc: documentSchema.nodeFromJSON(json) });
  const select = (json: unknown, from: number, to: number) => { const base = state(json); return base.apply(base.tr.setSelection(TextSelection.create(base.doc, from, to))); };

  it('wraps part of a paragraph in that paragraph, keeping its attrs and marks', () => {
    const json = { type: 'doc', content: [{ type: 'paragraph', attrs: { textAlign: 'center', lineHeight: '2' }, content: [text('Halo '), text('dunia', [{ type: 'bold' }])] }] };
    expect(selectionDocument(select(json, 3, 12))).toEqual({ type: 'doc', content: [{ type: 'paragraph', attrs: { textAlign: 'center', lineHeight: '2' }, content: [{ type: 'text', text: 'lo ' }, { type: 'text', text: 'dunia', marks: [{ type: 'bold' }] }] }] });
  });

  it('keeps the list around a run of selected list items', () => {
    const json = { type: 'doc', content: [{ type: 'orderedList', attrs: { start: 5, type: 'a' }, content: [item(paragraph('Satu')), item(paragraph('Dua'))] }] };
    const result = selectionDocument(select(json, 3, 13));
    expect(result?.content[0]).toMatchObject({ type: 'orderedList', attrs: { start: 5, type: 'a' } });
    expect(result?.content[0]!.content).toHaveLength(2);
  });

  it('returns nothing for an empty selection', () => {
    expect(selectionDocument(state({ type: 'doc', content: [paragraph('x')] }))).toBeNull();
  });
});
