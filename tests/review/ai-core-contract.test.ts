import evaluationFixtures from '../../fixtures/prompt-evaluation.json';
import { describe, expect, it } from "vitest";
import { normalizeRuntime, type PromptId, type RuntimeInput } from "@/server/ai/core";

const base = { language: "id" as const, protectedTerms: ["API"], protectedCitations: [] };

const fixtures: Record<Exclude<PromptId, "P10_REPAIR">, RuntimeInput> = {
  P01_STANDARD_REWRITE: { ...base, sourceText: "Teks", strength: "light" },
  P02_ACADEMIC: { ...base, sourceText: "Teks", academicContext: "thesis", audience: null, length: "same" },
  P03_HUMANIZER: { ...base, sourceText: "Teks", humanizerContext: "academic", strength: "balanced", preservation: "conservative" },
  P04_PROFESSIONAL: { ...base, sourceText: "Teks", audience: "client", documentType: "email", length: "same" },
  P05_CREATIVE: { ...base, sourceText: "Teks", audience: "umum", creativeGoal: "natural", creativityStrength: "light" },
  P06_SIMPLIFY: { ...base, sourceText: "Teks", targetAudience: "umum", readingLevel: null, length: "same", outputFormat: "paragraph" },
  P07_INLINE_ALTERNATIVES: { ...base, selectedText: "Teks", contextBefore: null, contextAfter: null, action: "alternatives", activeMode: "standard" },
  P08_CUSTOM_TRANSFORM: { ...base, sourceText: "Teks", format: "paragraph", length: "same", audience: "umum", focus: ["clarity"], extraRequest: null },
};

describe("AI core runtime contract", () => {
  it.each(Object.entries(fixtures))("normalizes required controls for %s", (id, input) => {
    const runtime = normalizeRuntime(id as keyof typeof fixtures, { ...input, garbage: "must be dropped" } as RuntimeInput & { garbage: string });
    expect(runtime).toMatchObject({ language: "id", protected_terms: ["API"] });
    expect(runtime).not.toHaveProperty("garbage");
    expect(Object.values(runtime).every((value) => value !== undefined)).toBe(true);
  });

  it("accepts backend snake_case controls while keeping custom request fields", () => {
    const runtime = normalizeRuntime("P08_CUSTOM_TRANSFORM", {
      source_text: "Teks", language: "id", format: "bullets", length: "same", audience: "umum",
      focus: ["clarity"], extra_request: "Pertahankan istilah", protected_terms: ["API"], protected_citations: [],
      custom_request: { format: "bullets" },
    });
    expect(runtime).toMatchObject({ source_text: "Teks", format: "bullets", extra_request: "Pertahankan istilah", protected_terms: ["API"], custom_request: { format: "bullets" } });
  });
});

describe('offline evaluation fixture contracts',()=>{
  for(const fixture of evaluationFixtures)it(fixture.id,()=>{
    expect(()=>normalizeRuntime(fixture.promptId as PromptId,{...fixture.runtime,sourceText:fixture.sourceText,selectedText:fixture.sourceText,contextBefore:null,contextAfter:null} as RuntimeInput)).not.toThrow();
    expect(fixture.expected.meaning).toBeTruthy();expect(fixture.expected.facts).toBeTruthy();
  });
});
