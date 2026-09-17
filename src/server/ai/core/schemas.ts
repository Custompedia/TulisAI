import { z } from "zod";
import { EXTRA_LIMIT, SAMPLE_LIMIT } from "@/lib/writing/settings";

const warnings = z.array(z.string().max(160)).max(3);
const transform = z.object({ transformed_text: z.string(), change_categories: z.array(z.string().max(40)).max(3), warnings, no_change_needed: z.boolean() });
const alternatives = z.object({
  alternatives: z.array(z.object({ text: z.string().min(1), variation_level: z.enum(["leksikal", "struktur", "panjang", "register"]) })).min(1).max(5),
  warnings,
});
const repair = z.object({ corrected_text: z.string(), unrepairable_spans: z.array(z.string()) });
export const qualityValues = ["rendah", "sedang", "tinggi", "tidak_berlaku"] as const;
export const qualityDimensions = ["clarity", "academic_fit", "naturalness", "formality"] as const;
const dimension = z.object({ value: z.enum(qualityValues), reason: z.string() });
const quality = z.object({ clarity: dimension, academic_fit: dimension, naturalness: dimension, formality: dimension });

export const responseSchemas = {
  P01_STANDARD_REWRITE: transform,
  P02_ACADEMIC: transform,
  P03_HUMANIZER: transform,
  P04_PROFESSIONAL: transform,
  P05_CREATIVE: transform,
  P06_SIMPLIFY: transform,
  P07_INLINE_ALTERNATIVES: alternatives,
  P08_CUSTOM_TRANSFORM: transform,
  P09_QUALITY_EVALUATION: quality,
  P10_REPAIR: repair,
} as const;

export type ResponseSchemas = typeof responseSchemas;

// First run of a brand-new notebook only: the same rewrite result plus a short label for the document.
const titled = transform.extend({ suggested_title: z.string() });
export const titledResponseSchemas: Partial<Record<keyof ResponseSchemas, typeof titled>> = {
  P01_STANDARD_REWRITE: titled, P02_ACADEMIC: titled, P03_HUMANIZER: titled, P04_PROFESSIONAL: titled, P05_CREATIVE: titled, P06_SIMPLIFY: titled, P08_CUSTOM_TRANSFORM: titled,
};

export const focusValues = ["clarity", "naturalness", "formality", "persuasiveness", "remove_repetition"] as const;
const language = z.enum(["id", "en"]);
const strings = z.array(z.string()).default([]);
const request = z.object({
  format: z.enum(["paragraf", "poin", "bernomor", "tabel", "ringkasan", "email"]).default("paragraf"),
  length: z.enum(["lebih singkat", "sama", "lebih detail"]).optional(),
  audience: z.enum(["dosen", "profesional", "klien", "umum"]).optional(),
  focus: z.array(z.enum(focusValues)).max(3).default([]),
  additional_instruction: z.string().max(EXTRA_LIMIT).default(""),
});
// style_reference is the author's writing sample; it travels in the user message as its own block.
const rewrite = { source_text: z.string().min(1), context_before: z.string().nullable().default(null), context_after: z.string().nullable().default(null), language, protected_terms: strings, protected_citations: strings, request: request.optional(), style_reference: z.string().max(SAMPLE_LIMIT).optional(), suggest_title: z.boolean().optional() };
const strength = z.enum(["light", "balanced", "strong"]);

export const runtimeSchemas = {
  P01_STANDARD_REWRITE: z.object({ ...rewrite, strength }),
  P02_ACADEMIC: z.object({ ...rewrite, academic_context: z.enum(["skripsi", "jurnal", "umum"]) }),
  P03_HUMANIZER: z.object({ ...rewrite, strength, humanizer_context: z.enum(["akademik", "profesional", "umum"]), preservation: z.enum(["conservative", "balanced", "flexible"]).default("balanced") }),
  P04_PROFESSIONAL: z.object({ ...rewrite, audience: z.enum(["atasan", "klien", "rekan", "vendor", "umum"]) }),
  P05_CREATIVE: z.object({ ...rewrite, creativity_strength: z.enum(["ringan", "sedang", "berani"]) }),
  P06_SIMPLIFY: z.object({ ...rewrite, audience: z.enum(["anak sekolah", "umum", "klien", "pemula"]) }),
  P07_INLINE_ALTERNATIVES: z.object({ selected_text: z.string().min(1), context_before: z.string().nullable().default(null), context_after: z.string().nullable().default(null), language, intent: z.enum(["alternatif", "lebih singkat", "lebih jelas", "lebih formal", "lebih natural"]), n: z.number().int().min(3).max(5).default(3), protected_terms: strings, protected_citations: strings }),
  P08_CUSTOM_TRANSFORM: z.object({ ...rewrite, strength: z.literal("balanced"), request }),
  P09_QUALITY_EVALUATION: z.object({ source_text: z.string().min(1), language, mode: z.string().min(1) }),
  P10_REPAIR: z.object({ language, failed_output: z.string(), original_scope: z.string().min(1), required_protected_terms: strings, required_protected_citations: strings }),
} as const;
