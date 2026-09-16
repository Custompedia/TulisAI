import { describe, expect, it } from 'vitest';
import { EditorState, TextSelection } from '@tiptap/pm/state';
import { Schema } from '@tiptap/pm/model';
import { inlineTargetExtension, inlineTargetKey } from '../../src/components/workspace/inline-target';
import { commandLabel, isGenerateCommand, planSelectionCommand, type SelectionCommand } from '../../src/components/workspace/selection-commands';
import { defaults, INLINE_LIMIT, SELECTION_LIMIT } from '../../src/lib/writing/settings';
import type { SelectionRange } from '../../src/components/workspace/types';

const t = (id: string) => id;
const format = (value: number) => String(value);
const range = (text: string): SelectionRange => ({ from: 0, to: text.length, text, pmFrom: 1, pmTo: 1 + text.length });

describe('review: selection toolbar commands resolve on the text itself', () => {
  it('runs single-line quick actions as inline alternatives requests', () => {
    const plan = planSelectionCommand('shorter', range('kalimat yang cukup panjang'), defaults, t, format);
    expect(plan).toEqual({ kind: 'generate', label: 'Lebih singkat', inlineAction: 'shorter' });
  });
  it('maps multi-line quick actions onto full modes and keeps the writing register for natural', () => {
    const base = { ...defaults, mode: 'academic' as const, context: 'general' };
    expect(planSelectionCommand('shorter', range('Satu.\nDua.'), base, t, format)).toMatchObject({ kind: 'generate', override: { mode: 'standard', customized: true, length: 'shorter' } });
    expect(planSelectionCommand('clearer', range('Satu.\nDua.'), base, t, format)).toMatchObject({ kind: 'generate', override: { mode: 'simplify' } });
    expect(planSelectionCommand('formal', range('Satu.\nDua.'), base, t, format)).toMatchObject({ kind: 'generate', override: { mode: 'professional' } });
    expect(planSelectionCommand('natural', range('Satu.\nDua.'), base, t, format)).toMatchObject({ kind: 'generate', override: { mode: 'humanize', context: 'academic' } });
    expect(planSelectionCommand('humanize', range('Satu.'), base, t, format)).toMatchObject({ kind: 'generate', label: 'Humanize', override: { mode: 'humanize', context: 'academic' } });
  });
  it('rejects alternatives across lines and over-limit selections with an inline message', () => {
    expect(planSelectionCommand('alternatives', range('Satu.\nDua.'), defaults, t, format)).toMatchObject({ kind: 'error' });
    expect(planSelectionCommand('clearer', range('x'.repeat(INLINE_LIMIT + 1)), defaults, t, format)).toEqual({ kind: 'error', label: 'Lebih jelas', message: `${INLINE_LIMIT + 1}/${INLINE_LIMIT} karakter — persingkat pilihan.` });
    expect(planSelectionCommand('academic', range('x'.repeat(SELECTION_LIMIT + 1)), defaults, t, format)).toMatchObject({ kind: 'error', message: expect.stringContaining(String(SELECTION_LIMIT)) });
    expect(planSelectionCommand('academic', range('x'.repeat(INLINE_LIMIT + 1)), defaults, t, format)).toMatchObject({ kind: 'generate' });
  });
  it('passes lock, unlock and customize through untouched and labels every command', () => {
    for (const command of ['lock', 'unlock', 'customize'] as const) expect(planSelectionCommand(command, range('istilah'), defaults, t, format)).toEqual({ kind: command });
    const commands: SelectionCommand[] = ['alternatives', 'shorter', 'clearer', 'formal', 'natural', 'humanize', 'academic', 'lock', 'unlock', 'customize'];
    for (const command of commands) expect(commandLabel(command, t)).toBeTruthy();
    expect(commands.filter(isGenerateCommand)).toHaveLength(7);
  });
});

describe('review: inline target highlight follows edits', () => {
  const schema = new Schema({ nodes: { doc: { content: 'block+' }, paragraph: { group: 'block', content: 'inline*', toDOM: () => ['p', 0] }, text: { group: 'inline' } } });
  const plugin = inlineTargetExtension.config.addProseMirrorPlugins!.call({ name: 'inlineTarget', options: {}, storage: {}, editor: {} as never, type: {} as never, parent: undefined } as never)[0]!;
  const state = () => EditorState.create({ doc: schema.node('doc', null, [schema.node('paragraph', null, [schema.text('Halo dunia yang indah')])]), plugins: [plugin] });

  it('stores the target through meta and maps it when text before it changes', () => {
    let current = state();
    current = current.apply(current.tr.setMeta('inlineTarget', { from: 6, to: 11 }));
    expect(inlineTargetKey.getState(current)).toEqual({ from: 6, to: 11 });
    current = current.apply(current.tr.insertText('Oh, ', 1));
    expect(inlineTargetKey.getState(current)).toEqual({ from: 10, to: 15 });
    expect(current.doc.textBetween(10, 15)).toBe('dunia');
  });
  it('drops the target when the highlighted text is deleted and when cleared explicitly', () => {
    let current = state();
    current = current.apply(current.tr.setMeta('inlineTarget', { from: 6, to: 11 }));
    current = current.apply(current.tr.setSelection(TextSelection.create(current.doc, 6, 11)).deleteSelection());
    expect(inlineTargetKey.getState(current)).toBeNull();
    current = current.apply(current.tr.setMeta('inlineTarget', { from: 1, to: 5 }));
    current = current.apply(current.tr.setMeta('inlineTarget', null));
    expect(inlineTargetKey.getState(current)).toBeNull();
  });
});
