import { z } from "zod";

export const ApiErrorSchema = z.object({ error: z.object({ code: z.string(), message: z.string(), details: z.unknown().optional() }) });
const MAX_EDITOR_NODES = 12_000;
const EditorMarkSchema = z.object({ type: z.enum(["bold", "italic", "underline", "link"]), attrs: z.object({ href: z.string().url().max(2048).refine(value => /^https?:\/\//i.test(value), "Only HTTP(S) links are supported."), target: z.string().max(100).nullable().optional(), rel: z.string().max(200).nullable().optional(), class: z.string().max(200).nullable().optional() }).optional() }).strict();
type EditorNode = { type: string; text?: string; attrs?: Record<string, unknown>; marks?: Array<z.infer<typeof EditorMarkSchema>>; content?: EditorNode[] };
const EditorNodeSchema: z.ZodType<EditorNode> = z.lazy(() => z.object({
  type: z.enum(["paragraph", "heading", "text", "bulletList", "orderedList", "listItem", "hardBreak", "blockquote", "horizontalRule", "table", "tableRow", "tableHeader", "tableCell"]),
  text: z.string().max(200_000).optional(), attrs: z.object({ level: z.number().int().min(1).max(6).optional(), href: z.string().url().max(2048).refine(value => /^https?:\/\//i.test(value), "Only HTTP(S) links are supported.").optional(), target: z.string().max(100).nullable().optional(), rel: z.string().max(200).nullable().optional(), class: z.string().max(200).nullable().optional(), textAlign: z.enum(["left", "center", "right", "justify"]).nullable().optional(), start: z.number().int().min(1).max(9999).optional(), colspan: z.number().int().min(1).max(100).optional(), rowspan: z.number().int().min(1).max(100).optional(), colwidth: z.array(z.number().int().min(1).max(10000)).nullable().optional() }).strict().optional(), marks: z.array(EditorMarkSchema).max(4).optional(), content: z.array(EditorNodeSchema).max(500).optional()
}).strict().superRefine((node, ctx) => { if (node.type === "text" && node.text === undefined) ctx.addIssue({ code: "custom", message: "Text nodes require text." }); if (node.type !== "text" && node.text !== undefined) ctx.addIssue({ code: "custom", message: "Only text nodes may contain text." }); }));
export const EditorDocumentSchema = z.object({ type: z.literal("doc"), content: z.array(EditorNodeSchema).max(MAX_EDITOR_NODES).default([]) }).strict().superRefine((document, ctx) => { const encoded = JSON.stringify(document); if (encoded.length > 1_500_000) ctx.addIssue({ code: "custom", message: "Document exceeds the inline safety limit." }); });
const DocumentPreferencesSchema = z.record(z.string(), z.union([z.string().max(500), z.number().finite(), z.boolean(), z.array(z.string().max(300)).max(20)]));
export const DocumentCreateSchema = z.object({ title: z.string().trim().min(1).max(180).default("Untitled document"), content: EditorDocumentSchema.optional(), language: z.enum(["auto", "id", "en"]).default("auto"), preferences: DocumentPreferencesSchema.optional() });
export const DocumentPatchSchema = z.object({ title: z.string().trim().min(1).max(180).optional(), language: z.enum(["auto", "id", "en"]).optional(), preferences: DocumentPreferencesSchema.optional(), content: EditorDocumentSchema.optional(), expectedRevision: z.number().int().min(0) });
export const AutosaveSchema = z.object({ content: EditorDocumentSchema, title: z.string().trim().min(1).max(180).optional(), language: z.enum(["auto", "id", "en"]).optional(), preferences: z.record(z.string(), z.unknown()).optional(), expectedRevision: z.number().int().min(0) });
export const LockCreateSchema = z.object({ term: z.string().min(1).max(300).refine((term) => term.trim().length > 0, "A locked term cannot be blank.") });
export const GenerateSchema = z.object({
  documentId: z.string().uuid(), promptId: z.enum(["P01_STANDARD_REWRITE", "P02_ACADEMIC", "P03_HUMANIZER", "P04_PROFESSIONAL", "P05_CREATIVE", "P06_SIMPLIFY", "P07_INLINE_ALTERNATIVES", "P08_CUSTOM_TRANSFORM"]),
  source: z.object({ text: z.string().min(1).max(200000), anchor: z.object({ from: z.number().int().min(0), to: z.number().int().min(0) }).optional() }),
  runtime: z.record(z.string(), z.unknown()), expectedRevision: z.number().int().min(0)
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
