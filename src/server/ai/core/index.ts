import { z } from "zod";
import { changePercentage } from "@/lib/editor/metrics";
import { EXTRA_LIMIT, FOCUS_LIMIT } from "@/lib/writing/settings";
import { BASE, BASE_READONLY, P01, P02, P03, P04, P05, P06, P07, P08_CONTROL_BLOCK, P09, P10, PROMPTS, PROMPT_VERSION, REASONING_EFFORT } from "./prompts";
import { responseSchemas, runtimeSchemas } from "./schemas";
import { paragraphsPreserved, repairDrift, simplifyLengthKept } from "./validators";
import { promptIds, type AIResponse, type ControlRequest, type PromptDefinition, type PromptId, type ProviderResult, type RuntimeInput } from "./types";

// Strict structured outputs reject string length keywords; lengths are clamped before zod parsing instead.
const strictSafe = (node: unknown): unknown => Array.isArray(node) ? node.map(strictSafe) : node && typeof node === "object" ? Object.fromEntries(Object.entries(node).filter(([key]) => key !== "minLength" && key !== "maxLength").map(([key, value]) => [key, strictSafe(value)])) : node;
const jsonSchema = (schema: z.ZodTypeAny) => ({ type: "json_schema", json_schema: { name: "ai_result", strict: true, schema: strictSafe(z.toJSONSchema(schema)) } });

export function getPromptDefinition(id: PromptId): PromptDefinition {
  return { id, systemPrompt: PROMPTS[id], reasoningEffort: REASONING_EFFORT[id], outputSchema: responseSchemas[id] as z.ZodType<AIResponse>, responseFormat: jsonSchema(responseSchemas[id]) };
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
  format: { paragraph: "paragraf", bullets: "poin", numbered_list: "bernomor", table: "tabel", short_summary: "ringkasan", summary: "ringkasan" },
  length: { shorter: "lebih singkat", same: "sama", more_detailed: "lebih detail" },
  mode: { standard: "standar", academic: "akademik", humanize: "humanize", professional: "profesional", creative: "kreatif", simplify: "sederhanakan" },
} satisfies Record<string, Table>;

const FORMAT_LINE: Table = { poin: "bullet points where the content is genuinely enumerable; keep continuous argument as prose", bernomor: "a numbered list, only where the content has a real sequence", tabel: "a table whose columns come from distinctions already present in the text", ringkasan: "a summary that keeps every claim, at roughly 40% of the input length" };
const LENGTH_LINE: Table = { "lebih singkat": "about 60-75% of the input length, with no claim dropped", sama: "within 10% of the input length", "lebih detail": "about 130-150% of the input length, expanding only what is already present" };
const AUDIENCE_LINE: Table = { dosen: "a thesis supervisor or journal reviewer", profesional: "a professional colleague", klien: "a client who is not a specialist", umum: "a general reader" };
const FOCUS_LABEL: Table = { clarity: "clarity", naturalness: "naturalness", formality: "formality", persuasiveness: "persuasiveness", remove_repetition: "removing repetition" };

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

