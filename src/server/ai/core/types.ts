import { z } from "zod";

export const promptIds = [
  "P01_STANDARD_REWRITE", "P02_ACADEMIC", "P03_HUMANIZER", "P04_PROFESSIONAL",
  "P05_CREATIVE", "P06_SIMPLIFY", "P07_INLINE_ALTERNATIVES", "P08_CUSTOM_TRANSFORM", "P09_QUALITY_EVALUATION", "P10_REPAIR",
] as const;
export type PromptId = (typeof promptIds)[number];

// Trusted runtime controls; camelCase or snake_case UI values are mapped to v3 enums by normalizeRuntime.
export type RuntimeInput = {
  [key: string]: unknown;
  sourceText?: string; selectedText?: string; contextBefore?: string | null; contextAfter?: string | null;
  language?: "id" | "en"; strength?: string; protectedTerms?: string[]; protectedCitations?: string[];
  protected_terms?: string[]; protected_citations?: string[];
  requiredProtectedTerms?: string[]; requiredProtectedCitations?: string[]; required_protected_terms?: string[]; required_protected_citations?: string[];
  failedOutput?: string; originalScope?: string; failed_output?: string; original_scope?: string;
  preservation?: string; suggestTitle?: boolean; request?: ControlRequest; custom_request?: Record<string, unknown>;
};

export type ControlRequest = {
  format: "paragraf" | "poin" | "bernomor" | "tabel" | "ringkasan";
  length?: "lebih singkat" | "sama" | "lebih detail";
  audience?: "dosen" | "profesional" | "klien" | "umum";
  focus: string[];
  additional_instruction: string;
};

export type AIResponse = Record<string, unknown>;
export type UsageMetadata = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  costUsd?: number;
  providerRequestId?: string;
};

export type ProviderResult = {
  ok: true;
  response: AIResponse;
  usage: UsageMetadata;
} | {
  ok: false;
  error: "timeout" | "http_error" | "response_too_large" | "invalid_json" | "invalid_provider_response" | "network_error";
  status?: number;
  usage?: UsageMetadata;
};

export type PromptDefinition = {
  id: PromptId;
  systemPrompt: string;
  reasoningEffort: "none" | "low";
  outputSchema: z.ZodType<AIResponse>;
  responseFormat: Record<string, unknown>;
};
