import { z } from "zod";
import { PROMPTS } from "./prompts";
import { responseSchemas, runtimeSchemas } from "./schemas";
import { promptIds, type AIResponse, type PromptDefinition, type PromptId, type ProviderResult, type RuntimeInput } from "./types";

const jsonSchema = (schema: z.ZodTypeAny) => ({ type: "json_schema", json_schema: { name: "ai_result", strict: true, schema: z.toJSONSchema(schema) } });

export function getPromptDefinition(id: PromptId): PromptDefinition {
  return { id, systemPrompt: PROMPTS[id], outputSchema: responseSchemas[id] as z.ZodType<AIResponse>, responseFormat: jsonSchema(responseSchemas[id]) };
}

export function normalizeRuntime(id: PromptId, input: RuntimeInput): Record<string, unknown> {
  const normalized: Record<string, unknown> = {};
  const fields: Array<[keyof RuntimeInput, string]> = [
    ["language", "language"], ["strength", "strength"], ["academicContext", "academic_context"], ["audience", "audience"], ["length", "length"], ["humanizerContext", "humanizer_context"], ["preservation", "preservation"], ["documentType", "document_type"], ["creativeGoal", "creative_goal"], ["creativityStrength", "creativity_strength"], ["targetAudience", "target_audience"], ["readingLevel", "reading_level"], ["outputFormat", "output_format"], ["action", "action"], ["activeMode", "active_mode"], ["format", "format"], ["focus", "focus"], ["extraRequest", "extra_request"], ["failedOutput", "failed_output"], ["originalScope", "original_scope"], ["requiredProtectedTerms", "required_protected_terms"], ["requiredProtectedCitations", "required_protected_citations"], ["customRequest", "custom_request"], ["context", "context"],
  ];
  for (const [from, to] of fields) if (input[from] !== undefined) normalized[to] = input[from];
  const snakeFields: Array<keyof RuntimeInput> = ["source_text", "selected_text", "context_before", "context_after", "protected_terms", "protected_citations", "academic_context", "humanizer_context", "document_type", "creative_goal", "creativity_strength", "target_audience", "reading_level", "output_format", "active_mode", "extra_request", "failed_output", "original_scope", "required_protected_terms", "required_protected_citations", "custom_request", "requested_dimensions", "rubric"];
  for (const field of snakeFields) if (input[field] !== undefined) normalized[field] = input[field];
  if (input.sourceText !== undefined) normalized.source_text = input.sourceText;
  if (input.selectedText !== undefined) normalized.selected_text = input.selectedText;
  if (input.contextBefore !== undefined) normalized.context_before = input.contextBefore;
  if (input.contextAfter !== undefined) normalized.context_after = input.contextAfter;
  if (input.protectedTerms !== undefined) normalized.protected_terms = [...input.protectedTerms];
  if (input.protectedCitations !== undefined) normalized.protected_citations = [...input.protectedCitations];
  const parsed = runtimeSchemas[id].parse(normalized) as Record<string, unknown>;
  return { ...normalized, ...parsed };
}

export function validateAIResponse(id: PromptId, value: unknown): AIResponse {
  const parsed = responseSchemas[id].parse(value) as AIResponse;
  if (id === "P07_INLINE_ALTERNATIVES") {
    const options = parsed.alternatives as Array<{ text: string }>;
    if (options.some(option => !option.text.trim() || option.text.length > 200000) || options.length < 3 || options.length > 5) throw new Error("P07 requires 3-5 alternatives");
    const seen = new Set(options.map((x) => x.text.trim()));
    if (seen.size !== options.length) throw new Error("P07 alternatives must be distinct");
  }
  if (id === "P03_HUMANIZER") parsed.transformed_text = parsed.humanized_text;
  const text = String(parsed.transformed_text ?? parsed.humanized_text ?? parsed.corrected_text ?? "");
  if (id !== "P07_INLINE_ALTERNATIVES" && id !== "P09_QUALITY_EVALUATION" && (text.trim().length === 0 || text.length > 200000)) throw new Error("AI output cannot be empty");
  return parsed;
}

