import {Extension} from '@tiptap/core';
import {Plugin} from '@tiptap/pm/state';
import {documentText} from '@/lib/editor/document';
export function documentLimits(onReject:()=>void){
 return Extension.create({name:'documentLimits',addProseMirrorPlugins(){return [new Plugin({filterTransaction(transaction){if(!transaction.docChanged)return true;try{const json=transaction.doc.toJSON();if(documentText(json).length>200000)throw new Error('limit');return true}catch{queueMicrotask(onReject);return false}}})]}});
}
