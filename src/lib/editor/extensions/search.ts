import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, type EditorState, type Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';
import type { Node as PMNode } from '@tiptap/pm/model';

export type SearchMatch = { from: number; to: number };
export type SearchState = { query: string; caseSensitive: boolean; matches: SearchMatch[]; index: number; decorations: DecorationSet };
type SearchMeta = { query?: string; caseSensitive?: boolean; index?: number; after?: number };

export const MAX_MATCHES = 5000;
export const searchKey = new PluginKey<SearchState>('search');
// Length-preserving lowercase, so offsets in the folded text still point at the original characters.
const fold = (text: string) => text.replace(/[\s\S]/gu, (char) => { const lower = char.toLowerCase(); return lower.length === char.length ? lower : char; });

// Matches inside each textblock; inline atoms count as one opaque character so offsets stay aligned with positions.
export function findMatches(doc: PMNode, query: string, caseSensitive: boolean): SearchMatch[] {
  if (!query) return [];
  const needle = caseSensitive ? query : fold(query);
  const matches: SearchMatch[] = [];
  doc.descendants((node, pos) => {
    if (matches.length >= MAX_MATCHES) return false;
    if (!node.isTextblock) return true;
    let text = '';
    node.forEach((child) => { text += child.isText ? child.text ?? '' : '￼'; });
    const haystack = caseSensitive ? text : fold(text);
    for (let at = haystack.indexOf(needle); at !== -1 && matches.length < MAX_MATCHES; at = haystack.indexOf(needle, at + needle.length)) {
      matches.push({ from: pos + 1 + at, to: pos + 1 + at + needle.length });
    }
    return false;
  });
  return matches;
}

const firstAtOrAfter = (matches: SearchMatch[], position: number) => Math.max(0, matches.findIndex((match) => match.from >= position));

function decorate(doc: PMNode, matches: SearchMatch[], index: number) {
  return DecorationSet.create(doc, matches.map((match, at) => Decoration.inline(match.from, match.to, { class: at === index ? 'ww-search-match ww-search-current' : 'ww-search-match' })));
}

const EMPTY: SearchState = { query: '', caseSensitive: false, matches: [], index: 0, decorations: DecorationSet.empty };

export const searchPlugin = () => new Plugin<SearchState>({
  key: searchKey,
  state: {
    init: () => EMPTY,
    apply(tr: Transaction, prev: SearchState, _old: EditorState, next: EditorState): SearchState {
      const meta = tr.getMeta(searchKey) as SearchMeta | undefined;
      if (!meta && !tr.docChanged) return prev;
      const query = meta?.query ?? prev.query;
      const caseSensitive = meta?.caseSensitive ?? prev.caseSensitive;
      if (!query) return { ...EMPTY, caseSensitive };
      const matches = findMatches(next.doc, query, caseSensitive);
      const queryChanged = query !== prev.query || caseSensitive !== prev.caseSensitive;
      let index = meta?.index ?? (meta?.after !== undefined ? firstAtOrAfter(matches, meta.after) : queryChanged ? firstAtOrAfter(matches, next.selection.from) : prev.index);
      index = matches.length ? Math.min(Math.max(index, 0), matches.length - 1) : 0;
      return { query, caseSensitive, matches, index, decorations: decorate(next.doc, matches, index) };
    },
  },
  props: { decorations(state) { return searchKey.getState(state)?.decorations; } },
});

export const SearchExtension = Extension.create({ name: 'search', addProseMirrorPlugins: () => [searchPlugin()] });

export const searchState = (state: EditorState): SearchState => searchKey.getState(state) ?? EMPTY;

function reveal(view: EditorView) {
  view.dom.querySelector('.ww-search-current')?.scrollIntoView({ block: 'center', inline: 'nearest' });
}

export function setSearch(view: EditorView, query: string, caseSensitive: boolean) {
  view.dispatch(view.state.tr.setMeta(searchKey, { query, caseSensitive }).setMeta('addToHistory', false));
  reveal(view);
}

export function stepSearch(view: EditorView, direction: 1 | -1) {
  const { matches, index } = searchState(view.state);
  if (!matches.length) return;
  view.dispatch(view.state.tr.setMeta(searchKey, { index: (index + direction + matches.length) % matches.length }).setMeta('addToHistory', false));
  reveal(view);
}

export function replaceCurrent(view: EditorView, replacement: string) {
  const { matches, index } = searchState(view.state);
  const match = matches[index];
  if (!match) return;
  const tr = replacement ? view.state.tr.insertText(replacement, match.from, match.to) : view.state.tr.delete(match.from, match.to);
  view.dispatch(tr.setMeta(searchKey, { after: match.from + replacement.length }));
  reveal(view);
}

// Every match in one transaction, so a single undo restores them all.
export function replaceAll(view: EditorView, replacement: string): number {
  const { matches } = searchState(view.state);
  if (!matches.length) return 0;
  const tr = view.state.tr;
  for (let at = matches.length - 1; at >= 0; at--) {
    const { from, to } = matches[at]!;
    if (replacement) tr.insertText(replacement, from, to); else tr.delete(from, to);
  }
  view.dispatch(tr);
  return matches.length;
}
