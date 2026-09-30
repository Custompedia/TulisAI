import { Fragment, Slice, type Node as PMNode } from '@tiptap/pm/model';
import { Transform } from '@tiptap/pm/transform';
import { EditorDocumentSchema } from '../contracts';
import { documentSchema } from './extensions';

export type EditorDocument = ReturnType<typeof EditorDocumentSchema.parse>;
export type EditorNode = EditorDocument['content'][number];
export type PlainRange = {from:number;to:number};
// The same schema the editor builds, so server-side edits never drop or reject an attribute the editor wrote.
const schema = documentSchema;
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
// AI output separates parts with a blank line; the editor spaces paragraphs itself, so the blank lines would double the gap.
export const collapseBlankLines=(text:string):string=>text.replace(/\n{2,}/gu,'\n');
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
  // Plain paragraphs open at both ends, so the first and last lines join the text around a mid-paragraph selection; the last keeps its block's type and attrs.
  if(format==='paragraph'){let content=parsed(formatted(replacement,format)).content;const tail=doc.resolve(pmTo).parent;if(content.childCount>1&&tail.isTextblock)content=content.replaceChild(content.childCount-1,tail.type.create(tail.attrs,content.lastChild!.content));slice=new Slice(content,1,1);}
  else if(format){slice=new Slice(parsed(formatted(replacement,format)).content,0,0);}
  else {
    const marks=doc.resolve(pmFrom).nodeAfter?.marks??doc.resolve(pmFrom).marks();
    const nodes=inline(replacement).map(node=>node.type==='text'?schema.text(node.text!,marks):schema.node('hardBreak'));
    slice=new Slice(Fragment.fromArray(nodes),0,0);
  }
  const result=new Transform(doc).replaceRange(pmFrom,pmTo,slice).doc;result.check();
  return keepingOriginals(document,doc,result);
}
// Nodes a transform left untouched are shared with the old document, so they are written back from their stored
// JSON exactly as they were; only what changed is serialised again.
function keepingOriginals(document:unknown,doc:PMNode,result:PMNode):EditorDocument {
  const originals=new Map<PMNode,EditorNode>();const raw=EditorDocumentSchema.parse(document);const remember=(node:PMNode,json:EditorNode)=>{originals.set(node,json);node.forEach((child,_offset,index)=>{const original=json.content?.[index];if(original)remember(child,original)});};doc.forEach((child,_offset,index)=>{const original=raw.content[index];if(original)remember(child,original)});
  const emit=(node:PMNode):EditorNode=>originals.get(node)??{...node.toJSON(),...(node.childCount?{content:Array.from({length:node.childCount},(_,index)=>emit(node.child(index)))}:{})};
  return EditorDocumentSchema.parse({type:'doc',content:Array.from({length:result.childCount},(_,index)=>emit(result.child(index)))});
}
// UX 3: a whole-document or multi-block rewrite (P01–P06) that keeps one line per text block goes back block by
// block: every heading, list item, quote and table cell keeps its node, attributes and place, and only its text
// changes; a line the AI left as it was keeps its marks too. Null when the lines do not line up one to one (the
// caller then falls back to plain paragraphs, as before), or when a changed block holds a footnote the new text
// could not carry. `structured` says whether the range has any structure to lose.
const LINE_MARKER=/^\s*(?:[-*•]|\d{1,3}[.)])\s+/u;
export function replaceBlocksKeepingStructure(document:unknown,from:number,to:number,output:string):{content:EditorDocument|null;structured:boolean} {
  const doc=parsed(document);const {text,spans}=mapping(doc);
  if(!Number.isInteger(from)||!Number.isInteger(to)||from<0||to<=from||to>text.length)return {content:null,structured:false};
  const plainAt=(position:number)=>{const span=spans.find(item=>position>=item.pmFrom&&position<=item.pmTo);if(span)return span.from+Math.min(position-span.pmFrom,span.to-span.from);return spans.find(item=>item.pmFrom>position)?.from??text.length;};
  type Unit={kind:'block';node:PMNode;pos:number;text:string;start:number;end:number;structured:boolean}|{kind:'row';node:PMNode;pos:number;text:string;start:number;end:number;cells:Array<{node:PMNode;pos:number;text:string}>};
  const units:Unit[]=[];let broken=false;let structured=false;
  doc.descendants((node,pos,parent)=>{
    if(broken)return false;
    if(node.type.name==='tableOfContents'){if(plainAt(pos+node.nodeSize)>from&&plainAt(pos)<to)broken=true;return false;}
    if(node.type.name==='tableRow'){
      const cells:Array<{node:PMNode;pos:number;text:string}>=[];
      node.forEach((cell,offset)=>{if(cell.childCount!==1||!cell.firstChild!.isTextblock){broken=true;return;}cells.push({node:cell.firstChild!,pos:pos+1+offset+1,text:cell.firstChild!.textContent});});
      const start=plainAt(pos+1);const end=plainAt(pos+node.nodeSize-1);
      if(end>from&&start<to){if(start<from||end>to)broken=true;units.push({kind:'row',node,pos,text:cells.map(cell=>cell.text).join(' | '),start,end,cells});structured=true;}
      return false;
    }
    if(node.isTextblock){
      const start=plainAt(pos+1);const end=plainAt(pos+node.nodeSize-1);
      if(end>=from&&start<=to&&!(end===start&&(start===from||start===to))){
        if(start<from||end>to){broken=true;return false;}
        let hardBreak=false;node.forEach(child=>{if(child.type.name==='hardBreak')hardBreak=true;});if(hardBreak){broken=true;return false;}
        const inStructure=node.type.name==='heading'||(parent!==null&&parent.type.name!=='doc');
        if(inStructure)structured=true;
        units.push({kind:'block',node,pos,text:node.textContent,start,end,structured:inStructure});
      }
      return false;
    }
    return true;
  });
  if(broken||!units.length)return {content:null,structured};
  const filled=units.filter(unit=>unit.text.trim());
  const lines=output.split('\n').map(line=>line.trim()).filter(Boolean);
  // The scope must be exactly these blocks, and the result must keep one line per block.
  const scoped=text.slice(from,to).split('\n').map(line=>line.trim()).filter(Boolean);
  if(lines.length!==filled.length||scoped.length!==filled.length||scoped.some((line,index)=>line!==filled[index]!.text.trim()))return {content:null,structured};
  type Change={from:number;to:number;nodes:PMNode[]};const changes:Change[]=[];
  const inlineFor=(block:PMNode,value:string):PMNode[]=>{
    const texts:PMNode[]=[];let other=false;block.forEach(child=>{if(child.isText)texts.push(child);else other=true;});
    if(other)return [];
    const marks=texts.length&&texts.every(child=>child.sameMarkup(texts[0]!))?texts[0]!.marks:[];
    return value?[schema.text(value,marks)]:[];
  };
  for(const [index,unit] of filled.entries()){
    let line=lines[index]!;
    if(line===unit.text.trim())continue;
    if(unit.kind==='row'){
      const cells=line.replace(/^\||\|$/g,'').split('|').map(cell=>cell.trim());
      if(cells.length!==unit.cells.length)return {content:null,structured};
      for(const [cellIndex,cell] of unit.cells.entries()){
        if(cells[cellIndex]===cell.text.trim())continue;
        const nodes=inlineFor(cell.node,cells[cellIndex]!);if(!nodes.length&&cells[cellIndex])return {content:null,structured};
        changes.push({from:cell.pos+1,to:cell.pos+cell.node.nodeSize-1,nodes});
      }
      continue;
    }
    // A model that echoes list or heading markup in front of the line is not changing the text.
    if(unit.structured&&!LINE_MARKER.test(unit.text))line=line.replace(LINE_MARKER,'');
    if(unit.node.type.name==='heading')line=line.replace(/^#{1,6}\s+/u,'');
    const nodes=inlineFor(unit.node,line);if(!nodes.length)return {content:null,structured};
    changes.push({from:unit.pos+1,to:unit.pos+unit.node.nodeSize-1,nodes});
  }
  const transform=new Transform(doc);
  for(const change of changes.sort((left,right)=>right.from-left.from))transform.replaceWith(change.from,change.to,change.nodes);
  const result=transform.doc;result.check();
  return {content:keepingOriginals(document,doc,result),structured};
}
// UX 3: blocks written by Draf dari brief go in as real editor nodes (paragraphs, subheadings, lists), never flattened.
export type StructuredBlock = { type: 'paragraph' | 'heading' | 'bulletList' | 'orderedList'; text?: string; items?: string[]; level?: number };
function structuredNode(block:StructuredBlock):EditorNode {
  if(block.type==='heading')return {type:'heading',attrs:{level:Math.min(3,Math.max(1,block.level??2))},content:inline(block.text??'')};
  if(block.type==='bulletList'||block.type==='orderedList')return {type:block.type,content:(block.items??[]).map(item=>({type:'listItem',content:[{type:'paragraph',content:inline(item)}]}))};
  return {type:'paragraph',content:inline(block.text??'')};
}
// The top-level block a plain-text offset falls in. A leaf between blocks (a rule, a page break) counts as its own block.
function topLevelIndex(doc:PMNode,at:number):number {
  const {text,spans}=mapping(doc);
  if(!Number.isInteger(at)||at<0||at>text.length)throw new Error('The insertion point no longer matches the document.');
  const span=spans.find(item=>item.from<=at&&at<=item.to);
  if(!span)throw new Error('The insertion point falls outside editable text.');
  const $pos=doc.resolve(span.pmFrom+Math.min(at-span.from,span.to-span.from));
  return Math.min($pos.index(0),doc.childCount-1);
}
// A reference list is the writer's own sources: Draf dari brief never writes one, not even as a section of the outline.
export const isReferenceHeading=(text:string)=>/^(?:daftar pustaka|daftar rujukan|referensi|rujukan|bibliografi|references?|bibliography|works cited)$/iu.test(text.trim());
const isEmptyParagraph=(node:PMNode|null|undefined)=>!!node&&node.type.name==='paragraph'&&node.content.size===0;
export type DraftTarget = { index:number; kind:'heading'|'empty'; heading:{text:string;level:number}; outline:string[]; before:string; after:string };
// Where Draf dari brief may write: on a heading whose section is still empty (the draft goes under it), or on an
// empty line under a heading (the draft replaces that line, so it lands at the cursor). Null anywhere else, so a
// draft never lands in the middle of text or above text that is already there.
export function draftTarget(document:unknown,at:number):DraftTarget|null {
  const doc=parsed(document);let index:number;
  try{index=topLevelIndex(doc,at);}catch{return null;}
  const blocks=Array.from({length:doc.childCount},(_,position)=>doc.child(position));
  const texts=blocks.map(node=>node.textBetween(0,node.content.size,'\n',' ').trim());
  const block=blocks[index]!;
  let kind:'heading'|'empty';let headingIndex=-1;
  if(block.type.name==='heading'){
    kind='heading';headingIndex=index;
    for(let next=index+1;next<blocks.length&&blocks[next]!.type.name!=='heading';next++)if(texts[next])return null;
  } else if(isEmptyParagraph(block)){
    kind='empty';
    for(let previous=index-1;previous>=0;previous--)if(blocks[previous]!.type.name==='heading'){headingIndex=previous;break;}
  } else return null;
  if(headingIndex<0||!texts[headingIndex]||isReferenceHeading(texts[headingIndex]!))return null;
  const clipEnd=(value:string,size:number)=>value.length<=size?value:value.slice(value.length-size).replace(/^\S*\s/u,'');
  const clipStart=(value:string,size:number)=>value.length<=size?value:value.slice(0,size).replace(/\s\S*$/u,'');
  return {
    index,kind,heading:{text:texts[headingIndex]!,level:Number(blocks[headingIndex]!.attrs.level)||2},
    outline:blocks.flatMap((node,position)=>node.type.name==='heading'&&texts[position]?[texts[position]!]:[]).slice(0,60),
    before:clipEnd(texts.slice(0,index).filter(Boolean).join('\n'),1000),
    after:clipStart(texts.slice(index+1).filter(Boolean).join('\n'),600),
  };
}
// Inserts the blocks at a draft target: an empty line is replaced, a heading gets them right under it (filling the
// outline's own empty line when there is one). Every other block keeps its stored JSON exactly as it was.
export function insertBlocksAt(document:unknown,at:number,blocks:StructuredBlock[]):EditorDocument {
  const target=draftTarget(document,at);
  if(!target)throw new Error('The insertion point no longer matches the document.');
  const raw=EditorDocumentSchema.parse(document);const content:EditorNode[]=raw.content.length?[...raw.content]:[{type:'paragraph'}];
  const nodes=blocks.filter(block=>block.type==='bulletList'||block.type==='orderedList'?(block.items??[]).some(item=>item.trim()):(block.text??'').trim()).map(structuredNode);
  if(!nodes.length)throw new Error('The draft is empty.');
  const doc=parsed(document);
  const replaceAt=target.kind==='empty'?target.index:isEmptyParagraph(target.index+1<doc.childCount?doc.child(target.index+1):null)?target.index+1:-1;
  if(replaceAt>=0)content.splice(replaceAt,1,...nodes);else content.splice(target.index+1,0,...nodes);
  const result=EditorDocumentSchema.parse({type:'doc',content});parsed(result);
  return result;
}
// True when a plain-text range runs across a block boundary. Block separators are the only newlines no inline
// span covers (a hard break is its own span), so a range with one is several paragraphs, not one with line breaks.
export function crossesBlocks(document:unknown,from:number,to:number):boolean {
  const {text,spans}=mapping(parsed(document));
  for(let index=Math.max(0,from);index<Math.min(to,text.length);index++){
    if(text[index]==='\n'&&!spans.some(span=>span.from<=index&&span.to>index))return true;
  }
  return false;
}
export function protectedRanges(document:unknown,terms:string[]):Array<{from:number;to:number}> {
 const {text,spans}=mapping(parsed(document));const ranges:Array<{from:number;to:number}>=[];
 for(const term of new Set(terms)){if(!term)continue;let offset=0;while(offset<text.length){const found=text.indexOf(term,offset);if(found<0)break;const first=spans.find(span=>span.from<=found&&span.to>found);const last=spans.find(span=>span.from<found+term.length&&span.to>=found+term.length);if(first&&last)ranges.push({from:first.pmFrom+found-first.from,to:last.pmFrom+found+term.length-last.from});offset=found+term.length;if(ranges.length>=2000)return ranges;}}
 return ranges;
}
