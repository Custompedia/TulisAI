import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { EXTRA_LIMIT } from "../../src/lib/writing/settings";
import { addsIntensifier, buildMessages, buildSystemMessage, buildUserMessage, clipText, compileControlBlock, echoesContext, selectOptions, tidyText, validateProtectedContent, createOpenRouterProvider, exceedsPreservation, getPromptDefinition, normalizeRuntime, promptHash, PROMPT_VERSION, PROMPTS, promptIds, REASONING_EFFORT, validateGeneration } from "../../src/server/ai/core";
import { BASE, BASE_INLINE, BASE_READONLY, LANGUAGE_RULES, OUTPUT_LANGUAGE, P03_ACTIVE, P01, P01_LANGUAGE, P02, P02_LANGUAGE, P03, P03_LANGUAGE, P04, P04_LANGUAGE, P05, P05_LANGUAGE, P06, P06_LANGUAGE, P07, P07_LANGUAGE, P08_CONTROL_BLOCK, P09, P10 } from "../../src/server/ai/core/prompts";

const transform = (text: string, extra: Record<string, unknown> = {}) => ({ transformed_text: text, change_categories: [], warnings: [], no_change_needed: false, ...extra });

describe("prompt registry v5", () => {
  it("copies every named text block from systemprompt.md verbatim", () => {
    const blocks = Object.fromEntries([...readFileSync("systemprompt.md", "utf8").matchAll(/^```text ([\w.-]+)\n([\s\S]*?)\n```$/gm)].map((match) => [match[1], match[2]]));
    const registry: Record<string, string> = { BASE, BASE_INLINE, BASE_READONLY, "OUTPUT_LANGUAGE.id": OUTPUT_LANGUAGE.id, "OUTPUT_LANGUAGE.en": OUTPUT_LANGUAGE.en, P01, P02, P03, P04, P05, P06, P07, P08_CONTROL_BLOCK, P09, P10, PROMPT_IDS: promptIds.join("\n") };
    for (const [name, table] of Object.entries({ P01: P01_LANGUAGE, P02: P02_LANGUAGE, P03: P03_LANGUAGE, P04: P04_LANGUAGE, P05: P05_LANGUAGE, P06: P06_LANGUAGE, P07: P07_LANGUAGE })) { registry[`${name}.id`] = table.id; registry[`${name}.en`] = table.en; }
    expect(Object.keys(blocks).sort()).toEqual(Object.keys(registry).sort());
    for (const [name, text] of Object.entries(registry)) expect(blocks[name], name).toBe(text);
    expect(PROMPT_VERSION).toBe("v5");
  });
  it("keeps each prompt free of unresolved language placeholders after composition", () => {
    for (const id of promptIds) { const rules = LANGUAGE_RULES[id]; expect(PROMPTS[id].includes("{{language_rules}}"), id).toBe(Boolean(rules)); }
    expect(PROMPTS.P10_REPAIR).toBe(P10); expect(PROMPTS.P10_REPAIR).not.toContain("{{");
    expect(PROMPTS.P07_INLINE_ALTERNATIVES.startsWith(BASE_INLINE)).toBe(true);
    for (const text of [BASE, BASE_INLINE, BASE_READONLY, P01, P02, P03, P04, P05, P06, P07, P08_CONTROL_BLOCK, P09, P10]) expect(text).not.toMatch(/\bNEVER\b|\bMUST\b/);
  });
  it("composes templates and records reasoning effort per prompt", async () => {
    expect(PROMPTS.P09_QUALITY_EVALUATION.startsWith(BASE_READONLY)).toBe(true);
    expect(PROMPTS.P08_CUSTOM_TRANSFORM).toBe(`${BASE}\n\n${P01}\n\n${P08_CONTROL_BLOCK}`);
    expect(REASONING_EFFORT).toMatchObject({ P01_STANDARD_REWRITE: "none", P07_INLINE_ALTERNATIVES: "none", P08_CUSTOM_TRANSFORM: "low", P03_HUMANIZER: "low", P09_QUALITY_EVALUATION: "low", P10_REPAIR: "low" });
    expect(await promptHash("P01_STANDARD_REWRITE")).toMatch(/^[0-9a-f]{64}$/);
    expect(getPromptDefinition("P01_STANDARD_REWRITE").responseFormat).toMatchObject({ type: "json_schema" });
    expect(JSON.stringify(getPromptDefinition("P03_HUMANIZER").responseFormat)).not.toContain("maxLength");
  });
});

