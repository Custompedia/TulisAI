import { z } from "zod";
import { changePercentage } from "@/lib/editor/metrics";
import { EXTRA_LIMIT, FOCUS_LIMIT, PRESERVATION_CEILING, SAMPLE_LIMIT } from "@/lib/writing/settings";
import { BASE, BASE_INLINE, BASE_READONLY, LANGUAGE_RULES, OUTPUT_LANGUAGE, P01, P02, P03, P04, P05, P06, P07, P03_ACTIVE, P08, P08_CONTROL_BLOCK, P09, P10, PROMPTS, PROMPT_VERSION, REASONING_EFFORT, type Language } from "./prompts";
import { responseSchemas, runtimeSchemas, titledResponseSchemas } from "./schemas";
import { compareNumericValues } from "./numeric";
import { sanitizeInstruction } from "@/lib/writing/instruction";
import { dropFragments, LIST_FORMATS, plainDashes, mergeWarnings as mergeWarningList, repairDrift, sampleEchoRuns, sampleEchoSeverity, simplifyLengthKept } from "./validators";
import { promptIds, type AIResponse, type ControlRequest, type PromptDefinition, type PromptId, type ProviderResult, type RuntimeInput } from "./types";

// Strict structured outputs reject string length keywords; lengths are clamped before zod parsing instead.
const strictSafe = (node: unknown): unknown => Array.isArray(node) ? node.map(strictSafe) : node && typeof node === "object" ? Object.fromEntries(Object.entries(node).filter(([key]) => key !== "minLength" && key !== "maxLength").map(([key, value]) => [key, strictSafe(value)])) : node;
const jsonSchema = (schema: z.ZodTypeAny) => ({ type: "json_schema", json_schema: { name: "ai_result", strict: true, schema: strictSafe(z.toJSONSchema(schema)) } });

// Only the first run of a brand-new notebook asks for a title, so every other call keeps the plain schema.
export const titleAware = (id: PromptId, wantsTitle: boolean) => (wantsTitle && titledResponseSchemas[id] ? titledResponseSchemas[id] : responseSchemas[id]) as z.ZodTypeAny;

export function getPromptDefinition(id: PromptId, wantsTitle = false): PromptDefinition {
  const schema = titleAware(id, wantsTitle);
  return { id, systemPrompt: PROMPTS[id], reasoningEffort: REASONING_EFFORT[id], outputSchema: schema as z.ZodType<AIResponse>, responseFormat: jsonSchema(schema) };
}

type Table = Record<string, string>;
const lookup = (table: Table, value: unknown) => typeof value === "string" && Object.hasOwn(table, value) ? table[value] : value;
// Values outside a prompt's v3 audience enum fall back to umum (general reader).
const audienceOf = (table: Table, allowed: readonly string[], value: unknown) => { const mapped = lookup(table, typeof value === "string" ? value.trim() : value); return typeof mapped === "string" && allowed.includes(mapped) ? mapped : typeof mapped === "string" && mapped ? "umum" : undefined; };
const P04_AUDIENCES = ["atasan", "klien", "rekan", "vendor", "umum"] as const;
const P06_AUDIENCES = ["anak sekolah", "umum", "klien", "pemula"] as const;
export const ENUM_MAP = {
  academic_context: { thesis: "skripsi", journal: "jurnal", general_academic: "umum" },
  humanizer_context: { academic: "akademik", professional: "profesional", general: "umum" },
  creativity_strength: { light: "ringan", balanced: "sedang", strong: "berani" },
  intent: { alternatives: "alternatif", paraphrase: "alternatif", shorter: "lebih singkat", clearer: "lebih jelas", formal: "lebih formal", natural: "lebih natural" },
  simplify_for: { anak_sekolah: "anak sekolah" },
  request_audience: { lecturer: "dosen", professional: "profesional", client: "klien", general_public: "umum" },
  format: { paragraph: "paragraf", bullets: "poin", numbered_list: "bernomor", table: "tabel", short_summary: "ringkasan", summary: "ringkasan", email: "email" },
  length: { shorter: "lebih singkat", same: "sama", more_detailed: "lebih detail" },
  mode: { standard: "standar", academic: "akademik", humanize: "humanize", professional: "profesional", creative: "kreatif", simplify: "sederhanakan" },
} satisfies Record<string, Table>;

