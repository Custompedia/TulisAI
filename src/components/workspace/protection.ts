import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { docText, protectedRangesIn } from '@/lib/editor/text-map';
import { detectedCitations } from '@/lib/editor/protection';

type State = { decorations: DecorationSet; refresh: number };
const key = new PluginKey<State>('protectedContent');

// Locked terms and detected citations, underlined on the canvas. The marks only show what the server enforces, so
// they are recomputed once typing pauses (longer on a long notebook) and simply move with the text in between: the
// old version re-serialized and searched the whole document on every keystroke.
export function protectionExtension(getTerms: () => string[], label: () => string) {
  return Extension.create({
    name: 'protectedContent',
    addProseMirrorPlugins() {
      return [new Plugin<State>({
        key,
        state: {
          init: () => ({ decorations: DecorationSet.empty, refresh: 0 }),
          apply(transaction, old) {
            const next = transaction.getMeta(key) as DecorationSet | undefined;
            if (next) return { decorations: next, refresh: old.refresh };
            const decorations = transaction.docChanged ? old.decorations.map(transaction.mapping, transaction.doc) : old.decorations;
            return { decorations, refresh: old.refresh + (transaction.getMeta('refreshProtection') ? 1 : 0) };
          },
        },
        props: { decorations(state) { return key.getState(state)?.decorations; } },
        view(view) {
          let timer: ReturnType<typeof setTimeout> | undefined; let seen = 0;
          const run = () => {
            timer = undefined;
            if (view.isDestroyed) return;
            const doc = view.state.doc;
            const spans = protectedRangesIn(doc, [...getTerms(), ...detectedCitations(docText(doc))]);
            const title = label();
            view.dispatch(view.state.tr.setMeta(key, DecorationSet.create(doc, spans.map((span) => Decoration.inline(span.from, span.to, { class: 'ww-protected', title })))).setMeta('addToHistory', false));
          };
          const schedule = (size: number) => { clearTimeout(timer); timer = setTimeout(run, size > 3_000_000 ? 3_000 : size > 500_000 ? 1_200 : 200); };
          schedule(0);
          return {
            update(updated, previous) {
              const refresh = key.getState(updated.state)?.refresh ?? 0;
              if (updated.state.doc !== previous.doc || refresh !== seen) { seen = refresh; schedule(updated.state.doc.content.size); }
            },
            destroy() { clearTimeout(timer); },
          };
        },
      })];
    },
  });
}