export function validateGeneration(id: PromptId, original: string, value: unknown, runtime: RuntimeInput, repairAttempt = 0): AIResponse {
  if (id === "P10_REPAIR" && repairAttempt !== 1) throw new Error("P10 may run only as the single repair attempt");
  if (id !== "P10_REPAIR" && repairAttempt !== 0) throw new Error("repair attempt requires P10");
  const parsed = validateAIResponse(id, value);
  if (id === "P10_REPAIR") {
    const requiredTerms = (runtime.requiredProtectedTerms ?? runtime.required_protected_terms ?? []) as string[];
    const requiredCitations = (runtime.requiredProtectedCitations ?? runtime.required_protected_citations ?? []) as string[];
    const repaired = String(parsed.corrected_text ?? "");
    const check = validateProtectedContent(original, repaired, [...requiredTerms, ...requiredCitations], requiredCitations, true);
    if (!check.valid) throw new Error(check.errors.join("; "));
    return parsed;
  }
  if (id === "P07_INLINE_ALTERNATIVES") {
    const options = (parsed.alternatives as Array<{ text: string }>).map((option) => option.text);
    const protectedTerms = (runtime.protectedTerms ?? runtime.protected_terms ?? []) as string[];
    const protectedCitations = (runtime.protectedCitations ?? runtime.protected_citations ?? []) as string[];
    for (const option of options) {
      if (protectedTerms.some((term) => option.trim() === term.trim())) throw new Error("P07 cannot offer a protected term as a replacement");
      const check = validateProtectedContent(original, option, protectedTerms, protectedCitations, true);
      if (!check.valid) throw new Error(check.errors.join("; "));
    }
    return parsed;
  }
  const text = String(parsed.transformed_text ?? parsed.humanized_text ?? "");
  const protectedTerms = (runtime.protectedTerms ?? runtime.protected_terms ?? []) as string[];
  const protectedCitations = (runtime.protectedCitations ?? runtime.protected_citations ?? []) as string[];
  const check = validateProtectedContent(original, text, protectedTerms, protectedCitations, true);
  if (!check.valid) throw new Error(check.errors.join("; "));
  return parsed;
}

const multiset = (tokens: string[]) => tokens.reduce((map, token) => map.set(token, (map.get(token) ?? 0) + 1), new Map<string, number>());
const count = (haystack: string, needle: string) => needle ? haystack.split(needle).length - 1 : 0;
const numericTokens = (text: string) => text.match(/\b\d+(?:[.,]\d+)*\b/g) ?? [];
const citationTokens = (text: string): string[] => text.match(/(?:\b[A-Z][A-Za-zÀ-ÿ'’-]+(?:\s+et al\.)?\s*\(\d{4}[a-z]?\)|\([A-Z][A-Za-zÀ-ÿ'’-]+(?:\s+et al\.)?,\s*\d{4}[a-z]?\))/gu) ?? [];

export function validateProtectedContent(original: string, output: string, protectedTerms: string[], protectedCitations: string[], checkNumbers = true) {
  const errors: string[] = [];
  for (const term of [...protectedTerms, ...protectedCitations]) if (count(output, term) < count(original, term) && count(original, term) > 0) errors.push(`protected span missing: ${term}`);
  if (checkNumbers) {
    const expected = multiset(numericTokens(original)); const actual = multiset(numericTokens(output));
    for (const [token, amount] of expected) if ((actual.get(token) ?? 0) < amount) errors.push(`numeric token missing: ${token}`);
    for (const [token, amount] of actual) if (amount > (expected.get(token) ?? 0)) errors.push(`new numeric token: ${token}`);
  }
  {
    const expectedCitations = multiset(citationTokens(original)); const actualCitations = multiset(citationTokens(output));
    for (const [citation, amount] of actualCitations) if (amount > (expectedCitations.get(citation) ?? 0)) errors.push(`new citation-shaped text: ${citation}`);
  }
  return { valid: errors.length === 0, errors };
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
    let runtime: Record<string, unknown>;
    try {
      const trustedInput = { ...args.runtime, ...(args.promptId === "P07_INLINE_ALTERNATIVES" ? { selectedText: args.sourceText } : {}), ...(args.promptId === "P10_REPAIR" ? {} : { sourceText: args.sourceText }) } as RuntimeInput;
      runtime = normalizeRuntime(args.promptId, trustedInput);
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
      const response = await fetchImpl(endpoint, { method: "POST", headers: { Authorization: `Bearer ${options.apiKey}`, "Content-Type": "application/json", "X-Title": "AI Writing Workspace" }, body: JSON.stringify({ model: options.model, messages: [{ role: "system", content: definition.systemPrompt }, { role: "user", content: JSON.stringify({ ...runtime, source_text: args.sourceText }) }], response_format: definition.responseFormat, provider: { data_collection: "deny" }, stream: false }), signal: controller.signal });
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

export { PROMPTS, promptIds, responseSchemas, runtimeSchemas };
export type { AIResponse, PromptId, PromptDefinition, ProviderResult, RuntimeInput } from "./types";
