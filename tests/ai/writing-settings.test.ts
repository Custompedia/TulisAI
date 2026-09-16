import { describe, expect, it } from "vitest";
import { AI_SCOPE_LIMIT, asMode, customConflict, defaults, detectLanguage, EXTRA_LIMIT, FOCUS_LIMIT, INLINE_LIMIT, modeFromPrompt, normalizeSettings, promptFor, runtimeControls, SELECTION_LIMIT } from "../../src/lib/writing/settings";
import { countSentences, repeatedWords, wordDelta } from "../../src/lib/editor/metrics";

describe("writing settings", () => {
  it("blocks conflicting customize choices before any AI call", () => {
    expect(customConflict({ ...defaults, format: "short_summary", length: "more_detailed" }, [])).toBe("summary-detail");
    expect(customConflict({ ...defaults, extra: "ubah Technology Acceptance Model jadi TAM" }, ["Technology Acceptance Model"])).toBe("locked-term");
    expect(customConflict({ ...defaults, extra: "fokus pada kesimpulan" }, ["TAM"])).toBeNull();
  });
  it("detects Indonesian and English and reports ambiguity", () => {
    expect(detectLanguage("Penelitian ini menunjukkan bahwa sistem yang digunakan tidak efektif.")).toBe("id");
    expect(detectLanguage("This study shows that the system is not effective for the users.")).toBe("en");
    expect(detectLanguage("OK 123")).toBeNull();
  });
  it("sends exactly the controls each prompt needs", () => {
    const base = { ...defaults, strength: "strong" as const, academic: "journal", context: "academic", preservation: "conservative", recipient: "vendor" as const, simplifyFor: "anak_sekolah" as const };
    expect(runtimeControls({ ...base, mode: "standard" }, "id")).toEqual({ language: "id", strength: "strong" });
    expect(runtimeControls({ ...base, mode: "academic" }, "id")).toEqual({ language: "id", academic_context: "journal" });
    expect(runtimeControls({ ...base, mode: "humanize" }, "en")).toEqual({ language: "en", strength: "strong", humanizer_context: "academic", preservation: "conservative" });
    expect(runtimeControls({ ...base, mode: "professional" }, "id")).toEqual({ language: "id", audience: "vendor" });
    expect(runtimeControls({ ...base, mode: "creative" }, "id")).toEqual({ language: "id", creativity_strength: "strong" });
    expect(runtimeControls({ ...base, mode: "simplify" }, "id")).toEqual({ language: "id", target_audience: "anak_sekolah" });
    expect(runtimeControls({ ...base, mode: "professional", customized: true, audience: "lecturer", format: "table", length: "shorter", focus: ["clarity"], extra: " Singkat " }, "id")).toEqual({ language: "id", audience: "vendor", custom_request: { format: "table", length: "shorter", audience: "lecturer", focus: ["clarity"], extra_request: "Singkat" } });
    expect(runtimeControls({ ...base, mode: "creative", customized: true }, "id", "alternatives")).toEqual({ language: "id", action: "alternatives" });
    for (const mode of ["standard", "academic", "humanize", "professional", "creative", "simplify"] as const) expect(JSON.stringify(runtimeControls({ ...base, mode }, "id"))).not.toMatch(/document_type|creative_goal|reading_level|custom_request/);
  });
  it("normalizes legacy stored preferences", () => {
    expect(normalizeSettings({ mode: "custom", format: "table", documentType: "email", readingLevel: "SMA", creativeGoal: "hangat" })).toEqual({ ...defaults, mode: "standard", format: "table", customized: true });
    expect(defaults.mode).toBe("humanize");
    expect(normalizeSettings({ mode: "academic", audience: "investor", recipient: "bos", simplifyFor: "anak sekolah" })).toMatchObject({ mode: "academic", audience: "general_public", recipient: "umum", simplifyFor: "umum", customized: false });
    expect(normalizeSettings({ recipient: "klien", simplifyFor: "pemula", audience: "client", focus: ["clarity", 3, "formality", "naturalness", "persuasiveness"] })).toMatchObject({ recipient: "klien", simplifyFor: "pemula", audience: "client", focus: ["clarity", "formality", "naturalness"] });
    expect(normalizeSettings(undefined)).toEqual(defaults);
    expect(asMode("custom")).toBe("standard"); expect(asMode("simplify")).toBe("simplify"); expect(asMode("other")).toBeNull();
    expect(modeFromPrompt("P03_HUMANIZER")).toBe("humanize");
    expect(modeFromPrompt("P08_CUSTOM_TRANSFORM")).toBe("standard");
    expect(Object.values(promptFor)).not.toContain("P08_CUSTOM_TRANSFORM");
  });
  it("exposes the v3 cost-safe limits", () => {
    expect({ EXTRA_LIMIT, FOCUS_LIMIT, INLINE_LIMIT, SELECTION_LIMIT, AI_SCOPE_LIMIT }).toEqual({ EXTRA_LIMIT: 500, FOCUS_LIMIT: 3, INLINE_LIMIT: 600, SELECTION_LIMIT: 5_000, AI_SCOPE_LIMIT: 20_000 });
  });
});

describe("local analytics", () => {
  it("counts sentences, repeated words and word deltas without AI", () => {
    expect(countSentences("Kalimat pertama. Kalimat kedua! Ketiga?")).toBe(3);
    expect(countSentences("")).toBe(0);
    expect(repeatedWords("sistem sistem sistem data data")).toEqual([{ word: "sistem", count: 3 }]);
    expect(wordDelta("satu dua tiga", "satu empat tiga lima")).toEqual({ added: 2, removed: 1 });
  });
});