const FORMAT_LINE: Table = { email: "an email in this order, each part on its own line: a greeting line addressed to the recipient named in <input>, or a neutral greeting when <input> names nobody; one opening sentence stating why you are writing; the body in short paragraphs, one topic each; one closing sentence built only from a request or next step already in <input>; a sign-off line followed by the sender name from <input>, or a [Nama] placeholder when <input> has none. Keep a greeting or sign-off <input> already has instead of adding a second one. The greeting line, the sign-off line, and that placeholder are the only details that may be added", poin: "bullet points, one item per line starting with '- ', wherever <input> lists items or parallel points, with any lead-in kept as a line above them; a continuous argument whose sentences depend on each other stays prose", bernomor: "a numbered list with exactly one action or item per numbered line: a sentence that joins two actions with a word such as 'then', 'lalu', or 'dan' becomes two lines. Content with no real sequence stays prose", tabel: "a markdown table whose columns come from distinctions already present in the text, with a header row that names each column in words", ringkasan: "a summary that keeps every claim, at roughly 40% of the input length" };
const LENGTH_LINE: Table = { "lebih singkat": "about 60-75% of the input length, with no claim dropped", sama: "within 10% of the input length", "lebih detail": "about 130-150% of the input length, expanding only what is already present" };
const AUDIENCE_LINE: Table = { dosen: "a thesis supervisor or journal reviewer", profesional: "a professional colleague", klien: "a client who is not a specialist", umum: "a general reader" };
const FOCUS_LABEL: Table = { clarity: "clarity", naturalness: "naturalness", formality: "formality", persuasiveness: "persuasiveness", remove_repetition: "removing repetition" };

// Keeps only the active "- value = ..." line under a header naming {{key}}, the <example key="value"> blocks for the active value, and the numbered lines a prompt lists as active, so each call carries one definition per option (IFScale, ManyIFEval).
export function selectOptions(template: string, values: Record<string, unknown>, activeNumbers?: ReadonlySet<number>): string {
  const lines = template.replace(/<example ([a-z_]+)="([^"]*)">[\s\S]*?<\/example>\n?/g, (block, key: string, value: string) => (values[key] === undefined || String(values[key]) === value ? block : "")).split("\n");
  const kept: string[] = []; let active: string | undefined;
  for (const line of lines) {
    const option = line.match(/^- ([^=]+?) = /);
    if (!option) { const key = line.match(/\{\{(\w+)\}\}/)?.[1]; active = key && values[key] !== undefined ? String(values[key]) : undefined; }
    const numbered = line.match(/^(\d+)[.:] /);
    if (option && active !== undefined && option[1] !== active) continue;
    if (numbered && activeNumbers && !activeNumbers.has(Number(numbered[1]))) continue;
    kept.push(line);
  }
  return kept.join("\n").replace(/\n+$/, "");
}

const fill = (template: string, values: Record<string, unknown>) => template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => { const value = values[key]; if (value === undefined || value === null || value === "") throw new Error(`missing prompt variable: ${key}`); return String(value); });

export function compileControlBlock(request: ControlRequest): string {
  const values: Record<string, string> = {
    format_line: FORMAT_LINE[request.format] ?? "", length_line: request.length ? LENGTH_LINE[request.length] ?? "" : "", audience_line: request.audience ? AUDIENCE_LINE[request.audience] ?? "" : "",
    focus_line: [...new Set(request.focus)].slice(0, FOCUS_LIMIT).map((item) => FOCUS_LABEL[item] ?? "").filter(Boolean).join(", "),
    additional_instruction: request.additional_instruction.replace(/[<>]/g, "").replace(/\s+/g, " ").trim().slice(0, EXTRA_LIMIT).trim(),
  };
  if (!Object.values(values).some(Boolean)) return "";
  const lines = P08_CONTROL_BLOCK.split("\n").filter((line) => { const key = line.match(/\{\{(\w+)\}\}/)?.[1]; return !key || values[key]; });
  return fill(lines.join("\n"), values);
}

const record = (value: unknown) => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;

// Same treatment as the author note: tags stripped, spacing tamed, hard cap; blank lines survive so the sample keeps its shape.
export const sanitizeSample = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined;
  const cleaned = value.replace(/[<>]/g, "").replace(/[ \t]+/g, " ").replace(/ ?\n ?/g, "\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, SAMPLE_LIMIT).trim();
  return cleaned || undefined;
};

