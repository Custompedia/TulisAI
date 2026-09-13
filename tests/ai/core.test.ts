import { describe, expect, it, vi } from "vitest";
import { getPromptDefinition, normalizeRuntime, validateGeneration, createOpenRouterProvider, PROMPTS, promptIds, promptHash } from "../../src/server/ai/core";

describe("prompt registry", () => {
  it("contains the v1 capabilities including on-demand P09", () => {
    expect(promptIds).toEqual(["P01_STANDARD_REWRITE", "P02_ACADEMIC", "P03_HUMANIZER", "P04_PROFESSIONAL", "P05_CREATIVE", "P06_SIMPLIFY", "P07_INLINE_ALTERNATIVES", "P08_CUSTOM_TRANSFORM", "P09_QUALITY_EVALUATION", "P10_REPAIR"]);
    expect(PROMPTS.P01_STANDARD_REWRITE).toContain("You are a bilingual rewriting editor.");
    expect(PROMPTS.P10_REPAIR).toContain("Repair only the protected-content violation.");
    expect(getPromptDefinition("P01_STANDARD_REWRITE").responseFormat).toMatchObject({ type: "json_schema" });
  });
  it("keeps the exact extracted v1 prompt baseline", async () => {
    const expected: Record<string, string> = { P09_QUALITY_EVALUATION: "5f5615ee698e772856096eddbc7e7d3e55ae0002f55bc41c2dab5efd3313aa4a", P01_STANDARD_REWRITE: "2b62017e27830326da65b68ab517e77e02a6fbacb98ef986b5f2f285ef1f16df", P02_ACADEMIC: "bf7d402c2eae2cbfee278b99b597664f11e5beda26baa58e8e698941e846e054", P03_HUMANIZER: "0baee13ca160f1f067432b50762bf21dec2f321afcbb7a75b0c148a9ab2c5fb8", P04_PROFESSIONAL: "2908e09bc065a072e6451086c298a329e303c4afeef27fbabde02c7c02eff41c", P05_CREATIVE: "afc58e80f89806c5bf9338670cc7f809b69279e2114c562e0c12a1596b5b4c32", P06_SIMPLIFY: "23c6545f448b78e706da97b114278c9fe6b0846b5e9ad7026c8a78c1ba5c7423", P07_INLINE_ALTERNATIVES: "4b93e12b78c50fc6c80ce3a5d5d07ff5215712a01b2a89075946372061b9772a", P08_CUSTOM_TRANSFORM: "226a013a8ddafa979e3ab39a39313d23a1fd5bf2a3de01ea3bd43a66fb6fc54c", P10_REPAIR: "ddee6c3458bf2e25ad2ef7d580ea4ea0f973cd63d176a349d65d69b7dd2044f0" };
    for (const id of promptIds) expect(await promptHash(id)).toBe(expected[id]);
  });
  it("normalizes trusted camel case input and validates enums", () => {
    expect(normalizeRuntime("P01_STANDARD_REWRITE", { sourceText: "Halo", language: "id", strength: "light", protectedTerms: [], protectedCitations: [] })).toMatchObject({ source_text: "Halo", language: "id", strength: "light" });
    expect(() => normalizeRuntime("P01_STANDARD_REWRITE", { sourceText: "", language: "id", strength: "light", protectedTerms: [], protectedCitations: [] })).toThrow();
  });
});