export function normalizeRuntime(id: PromptId, input: RuntimeInput): Record<string, unknown> {
  const get = (...keys: string[]) => keys.map((key) => input[key]).find((value) => value !== undefined);
  const source = record(input.request) ?? record(get("customRequest", "custom_request")) ?? (id === "P08_CUSTOM_TRANSFORM" ? input : undefined);
  const request = source && {
    format: lookup(ENUM_MAP.format, source.format ?? "paragraph"), length: lookup(ENUM_MAP.length, source.length),
    audience: audienceOf(ENUM_MAP.request_audience, ["dosen", "profesional", "klien", "umum"], source.audience), focus: source.focus ?? [],
    additional_instruction: [source.additional_instruction, source.extra_request, source.extraRequest].find((value) => typeof value === "string") ?? "",
  };
  const candidate: Record<string, unknown> = {
    language: input.language, source_text: get("sourceText", "source_text"), selected_text: get("selectedText", "selected_text"),
    context_before: get("contextBefore", "context_before"), context_after: get("contextAfter", "context_after"),
    protected_terms: get("protectedTerms", "protected_terms"), protected_citations: get("protectedCitations", "protected_citations"),
    strength: id === "P08_CUSTOM_TRANSFORM" ? "balanced" : input.strength,
    academic_context: lookup(ENUM_MAP.academic_context, get("academicContext", "academic_context")),
    humanizer_context: lookup(ENUM_MAP.humanizer_context, get("humanizerContext", "humanizer_context")),
    preservation: input.preservation,
    audience: id === "P04_PROFESSIONAL" ? audienceOf({}, P04_AUDIENCES, get("recipient", "audience")) ?? "umum"
      : id === "P06_SIMPLIFY" ? audienceOf(ENUM_MAP.simplify_for, P06_AUDIENCES, get("simplifyFor", "simplify_for", "targetAudience", "target_audience", "audience")) ?? "umum" : undefined,
    creativity_strength: lookup(ENUM_MAP.creativity_strength, get("creativityStrength", "creativity_strength", "strength")),
    intent: lookup(ENUM_MAP.intent, get("intent", "action")), n: input.n,
    mode: lookup(ENUM_MAP.mode, get("mode", "context")),
    request: request && Object.fromEntries(Object.entries(request).filter(([, value]) => value !== undefined)),
    failed_output: get("failedOutput", "failed_output"), original_scope: get("originalScope", "original_scope"),
    required_protected_terms: get("requiredProtectedTerms", "required_protected_terms"), required_protected_citations: get("requiredProtectedCitations", "required_protected_citations"),
  };
  const defined = Object.fromEntries(Object.entries(candidate).filter(([, value]) => value !== undefined));
  return runtimeSchemas[id].parse(defined) as Record<string, unknown>;
}

const CAPABILITY: Record<PromptId, string> = { P01_STANDARD_REWRITE: P01, P02_ACADEMIC: P02, P03_HUMANIZER: P03, P04_PROFESSIONAL: P04, P05_CREATIVE: P05, P06_SIMPLIFY: P06, P07_INLINE_ALTERNATIVES: P07, P08_CUSTOM_TRANSFORM: P01, P09_QUALITY_EVALUATION: P09, P10_REPAIR: P10 };

// System message holds only prompt text and compiled controls; user text never enters it.
export function buildSystemMessage(id: PromptId, runtime: Record<string, unknown>): string {
  const parts = [fill(id === "P09_QUALITY_EVALUATION" ? BASE_READONLY : BASE, runtime), fill(CAPABILITY[id], runtime)];
  const request = record(runtime.request) as ControlRequest | undefined;
  const block = request ? compileControlBlock(request) : "";
  return (block ? [...parts, block] : parts).join("\n\n");
}

const section = (tag: string, value: unknown) => typeof value === "string" && value ? `<${tag}>\n${value}\n</${tag}>` : "";
export function buildUserMessage(id: PromptId, runtime: Record<string, unknown>): string {
  const strings = (value: unknown) => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  if (id === "P09_QUALITY_EVALUATION") return section("input", runtime.source_text);
  if (id === "P10_REPAIR") {
    const original = String(runtime.original_scope); const failed = String(runtime.failed_output);
    const { violations } = validateProtectedContent(original, failed, strings(runtime.required_protected_terms), strings(runtime.required_protected_citations), true);
    return [section("violations", violations.map((item) => `required: ${item.required} | appeared instead: ${item.found}`).join("\n")), section("failed_output", failed), section("original", original)].filter(Boolean).join("\n");
  }
  const protectedStrings = [...new Set([...strings(runtime.protected_terms), ...strings(runtime.protected_citations)])].join("\n");
  const body = id === "P07_INLINE_ALTERNATIVES" ? section("selection", runtime.selected_text) : section("input", runtime.source_text);
  return [section("protected", protectedStrings), section("context_before", runtime.context_before), body, section("context_after", runtime.context_after)].filter(Boolean).join("\n");
}

export function buildMessages(id: PromptId, runtime: Record<string, unknown>) {
  return [{ role: "system" as const, content: buildSystemMessage(id, runtime) }, { role: "user" as const, content: buildUserMessage(id, runtime) }];
}

const clampList = (value: unknown, items: number, characters: number) => Array.isArray(value) ? value.slice(0, items).map((item) => typeof item === "string" ? item.slice(0, characters) : item) : value;
function clampResponse(value: unknown): unknown {
  const result = record(value); if (!result) return value;
  const clamped = { ...result };
  if ("warnings" in clamped) clamped.warnings = clampList(clamped.warnings, 3, 160);
  if ("change_categories" in clamped) clamped.change_categories = clampList(clamped.change_categories, 3, 40);
  if (Array.isArray(clamped.alternatives)) clamped.alternatives = clamped.alternatives.slice(0, 5);
  return clamped;
}

