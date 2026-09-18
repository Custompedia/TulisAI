import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';

export const spellcheckKey = new PluginKey<boolean>('spellcheck');
const STORAGE_KEY = 'editor-spellcheck';

const readPreference = () => { try { return typeof window === 'undefined' || window.localStorage.getItem(STORAGE_KEY) !== 'off'; } catch { return true; } };

export function setSpellcheck(view: EditorView, on: boolean) {
  try { window.localStorage.setItem(STORAGE_KEY, on ? 'on' : 'off'); } catch { /* storage unavailable */ }
  view.dispatch(view.state.tr.setMeta(spellcheckKey, on).setMeta('addToHistory', false));
}

// The browser spell checker, switchable per viewer; `active` false (plain mode) always leaves it on.
export function spellcheckExtension(active: () => boolean) {
  return Extension.create({
    name: 'spellcheck',
    addProseMirrorPlugins() {
      return [new Plugin<boolean>({
        key: spellcheckKey,
        state: { init: readPreference, apply: (tr, on) => (tr.getMeta(spellcheckKey) as boolean | undefined) ?? on },
        props: { attributes: (state) => ({ spellcheck: !active() || spellcheckKey.getState(state) ? 'true' : 'false' }) },
      })];
    },
  });
}