export function normalizeRuntime(id: PromptId, input: RuntimeInput): Record<string, unknown> {
  const get = (...keys: string[]) => keys.map((key) => input[key]).find((value) => value !== undefined);
  const source = record(input.request) ?? record(get("customRequest", "custom_request")) ?? (id === "P08_CUSTOM_TRANSFORM" ? input : undefined);
  const request = source && {
    format: lookup(ENUM_MAP.format, source.format ?? "paragraph"), length: lookup(ENUM_MAP.length, source.length),
    audience: id === "P04_PROFESSIONAL" || id === "P06_SIMPLIFY" ? undefined : audienceOf(ENUM_MAP.request_audience, ["dosen", "profesional", "klien", "umum"], source.audience), focus: source.focus ?? [],
    additional_instruction: [source.additional_instruction, source.extra_request, source.extraRequest].find((value) => typeof value === "string") ?? "",
  };
  const candidate: Record<string, unknown> = {
    language: input.language, source_text: get("sourceText", "source_text"), selected_text: get("selectedText", "selected_text"),
    context_before: get("contextBefore", "context_before"), context_after: get("contextAfter", "context_after"),
    protected_terms: get("protectedTerms", "protected_terms"), protected_citations: get("protectedCitations", "protected_citations"),
    // A list, table, summary, or email has to move sentence boundaries, which only the strong level permits.
    strength: id === "P08_CUSTOM_TRANSFORM" ? (request && LIST_FORMATS.has(String(request.format)) ? "strong" : "balanced") : input.strength,
    academic_context: lookup(ENUM_MAP.academic_context, get("academicContext", "academic_context")),
    humanizer_context: lookup(ENUM_MAP.humanizer_context, get("humanizerContext", "humanizer_context")),
    preservation: input.preservation,
    audience: id === "P04_PROFESSIONAL" ? audienceOf({}, P04_AUDIENCES, get("recipient", "audience")) ?? "umum"
      : id === "P06_SIMPLIFY" ? audienceOf(ENUM_MAP.simplify_for, P06_AUDIENCES, get("simplifyFor", "simplify_for", "targetAudience", "target_audience", "audience")) ?? "umum" : undefined,
    creativity_strength: lookup(ENUM_MAP.creativity_strength, get("creativityStrength", "creativity_strength", "strength")),
    intent: lookup(ENUM_MAP.intent, get("intent", "action")), n: input.n,
    mode: lookup(ENUM_MAP.mode, get("mode", "context")),
    request: request && Object.fromEntries(Object.entries(request).filter(([, value]) => value !== undefined)),
    style_reference: id === "P07_INLINE_ALTERNATIVES" ? undefined : sanitizeSample(get("styleSample", "style_sample", "styleReference", "style_reference")),
    suggest_title: get("suggestTitle", "suggest_title") === true ? true : undefined,
    user_instruction: sanitizeInstruction(get("userInstruction", "user_instruction")),
    failed_output: get("failedOutput", "failed_output"), original_scope: get("originalScope", "original_scope"),
    required_protected_terms: get("requiredProtectedTerms", "required_protected_terms"), required_protected_citations: get("requiredProtectedCitations", "required_protected_citations"),
    locked_only: id === "P10_REPAIR" && get("lockedOnly", "locked_only") === true ? true : undefined,
  };
  const defined = Object.fromEntries(Object.entries(candidate).filter(([, value]) => value !== undefined));
  return runtimeSchemas[id].parse(defined) as Record<string, unknown>;
}

const CAPABILITY: Record<PromptId, string> = { P01_STANDARD_REWRITE: P01, P02_ACADEMIC: P02, P03_HUMANIZER: P03, P04_PROFESSIONAL: P04, P05_CREATIVE: P05, P06_SIMPLIFY: P06, P07_INLINE_ALTERNATIVES: P07, P08_CUSTOM_TRANSFORM: P08, P09_QUALITY_EVALUATION: P09, P10_REPAIR: P10 };

const BASE_OF: Partial<Record<PromptId, string>> = { P07_INLINE_ALTERNATIVES: BASE_INLINE, P08_CUSTOM_TRANSFORM: "", P09_QUALITY_EVALUATION: BASE_READONLY, P10_REPAIR: "" };
export const languageOf = (runtime: Record<string, unknown>): Language => runtime.language === "en" ? "en" : "id";
// Language blocks are chosen server-side so only the active language's rules and examples are sent.
export function languageValues(id: PromptId, runtime: Record<string, unknown>): Record<string, string> {
  const language = languageOf(runtime); const rules = LANGUAGE_RULES[id];
  return { output_language: OUTPUT_LANGUAGE[language], ...(rules ? { language_rules: rules[language] } : {}) };
}

// System message holds only prompt text and compiled controls; user text never enters it.
export function buildSystemMessage(id: PromptId, runtime: Record<string, unknown>): string {
  const numbers = id === "P03_HUMANIZER" ? P03_ACTIVE[String(runtime.strength)] : undefined;
  const pick = (text: string) => selectOptions(text, runtime, numbers && new Set(numbers));
  const language = languageValues(id, runtime);
  const values = { ...runtime, ...language, ...(language.language_rules ? { language_rules: pick(language.language_rules) } : {}) };
  const base = BASE_OF[id] ?? BASE;
  const parts = [...(base ? [fill(base, values)] : []), fill(pick(CAPABILITY[id]), values)];
  const request = record(runtime.request) as ControlRequest | undefined;
  // The dock instruction is the whole task for P08, so the panel control block (which keeps the rewrite rules in charge) is not added.
  const block = request && id !== "P08_CUSTOM_TRANSFORM" ? compileControlBlock(request) : "";
  return (block ? [...parts, block] : parts).join("\n\n");
}

