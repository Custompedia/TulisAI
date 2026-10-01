import { Extension } from '@tiptap/core';
import { Plugin } from '@tiptap/pm/state';
import { editorDocumentProblem } from '@/lib/contracts';
import { changedTopRange } from '@/lib/editor/changed-range';
import { docTextLength } from '@/lib/editor/text-map';
import { MAX_DOCUMENT_CHARACTERS, MAX_TOP_LEVEL_BLOCKS } from '@/lib/limits';

// Refuses an edit that would make a notebook the server cannot store: more text than MAX_DOCUMENT_CHARACTERS, or a
// block the stored-document contract rejects (an over-long attribute, a non-HTTP link). It used to serialize and
// re-validate the whole document on every keystroke; now it checks only the blocks the edit touched, and counts the
// text (from the cached per-block map) only once the document is big enough to be near the limit.
export function documentLimits(onReject: () => void) {
  return Extension.create({
    name: 'documentLimits',
    addProseMirrorPlugins() {
      return [new Plugin({
        filterTransaction(transaction, state) {
          if (!transaction.docChanged) return true;
          const reject = () => { queueMicrotask(onReject); return false; };
          try {
            const doc = transaction.doc;
            if (doc.childCount > MAX_TOP_LEVEL_BLOCKS) return reject();
            if (doc.content.size > MAX_DOCUMENT_CHARACTERS && docTextLength(doc) > MAX_DOCUMENT_CHARACTERS) return reject();
            const changed = changedTopRange(state.doc, doc);
            if (!changed) return true;
            const content = [];
            for (let index = changed.fromIndex; index <= changed.toIndex && index < doc.childCount; index++) content.push(doc.child(index).toJSON());
            return editorDocumentProblem({ type: 'doc', content }) ? reject() : true;
          } catch { return reject(); }
        },
      })];
    },
  });
}