describe("deterministic response safety", () => {
  it("rejects unsafe P07 without repair", () => {
    expect(() => validateGeneration("P07_INLINE_ALTERNATIVES", "Technology Acceptance Model works", { alternatives: [{ text: "a" }, { text: "b" }], warnings: [] }, { protectedTerms: [] })).toThrow();
    expect(() => validateGeneration("P07_INLINE_ALTERNATIVES", "Technology Acceptance Model works", { alternatives: [{ text: "Technology Acceptance Model" }, { text: "b" }, { text: "c" }], warnings: [] }, { protectedTerms: ["Technology Acceptance Model"] })).toThrow();
  });
  it("adapts P03 output and protects multiplicity", () => {
    const result = validateGeneration("P03_HUMANIZER", "Davis (1989) memakai 2 metode", { humanized_text: "Davis (1989) memakai 2 metode", change_categories: [], warnings: [] }, { protectedTerms: [], protectedCitations: ["Davis (1989)"] });
    expect(result.transformed_text).toBe("Davis (1989) memakai 2 metode");
    expect(() => validateGeneration("P03_HUMANIZER", "Davis (1989) memakai 2 metode", { humanized_text: "Davis memakai 2 metode", change_categories: [], warnings: [] }, { protectedTerms: [], protectedCitations: ["Davis (1989)"] })).toThrow();
    expect(() => validateGeneration("P01_STANDARD_REWRITE", "x 🌏 x 🌏 10", { transformed_text: "x 🌏 10", change_categories: [], warnings: [] }, { protectedTerms: ["🌏"], protectedCitations: [] })).toThrow();
    expect(() => validateGeneration("P01_STANDARD_REWRITE", "x 10", { transformed_text: "x 10 11", change_categories: [], warnings: [] }, { protectedTerms: [], protectedCitations: [] })).toThrow();
    expect(() => validateGeneration("P01_STANDARD_REWRITE", "Davis (1989)", { transformed_text: "Davis (1989) dan Smith (2020)", change_categories: [], warnings: [] }, { protectedTerms: [], protectedCitations: [] })).toThrow();
  });
  it("permits exactly one P10 attempt", () => {
    expect(() => validateGeneration("P10_REPAIR", "x", { corrected_text: "x" }, {}, 0)).toThrow();
    expect(validateGeneration("P10_REPAIR", "Davis (1989) memakai 10 metode", { corrected_text: "Davis (1989) memakai 10 metode" }, { requiredProtectedTerms: [], requiredProtectedCitations: ["Davis (1989)"] }, 1)).toEqual({ corrected_text: "Davis (1989) memakai 10 metode" });
    expect(() => validateGeneration("P10_REPAIR", "Davis (1989) memakai 10 metode", { corrected_text: "Davis (1989) memakai 1 metode" }, { requiredProtectedTerms: [], requiredProtectedCitations: ["Davis (1989)"] }, 1)).toThrow();
  });
});

describe("bounded OpenRouter provider", () => {
  it("sends structured output with explicit privacy denial and parses usage", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: "req_1", choices: [{ message: { content: JSON.stringify({ transformed_text: "Halo", change_categories: [], warnings: [] }) } }], usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 } }), { status: 200, headers: { "content-type": "application/json" } }));
    const provider = createOpenRouterProvider({ apiKey: "test", model: "openai/gpt-5.6-luna", privacyMode: "deny", fetchImpl });
    const result = await provider.generate({ promptId: "P01_STANDARD_REWRITE", runtime: { language: "id", strength: "light", protected_terms: [], protected_citations: [] }, sourceText: "Halo", requestId: "r1" });
    expect(result).toMatchObject({ ok: true, usage: { totalTokens: 5, providerRequestId: "req_1" } });
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body).provider).toEqual({ data_collection: "deny" });
  });
  it("fails closed when privacy mode is not explicit", () => {
    expect(() => createOpenRouterProvider({ apiKey: "test", model: "x", privacyMode: "allow" as "deny" })).toThrow();
  });
  it("normalizes backend camel protected fields before provider comparison", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: "locked", choices: [{ message: { content: JSON.stringify({ transformed_text: "Technology Acceptance Model tetap", change_categories: [], warnings: [] }) } }], usage: {} }), { status: 200 }));
    const provider = createOpenRouterProvider({ apiKey: "test", model: "x", privacyMode: "deny", fetchImpl });
    const result = await provider.generate({ promptId: "P01_STANDARD_REWRITE", runtime: { language: "id", strength: "light", protectedTerms: ["Technology Acceptance Model"], protectedCitations: [] }, sourceText: "Technology Acceptance Model tetap", requestId: "locked" });
    expect(result.ok).toBe(true); expect(fetchImpl).toHaveBeenCalledOnce();
  });
  it("accepts P10 required protected arrays and rejects mismatches before fetch", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: "repair", choices: [{ message: { content: JSON.stringify({ corrected_text: "Davis (1989)" }) } }], usage: {} }), { status: 200 }));
    const provider = createOpenRouterProvider({ apiKey: "test", model: "x", privacyMode: "deny", fetchImpl });
    const runtime = { failedOutput: "Davis 1989", originalScope: "Davis (1989)", requiredProtectedTerms: [], requiredProtectedCitations: ["Davis (1989)"] };
    expect((await provider.generate({ promptId: "P10_REPAIR", runtime, sourceText: runtime.originalScope, requestId: "repair", protectedTerms: [], protectedCitations: ["Davis (1989)"], repairAttempt: 1 })).ok).toBe(true);
    expect((await provider.generate({ promptId: "P10_REPAIR", runtime, sourceText: runtime.originalScope, requestId: "repair-bad", protectedTerms: ["wrong"], protectedCitations: ["Davis (1989)"], repairAttempt: 1 })).ok).toBe(false);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });
});
