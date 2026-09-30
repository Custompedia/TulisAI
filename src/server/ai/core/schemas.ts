import { z } from "zod";
import { EXTRA_LIMIT, SAMPLE_LIMIT } from "@/lib/writing/settings";
import { INSTRUCTION_LIMIT } from "@/lib/writing/instruction";
import { DOC_TYPES } from "@/lib/writing/doc-types";
import { BRIEF_VALUE_LIMIT } from "@/lib/writing/notebook-meta";

// UX 3: P07 intents for creators (the selection bubble's Lebih catchy, Jadikan hook, Tambah CTA).
export const CREATOR_INTENTS = ["lebih catchy", "jadikan hook", "tambah cta"] as const;
export const isCreatorIntent = (value: unknown) => typeof value === "string" && (CREATOR_INTENTS as readonly string[]).includes(value);
// UX 3: the kinds of writing P11 knows ("none" = the writer set no kind) and the brief fields it reads.
export const draftDocTypes = [...DOC_TYPES, "none"] as const;
export const draftBriefFields = ["topic", "platform", "audience", "message", "cta", "duration", "notes"] as const;
export type DraftBriefField = (typeof draftBriefFields)[number];
const briefValue = z.string().max(BRIEF_VALUE_LIMIT).default("");

const warnings = z.array(z.string().max(160)).max(3);
const transform = z.object({ transformed_text: z.string(), change_categories: z.array(z.string().max(40)).max(3), warnings, no_change_needed: z.boolean() });
// P03 names the passages it found before it rewrites, so the edit is tied to quoted evidence instead of a general impression.
const humanize = z.object({ patterns_found: z.array(z.string()).default([]), ...transform.shape });
const alternatives = z.object({
  alternatives: z.array(z.object({ text: z.string().min(1), variation_level: z.enum(["leksikal", "struktur", "panjang", "register"]) })).min(1).max(5),
  warnings,
});
const repair = z.object({ corrected_text: z.string(), unrepairable_spans: z.array(z.string()) });
export const qualityValues = ["rendah", "sedang", "tinggi", "tidak_berlaku"] as const;
export const qualityDimensions = ["clarity", "academic_fit", "naturalness", "formality"] as const;
// P11: one section as real editor blocks. Every field is present on every block (strict structured outputs), so a
// paragraph carries an empty items list and a list carries an empty text.
export const draftBlockTypes = ["paragraph", "subheading", "bullet_list", "numbered_list"] as const;
export const DRAFT_MAX_BLOCKS = 12;
const draft = z.object({ blocks: z.array(z.object({ type: z.enum(draftBlockTypes), text: z.string(), items: z.array(z.string()) })).min(1).max(DRAFT_MAX_BLOCKS), warnings });
const dimension = z.object({ value: z.enum(qualityValues), reason: z.string() });
const quality = z.object({ clarity: dimension, academic_fit: dimension, naturalness: dimension, formality: dimension });

export const responseSchemas = {
  P01_STANDARD_REWRITE: transform,
  P02_ACADEMIC: transform,
  P03_HUMANIZER: humanize,
  P04_PROFESSIONAL: transform,
  P05_CREATIVE: transform,
  P06_SIMPLIFY: transform,
  P07_INLINE_ALTERNATIVES: alternatives,
  P08_CUSTOM_TRANSFORM: transform,
  P09_QUALITY_EVALUATION: quality,
  P10_REPAIR: repair,
  P11_SECTION_DRAFT: draft,
} as const;

export type ResponseSchemas = typeof responseSchemas;

// First run of a brand-new notebook only: the same rewrite result plus a short label for the document.
const titled = transform.extend({ suggested_title: z.string() });
export const titledResponseSchemas: Partial<Record<keyof ResponseSchemas, z.ZodTypeAny>> = {
  P01_STANDARD_REWRITE: titled, P02_ACADEMIC: titled, P03_HUMANIZER: humanize.extend({ suggested_title: z.string() }), P04_PROFESSIONAL: titled, P05_CREATIVE: titled, P06_SIMPLIFY: titled, P08_CUSTOM_TRANSFORM: titled,
};