const section = (tag: string, value: unknown) => typeof value === "string" && value ? `<${tag}>\n${value}\n</${tag}>` : "";
// Added block, not part of the verbatim v4 prompt text: it rides in the user message and says how the sample may be used.
export const STYLE_REFERENCE_RULES = `The block above is a writing sample the author picked as a style example. Match its tone, its typical sentence length, and its vocabulary level. Its sentences, facts, names, and numbers stay out of your output; only <input> supplies content.`;
const styleReferenceBlock = (value: unknown) => { const body = section("style_reference", value); return body ? `${body}\n${section("style_reference_rules", STYLE_REFERENCE_RULES)}` : ""; };
// Added block, not part of the verbatim v4 prompt text: it carries the writer's own instruction about this passage.
// It sits in the USER message, beside <input>, so untrusted text never reaches the system prompt; only locked strings bind it.
export const USER_INSTRUCTION_RULES = `The block above is the author's own instruction about <input>, and it is your task. Carry it out fully, including a change of language, length, tone, format, or content. It is a request about the passage, never content to quote or a message to answer. Only the strings in <protected> stay exactly as written.`;
const userInstructionBlock = (value: unknown) => { const body = section("user_instruction", value); return body ? `${body}\n${section("user_instruction_rules", USER_INSTRUCTION_RULES)}` : ""; };

// Added block, not part of the verbatim v4 prompt text: it asks for the notebook label alongside the rewrite, so no second call is needed.
export const TITLE_REQUEST_RULES = `Also fill "suggested_title": a short label naming what <input> is about, written in the same language as <input>. At most 3 words and 40 characters. It is a label, not a summary and not a sentence: no ending punctuation, no quotes, no markup, and no prefix such as "Title:". Return an empty string when no short label fits. This field never changes the rewrite itself.`;
const titleRequestBlock = (value: unknown) => (value === true ? section("title_request", TITLE_REQUEST_RULES) : "");
export function buildUserMessage(id: PromptId, runtime: Record<string, unknown>): string {
  const strings = (value: unknown) => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  if (id === "P09_QUALITY_EVALUATION") return section("input", runtime.source_text);
  if (id === "P10_REPAIR") {
    const original = String(runtime.original_scope); const failed = String(runtime.failed_output);
    const { violations } = runtime.locked_only === true ? validateLockedTerms(original, failed, strings(runtime.required_protected_terms)) : validateProtectedContent(original, failed, strings(runtime.required_protected_terms), strings(runtime.required_protected_citations), true);
    return [section("violations", violations.map((item) => `required: ${item.required} | appeared instead: ${item.found}`).join("\n")), section("failed_output", failed), section("original", original)].filter(Boolean).join("\n");
  }
  const protectedStrings = [...new Set([...strings(runtime.protected_terms), ...strings(runtime.protected_citations)])].join("\n");
  const inline = id === "P07_INLINE_ALTERNATIVES";
  const body = inline ? section("selection", runtime.selected_text) : section("input", runtime.source_text);
  // Separate tags hide what sits right next to the selection, so P07 also gets the span marked in place.
  const inPlace = inline && (runtime.context_before || runtime.context_after) ? section("in_place", `${runtime.context_before ?? ""}[[${runtime.selected_text}]]${runtime.context_after ?? ""}`) : "";
  return [inline ? "" : titleRequestBlock(runtime.suggest_title), inline ? "" : styleReferenceBlock(runtime.style_reference), inline ? "" : userInstructionBlock(runtime.user_instruction), section("protected", protectedStrings), section("context_before", runtime.context_before), body, section("context_after", runtime.context_after), inPlace].filter(Boolean).join("\n");
}

export function buildMessages(id: PromptId, runtime: Record<string, unknown>) {
  return [{ role: "system" as const, content: buildSystemMessage(id, runtime) }, { role: "user" as const, content: buildUserMessage(id, runtime) }];
}

// Cuts an over-long label at the last whole word so a clamped value never reads as a broken fragment.
// Turns an identifier-shaped label ("academic_style") back into words so the preview never shows a raw key.
export function humanizeLabel(value: string): string {
  const spaced = value.replace(/[_\-]+/g, " ").replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/\s+/g, " ").trim();
  return spaced === spaced.toLowerCase() || spaced === value ? spaced : spaced.toLowerCase();
}
export function clipText(value: string, characters: number): string {
  if (value.length <= characters) return value;
  const cut = value.slice(0, characters);
  const space = cut.lastIndexOf(" ");
  return (space >= Math.ceil(characters * 0.5) ? cut.slice(0, space) : cut).replace(/[\s,;:.\-–—]+$/u, "");
}
const clampList = (value: unknown, items: number, characters: number, tidy: (text: string) => string = (text) => text) => Array.isArray(value) ? value.slice(0, items).map((item) => typeof item === "string" ? clipText(tidy(item), characters) : item) : value;
function clampResponse(value: unknown): unknown {
  const result = record(value); if (!result) return value;
  const clamped = { ...result };
  if ("warnings" in clamped) clamped.warnings = clampList(clamped.warnings, 3, 160);
  if ("change_categories" in clamped) clamped.change_categories = clampList(clamped.change_categories, 3, 40, humanizeLabel);
  if (typeof clamped.suggested_title === "string") clamped.suggested_title = clamped.suggested_title.slice(0, 200);
  if (Array.isArray(clamped.alternatives)) clamped.alternatives = clamped.alternatives.slice(0, 5);
  return clamped;
}

