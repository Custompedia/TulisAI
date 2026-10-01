import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';
import type { Node as PMNode } from '@tiptap/pm/model';
import { changedTopRange } from '@/lib/editor/changed-range';

export const paragraphGutterKey = new PluginKey<DecorationSet>('paragraphGutter');

// Blocks worth offering a paragraph action on. A rule has no text, and a table is handled cell by cell.
const TARGETS = new Set(['paragraph', 'heading', 'blockquote', 'bulletList', 'orderedList']);

export type GutterTarget = { from: number; to: number };

// Every top-level block that holds text, as plain document positions. Exported so the offsets can be tested
// without a browser.
export function gutterTargets(doc: PMNode, from = 0, to = doc.content.size): GutterTarget[] {
  const targets: GutterTarget[] = [];
  doc.forEach((node, offset) => {
    if (offset + node.nodeSize <= from || offset >= to) return;
    if (!TARGETS.has(node.type.name)) return;
    if (!node.textContent.trim()) return;
    // Inside the block, so selecting the range never swallows the block boundary itself.
    targets.push({ from: offset + 1, to: offset + node.nodeSize - 1 });
  });
  return targets;
}

// The block the caret sits in, so an action with no selection can still name what it will rewrite.
// Only the block at the position is looked at (the same answer as searching gutterTargets), so it is cheap enough
// to run on every render of a 2,000-page notebook.
export function targetAtPosition(doc: PMNode, position: number): GutterTarget | null {
  if (position < 0 || position > doc.content.size) return null;
  const { node, offset } = doc.childAfter(position);
  if (!node || !TARGETS.has(node.type.name) || !node.textContent.trim()) return null;
  const target = { from: offset + 1, to: offset + node.nodeSize - 1 };
  return position >= target.from && position <= target.to ? target : null;
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
          init: (_, state) => (enabled() ? build(state.doc, label(), state.selection.from) : DecorationSet.empty),
          apply(transaction, old, _oldState, newState) {
            if (!enabled()) return DecorationSet.empty;
            // A long notebook shows the handle on the caret's paragraph only (see build).
            if (newState.doc.childCount > ALL_HANDLES_LIMIT) return build(newState.doc, label(), newState.selection.from, transaction.docChanged ? old.map(transaction.mapping, transaction.doc) : old);
            if (transaction.getMeta(paragraphGutterKey)) return build(newState.doc, label(), newState.selection.from);
            if (!transaction.docChanged) return old;
            // Only the blocks the change touched get new handles; every other handle just moves with the text.
            const changed = changedTopRange(transaction.before, newState.doc);
            const mapped = old.map(transaction.mapping, transaction.doc);
            if (!changed) return mapped;
            const stale = mapped.find(changed.from, changed.to);
            const fresh = gutterTargets(newState.doc, changed.from, changed.to).map((target) => widget(target, label()));
            return mapped.remove(stale).add(newState.doc, fresh);
          },
        },
        props: {
          decorations(state) { return this.getState(state); },
          handleDOMEvents: {
            mousedown(view, event) {
              const button = (event.target as HTMLElement | null)?.closest?.('[data-paragraph-gutter]');
              if (!button) return false;
              // The handle sits at the start of its block; the block is looked up now, so a handle that moved with
              // the text since it was drawn still selects the right paragraph.
              const target = targetAtPosition(view.state.doc, view.posAtDOM(button, 0));
              if (!target) return false;
              event.preventDefault();
              selectParagraph(view, target);
              return true;
            },
          },
        },
      })];
    },
  });
}

// Past this many blocks a handle on every paragraph costs more than it gives: ProseMirror compares every widget on
// every keystroke, which made typing in a 2,000-page notebook lag. There the handle follows the caret instead.
export const ALL_HANDLES_LIMIT = 1500;
function build(doc: PMNode, label: string, caret = 0, previous?: DecorationSet): DecorationSet {
  if (doc.childCount <= ALL_HANDLES_LIMIT) return DecorationSet.create(doc, gutterTargets(doc).map((target) => widget(target, label)));
  const target = targetAtPosition(doc, caret);
  const current = previous?.find()[0];
  if (target && current && current.from === target.from) return previous!;
  return target ? DecorationSet.create(doc, [widget(target, label)]) : DecorationSet.empty;
}

function widget(target: GutterTarget, label: string): Decoration {
  return Decoration.widget(target.from, () => {
    const button = window.document.createElement('button');
    button.type = 'button';
    // Out of the tab order: Tab belongs to the text, and the same action sits in the instruction dock.
    button.tabIndex = -1;
    button.className = 'ww-paragraph-gutter';
    button.setAttribute('data-paragraph-gutter', '');
    button.setAttribute('aria-label', label);
    button.title = label;
    // Inline SVG, so the widget needs no React tree of its own. A grip, not a plus: the handle selects the
    // paragraph, it never inserts anything.
    button.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" stroke="none" aria-hidden="true"><circle cx="9" cy="5" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="9" cy="19" r="1.6"/><circle cx="15" cy="5" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="15" cy="19" r="1.6"/></svg>';
    return button;
  }, { side: -1, ignoreSelection: true, key: 'gutter' });
}