export const focusValues = ["clarity", "naturalness", "formality", "persuasiveness", "remove_repetition"] as const;
const language = z.enum(["id", "en"]);
const strings = z.array(z.string()).default([]);
const request = z.object({
  format: z.enum(["paragraf", "poin", "bernomor", "tabel", "ringkasan", "email", "script", "thread"]).default("paragraf"),
  length: z.enum(["lebih singkat", "sama", "lebih detail"]).optional(),
  audience: z.enum(["dosen", "profesional", "klien", "umum"]).optional(),
  focus: z.array(z.enum(focusValues)).max(3).default([]),
  additional_instruction: z.string().max(EXTRA_LIMIT).default(""),
});
// style_reference is the author's writing sample; it travels in the user message as its own block.
const rewrite = { source_text: z.string().min(1), context_before: z.string().nullable().default(null), context_after: z.string().nullable().default(null), language, protected_terms: strings, protected_citations: strings, request: request.optional(), style_reference: z.string().max(SAMPLE_LIMIT).optional(), suggest_title: z.boolean().optional(), user_instruction: z.string().max(INSTRUCTION_LIMIT).optional() };
const strength = z.enum(["light", "balanced", "strong"]);

export const runtimeSchemas = {
  P01_STANDARD_REWRITE: z.object({ ...rewrite, strength }),
  P02_ACADEMIC: z.object({ ...rewrite, academic_context: z.enum(["skripsi", "jurnal", "umum"]) }),
  P03_HUMANIZER: z.object({ ...rewrite, strength, humanizer_context: z.enum(["akademik", "profesional", "umum"]), preservation: z.enum(["conservative", "balanced", "flexible"]).default("balanced") }),
  P04_PROFESSIONAL: z.object({ ...rewrite, audience: z.enum(["atasan", "klien", "rekan", "vendor", "umum"]) }),
  P05_CREATIVE: z.object({ ...rewrite, creativity_strength: z.enum(["ringan", "sedang", "berani"]) }),
  P06_SIMPLIFY: z.object({ ...rewrite, audience: z.enum(["anak sekolah", "umum", "klien", "pemula"]) }),
  P07_INLINE_ALTERNATIVES: z.object({ selected_text: z.string().min(1), context_before: z.string().nullable().default(null), context_after: z.string().nullable().default(null), language, intent: z.enum(["alternatif", "lebih singkat", "lebih jelas", "lebih formal", "lebih natural", ...CREATOR_INTENTS]), n: z.number().int().min(3).max(5).default(3), protected_terms: strings, protected_citations: strings }),
  P08_CUSTOM_TRANSFORM: z.object({ ...rewrite, strength: z.enum(["balanced", "strong"]), request }),
  P09_QUALITY_EVALUATION: z.object({ source_text: z.string().min(1), language, mode: z.string().min(1) }),
  P10_REPAIR: z.object({ language, failed_output: z.string(), original_scope: z.string().min(1), required_protected_terms: strings, required_protected_citations: strings, locked_only: z.literal(true).optional() }),
  // Brief, outline and context arrive already sanitised (see ./draft); the bounds here are the last line.
  P11_SECTION_DRAFT: z.object({
    language, doc_type: z.enum([...draftDocTypes]).default("none"), academic: z.boolean().default(false), max_characters: z.number().int().min(100).max(5000),
    brief: z.object({ topic: briefValue, platform: briefValue, audience: briefValue, message: briefValue, cta: briefValue, duration: briefValue, notes: briefValue }),
    outline: z.array(z.string().max(200)).max(60).default([]), section_heading: z.string().min(1).max(200),
    context_before: z.string().max(1200).nullable().default(null), context_after: z.string().max(1200).nullable().default(null),
  }),
} as const;