// Debris a deletion leaves behind: trailing spaces, a space before a full stop, or a comma stranded before one.
export const tidyText = (text: string) => text.split("\n").map((line) => line.replace(/,\s*\.(?=\s|$)/g, ".").replace(/[ \t]+\.(?=\s|$)/g, ".").replace(/[ \t]+$/, "")).join("\n").trim();

export function validateAIResponse(id: PromptId, value: unknown, wantsTitle = false): AIResponse {
  const parsed = titleAware(id, wantsTitle).parse(clampResponse(value)) as AIResponse;
  if (typeof parsed.transformed_text === "string") parsed.transformed_text = tidyText(parsed.transformed_text);
  if (id === "P07_INLINE_ALTERNATIVES") {
    if ((parsed.alternatives as Array<{ text: string }>).some((option) => !option.text.trim() || option.text.length > 200000)) throw new Error("P07 alternatives cannot be empty");
    return parsed;
  }
  if (id === "P09_QUALITY_EVALUATION") return parsed;
  const text = String(parsed.transformed_text ?? parsed.corrected_text ?? "");
  if (text.trim().length === 0 || text.length > 200000) throw new Error("AI output cannot be empty");
  return parsed;
}

const tokenSet = (text: string) => new Set(text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []);
// Near-duplicate: token Jaccard >= 0.8 or a single substituted word, for options of six words or more; in a shorter span one word is the whole difference, so only identical token sets count.
const NEAR_DUPLICATE_MIN_WORDS = 6;
export function nearDuplicate(left: string, right: string): boolean {
  const a = tokenSet(left); const b = tokenSet(right); let shared = 0;
  for (const token of a) if (b.has(token)) shared++;
  const union = a.size + b.size - shared; if (!union) return true;
  if (Math.min(a.size, b.size) < NEAR_DUPLICATE_MIN_WORDS) return shared === union;
  return shared / union >= 0.8 || (a.size === b.size && union - shared <= 2);
}
const wordsOf = (text: unknown) => (typeof text === "string" ? text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [] : []);
// An option that repeats the two words touching the selection was written as a whole sentence, not as a replacement span.
export function echoesContext(option: string, selection: string, before: unknown, after: unknown): boolean {
  const inOption = wordsOf(option).join(" "); const inSelection = wordsOf(selection).join(" ");
  return [wordsOf(before).slice(-2), wordsOf(after).slice(0, 2)].some((edge) => edge.length === 2 && inOption.includes(edge.join(" ")) && !inSelection.includes(edge.join(" ")));
}
const INTENSIFIERS = new Set(["sangat", "amat", "sekali", "banget", "sungguh", "terlalu", "very", "really", "extremely", "highly", "truly"]);
// Meaning guard: an option may not add an intensifier the selection does not have.
export const addsIntensifier = (option: string, selection: string) => { const had = new Set(wordsOf(selection)); return wordsOf(option).some((word) => INTENSIFIERS.has(word) && !had.has(word)); };
const letterCase = (text: string) => { const first = text.trimStart().charAt(0); return first !== first.toLowerCase() ? "upper" : first !== first.toUpperCase() ? "lower" : null; };
export const capitalisationMatches = (selection: string, option: string) => { const expected = letterCase(selection); const actual = letterCase(option); return !expected || !actual || expected === actual; };

// Request format and length in v3 terms, from a normalized runtime or raw UI controls.
export function requestOf(id: PromptId, runtime: RuntimeInput): { format?: string; length?: string } | undefined {
  const source = record(runtime.request) ?? record(runtime.custom_request) ?? record(runtime.customRequest) ?? (id === "P08_CUSTOM_TRANSFORM" ? runtime : undefined);
  if (!source) return undefined;
  const format = lookup(ENUM_MAP.format, source.format); const length = lookup(ENUM_MAP.length, source.length);
  return { ...(typeof format === "string" ? { format } : {}), ...(typeof length === "string" ? { length } : {}) };
}

const REWRITES = new Set<PromptId>(["P01_STANDARD_REWRITE", "P02_ACADEMIC", "P03_HUMANIZER", "P04_PROFESSIONAL", "P05_CREATIVE", "P06_SIMPLIFY", "P08_CUSTOM_TRANSFORM"]);
// Hard structural checks a protected-content repair cannot fix.
export function structuralErrors(id: PromptId, original: string, output: string, request?: { format?: string; length?: string }): string[] {
  if (!REWRITES.has(id)) return [];
  const errors: string[] = [];
  // A list, table, summary, or shorter-length request legitimately drops words, so the summarisation guard steps aside.
  const reshaped = Boolean(request?.format && LIST_FORMATS.has(request.format)) || request?.length === "lebih singkat";
  if (id === "P06_SIMPLIFY" && !reshaped && !simplifyLengthKept(original, output)) errors.push("simplified output is shorter than 85% of the input");
  return errors;
}

