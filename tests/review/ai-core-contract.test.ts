import baseFixtures from '../../fixtures/prompt-evaluation.json';
import edgeFixtures from '../../fixtures/prompt-edge-cases.json';
import heldOutFixtures from '../../fixtures/prompt-held-out.json';
import { describe, expect, it } from "vitest";
import { normalizeRuntime, type PromptId, type RuntimeInput } from "@/server/ai/core";

const base = { language: "id" as const, protectedTerms: ["API"], protectedCitations: [] };

const fixtures: Record<Exclude<PromptId, "P10_REPAIR">, RuntimeInput> = {
  P01_STANDARD_REWRITE: { ...base, sourceText: "Teks", strength: "light" },
  P02_ACADEMIC: { ...base, sourceText: "Teks", academicContext: "thesis" },
  P03_HUMANIZER: { ...base, sourceText: "Teks", humanizerContext: "academic", strength: "balanced", preservation: "conservative" },
  P04_PROFESSIONAL: { ...base, sourceText: "Teks", audience: "klien" },
  P05_CREATIVE: { ...base, sourceText: "Teks", creativity_strength: "light" },
  P06_SIMPLIFY: { ...base, sourceText: "Teks", target_audience: "pemula" },
  P07_INLINE_ALTERNATIVES: { ...base, selectedText: "Teks", contextBefore: null, contextAfter: null, action: "alternatives" },
  P08_CUSTOM_TRANSFORM: { ...base, sourceText: "Teks", format: "paragraph", length: "same", audience: "umum", focus: ["clarity"], extraRequest: null },
};

describe("AI core runtime contract", () => {
  it.each(Object.entries(fixtures))("normalizes required controls for %s", (id, input) => {
    const runtime = normalizeRuntime(id as keyof typeof fixtures, { ...input, garbage: "must be dropped" } as RuntimeInput & { garbage: string });
    expect(runtime).toMatchObject({ language: "id", protected_terms: ["API"] });
    expect(runtime).not.toHaveProperty("garbage");
    expect(Object.values(runtime).every((value) => value !== undefined)).toBe(true);
  });

  it("accepts backend snake_case custom controls as a v3 request", () => {
    const runtime = normalizeRuntime("P01_STANDARD_REWRITE", {
      source_text: "Teks", language: "id", strength: "light", protected_terms: ["API"], protected_citations: [],
      custom_request: { format: "bullets", length: "same", audience: "client", focus: ["clarity"], extra_request: "Pertahankan istilah" },
    });
    expect(runtime).toMatchObject({ source_text: "Teks", strength: "light", protected_terms: ["API"], request: { format: "poin", length: "sama", audience: "klien", focus: ["clarity"], additional_instruction: "Pertahankan istilah" } });
  });
});

describe('offline evaluation fixture contracts',()=>{
  const evaluationFixtures=[...baseFixtures,...edgeFixtures,...heldOutFixtures] as Array<{id:string;promptId:string;sourceText:string;runtime:Record<string,unknown>;expected:{meaning:string;facts:string}}>;
  for(const fixture of evaluationFixtures)it(fixture.id,()=>{
    expect(()=>normalizeRuntime(fixture.promptId as PromptId,{...fixture.runtime,sourceText:fixture.sourceText,selectedText:fixture.sourceText,contextBefore:null,contextAfter:null} as RuntimeInput)).not.toThrow();
    expect(fixture.expected.meaning).toBeTruthy();expect(fixture.expected.facts).toBeTruthy();
  });
});