describe("enum mapping", () => {
  const base = { sourceText: "Teks", language: "id" as const, protectedTerms: [], protectedCitations: [] };
  it("maps UI values to the v3 enums defined in each prompt", () => {
    expect(normalizeRuntime("P02_ACADEMIC", { ...base, academicContext: "thesis" })).toMatchObject({ academic_context: "skripsi" });
    expect(normalizeRuntime("P02_ACADEMIC", { ...base, academic_context: "general_academic" })).toMatchObject({ academic_context: "umum" });
    expect(normalizeRuntime("P03_HUMANIZER", { ...base, strength: "light", humanizer_context: "professional", preservation: "conservative" })).toMatchObject({ humanizer_context: "profesional", strength: "light" });
    expect(normalizeRuntime("P05_CREATIVE", { ...base, strength: "strong" })).toMatchObject({ creativity_strength: "berani" });
    for (const recipient of ["atasan", "klien", "rekan", "vendor", "umum"]) expect(normalizeRuntime("P04_PROFESSIONAL", { ...base, audience: recipient })).toMatchObject({ audience: recipient });
    expect(normalizeRuntime("P04_PROFESSIONAL", { ...base, recipient: "vendor" })).toMatchObject({ audience: "vendor" });
    expect(normalizeRuntime("P04_PROFESSIONAL", { ...base, audience: "client" })).toMatchObject({ audience: "umum" });
    expect(normalizeRuntime("P04_PROFESSIONAL", { ...base, audience: "manajer proyek" })).toMatchObject({ audience: "umum" });
    expect(normalizeRuntime("P04_PROFESSIONAL", base)).toMatchObject({ audience: "umum" });
    const simplify = { anak_sekolah: "anak sekolah", umum: "umum", klien: "klien", pemula: "pemula" };
    for (const [key, audience] of Object.entries(simplify)) expect(normalizeRuntime("P06_SIMPLIFY", { ...base, target_audience: key })).toMatchObject({ audience });
    expect(normalizeRuntime("P06_SIMPLIFY", { ...base, simplifyFor: "anak_sekolah" })).toMatchObject({ audience: "anak sekolah" });
    expect(normalizeRuntime("P06_SIMPLIFY", { ...base, target_audience: "general_public" })).toMatchObject({ audience: "umum" });
    expect(normalizeRuntime("P05_CREATIVE", { ...base, creativity_strength: "balanced" })).toMatchObject({ creativity_strength: "sedang" });
    expect(normalizeRuntime("P03_HUMANIZER", { ...base, strength: "light", humanizer_context: "general", preservation: "flexible" })).toMatchObject({ preservation: "flexible" });
    const intents = { alternatives: "alternatif", paraphrase: "alternatif", shorter: "lebih singkat", clearer: "lebih jelas", formal: "lebih formal", natural: "lebih natural" };
    for (const [action, intent] of Object.entries(intents)) expect(normalizeRuntime("P07_INLINE_ALTERNATIVES", { ...base, selectedText: "teks", action })).toMatchObject({ intent, n: 3 });
    expect(normalizeRuntime("P09_QUALITY_EVALUATION", { ...base, mode: "academic" })).toMatchObject({ mode: "akademik" });
  });
  it("runs custom mode as P01 with a request, strong only for reshaping formats, and rejects unknown enums", () => {
    expect(normalizeRuntime("P08_CUSTOM_TRANSFORM", { ...base, strength: "strong", format: "paragraph", length: "same", focus: [] })).toMatchObject({ strength: "balanced" });
    const runtime = normalizeRuntime("P08_CUSTOM_TRANSFORM", { ...base, strength: "light", format: "table", length: "shorter", audience: "lecturer", focus: ["clarity"], extra_request: null });
    expect(runtime).toMatchObject({ strength: "strong", request: { format: "tabel", length: "lebih singkat", audience: "dosen", focus: ["clarity"], additional_instruction: "" } });
    expect(normalizeRuntime("P08_CUSTOM_TRANSFORM", runtime)).toEqual(runtime);
    expect(() => normalizeRuntime("P01_STANDARD_REWRITE", { ...base, strength: "invented" })).toThrow();
    expect(() => normalizeRuntime("P01_STANDARD_REWRITE", { ...base, sourceText: "", strength: "light" })).toThrow();
    expect(() => normalizeRuntime("P08_CUSTOM_TRANSFORM", { ...base, focus: ["clarity", "formality", "naturalness", "persuasiveness"] })).toThrow();
    expect(() => normalizeRuntime("P08_CUSTOM_TRANSFORM", { ...base, extra_request: "x".repeat(EXTRA_LIMIT + 1) })).toThrow();
  });
});