export const NO_CHANGE_DRIFT = 10;
export const snapsToSource = (original: string, output: string) => changePercentage(original, output) <= NO_CHANGE_DRIFT;
export { PRESERVATION_CEILING } from "@/lib/writing/settings";
export const exceedsPreservation = (original: string, output: string, preservation: unknown) => changePercentage(original, output) > (PRESERVATION_CEILING[String(preservation)] ?? 30);

export function validateGeneration(id: PromptId, original: string, value: unknown, runtime: RuntimeInput, repairAttempt = 0): AIResponse {
  if (id === "P10_REPAIR" && repairAttempt !== 1) throw new Error("P10 may run only as the single repair attempt");
  if (id !== "P10_REPAIR" && repairAttempt !== 0) throw new Error("repair attempt requires P10");
  const parsed = validateAIResponse(id, value);
  if (id === "P09_QUALITY_EVALUATION") return parsed;
  const list = (...values: unknown[]) => (values.find((item) => item !== undefined) ?? []) as string[];
  if (id === "P10_REPAIR") {
    const requiredCitations = list(runtime.requiredProtectedCitations, runtime.required_protected_citations);
    const requiredTerms = list(runtime.requiredProtectedTerms, runtime.required_protected_terms);
    const corrected = String(parsed.corrected_text ?? "");
    // A P08 repair restores locked terms only: the instruction was free to change numbers and citations.
    const lockedOnly = runtime.lockedOnly === true || runtime.locked_only === true;
    const verify = (text: string, terms: string[]) => lockedOnly ? validateLockedTerms(original, text, terms) : validateProtectedContent(original, text, terms, requiredCitations, true);
    const check = verify(corrected, [...requiredTerms, ...requiredCitations]);
    if (!check.valid) throw rejectionOf(check.violations, check.errors);
    const failed = runtime.failedOutput ?? runtime.failed_output;
    if (typeof failed === "string") {
      const drift = repairDrift(failed, corrected, verify(failed, requiredTerms).violations);
      if (drift.length) throw new Error(drift.join("; "));
    }
    return parsed;
  }
  const protectedTerms = list(runtime.protectedTerms, runtime.protected_terms);
  const protectedCitations = list(runtime.protectedCitations, runtime.protected_citations);
  if (id === "P07_INLINE_ALTERNATIVES") {
    const options = parsed.alternatives as Array<{ text: string; variation_level: string }>;
    const before = runtime.contextBefore ?? runtime.context_before; const after = runtime.contextAfter ?? runtime.context_after;
    const safe = options.filter((option) => !echoesContext(option.text, original, before, after) && !addsIntensifier(option.text, original) && !protectedTerms.some((term) => option.text.trim() === term.trim()) && validateProtectedContent(original, option.text, protectedTerms, protectedCitations, true).valid);
    const kept: typeof options = [];
    for (const option of safe) if (capitalisationMatches(original, option.text) && !kept.some((other) => nearDuplicate(other.text, option.text))) kept.push(option);
    if (!kept.length) throw new Error("P07 returned no distinct alternatives");
    return { ...parsed, alternatives: kept };
  }
  // A flagged result that drifts by a comma is snapped back to the source; one that was really rewritten is a dishonest flag.
  if (parsed.no_change_needed === true) { if (!snapsToSource(original, String(parsed.transformed_text ?? ""))) throw new Error("no_change_needed was set but the text changed"); return { ...parsed, transformed_text: original }; }
  const cleaned = plainDashes(original, String(parsed.transformed_text ?? ""));
  const text = id === "P03_HUMANIZER" ? dropFragments(original, cleaned) : cleaned;
  const sample = [runtime.style_reference, runtime.styleSample, runtime.style_sample].find((value) => typeof value === "string");
  let echoWarning: string | null = null;
  if (typeof sample === "string") {
    const runs = sampleEchoRuns(sample, original, text); const severity = sampleEchoSeverity(runs);
    if (severity === "reject") throw new OutputRejected(`style sample copied verbatim: ${runs.join(" | ")}`, "style", runs[0]);
    if (severity === "warn") echoWarning = runtime.language === "en" ? `One phrase resembles the style sample: "${runs[0]}".` : `Satu frasa mirip contoh gaya: "${runs[0]}".`;
  }
  const check = id === "P08_CUSTOM_TRANSFORM" ? validateLockedTerms(original, text, protectedTerms) : validateProtectedContent(original, text, protectedTerms, protectedCitations, true, id === "P04_PROFESSIONAL", isCondensed(requestOf(id, runtime)));
  if (!check.valid) throw rejectionOf(check.violations, check.errors);
  const structure = structuralErrors(id, original, text, requestOf(id, runtime));
  if (structure.length) throw new OutputRejected(structure.join("; "), "structure");
  return { ...parsed, transformed_text: text, ...(echoWarning ? { warnings: mergeWarningList(parsed.warnings, [echoWarning]) } : {}) };
}

