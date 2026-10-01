import { z } from "zod";
import { INSTRUCTION_LIMIT } from "@/lib/writing/instruction";
import { NotebookAppearanceSchema } from "@/lib/notebook/appearance";
import { BRIEF_VALUE_LIMIT, metaLimit } from "@/lib/writing/notebook-meta";
import { MAX_CHILD_NODES, MAX_TEXT_NODE_CHARACTERS, MAX_TOP_LEVEL_BLOCKS } from "@/lib/limits";

export const ApiErrorSchema = z.object({ error: z.object({ code: z.string(), message: z.string(), details: z.unknown().optional() }) });
const httpUrl = (value: string) => /^https?:\/\//i.test(value);
export const EDITOR_NODE_TYPES = ["paragraph", "heading", "text", "bulletList", "orderedList", "listItem", "taskList", "taskItem", "hardBreak", "blockquote", "horizontalRule", "pageBreak", "footnote", "tableOfContents", "table", "tableRow", "tableHeader", "tableCell", "imageSpace"] as const;
export const EDITOR_MARK_TYPES = ["bold", "italic", "underline", "strike", "link", "textStyle", "highlight", "subscript", "superscript"] as const;
export type EditorMark = { type: (typeof EDITOR_MARK_TYPES)[number]; attrs?: Record<string, unknown> };
export type EditorNode = { type: string; text?: string; attrs?: Record<string, unknown>; marks?: EditorMark[]; content?: EditorNode[] };
export type EditorDocument = { type: "doc"; content: EditorNode[] };
const NODE_TYPES = new Set<string>(EDITOR_NODE_TYPES);
const MARK_TYPES = new Set<string>(EDITOR_MARK_TYPES);
const NODE_KEYS = new Set(["type", "text", "attrs", "marks", "content"]);
const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);

// Attribute values stay primitive and bounded; the TipTap schema itself decides which keys exist, so new defaults never
// break loading. Null attributes are dropped in place: TipTap writes every attribute, defaults included, and
// ProseMirror refills them on load, so the stored body stays small.
function attrsProblem(owner: Record<string, unknown>): string | null {
  const attrs = owner.attrs;
  if (attrs === undefined) return null;
  if (!isRecord(attrs)) return "Attributes must be an object.";
  let kept = 0;
  for (const key of Object.keys(attrs)) {
    const value = attrs[key];
    if (value === null || value === undefined) { delete attrs[key]; continue; }
    if (key.length > 40) return "Attribute names are at most 40 characters.";
    if (++kept > 40) return "Too many attributes.";
    if (typeof value === "string") {
      if (value.length > 2048) return "Attribute values are at most 2,048 characters.";
      if (key === "href" && !httpUrl(value)) return "Only HTTP(S) links are supported.";
      continue;
    }
    if (typeof value === "number") { if (!Number.isFinite(value)) return "Attribute numbers must be finite."; continue; }
    if (typeof value === "boolean") continue;
    if (Array.isArray(value)) {
      if (value.length > 100 || value.some((item) => typeof item !== "number" || !Number.isFinite(item) || item < 0 || item > 100_000)) return "Attribute lists hold at most 100 numbers.";
      continue;
    }
    return "Attribute values must be text, numbers or booleans.";
  }
  if (!kept) delete owner.attrs;
  return null;
}

