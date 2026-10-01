import type { MarkType, NodeType } from '@tiptap/pm/model';
import type { EditorDocument, EditorMark, EditorNode } from '../contracts';
import { documentSchema } from './extensions';

const schema = documentSchema;
// How deep nodes may nest. Two JSON levels per node (the object and its content list) plus a text node's marks keep
// a stored body inside the request parser's depth cap, so a notebook that loads can always be saved again.
export const MAX_NODE_DEPTH = 28;

function marksProblem(marks: EditorMark[], parent: NodeType): string | null {
  const seen: MarkType[] = [];
  for (const mark of marks) {
    const type = schema.marks[mark.type];
    if (!type) return `Unknown mark ${mark.type}.`;
    if (!parent.allowsMarkType(type)) return `${mark.type} is not allowed in ${parent.name}.`;
    // ProseMirror keeps one mark per type and drops marks that exclude each other, then refuses the node.
    if (seen.some((other) => other.excludes(type) || type.excludes(other))) return `Conflicting ${mark.type} marks.`;
    seen.push(type);
  }
  return null;
}

// Whether a stored document fits the editor schema: the same answer as documentSchema.nodeFromJSON(doc).check(),
// without building a single ProseMirror node. Building them for a 2,000-page thesis took seconds and tens of MB; the
// content expressions and mark rules are all a save needs. An empty document is valid: it loads as one empty paragraph.
export function schemaProblem(document: EditorDocument): string | null {
  if (!document.content.length) return null;
  const stack: Array<{ node: EditorNode | EditorDocument; type: NodeType; depth: number }> = [{ node: document, type: schema.topNodeType, depth: 0 }];
  while (stack.length) {
    const { node, type, depth } = stack.pop()!;
    if (depth > MAX_NODE_DEPTH) return 'The document is nested too deeply.';
    let match = type.contentMatch;
    for (const child of node.content ?? []) {
      const childType = schema.nodes[child.type];
      if (!childType) return `Unknown node type ${child.type}.`;
      const next = match.matchType(childType);
      if (!next) return `${child.type} is not allowed in ${type.name}.`;
      match = next;
      if (child.marks?.length) { const problem = marksProblem(child.marks, type); if (problem) return problem; }
      if (childType.isText) { if (!child.text) return 'Empty text nodes are not allowed.'; continue; }
      stack.push({ node: child, type: childType, depth: depth + 1 });
    }
    if (!match.validEnd) return `${type.name} is missing required content.`;
  }
  return null;
}

// The plain text of a stored document, exactly as documentText's ProseMirror mapping flattens it (block children
// on their own lines, table cells joined by " | ", hard breaks as newlines, atoms as nothing), read straight from
// the JSON. Only call it on a document schemaProblem accepted.
export function jsonDocumentTextLength(document: EditorDocument): number {
  let length = 0;
  const walk = (node: EditorNode) => {
    if (node.type === 'text') { length += node.text?.length ?? 0; return; }
    if (node.type === 'hardBreak') { length += 1; return; }
    const type = schema.nodes[node.type];
    if (!type || type.isLeaf) return;
    const separator = type.inlineContent ? 0 : node.type === 'tableRow' ? 3 : 1;
    (node.content ?? []).forEach((child, index) => { if (index > 0) length += separator; walk(child); });
  };
  document.content.forEach((block, index) => { if (index > 0) length += 1; walk(block); });
  return length;
}

export function jsonDocumentText(document: EditorDocument): string {
  const parts: string[] = [];
  const walk = (node: EditorNode) => {
    if (node.type === 'text') { parts.push(node.text ?? ''); return; }
    if (node.type === 'hardBreak') { parts.push('\n'); return; }
    const type = schema.nodes[node.type];
    if (!type || type.isLeaf) return;
    const separator = type.inlineContent ? '' : node.type === 'tableRow' ? ' | ' : '\n';
    (node.content ?? []).forEach((child, index) => { if (index > 0 && separator) parts.push(separator); walk(child); });
  };
  document.content.forEach((block, index) => { if (index > 0) parts.push('\n'); walk(block); });
  return parts.join('');
}
