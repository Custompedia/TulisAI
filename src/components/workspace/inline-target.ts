import { Extension, type Editor } from '@tiptap/core';
import { Plugin, PluginKey, type EditorState } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

export type InlineTarget = { from: number; to: number };

// Highlights the text an inline AI action is working on; positions follow later edits.
export const inlineTargetKey = new PluginKey<InlineTarget | null>('inlineTarget');
const META = 'inlineTarget';

export const inlineTargetExtension = Extension.create({
  name: 'inlineTarget',
  addProseMirrorPlugins() {
    return [new Plugin<InlineTarget | null>({
      key: inlineTargetKey,
      state: {
        init: () => null,
        apply(transaction, current) {
          const next = transaction.getMeta(META) as InlineTarget | null | undefined;
          if (next !== undefined) return next;
          if (!current || !transaction.docChanged) return current;
          const from = transaction.mapping.map(current.from, 1); const to = transaction.mapping.map(current.to, -1);
          return to > from ? { from, to } : null;
        },
      },
      props: {
        decorations(state) {
          const target = this.getState(state);
          return target ? DecorationSet.create(state.doc, [Decoration.inline(target.from, target.to, { class: 'ww-inline-target' })]) : DecorationSet.empty;
        },
      },
    })];
  },
});

export const getInlineTarget = (state: EditorState): InlineTarget | null => inlineTargetKey.getState(state) ?? null;

export function setInlineTarget(editor: Editor, target: InlineTarget | null) {
  if (getInlineTarget(editor.state) === target) return;
  editor.view.dispatch(editor.state.tr.setMeta(META, target).setMeta('addToHistory', false));
}