// The stored-document contract, checked by hand in one walk instead of a Zod tree: Zod copied every node, which for a
// 2,000-page thesis cost seconds of CPU and a second copy of the whole document in memory. The rules are the ones the
// Zod schema had (strict keys, known types, bounded attributes and marks, text only on text nodes) with the size caps
// of src/lib/limits.ts. The walk is iterative, so nesting cannot overflow the stack. Whether the nodes fit together
// is ProseMirror's call: see schemaProblem in src/lib/editor/validate.ts.
export function editorDocumentProblem(value: unknown): string | null {
  if (!isRecord(value) || value.type !== "doc") return "The document must be a doc node.";
  for (const key of Object.keys(value)) if (key !== "type" && key !== "content") return "Unknown document field.";
  if (value.content === undefined) value.content = [];
  if (!Array.isArray(value.content)) return "Document content must be a list.";
  if (value.content.length > MAX_TOP_LEVEL_BLOCKS) return "The document has too many blocks.";
  const stack: unknown[] = [...value.content];
  while (stack.length) {
    const node = stack.pop();
    if (!isRecord(node)) return "Every node must be an object.";
    for (const key of Object.keys(node)) if (!NODE_KEYS.has(key)) return "Unknown node field.";
    if (typeof node.type !== "string" || !NODE_TYPES.has(node.type)) return "Unknown node type.";
    if (node.type === "text") {
      if (typeof node.text !== "string") return "Text nodes require text.";
      if (node.text.length > MAX_TEXT_NODE_CHARACTERS) return "A text node is too long.";
    } else if (node.text !== undefined) return "Only text nodes may contain text.";
    const problem = attrsProblem(node);
    if (problem) return problem;
    if (node.marks !== undefined) {
      if (!Array.isArray(node.marks) || node.marks.length > 10) return "At most 10 marks per node.";
      for (const mark of node.marks) {
        if (!isRecord(mark) || typeof mark.type !== "string" || !MARK_TYPES.has(mark.type)) return "Unknown mark.";
        for (const key of Object.keys(mark)) if (key !== "type" && key !== "attrs") return "Unknown mark field.";
        const markProblem = attrsProblem(mark);
        if (markProblem) return markProblem;
        if (mark.type === "link" && (!isRecord(mark.attrs) || typeof mark.attrs.href !== "string" || !httpUrl(mark.attrs.href))) return "Only HTTP(S) links are supported.";
      }
      if (!node.marks.length) delete node.marks;
    }
    if (node.content !== undefined) {
      if (!Array.isArray(node.content)) return "Node content must be a list.";
      if (node.content.length > MAX_CHILD_NODES) return "A node has too many children.";
      for (const child of node.content) stack.push(child);
    }
  }
  return null;
}

// Validates and compacts null attributes in place: the parsed value is the same object, never a copy.
export const EditorDocumentSchema = z.custom<EditorDocument>().superRefine((value, ctx) => {
  const problem = editorDocumentProblem(value);
  if (problem) ctx.addIssue({ code: "custom", message: problem });
});
// Every string preference stays ≤500 characters except the brief (UX 3), whose values may reach BRIEF_VALUE_LIMIT,
// and the writing sample, which may reach SAMPLE_LIMIT (see metaLimit).
const DocumentPreferencesSchema = z.record(z.string(), z.union([z.string().max(BRIEF_VALUE_LIMIT), z.number().finite(), z.boolean(), z.null(), z.array(z.string().max(300)).max(20)]))
  .superRefine((preferences, ctx) => { for (const [key, value] of Object.entries(preferences)) if (typeof value === "string" && value.length > metaLimit(key)) ctx.addIssue({ code: "custom", path: [key], message: `At most ${metaLimit(key)} characters.` }); });
