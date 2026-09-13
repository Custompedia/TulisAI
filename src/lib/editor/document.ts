import { Schema, Fragment, Slice, type Node as PMNode } from '@tiptap/pm/model';
import { Transform } from '@tiptap/pm/transform';
import { EditorDocumentSchema } from '../contracts';

export type EditorDocument = ReturnType<typeof EditorDocumentSchema.parse>;
export type EditorNode = EditorDocument['content'][number];
export type PlainRange = {from:number;to:number};
const schema = new Schema({
  nodes: {
    doc:{content:'block+'}, text:{group:'inline'},
    paragraph:{group:'block',content:'inline*',attrs:{textAlign:{default:null}}},
    heading:{group:'block',content:'inline*',attrs:{level:{default:1},textAlign:{default:null}}},
    blockquote:{group:'block',content:'block+'}, horizontalRule:{group:'block'},
    hardBreak:{group:'inline',inline:true},
    bulletList:{group:'block',content:'listItem+'},orderedList:{group:'block',content:'listItem+',attrs:{start:{default:1}}},
    listItem:{content:'paragraph block*'},table:{group:'block',content:'tableRow+'},tableRow:{content:'(tableCell | tableHeader)+'},
    tableCell:{content:'block+',attrs:{colspan:{default:1},rowspan:{default:1},colwidth:{default:null}}},
    tableHeader:{content:'block+',attrs:{colspan:{default:1},rowspan:{default:1},colwidth:{default:null}}},
  },
  marks:{bold:{},italic:{},underline:{},link:{attrs:{href:{},target:{default:null},rel:{default:null},class:{default:null}}}},
});
function parsed(value:unknown):PMNode {
  const json=EditorDocumentSchema.parse(value);
  const doc=schema.nodeFromJSON(json.content.length?json:{type:'doc',content:[{type:'paragraph'}]});
  doc.check();return doc;
}
type Span={from:number;to:number;pmFrom:number;pmTo:number};
function mapping(doc:PMNode) {
  let text='';const spans:Span[]=[];
  const walk=(node:PMNode,position:number)=>{
    if(node.isText||node.type.name==='hardBreak'){
      const value=node.isText?node.text!:'\n';spans.push({from:text.length,to:text.length+value.length,pmFrom:position,pmTo:position+node.nodeSize});text+=value;return;
    }
    if(node.isLeaf){spans.push({from:text.length,to:text.length,pmFrom:position,pmTo:position+node.nodeSize});return;}
    const contentStart=node.type.name==='doc'?0:position+1;
    if(!node.childCount)spans.push({from:text.length,to:text.length,pmFrom:contentStart,pmTo:contentStart});
    node.forEach((child,offset,index)=>{
      if(index>0&&!node.inlineContent)text+=node.type.name==='tableRow'?' | ':'\n';
      walk(child,contentStart+offset);
    });
  };
  walk(doc,0);return {text,spans};
}
export function documentText(document:unknown):string {return mapping(parsed(document)).text;}
function inline(text:string):EditorNode[] {
  return text.split(/(\n)/u).flatMap((part):EditorNode[]=>part==='\n'?[{type:'hardBreak'}]:part?[{type:'text',text:part}]:[]);
}
export function plainTextDocument(text:string):EditorDocument {
  return {type:'doc',content:text.split('\n').map(line=>({type:'paragraph',content:inline(line)}))};
}
export function selectionOffsets(document:unknown,fromPM:number,toPM:number):PlainRange {
  const doc=parsed(document);if(!Number.isInteger(fromPM)||!Number.isInteger(toPM)||fromPM<0||toPM<fromPM||toPM>doc.content.size)throw new Error('Invalid editor selection.');
  const {spans,text}=mapping(doc);
  const offset=(position:number)=>{
    const span=spans.find(item=>position>=item.pmFrom&&position<=item.pmTo);
    if(span)return span.from+Math.min(position-span.pmFrom,span.to-span.from);
    const next=spans.find(item=>item.pmFrom>position);return next?.from??text.length;
  };
  return {from:offset(fromPM),to:offset(toPM)};
}
function formatted(text:string,format:'paragraph'|'bullets'|'numbered_list'|'table'):EditorDocument {
  if(format==='paragraph')return plainTextDocument(text);
  const lines=text.split(/\n+/u).map(line=>line.trim()).filter(Boolean);
  if(format==='bullets'||format==='numbered_list')return {type:'doc',content:[{type:format==='bullets'?'bulletList':'orderedList',content:lines.map(line=>({type:'listItem',content:[{type:'paragraph',content:inline(line.replace(/^(?:[-*•]|\d+[.)])\s+/u,''))}]}))}]};
  const rows=lines.map(line=>line.replace(/^\||\|$/g,'').split('|').map(cell=>cell.trim())).filter(row=>!row.every(cell=>/^:?-{3,}:?$/u.test(cell)));
  if(!rows.length)throw new Error('The table result is empty.');
  const width=Math.max(...rows.map(row=>row.length));
  return {type:'doc',content:[{type:'table',content:rows.map((row,index)=>({type:'tableRow',content:Array.from({length:width},(_,column)=>({type:index===0?'tableHeader':'tableCell',content:[{type:'paragraph',content:inline(row[column]??'')}]}))}))}]};
}
export function replaceTextInDocument(document:unknown,from:number,to:number,replacement:string,format?:'paragraph'|'bullets'|'numbered_list'|'table'):EditorDocument {
  const doc=parsed(document);const {text,spans}=mapping(doc);
  if(!Number.isInteger(from)||!Number.isInteger(to)||from<0||to<=from||to>text.length)throw new Error('Selection no longer matches the document.');
  if(from===0&&to===text.length)return EditorDocumentSchema.parse(parsed(formatted(replacement,format??'paragraph')).toJSON());
  const start=spans.find(span=>span.to>from&&span.from<=from)??[...spans].reverse().find(span=>span.to<=from);
  const end=[...spans].reverse().find(span=>span.from<to&&span.to>=to)??spans.find(span=>span.from>=to);
  if(!start||!end)throw new Error('Selection falls outside editable text.');
  const pmFrom=start.pmFrom+Math.min(from-start.from,start.to-start.from);const pmTo=end.pmFrom+Math.max(0,to-end.from);
  let slice:Slice;
  if(format){slice=new Slice(parsed(formatted(replacement,format)).content,0,0);}
  else {
    const marks=doc.resolve(pmFrom).nodeAfter?.marks??doc.resolve(pmFrom).marks();
    const nodes=inline(replacement).map(node=>node.type==='text'?schema.text(node.text!,marks):schema.node('hardBreak'));
    slice=new Slice(Fragment.fromArray(nodes),0,0);
  }
  const result=new Transform(doc).replaceRange(pmFrom,pmTo,slice).doc;result.check();
  const originals=new Map<PMNode,EditorNode>();const raw=EditorDocumentSchema.parse(document);const remember=(node:PMNode,json:EditorNode)=>{originals.set(node,json);node.forEach((child,_offset,index)=>{const original=json.content?.[index];if(original)remember(child,original)});};doc.forEach((child,_offset,index)=>{const original=raw.content[index];if(original)remember(child,original)});
  const emit=(node:PMNode):EditorNode=>originals.get(node)??{...node.toJSON(),...(node.childCount?{content:Array.from({length:node.childCount},(_,index)=>emit(node.child(index)))}:{})};
  return EditorDocumentSchema.parse({type:'doc',content:Array.from({length:result.childCount},(_,index)=>emit(result.child(index)))});
}
export function protectedRanges(document:unknown,terms:string[]):Array<{from:number;to:number}> {
 const {text,spans}=mapping(parsed(document));const ranges:Array<{from:number;to:number}>=[];
 for(const term of new Set(terms)){if(!term)continue;let offset=0;while(offset<text.length){const found=text.indexOf(term,offset);if(found<0)break;const first=spans.find(span=>span.from<=found&&span.to>found);const last=spans.find(span=>span.from<found+term.length&&span.to>=found+term.length);if(first&&last)ranges.push({from:first.pmFrom+found-first.from,to:last.pmFrom+found+term.length-last.from});offset=found+term.length;if(ranges.length>=2000)return ranges;}}
 return ranges;
}
