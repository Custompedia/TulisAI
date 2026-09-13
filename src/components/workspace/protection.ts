import {Extension} from '@tiptap/core';
import {Plugin,PluginKey} from '@tiptap/pm/state';
import {Decoration,DecorationSet} from '@tiptap/pm/view';
import {documentText,protectedRanges} from '@/lib/editor/document';
import {detectedCitations} from '@/lib/editor/protection';
export function protectionExtension(getTerms:()=>string[],label:()=>string){
 return Extension.create({name:'protectedContent',addProseMirrorPlugins(){return [new Plugin({key:new PluginKey('protectedContent'),state:{init:()=>DecorationSet.empty,apply(transaction,old){if(!transaction.docChanged&&!transaction.getMeta('refreshProtection'))return old.map(transaction.mapping,transaction.doc);const json=transaction.doc.toJSON();const spans=protectedRanges(json,[...getTerms(),...detectedCitations(documentText(json))]);return DecorationSet.create(transaction.doc,spans.map(span=>Decoration.inline(span.from,span.to,{class:'ww-protected',title:label()})))}},props:{decorations(state){return this.getState(state)}}})]}});
}
