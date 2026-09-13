import { z } from "zod";

const categories = z.array(z.string());
const warnings = z.array(z.string());
const transform = z.object({ transformed_text: z.string(), change_categories: categories, warnings });
const alternatives = z.object({
  alternatives: z.array(z.object({ text: z.string().min(1) })),
  warnings,
});
const repair = z.object({ corrected_text: z.string(), });
const dimension = z.object({ score: z.number().int().min(1).max(5).nullable(), reason: z.string() });
export const qualityDimensions = ["clarity", "naturalness", "formality", "academic_fit"] as const;
const quality = z.object({ dimensions: z.object({ clarity: dimension, naturalness: dimension, formality: dimension, academic_fit: dimension }), warnings });

export const responseSchemas = {
  P01_STANDARD_REWRITE: transform,
  P02_ACADEMIC: transform,
  P03_HUMANIZER: z.object({ humanized_text: z.string(), change_categories: categories, warnings }),
  P04_PROFESSIONAL: transform,
  P05_CREATIVE: transform,
  P06_SIMPLIFY: transform,
  P07_INLINE_ALTERNATIVES: alternatives,
  P08_CUSTOM_TRANSFORM: transform,
  P09_QUALITY_EVALUATION: quality,
  P10_REPAIR: repair,
} as const;

export type ResponseSchemas = typeof responseSchemas;

export const runtimeSchemas = {
  P01_STANDARD_REWRITE: z.object({ source_text: z.string().min(1), language: z.enum(["id", "en"]), strength: z.enum(["light", "balanced", "strong"]), protected_terms: z.array(z.string()), protected_citations: z.array(z.string()) }),
  P02_ACADEMIC: z.object({ source_text: z.string().min(1), language: z.enum(["id", "en"]), academic_context: z.enum(["thesis", "journal", "general_academic"]), audience: z.string().nullable(), length: z.enum(["shorter", "same", "more_detailed"]), protected_terms: z.array(z.string()), protected_citations: z.array(z.string()) }),
  P03_HUMANIZER: z.object({ source_text: z.string().min(1), language: z.enum(["id", "en"]), humanizer_context: z.enum(["academic", "professional", "general"]), strength: z.enum(["light", "balanced", "strong"]), preservation: z.enum(["conservative", "balanced", "flexible"]), protected_terms: z.array(z.string()), protected_citations: z.array(z.string()) }),
  P04_PROFESSIONAL: z.object({ source_text: z.string().min(1), language: z.enum(["id", "en"]), audience: z.string().min(1), document_type: z.enum(["email", "proposal", "report", "presentation", "other"]), length: z.enum(["shorter", "same", "more_detailed"]), protected_terms: z.array(z.string()) }),
  P05_CREATIVE: z.object({ source_text: z.string().min(1), language: z.enum(["id", "en"]), audience: z.string().min(1), creative_goal: z.string().min(1), creativity_strength: z.enum(["light", "balanced", "strong"]), protected_terms: z.array(z.string()), protected_citations: z.array(z.string()) }),
  P06_SIMPLIFY: z.object({ source_text: z.string().min(1), language: z.enum(["id", "en"]), target_audience: z.string().min(1), reading_level: z.string().nullable(), length: z.enum(["shorter", "same", "more_detailed"]), output_format: z.enum(["paragraph", "bullets", "numbered_list", "table", "summary"]), protected_terms: z.array(z.string()), protected_citations: z.array(z.string()) }),
  P07_INLINE_ALTERNATIVES: z.object({ selected_text: z.string().min(1), context_before: z.string().nullable(), context_after: z.string().nullable(), language: z.enum(["id", "en"]), action: z.enum(["alternatives", "clearer", "shorter", "paraphrase"]), active_mode: z.enum(["standard", "academic", "humanize", "professional", "creative", "simplify"]), protected_terms: z.array(z.string()), protected_citations: z.array(z.string()).default([]) }),
  P08_CUSTOM_TRANSFORM: z.object({ source_text: z.string().min(1), language: z.enum(["id", "en"]), format: z.enum(["paragraph", "bullets", "numbered_list", "table", "short_summary"]), length: z.enum(["shorter", "same", "more_detailed"]), audience: z.string().min(1), focus: z.array(z.enum(["clarity", "naturalness", "formality", "persuasiveness", "remove_repetition"])), extra_request: z.string().max(300).nullable(), protected_terms: z.array(z.string()), protected_citations: z.array(z.string()) }),
  P09_QUALITY_EVALUATION: z.object({ source_text: z.string().min(1), language: z.enum(["id", "en"]), context: z.enum(["standard", "academic", "humanize", "professional", "creative", "simplify"]), requested_dimensions: z.array(z.enum(qualityDimensions)).min(1), rubric: z.record(z.string(), z.string()) }),
  P10_REPAIR: z.object({ failed_output: z.string(), original_scope: z.string(), required_protected_terms: z.array(z.string()), required_protected_citations: z.array(z.string()) }),
} as const;
