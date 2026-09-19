import { z } from "zod";
import { INSTRUCTION_LIMIT } from "@/lib/writing/instruction";
import { NotebookAppearanceSchema } from "@/lib/notebook/appearance";

export const ApiErrorSchema = z.object({ error: z.object({ code: z.string(), message: z.string(), details: z.unknown().optional() }) });
const MAX_EDITOR_NODES = 12_000;
const httpUrl = (value: string) => /^https?:\/\//i.test(value);
// Attribute values stay primitive and bounded; the TipTap schema itself decides which keys exist, so new defaults never break loading.
const EditorAttrValueSchema = z.union([z.string().max(2048), z.number().finite(), z.boolean(), z.null(), z.array(z.number().finite().min(0).max(100_000)).max(100)]);
const EditorAttrsSchema = z.record(z.string().max(40), EditorAttrValueSchema).refine((attrs) => Object.keys(attrs).length <= 40, "Too many attributes.").refine((attrs) => typeof attrs.href !== "string" || httpUrl(attrs.href), "Only HTTP(S) links are supported.");
const EditorMarkSchema = z.object({ type: z.enum(["bold", "italic", "underline", "strike", "link", "textStyle", "highlight", "subscript", "superscript"]), attrs: EditorAttrsSchema.optional() }).strict().superRefine((mark, ctx) => { if (mark.type === "link" && (typeof mark.attrs?.href !== "string" || !httpUrl(mark.attrs.href))) ctx.addIssue({ code: "custom", message: "Only HTTP(S) links are supported." }); });
type EditorNode = { type: string; text?: string; attrs?: Record<string, unknown>; marks?: Array<z.infer<typeof EditorMarkSchema>>; content?: EditorNode[] };
const EditorNodeSchema: z.ZodType<EditorNode> = z.lazy(() => z.object({
  type: z.enum(["paragraph", "heading", "text", "bulletList", "orderedList", "listItem", "taskList", "taskItem", "hardBreak", "blockquote", "horizontalRule", "pageBreak", "footnote", "tableOfContents", "table", "tableRow", "tableHeader", "tableCell"]),
  text: z.string().max(200_000).optional(), attrs: EditorAttrsSchema.optional(), marks: z.array(EditorMarkSchema).max(10).optional(), content: z.array(EditorNodeSchema).max(5000).optional()
}).strict().superRefine((node, ctx) => { if (node.type === "text" && node.text === undefined) ctx.addIssue({ code: "custom", message: "Text nodes require text." }); if (node.type !== "text" && node.text !== undefined) ctx.addIssue({ code: "custom", message: "Only text nodes may contain text." }); }));
// TipTap writes every attribute, defaults included; null attrs are dropped so stored bodies stay small (ProseMirror refills them on load).
const compactNode = (node: unknown): unknown => {
  if (!node || typeof node !== "object" || Array.isArray(node)) return node;
  const { attrs, marks, content, ...rest } = node as { attrs?: Record<string, unknown>; marks?: unknown[]; content?: unknown[] };
  const kept = attrs && typeof attrs === "object" ? Object.fromEntries(Object.entries(attrs).filter(([, value]) => value !== null && value !== undefined)) : undefined;
  return { ...rest, ...(kept && Object.keys(kept).length ? { attrs: kept } : {}), ...(Array.isArray(marks) && marks.length ? { marks: marks.map(compactNode) } : {}), ...(Array.isArray(content) ? { content: content.map(compactNode) } : {}) };
};
// D1 caps a row at 2 MB of UTF-8 and non-ASCII takes up to 3 bytes per UTF-16 unit, so bytes are capped too, with room for the other columns.
const MAX_BODY_UNITS = 1_500_000; const MAX_BODY_BYTES = 1_900_000;
const utf8Length = (value: string) => { let bytes = value.length; for (let index = 0; index < value.length; index++) { const code = value.charCodeAt(index); if (code >= 0x80) bytes += code >= 0x800 && (code < 0xd800 || code > 0xdfff) ? 2 : 1; } return bytes; };
export const EditorDocumentSchema = z.preprocess(compactNode, z.object({ type: z.literal("doc"), content: z.array(EditorNodeSchema).max(MAX_EDITOR_NODES).default([]) }).strict().superRefine((document, ctx) => { const encoded = JSON.stringify(document); if (encoded.length > MAX_BODY_UNITS || (encoded.length > MAX_BODY_BYTES / 3 && utf8Length(encoded) > MAX_BODY_BYTES)) ctx.addIssue({ code: "custom", message: "Document exceeds the inline safety limit." }); }));
const DocumentPreferencesSchema = z.record(z.string(), z.union([z.string().max(500), z.number().finite(), z.boolean(), z.null(), z.array(z.string().max(300)).max(20)]));
export const DocumentCreateSchema = z.object({ title: z.string().trim().min(1).max(180).default("Untitled document"), content: EditorDocumentSchema.optional(), language: z.enum(["auto", "id", "en"]).default("auto"), preferences: DocumentPreferencesSchema.optional(), color: NotebookAppearanceSchema.shape.color.optional(), icon: NotebookAppearanceSchema.shape.icon.optional() });
export const DocumentPatchSchema = z.object({ title: z.string().trim().min(1).max(180).optional(), language: z.enum(["auto", "id", "en"]).optional(), preferences: DocumentPreferencesSchema.optional(), content: EditorDocumentSchema.optional(), expectedRevision: z.number().int().min(0) });
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
export const ApplyPreviewSchema = z.object({ expectedRevision: z.number().int().min(0), selectedAlternative: z.number().int().min(0).max(4).optional() });
export const AnalyzeQualitySchema = z.object({ documentId: z.string().uuid(), expectedRevision: z.number().int().min(0), source: z.object({ text: z.string().min(1).max(20000), anchor: z.object({ from: z.number().int().min(0), to: z.number().int().min(0) }).optional() }), language: z.enum(["id", "en"]), context: z.enum(["standard", "academic", "humanize", "professional", "creative", "simplify"]) });
export const RestoreVersionSchema = z.object({ expectedRevision: z.number().int().min(0) });
export const CheckpointSchema = z.object({ expectedRevision: z.number().int().min(0), label: z.string().trim().min(1).max(120).optional() });
export const VersionLabelSchema = z.object({ label: z.string().trim().min(1).max(120) });

export type DocumentCreateInput = z.infer<typeof DocumentCreateSchema>;
export type GenerateInput = z.infer<typeof GenerateSchema>;
export type AnalyzeQualityInput = z.infer<typeof AnalyzeQualitySchema>;
export type ApiError = z.infer<typeof ApiErrorSchema>;
export type DocumentDTO = { id: string; title: string; revision: number; language: "auto" | "id" | "en"; preferences?: Record<string, unknown>; originalVersionId?: string | null; color?: string | null; icon?: string | null; content: z.infer<typeof EditorDocumentSchema>; createdAt: string; updatedAt: string };
export type VersionDTO = { id: string; documentId: string; kind: "original" | "checkpoint" | "ai_apply" | "restore"; revision: number; createdAt: string; label: string | null; promptId?: string | null; scopeType?: string | null };

export function apiError(code: string, message: string, status: number, details?: unknown) {
  return Response.json({ error: { code, message, ...(details === undefined ? {} : { details }) } }, { status });
}

export function jsonData<T>(data: T, init?: ResponseInit) { return Response.json({ data }, init); }
