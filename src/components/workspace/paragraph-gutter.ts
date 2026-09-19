import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';
import type { Node as PMNode } from '@tiptap/pm/model';

export const paragraphGutterKey = new PluginKey<DecorationSet>('paragraphGutter');

// Blocks worth offering a paragraph action on. A rule has no text, and a table is handled cell by cell.
const TARGETS = new Set(['paragraph', 'heading', 'blockquote', 'bulletList', 'orderedList']);

export type GutterTarget = { from: number; to: number };

// Every top-level block that holds text, as plain document positions. Exported so the offsets can be tested
// without a browser.
export function gutterTargets(doc: PMNode): GutterTarget[] {
  const targets: GutterTarget[] = [];
  doc.forEach((node, offset) => {
    if (!TARGETS.has(node.type.name)) return;
    if (!node.textContent.trim()) return;
    // Inside the block, so selecting the range never swallows the block boundary itself.
    targets.push({ from: offset + 1, to: offset + node.nodeSize - 1 });
  });
  return targets;
}

// The block the caret sits in, so an action with no selection can still name what it will rewrite.
export function targetAtPosition(doc: PMNode, position: number): GutterTarget | null {
  return gutterTargets(doc).find((target) => position >= target.from && position <= target.to) ?? null;
}

// Selecting the paragraph is the whole action: the existing selection menu — with its instruction input —
// appears on the selection, so there is no second surface to keep in step.
export function selectParagraph(view: EditorView, target: GutterTarget) {
  const selection = TextSelection.create(view.state.doc, target.from, target.to);
  view.dispatch(view.state.tr.setSelection(selection));
  view.focus();
}

type Options = { enabled: () => boolean; label: () => string };

// A widget button in the page margin for each block, shown only in advanced mode.
export function paragraphGutterExtension({ enabled, label }: Options) {
  return Extension.create({
    name: 'paragraphGutter',
    addProseMirrorPlugins() {
      return [new Plugin<DecorationSet>({
        key: paragraphGutterKey,
        state: {
          init: (_, state) => (enabled() ? build(state.doc, label()) : DecorationSet.empty),
          apply(transaction, old, _oldState, newState) {
            if (!enabled()) return DecorationSet.empty;
            if (!transaction.docChanged && !transaction.getMeta(paragraphGutterKey)) return old.map(transaction.mapping, transaction.doc);
            return build(newState.doc, label());
          },
        },
        props: {
          decorations(state) { return this.getState(state); },
          handleDOMEvents: {
            mousedown(view, event) {
              const button = (event.target as HTMLElement | null)?.closest?.('[data-paragraph-gutter]');
              if (!button) return false;
              const from = Number(button.getAttribute('data-from'));
              const to = Number(button.getAttribute('data-to'));
              if (!Number.isFinite(from) || !Number.isFinite(to)) return false;
              event.preventDefault();
              selectParagraph(view, { from, to });
              return true;
            },
          },
        },
      })];
    },
  });
}

function build(doc: PMNode, label: string): DecorationSet {
  const decorations = gutterTargets(doc).map((target) => Decoration.widget(target.from, () => {
    const button = window.document.createElement('button');
    button.type = 'button';
    // Out of the tab order: Tab belongs to the text, and the same action sits in the instruction dock.
    button.tabIndex = -1;
    button.className = 'ww-paragraph-gutter';
    button.setAttribute('data-paragraph-gutter', '');
    button.setAttribute('data-from', String(target.from));
    button.setAttribute('data-to', String(target.to));
    button.setAttribute('aria-label', label);
    button.title = label;
    // Inline SVG, so the widget needs no React tree of its own.
    button.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v18M3 12h18"/></svg>';
    return button;
  }, { side: -1, ignoreSelection: true, key: `gutter-${target.from}` }));
  return DecorationSet.create(doc, decorations);
}