export function validateAIResponse(id: PromptId, value: unknown): AIResponse {
  const parsed = responseSchemas[id].parse(clampResponse(value)) as AIResponse;
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
// Near-duplicate: token Jaccard >= 0.8, or two 3+ token options differing by a single substituted word.
export function nearDuplicate(left: string, right: string): boolean {
  const a = tokenSet(left); const b = tokenSet(right); let shared = 0;
  for (const token of a) if (b.has(token)) shared++;
  const union = a.size + b.size - shared; if (!union) return true;
  return shared / union >= 0.8 || (Math.min(a.size, b.size) >= 3 && union - shared <= 2);
}
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
export function structuralErrors(id: PromptId, original: string, output: string, runtime: RuntimeInput): string[] {
  if (!REWRITES.has(id)) return [];
  const errors: string[] = [];
  if (!paragraphsPreserved(original, output, requestOf(id, runtime)?.format)) errors.push("paragraph count changed");
  if (id === "P06_SIMPLIFY" && !simplifyLengthKept(original, output)) errors.push("simplified output is shorter than 85% of the input");
  return errors;
}

export const PRESERVATION_CEILING: Record<string, number> = { conservative: 15, balanced: 30, flexible: 50 };
export const exceedsPreservation = (original: string, output: string, preservation: unknown) => changePercentage(original, output) > (PRESERVATION_CEILING[String(preservation)] ?? 30);

export function validateGeneration(id: PromptId, original: string, value: unknown, runtime: RuntimeInput, repairAttempt = 0): AIResponse {
  if (id === "P10_REPAIR" && repairAttempt !== 1) throw new Error("P10 may run only as the single repair attempt");
  if (id !== "P10_REPAIR" && repairAttempt !== 0) throw new Error("repair attempt requires P10");
  const parsed = validateAIResponse(id, value);
  const list = (...values: unknown[]) => (values.find((item) => item !== undefined) ?? []) as string[];
  if (id === "P10_REPAIR") {
    const requiredCitations = list(runtime.requiredProtectedCitations, runtime.required_protected_citations);
    const requiredTerms = list(runtime.requiredProtectedTerms, runtime.required_protected_terms);
    const corrected = String(parsed.corrected_text ?? "");
    const check = validateProtectedContent(original, corrected, [...requiredTerms, ...requiredCitations], requiredCitations, true);
    if (!check.valid) throw new Error(check.errors.join("; "));
    const failed = runtime.failedOutput ?? runtime.failed_output;
    if (typeof failed === "string") {
      const drift = repairDrift(failed, corrected, validateProtectedContent(original, failed, requiredTerms, requiredCitations, true).violations);
      if (drift.length) throw new Error(drift.join("; "));
    }
    return parsed;
  }
  const protectedTerms = list(runtime.protectedTerms, runtime.protected_terms);
  const protectedCitations = list(runtime.protectedCitations, runtime.protected_citations);
  if (id === "P07_INLINE_ALTERNATIVES") {
    const options = parsed.alternatives as Array<{ text: string; variation_level: string }>;
    for (const option of options) {
      if (protectedTerms.some((term) => option.text.trim() === term.trim())) throw new Error("P07 cannot offer a protected term as a replacement");
      const check = validateProtectedContent(original, option.text, protectedTerms, protectedCitations, true);
      if (!check.valid) throw new Error(check.errors.join("; "));
    }
    const kept: typeof options = [];
    for (const option of options) if (capitalisationMatches(original, option.text) && !kept.some((other) => other.variation_level === option.variation_level || nearDuplicate(other.text, option.text))) kept.push(option);
    if (!kept.length) throw new Error("P07 returned no distinct alternatives");
    return { ...parsed, alternatives: kept };
  }
  const text = String(parsed.transformed_text ?? "");
  const check = validateProtectedContent(original, text, protectedTerms, protectedCitations, true, id === "P04_PROFESSIONAL");
  if (!check.valid) throw new Error(check.errors.join("; "));
  if (parsed.no_change_needed === true && changePercentage(original, text) > 2) throw new Error("no_change_needed was set but the text changed");
  const structure = structuralErrors(id, original, text, runtime);
  if (structure.length) throw new Error(structure.join("; "));
  return parsed;
}

const multiset = (tokens: string[]) => tokens.reduce((map, token) => map.set(token, (map.get(token) ?? 0) + 1), new Map<string, number>());
const count = (haystack: string, needle: string) => needle ? haystack.split(needle).length - 1 : 0;
const numericTokens = (text: string) => text.match(/\b\d+(?:[.,]\d+)*\b/g) ?? [];
const citationTokens = (text: string): string[] => text.match(/(?:\b[A-Z][A-Za-zÀ-ÿ'’-]+(?:\s+et al\.)?\s*\(\d{4}[a-z]?\)|\([A-Z][A-Za-zÀ-ÿ'’-]+(?:\s+et al\.)?,\s*\d{4}[a-z]?\))/gu) ?? [];
export const placeholderTokens = (text: string) => text.match(/\[[^\[\]\n]{1,40}\]|\bTBD\b|\b[xX]{3,}\b/g) ?? [];