const multiset = (tokens: string[]) => tokens.reduce((map, token) => map.set(token, (map.get(token) ?? 0) + 1), new Map<string, number>());
const count = (haystack: string, needle: string) => needle ? haystack.split(needle).length - 1 : 0;
// Numbers are compared by value in ./numeric: notation, list markers and how often a figure is restated are not content.
const citationTokens = (text: string): string[] => text.match(/(?:\b[A-Z][A-Za-zÀ-ÿ'’-]+(?:\s+et al\.)?\s*\(\d{4}[a-z]?\)|\([A-Z][A-Za-zÀ-ÿ'’-]+(?:\s+et al\.)?,\s*\d{4}[a-z]?\))/gu) ?? [];
export const placeholderTokens = (text: string) => text.match(/\[[^\[\]\n]{1,40}\]|\bTBD\b|\b[xX]{3,}\b/g) ?? [];

export type ViolationKind = "term" | "citation" | "number" | "placeholder";
export type Violation = { required: string; found: string; kind: ViolationKind };
export type RejectionCause = ViolationKind | "style" | "structure" | "other";
// Carries why an output was refused so the API can name the cause instead of one message for every case.
// The message stays exactly what it used to be, so existing assertions and the ledger reason are unchanged.
export class OutputRejected extends Error {
  constructor(message: string, readonly cause: RejectionCause, readonly token?: string) { super(message); this.name = "OutputRejected"; }
}
export const rejectionOf = (violations: Violation[], errors: string[]): OutputRejected => {
  const first = violations[0];
  return new OutputRejected(errors.join("; "), first?.kind ?? "other", first ? (first.found === "(missing)" ? first.required : first.found) : undefined);
};

// condensed: a summary or shorter-length request may state a repeated number or term once, so presence is compared instead of multiplicity.
export const isCondensed = (request?: { format?: string; length?: string }) => request?.format === "ringkasan" || request?.length === "lebih singkat";
export function validateProtectedContent(original: string, output: string, protectedTerms: string[], protectedCitations: string[], checkNumbers = true, checkPlaceholders = false, condensed = false, checkCitations = true) {
  const errors: string[] = []; const violations: Violation[] = [];
  const missing = (label: string, token: string, kind: ViolationKind) => { errors.push(`${label}: ${token}`); violations.push({ required: token, found: "(missing)", kind }); };
  const added = (label: string, token: string, kind: ViolationKind) => { errors.push(`new ${label}: ${token}`); violations.push({ required: "(not in original)", found: token, kind }); };
  const compare = (label: string, kind: ViolationKind, expected: Map<string, number>, actual: Map<string, number>, reportMissing: boolean) => {
    if (reportMissing) for (const [token, amount] of expected) if ((actual.get(token) ?? 0) < (condensed ? 1 : amount)) missing(`${label} missing`, token, kind);
    for (const [token, amount] of actual) if (amount > (expected.get(token) ?? 0)) added(label, token, kind);
  };
  const citationSet = new Set(protectedCitations);
  for (const term of [...protectedTerms, ...protectedCitations]) if (count(original, term) > 0 && count(output, term) < (condensed ? 1 : count(original, term))) missing("protected span missing", term, citationSet.has(term) ? "citation" : "term");
  if (checkNumbers) {
    // Value comparison, so a dropped or invented figure is reported while a re-notated or restated one is not.
    const diff = compareNumericValues(original, output);
    for (const token of diff.dropped) missing("numeric value missing", token.raw, "number");
    for (const token of diff.invented) added("numeric value", token.raw, "number");
  }
  if (checkCitations) compare("citation-shaped text", "citation", multiset(citationTokens(original)), multiset(citationTokens(output)), false);
  if (checkPlaceholders) for (const [token, amount] of multiset(placeholderTokens(original))) if (count(output, token) < amount) missing("placeholder missing", token, "placeholder");
  return { valid: errors.length === 0, errors, violations };
}

// A dock instruction may change anything it asks for; only terms the author locked must survive, at least once.
export const validateLockedTerms = (original: string, output: string, terms: string[]) => validateProtectedContent(original, output, terms, [], false, false, true, false);