describe("message assembly", () => {
  const controls = { language: "id" as const, strength: "balanced", protectedTerms: ["API v2"], protectedCitations: [] };
  it("keeps the system prefix byte-stable and free of user text", () => {
    const first = normalizeRuntime("P01_STANDARD_REWRITE", { ...controls, sourceText: "Tim kami memakai API v2 rahasia-satu." });
    const second = normalizeRuntime("P01_STANDARD_REWRITE", { ...controls, sourceText: "Teks lain sama sekali rahasia-dua.", contextBefore: "Sebelum.", contextAfter: "Sesudah." });
    const system = buildSystemMessage("P01_STANDARD_REWRITE", first);
    expect(buildSystemMessage("P01_STANDARD_REWRITE", second)).toBe(system);
    expect(system.startsWith(`${BASE.replace("{{output_language}}", OUTPUT_LANGUAGE.id)}\n\nTASK: rewrite <input>`)).toBe(true);
    expect(system).toContain("STRENGTH balanced:\n- balanced = "); expect(system).not.toMatch(/^- (light|strong) = /m);
    expect(system).toContain('<example strength="balanced">'); expect(system).not.toContain('<example strength="light">');
    expect(system).not.toMatch(/rahasia|API v2|\{\{/);
    const english = buildSystemMessage("P01_STANDARD_REWRITE", normalizeRuntime("P01_STANDARD_REWRITE", { ...controls, language: "en", sourceText: "Text." }));
    expect(english).toContain(OUTPUT_LANGUAGE.en); expect(english).toContain(P01_LANGUAGE.en.split("\n")[1]!); expect(english).not.toContain("INDONESIAN"); expect(system).not.toContain("ENGLISH\n");
    expect(buildUserMessage("P01_STANDARD_REWRITE", second)).toBe("<protected>\nAPI v2\n</protected>\n<context_before>\nSebelum.\n</context_before>\n<input>\nTeks lain sama sekali rahasia-dua.\n</input>\n<context_after>\nSesudah.\n</context_after>");
  });
  it("uses selection for P07, input only for P09 and violations for P10", () => {
    const p07 = normalizeRuntime("P07_INLINE_ALTERNATIVES", { ...controls, protectedTerms: [], selectedText: "meninjau hasil", contextBefore: "Kami perlu ", action: "formal" });
    const [system, user] = buildMessages("P07_INLINE_ALTERNATIVES", p07);
    expect(system!.content).toContain("TASK: produce 3 replacement options"); expect(system!.content).toContain("INTENT lebih formal:\n- lebih formal = "); expect(system!.content).not.toContain("- lebih singkat = ");
    expect(system!.content.startsWith(BASE_INLINE.replace("{{output_language}}", OUTPUT_LANGUAGE.id))).toBe(true); expect(system!.content).toContain(P07_LANGUAGE.id.split("\n")[1]!); expect(system!.content).toContain('<example intent="lebih formal">'); expect(system!.content).not.toContain('<example intent="alternatif">'); expect(system!.content).not.toContain("transformed_text");
    expect(user!.content).toBe("<context_before>\nKami perlu \n</context_before>\n<selection>\nmeninjau hasil\n</selection>\n<in_place>\nKami perlu [[meninjau hasil]]\n</in_place>");
    const p09 = normalizeRuntime("P09_QUALITY_EVALUATION", { language: "en", sourceText: "Some text.", mode: "standard" });
    expect(buildSystemMessage("P09_QUALITY_EVALUATION", p09).startsWith(BASE_READONLY.replace("{{output_language}}", OUTPUT_LANGUAGE.en))).toBe(true);
    expect(buildUserMessage("P09_QUALITY_EVALUATION", p09)).toBe("<input>\nSome text.\n</input>");
    const p10 = normalizeRuntime("P10_REPAIR", { language: "id", failedOutput: "Total item.", originalScope: "Total 4 item.", requiredProtectedTerms: [], requiredProtectedCitations: [] });
    expect(buildSystemMessage("P10_REPAIR", p10)).toBe(P10);
    expect(buildUserMessage("P10_REPAIR", p10)).toBe("<violations>\nrequired: 4 | appeared instead: (missing)\n</violations>\n<failed_output>\nTotal item.\n</failed_output>\n<original>\nTotal 4 item.\n</original>");
  });
  it("substitutes every variable in every composed system message", () => {
    const common = { language: "id" as const, sourceText: "Teks", selectedText: "teks", protectedTerms: [], protectedCitations: [] };
    const inputs: Record<(typeof promptIds)[number], Record<string, unknown>> = {
      P01_STANDARD_REWRITE: { strength: "light" }, P02_ACADEMIC: { academic_context: "journal" }, P03_HUMANIZER: { strength: "strong", humanizer_context: "academic", preservation: "conservative" },
      P04_PROFESSIONAL: { audience: "atasan" }, P05_CREATIVE: { creativity_strength: "strong" }, P06_SIMPLIFY: { target_audience: "anak_sekolah" }, P07_INLINE_ALTERNATIVES: { action: "alternatives" },
      P08_CUSTOM_TRANSFORM: { format: "table", length: "shorter", audience: "client", focus: ["clarity"], extra_request: "Singkat" }, P09_QUALITY_EVALUATION: { mode: "academic" },
      P10_REPAIR: { failedOutput: "Teks", originalScope: "Teks", requiredProtectedTerms: [], requiredProtectedCitations: [] },
    };
    for (const id of promptIds) {
      const system = buildSystemMessage(id, normalizeRuntime(id, { ...common, ...inputs[id] }));
      expect(system, id).not.toContain("{{");
      const custom = normalizeRuntime(id, { ...common, ...inputs[id], custom_request: { format: "bullets", length: "more_detailed", audience: "lecturer", focus: ["clarity"], extra_request: "Catatan" } });
      expect(buildSystemMessage(id, custom), id).not.toContain("{{");
    }
    expect(buildSystemMessage("P07_INLINE_ALTERNATIVES", normalizeRuntime("P07_INLINE_ALTERNATIVES", { ...common, action: "paraphrase" }))).toContain("produce 3 replacement options");
    expect(buildSystemMessage("P06_SIMPLIFY", normalizeRuntime("P06_SIMPLIFY", { ...common, target_audience: "anak_sekolah" }))).toContain("so a reader in anak sekolah understands");
  });
  it("drops the request audience for modes that own an audience control", () => {
    const custom = { format: "paragraph", length: "same", audience: "lecturer", focus: [], extra_request: null };
    expect(normalizeRuntime("P04_PROFESSIONAL", { ...controls, sourceText: "Teks", audience: "klien", custom_request: custom }).request).not.toHaveProperty("audience");
    expect(normalizeRuntime("P06_SIMPLIFY", { ...controls, sourceText: "Teks", target_audience: "pemula", custom_request: custom }).request).not.toHaveProperty("audience");
    expect(normalizeRuntime("P02_ACADEMIC", { ...controls, sourceText: "Teks", academicContext: "journal", custom_request: custom }).request).toMatchObject({ audience: "dosen" });
    expect(buildSystemMessage("P04_PROFESSIONAL", normalizeRuntime("P04_PROFESSIONAL", { ...controls, sourceText: "Teks", audience: "klien", custom_request: custom }))).not.toContain("Audience:");
  });
  it("adds the control block only for customised requests", () => {
    const plain = normalizeRuntime("P02_ACADEMIC", { ...controls, sourceText: "Teks", academicContext: "journal" });
    expect(buildSystemMessage("P02_ACADEMIC", plain)).not.toContain("\n<request>\n");
    const custom = normalizeRuntime("P02_ACADEMIC", { ...controls, sourceText: "Teks", academicContext: "journal", custom_request: { format: "paragraph", length: "same", audience: "", focus: [], extra_request: null } });
    expect(buildSystemMessage("P02_ACADEMIC", custom).endsWith(`<request>\nLength: within 10% of the input length\n</request>\n\n${P08_CONTROL_BLOCK.split("\n\n")[1]}`)).toBe(true);
  });
  it("sends only the active option, its example, and the patterns of the active strength", () => {
    const humanizer = (strength: string) => buildSystemMessage("P03_HUMANIZER", normalizeRuntime("P03_HUMANIZER", { ...controls, sourceText: "Teks", strength, humanizerContext: "general", preservation: "balanced" }));
    const light = humanizer("light"); const strong = humanizer("strong");
    for (const number of [4, 10, 12]) { expect(P03_ACTIVE.light).not.toContain(number); expect(light).not.toMatch(new RegExp(`^${number}[.:] `, "m")); expect(strong).toMatch(new RegExp(`^${number}\\. `, "m")); }
    expect(light).toContain("REGISTER umum:\n- umum = "); expect(light).not.toContain("- akademik = "); expect(light).toContain('<example strength="light">'); expect(light).not.toContain('<example strength="strong">');
    for (const audience of ["atasan", "klien", "rekan", "vendor", "umum"]) { const system = buildSystemMessage("P04_PROFESSIONAL", normalizeRuntime("P04_PROFESSIONAL", { ...controls, sourceText: "Teks", audience })); expect(system, audience).toContain(`<example audience="${audience}">`); expect(system.match(/<example /g), audience).toHaveLength(1); }
    expect(selectOptions("HEAD {{mode}}:\n- a = one\n- b = two\nTAIL", { mode: "b" })).toBe("HEAD {{mode}}:\n- b = two\nTAIL");
    expect(selectOptions("HEAD {{mode}}:\n- a = one", {})).toBe("HEAD {{mode}}:\n- a = one");
  });
  it("compiles the control block, omitting empty fields and capping emphasis and author note", () => {
    const block = compileControlBlock({ format: "poin", focus: ["clarity", "formality", "naturalness", "persuasiveness"], additional_instruction: `<b>Tulis\nringkas</b> ${"a".repeat(EXTRA_LIMIT + 100)}` });
    expect(block).toContain("Format: bullet points, one item per line starting with '- '");
    expect(block).toContain("Emphasis: clarity, formality, naturalness\n");
    expect(block).not.toMatch(/Length:|Audience:|\{\{|none/);
    const note = block.match(/Author note: (.*)/)![1]!;
    expect(note.length).toBe(EXTRA_LIMIT); expect(note).not.toMatch(/[<>\n]/); expect(note.startsWith("bTulis ringkas/b")).toBe(true);
    expect(compileControlBlock({ format: "paragraf", focus: [], additional_instruction: " " })).toBe("");
  });
});

describe("deterministic response safety", () => {
  it("validates P03 transformed_text and protects multiplicity", () => {
    expect(validateGeneration("P03_HUMANIZER", "Davis (1989) memakai 2 metode", transform("Davis (1989) memakai 2 metode"), { protectedTerms: [], protectedCitations: ["Davis (1989)"] }).transformed_text).toBe("Davis (1989) memakai 2 metode");
    expect(() => validateGeneration("P03_HUMANIZER", "x", { humanized_text: "x", change_categories: [], warnings: [], no_change_needed: false }, {})).toThrow();
    expect(() => validateGeneration("P03_HUMANIZER", "Davis (1989) memakai 2 metode", transform("Davis memakai 2 metode"), { protectedTerms: [], protectedCitations: ["Davis (1989)"] })).toThrow();
    expect(() => validateGeneration("P01_STANDARD_REWRITE", "x 🌏 x 🌏 10", transform("x 🌏 10"), { protectedTerms: ["🌏"], protectedCitations: [] })).toThrow();
    expect(() => validateGeneration("P01_STANDARD_REWRITE", "x 10", transform("x 10 11"), {})).toThrow();
    expect(() => validateGeneration("P01_STANDARD_REWRITE", "Davis (1989)", transform("Davis (1989) dan Smith (2020)"), {})).toThrow();
  });
  it("clamps list lengths instead of rejecting", () => {
    const result = validateGeneration("P01_STANDARD_REWRITE", "Halo semua", transform("Halo semuanya", { change_categories: ["a", "b", "c", "d"], warnings: ["w".repeat(200)] }), {});
    expect(result.change_categories).toHaveLength(3); expect((result.warnings as string[])[0]).toHaveLength(160);
  });
  it("preserves P04 placeholders", () => {
    expect(() => validateGeneration("P04_PROFESSIONAL", "Rapat [tanggal] TBD dengan xxx.", transform("Rapat TBD dengan xxx."), {})).toThrow(/placeholder/);
    expect(validateGeneration("P04_PROFESSIONAL", "Rapat [tanggal] TBD dengan xxx.", transform("Rapat pada [tanggal] TBD bersama xxx."), {}).transformed_text).toContain("[tanggal]");
  });
  it("snaps a flagged near-copy back to the source and rejects a dishonest flag", () => {
    const source = "Satu dua tiga empat lima enam tujuh delapan sembilan sepuluh.";
    expect(validateGeneration("P01_STANDARD_REWRITE", source, transform(source, { no_change_needed: true }), {}).no_change_needed).toBe(true);
    expect(validateGeneration("P01_STANDARD_REWRITE", source, transform("Satu dua tiga empat lima enam tujuh delapan sembilan, sepuluh.", { no_change_needed: true }), {}).transformed_text).toBe(source);
    expect(() => validateGeneration("P01_STANDARD_REWRITE", source, transform("Tulisan yang sepenuhnya berbeda dari sumbernya.", { no_change_needed: true }), {})).toThrow(/no_change_needed/);
  });
  it("treats list markers as layout, relaxes multiplicity for condensed formats, and tidies deletion debris", () => {
    expect(validateProtectedContent("Matikan server, lalu pantau log 24 jam.", "1. Matikan server.\n2. Pantau log 24 jam.", [], []).valid).toBe(true);
    expect(validateProtectedContent("Ada 40 peserta. Dari 40 peserta, 12 lulus.", "Dari 40 peserta, 12 lulus.", [], []).valid).toBe(false);
    expect(validateProtectedContent("Ada 40 peserta. Dari 40 peserta, 12 lulus.", "Dari 40 peserta, 12 lulus.", [], [], true, false, true).valid).toBe(true);
    expect(validateGeneration("P06_SIMPLIFY", "Plan A costs $20 and includes email support for every single user account.", transform("| Plan | Cost |\n|---|---|\n| Plan A | $20 |"), { request: { format: "tabel", focus: [], additional_instruction: "" } }).transformed_text).toContain("| Plan A |");
    expect(tidyText("Omzet naik 18% setelah program, .\nSelesai . ")).toBe("Omzet naik 18% setelah program.\nSelesai.");
    expect(validateGeneration("P09_QUALITY_EVALUATION", "Ada 120 responden.", { clarity: { value: "tinggi", reason: "x" }, academic_fit: { value: "tidak_berlaku", reason: "x" }, naturalness: { value: "sedang", reason: "x" }, formality: { value: "rendah", reason: "x" } }, {})).toBeTruthy();
  });
  it("flags preservation ceilings per level", () => {
    const source = "a b c d e f g h i j"; const output = "a b c d e f g h i z";
    expect(exceedsPreservation(source, output, "conservative")).toBe(true);
    expect(exceedsPreservation(source, output, "balanced")).toBe(false);
    expect(exceedsPreservation(source, "a b c d e f g h y z", "balanced")).toBe(true);
    expect(exceedsPreservation(source, "a b c d e f g h y z", "flexible")).toBe(false);
  });
  it("filters P07 options by capitalisation and distinctness and rejects unsafe sets", () => {
    const option = (text: string, variation_level: string) => ({ text, variation_level });
    const result = validateGeneration("P07_INLINE_ALTERNATIVES", "meninjau hasil ini", { alternatives: [option("memeriksa hasil ini", "leksikal"), option("Memeriksa hasil tersebut", "struktur"), option("memeriksa hasil itu", "register"), option("mengkaji ulang hasil ini", "leksikal"), option("hasil ini diperiksa kembali dengan cermat", "panjang")], warnings: [] }, { protectedTerms: [] });
    expect((result.alternatives as Array<{ text: string }>).map((item) => item.text)).toEqual(["memeriksa hasil ini", "memeriksa hasil itu", "mengkaji ulang hasil ini", "hasil ini diperiksa kembali dengan cermat"]);
    const long = validateGeneration("P07_INLINE_ALTERNATIVES", "kami akan meninjau seluruh hasil survei ini besok", { alternatives: [option("kami akan memeriksa seluruh hasil survei ini besok", "leksikal"), option("kami akan mengkaji seluruh hasil survei ini besok", "leksikal")], warnings: [] }, {});
    expect(long.alternatives).toHaveLength(1);
    const guarded = validateGeneration("P07_INLINE_ALTERNATIVES", "bagus", { alternatives: [option("baik", "leksikal"), option("sangat baik", "register"), option("hasilnya memuaskan sekali", "struktur")], warnings: [] }, { contextBefore: "Menurut kami hasilnya ", contextAfter: " sekali." });
    expect((guarded.alternatives as Array<{ text: string }>).map((item) => item.text)).toEqual(["baik"]);
    expect(addsIntensifier("very good", "good")).toBe(true); expect(addsIntensifier("sangat baik", "sangat bagus")).toBe(false);
    expect(echoesContext("peneliti mengumpulkan data tersebut", "dikumpulkan peneliti", "Data tersebut ", " selama tiga bulan.")).toBe(true);
    expect(() => validateGeneration("P07_INLINE_ALTERNATIVES", "meninjau", { alternatives: [option("Memeriksa", "leksikal")], warnings: [] }, {})).toThrow();
    expect(() => validateGeneration("P07_INLINE_ALTERNATIVES", "Technology Acceptance Model works", { alternatives: [option("Technology Acceptance Model", "leksikal"), option("b", "struktur")], warnings: [] }, { protectedTerms: ["Technology Acceptance Model"] })).toThrow();
    expect(() => validateGeneration("P07_INLINE_ALTERNATIVES", "x", { alternatives: [], warnings: [] }, {})).toThrow();
  });
  it("permits exactly one P10 attempt", () => {
    const repaired = { corrected_text: "Davis (1989) memakai 10 metode", unrepairable_spans: [] };
    expect(() => validateGeneration("P10_REPAIR", "x", { corrected_text: "x", unrepairable_spans: [] }, {}, 0)).toThrow();
    expect(validateGeneration("P10_REPAIR", "Davis (1989) memakai 10 metode", repaired, { requiredProtectedTerms: [], requiredProtectedCitations: ["Davis (1989)"] }, 1)).toEqual(repaired);
    expect(() => validateGeneration("P10_REPAIR", "Davis (1989) memakai 10 metode", { ...repaired, corrected_text: "Davis (1989) memakai 1 metode" }, { requiredProtectedTerms: [], requiredProtectedCitations: ["Davis (1989)"] }, 1)).toThrow();
  });
  it("accepts banded quality values only", () => {
    const dim = (value: string) => ({ value, reason: "Kalimat pertama langsung menyebut tujuan." });
    const ok = { clarity: dim("tinggi"), academic_fit: dim("tidak_berlaku"), naturalness: dim("sedang"), formality: dim("rendah") };
    expect(validateGeneration("P09_QUALITY_EVALUATION", "x", ok, {})).toEqual(ok);
    expect(() => validateGeneration("P09_QUALITY_EVALUATION", "x", { ...ok, clarity: { score: 4, reason: "x" } }, {})).toThrow();
  });
});

describe("bounded OpenRouter provider", () => {
  const reply = (content: unknown, id = "req_1") => new Response(JSON.stringify({ id, choices: [{ message: { content: JSON.stringify(content) } }], usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5, cost: 0.0004 } }), { status: 200, headers: { "content-type": "application/json" } });
  it("sends tagged messages, reasoning effort, structured output and privacy denial", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(reply(transform("Halo")));
    const provider = createOpenRouterProvider({ apiKey: "test", model: "openai/gpt-5.6-luna", privacyMode: "deny", fetchImpl });
    const result = await provider.generate({ promptId: "P01_STANDARD_REWRITE", runtime: { language: "id", strength: "light", protected_terms: [], protected_citations: [] }, sourceText: "Halo", requestId: "r1" });
    expect(result).toMatchObject({ ok: true, usage: { totalTokens: 5, costUsd: 0.0004, providerRequestId: "req_1" } });
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(body.provider).toEqual({ data_collection: "deny" }); expect(body.reasoning).toEqual({ effort: "none" });
    expect(body.messages[0].content).not.toContain("Halo\n"); expect(body.messages[1].content).toBe("<input>\nHalo\n</input>");
  });
  it("fails closed when privacy mode is not explicit", () => {
    expect(() => createOpenRouterProvider({ apiKey: "test", model: "x", privacyMode: "allow" as "deny" })).toThrow();
  });
  it("normalizes backend camel protected fields before provider comparison", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(reply(transform("Technology Acceptance Model tetap"), "locked"));
    const provider = createOpenRouterProvider({ apiKey: "test", model: "x", privacyMode: "deny", fetchImpl });
    const result = await provider.generate({ promptId: "P01_STANDARD_REWRITE", runtime: { language: "id", strength: "light", protectedTerms: ["Technology Acceptance Model"], protectedCitations: [] }, sourceText: "Technology Acceptance Model tetap", requestId: "locked" });
    expect(result.ok).toBe(true); expect(fetchImpl).toHaveBeenCalledOnce();
  });
  it("accepts P10 required protected arrays and rejects mismatches before fetch", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(reply({ corrected_text: "Davis (1989)", unrepairable_spans: [] }, "repair"));
    const provider = createOpenRouterProvider({ apiKey: "test", model: "x", privacyMode: "deny", fetchImpl });
    const runtime = { language: "id", failedOutput: "Davis 1989", originalScope: "Davis (1989)", requiredProtectedTerms: [], requiredProtectedCitations: ["Davis (1989)"] };
    expect((await provider.generate({ promptId: "P10_REPAIR", runtime, sourceText: runtime.originalScope, requestId: "repair", protectedTerms: [], protectedCitations: ["Davis (1989)"], repairAttempt: 1 })).ok).toBe(true);
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body).reasoning).toEqual({ effort: "low" });
    expect((await provider.generate({ promptId: "P10_REPAIR", runtime, sourceText: runtime.originalScope, requestId: "repair-bad", protectedTerms: ["wrong"], protectedCitations: ["Davis (1989)"], repairAttempt: 1 })).ok).toBe(false);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });
});

describe('clipText', () => {
  it('keeps short labels and cuts long ones at a word boundary', () => {
    expect(clipText('kosakata', 40)).toBe('kosakata');
    expect(clipText('Penghapusan pengulangan dan penguatan bentuk aktif', 40)).toBe('Penghapusan pengulangan dan penguatan');
    expect(clipText('Supercalifragilisticexpialidociousandmorewords', 20)).toBe('Supercalifragilistic');
  });
});