export const DocumentCreateSchema = z.object({ title: z.string().trim().min(1).max(180).default("Untitled document"), content: EditorDocumentSchema.optional(), language: z.enum(["auto", "id", "en"]).default("auto"), preferences: DocumentPreferencesSchema.optional(), color: NotebookAppearanceSchema.shape.color.optional(), icon: NotebookAppearanceSchema.shape.icon.optional(), docxImportReceipt: z.string().uuid().optional() });
export const DocumentPatchSchema = z.object({ title: z.string().trim().min(1).max(180).optional(), language: z.enum(["auto", "id", "en"]).optional(), preferences: DocumentPreferencesSchema.optional(), content: EditorDocumentSchema.optional(), expectedRevision: z.number().int().min(0) });
// GET /api/documents: every filter is optional; an unknown mode or kind is refused rather than matching nothing.
export const DocumentListQuerySchema = z.object({
  q: z.string().max(100).optional(),
  mode: z.enum(["standard", "academic", "humanize", "professional", "creative", "simplify"]).optional(),
  docType: z.enum(["article", "script", "caption", "essay", "report", "email", "product", "story", "none"]).optional(),
  sort: z.enum(["updated", "title", "created"]).optional(),
  pinned: z.enum(["1", "true"]).optional(), trash: z.enum(["1", "true"]).optional(), counts: z.enum(["1", "true"]).optional(),
});
export const PinSchema = z.object({ pinned: z.boolean() });
export const DocumentTitleSchema = z.object({ title: z.string().trim().min(1).max(180), expectedRevision: z.number().int().min(0) });
export const AutosaveSchema = z.object({ content: EditorDocumentSchema, title: z.string().trim().min(1).max(180).optional(), language: z.enum(["auto", "id", "en"]).optional(), preferences: z.record(z.string(), z.unknown()).optional(), expectedRevision: z.number().int().min(0) });
export const LockCreateSchema = z.object({ term: z.string().min(1).max(300).refine((term) => term.trim().length > 0, "A locked term cannot be blank.") });
export const GenerateSchema = z.object({
  documentId: z.string().uuid(), promptId: z.enum(["P01_STANDARD_REWRITE", "P02_ACADEMIC", "P03_HUMANIZER", "P04_PROFESSIONAL", "P05_CREATIVE", "P06_SIMPLIFY", "P07_INLINE_ALTERNATIVES", "P08_CUSTOM_TRANSFORM"]),
  source: z.object({ text: z.string().min(1).max(200000), anchor: z.object({ from: z.number().int().min(0), to: z.number().int().min(0) }).optional() }),
  runtime: z.record(z.string(), z.unknown()), expectedRevision: z.number().int().min(0),
  // Set once, on the first run of a brand-new notebook, so the rewrite call also returns a short title.
  suggestTitle: z.boolean().optional(),
  // Free-form instruction typed by the writer. Kept at the top level, outside `runtime`, because it is
  // untrusted text: the server sanitises it and sends it as its own USER block, never as a control.
  instruction: z.string().max(INSTRUCTION_LIMIT).optional(),
});
// UX 3, Draf dari brief: where to write (a plain-text offset on a heading or an empty line) and in which language.
// The brief, the outline and the kind of writing are read from the saved notebook, never from this body.
export const DraftSchema = z.object({ documentId: z.string().uuid(), expectedRevision: z.number().int().min(0), at: z.number().int().min(0), language: z.enum(["id", "en"]) });
export const ApplyPreviewSchema =z.object({ expectedRevision: z.number().int().min(0), selectedAlternative: z.number().int().min(0).max(4).optional() });
export const AnalyzeQualitySchema = z.object({ documentId: z.string().uuid(), expectedRevision: z.number().int().min(0), source: z.object({ text: z.string().min(1).max(20000), anchor: z.object({ from: z.number().int().min(0), to: z.number().int().min(0) }).optional() }), language: z.enum(["id", "en"]), context: z.enum(["standard", "academic", "humanize", "professional", "creative", "simplify"]) });
export const RestoreVersionSchema = z.object({ expectedRevision: z.number().int().min(0) });
export const CheckpointSchema = z.object({ expectedRevision: z.number().int().min(0), label: z.string().trim().min(1).max(120).optional() });
export const VersionLabelSchema = z.object({ label: z.string().trim().min(1).max(120) });

export type DocumentCreateInput = z.infer<typeof DocumentCreateSchema>;
export type GenerateInput = z.infer<typeof GenerateSchema>;
export type DraftInput = z.infer<typeof DraftSchema>;
export type AnalyzeQualityInput = z.infer<typeof AnalyzeQualitySchema>;
export type ApiError = z.infer<typeof ApiErrorSchema>;
export type DocumentDTO = { id: string; title: string; revision: number; language: "auto" | "id" | "en"; preferences?: Record<string, unknown>; originalVersionId?: string | null; color?: string | null; icon?: string | null; pinned?: boolean; content: EditorDocument; createdAt: string; updatedAt: string };
export type VersionDTO = { id: string; documentId: string; kind: "original" | "checkpoint" | "ai_apply" | "restore" | "auto"; revision: number; createdAt: string; label: string | null; promptId?: string | null; scopeType?: string | null };

export function apiError(code: string, message: string, status: number, details?: unknown) {
  return Response.json({ error: { code, message, ...(details === undefined ? {} : { details }) } }, { status });
}

export function jsonData<T>(data: T, init?: ResponseInit) { return Response.json({ data }, init); }