export function validateProtectedContent(original: string, output: string, protectedTerms: string[], protectedCitations: string[], checkNumbers = true, checkPlaceholders = false) {
  const errors: string[] = []; const violations: Array<{ required: string; found: string }> = [];
  const missing = (label: string, token: string) => { errors.push(`${label}: ${token}`); violations.push({ required: token, found: "(missing)" }); };
  const compare = (label: string, expected: Map<string, number>, actual: Map<string, number>, reportMissing: boolean) => {
    if (reportMissing) for (const [token, amount] of expected) if ((actual.get(token) ?? 0) < amount) missing(`${label} missing`, token);
    for (const [token, amount] of actual) if (amount > (expected.get(token) ?? 0)) { errors.push(`new ${label}: ${token}`); violations.push({ required: "(not in original)", found: token }); }
  };
  for (const term of [...protectedTerms, ...protectedCitations]) if (count(output, term) < count(original, term) && count(original, term) > 0) missing("protected span missing", term);
  if (checkNumbers) compare("numeric token", multiset(numericTokens(original)), multiset(numericTokens(output)), true);
  compare("citation-shaped text", multiset(citationTokens(original)), multiset(citationTokens(output)), false);
  if (checkPlaceholders) for (const [token, amount] of multiset(placeholderTokens(original))) if (count(output, token) < amount) missing("placeholder missing", token);
  return { valid: errors.length === 0, errors, violations };
}

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
    const definition = getPromptDefinition(args.promptId);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      const response = await fetchImpl(endpoint, { method: "POST", headers: { Authorization: `Bearer ${options.apiKey}`, "Content-Type": "application/json", "X-Title": "AI Writing Workspace" }, body: JSON.stringify({ model: options.model, messages, response_format: definition.responseFormat, reasoning: { effort: definition.reasoningEffort }, provider: { data_collection: "deny" }, stream: false }), signal: controller.signal });
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
      let parsed: AIResponse; try { parsed = validateAIResponse(args.promptId, JSON.parse(content)); } catch { return { ok: false, error: "invalid_provider_response", usage: usageOf(json) }; }
      return { ok: true, response: parsed, usage: { ...usageOf(record), providerRequestId: record.id } };
    } catch (error) { return { ok: false, error: error instanceof DOMException && error.name === "AbortError" ? "timeout" : "network_error" }; }
    finally { clearTimeout(timer); reader?.releaseLock(); }
  } };
}
function usageOf(value: { usage?: Record<string, unknown> }) { return { inputTokens: typeof value.usage?.prompt_tokens === "number" ? value.usage.prompt_tokens : undefined, outputTokens: typeof value.usage?.completion_tokens === "number" ? value.usage.completion_tokens : undefined, totalTokens: typeof value.usage?.total_tokens === "number" ? value.usage.total_tokens : undefined }; }

export { mergeWarnings, softWarnings } from "./validators";
export { PROMPTS, PROMPT_VERSION, REASONING_EFFORT, promptIds, responseSchemas, runtimeSchemas };
export type { AIResponse, ControlRequest, PromptId, PromptDefinition, ProviderResult, RuntimeInput } from "./types";