export async function promptHash(id: PromptId) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(PROMPTS[id]));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export type OpenRouterOptions = { apiKey: string; model: string; endpoint?: string; timeoutMs?: number; maxResponseBytes?: number; fetchImpl?: typeof fetch; privacyMode: "deny" };
export function createOpenRouterProvider(options: OpenRouterOptions) {
  if (options.privacyMode !== "deny") throw new Error("OpenRouter data collection must be explicitly denied");
  const endpoint = options.endpoint ?? "https://openrouter.ai/api/v1/chat/completions";
  const timeoutMs = options.timeoutMs ?? 30_000;
  const maxBytes = options.maxResponseBytes ?? 2_000_000;
  const fetchImpl = options.fetchImpl ?? fetch;
  return { async generate(args: { promptId: PromptId; runtime: Record<string, unknown>; sourceText: string; requestId: string; protectedTerms?: string[]; protectedCitations?: string[]; repairAttempt?: number }): Promise<ProviderResult> {
    let runtime: Record<string, unknown>; let messages: ReturnType<typeof buildMessages>;
    try {
      const trustedInput = { ...args.runtime, ...(args.promptId === "P07_INLINE_ALTERNATIVES" ? { selectedText: args.sourceText } : {}), ...(args.promptId === "P10_REPAIR" ? {} : { sourceText: args.sourceText }) } as RuntimeInput;
      runtime = normalizeRuntime(args.promptId, trustedInput); messages = buildMessages(args.promptId, runtime);
    } catch { return { ok: false, error: "invalid_provider_response" }; }
    const runtimeTerms = (runtime.protected_terms ?? runtime.required_protected_terms ?? []) as string[];
    const runtimeCitations = (runtime.protected_citations ?? runtime.required_protected_citations ?? []) as string[];
    if (args.protectedTerms && JSON.stringify(args.protectedTerms) !== JSON.stringify(runtimeTerms)) return { ok: false, error: "invalid_provider_response" };
    if (args.protectedCitations && JSON.stringify(args.protectedCitations) !== JSON.stringify(runtimeCitations)) return { ok: false, error: "invalid_provider_response" };
    const wantsTitle = runtime.suggest_title === true;
    const definition = getPromptDefinition(args.promptId, wantsTitle);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      const response = await fetchImpl(endpoint, { method: "POST", headers: { Authorization: `Bearer ${options.apiKey}`, "Content-Type": "application/json", "X-Title": "AI Writing Workspace" }, body: JSON.stringify({ model: options.model, messages, response_format: definition.responseFormat, reasoning: { effort: definition.reasoningEffort }, provider: { data_collection: "deny" }, usage: { include: true }, stream: false }), signal: controller.signal });
      if (!response.ok) return { ok: false, error: "http_error", status: response.status };
      if (!response.body) return { ok: false, error: "invalid_provider_response" };
      reader = response.body.getReader(); const chunks: Uint8Array[] = []; let total = 0;
      while (true) { const part = await reader.read(); if (part.done) break; total += part.value.byteLength; if (total > maxBytes) { await reader.cancel(); return { ok: false, error: "response_too_large" }; } chunks.push(part.value); }
      const joined = new Uint8Array(total); let offset = 0; for (const chunk of chunks) { joined.set(chunk, offset); offset += chunk.byteLength; }
      const body = new TextDecoder().decode(joined); let json: unknown;
      try { json = JSON.parse(body); } catch { return { ok: false, error: "invalid_json" }; }
      if (!json || typeof json !== "object") return { ok: false, error: "invalid_provider_response" };
      const record = json as { choices?: Array<{ message?: { content?: unknown }; finish_reason?: string }>; usage?: Record<string, unknown>; id?: string };
      const choice = record.choices?.[0]; const content = choice?.message?.content; if (choice?.finish_reason === "length") return { ok: false, error: "invalid_provider_response", usage: usageOf(record) };
      if (typeof content !== "string") return { ok: false, error: "invalid_provider_response", usage: usageOf(record) };
      let parsed: AIResponse; try { parsed = validateAIResponse(args.promptId, JSON.parse(content), wantsTitle); } catch { return { ok: false, error: "invalid_provider_response", usage: usageOf(json) }; }
      return { ok: true, response: parsed, usage: { ...usageOf(record), providerRequestId: record.id } };
    } catch (error) { return { ok: false, error: error instanceof DOMException && error.name === "AbortError" ? "timeout" : "network_error" }; }
    finally { clearTimeout(timer); reader?.releaseLock(); }
  } };
}
function usageOf(value: { usage?: Record<string, unknown> }) { return { inputTokens: typeof value.usage?.prompt_tokens === "number" ? value.usage.prompt_tokens : undefined, outputTokens: typeof value.usage?.completion_tokens === "number" ? value.usage.completion_tokens : undefined, totalTokens: typeof value.usage?.total_tokens === "number" ? value.usage.total_tokens : undefined, costUsd: typeof value.usage?.cost === "number" && value.usage.cost >= 0 ? value.usage.cost : undefined }; }

export { mergeWarnings, sampleEcho, sampleEchoRuns, sampleEchoSeverity, softWarnings } from "./validators";
export { PROMPTS, PROMPT_VERSION, REASONING_EFFORT, promptIds, responseSchemas, runtimeSchemas, titledResponseSchemas };
export type { AIResponse, ControlRequest, PromptId, PromptDefinition, ProviderResult, RuntimeInput } from "./types";
