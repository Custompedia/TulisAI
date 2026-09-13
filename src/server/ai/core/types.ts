import { z } from "zod";

export const promptIds = [
  "P01_STANDARD_REWRITE", "P02_ACADEMIC", "P03_HUMANIZER", "P04_PROFESSIONAL",
  "P05_CREATIVE", "P06_SIMPLIFY", "P07_INLINE_ALTERNATIVES", "P08_CUSTOM_TRANSFORM", "P09_QUALITY_EVALUATION", "P10_REPAIR",
] as const;
export type PromptId = (typeof promptIds)[number];

export type RuntimeInput = {
  sourceText?: string;
  selectedText?: string;
  contextBefore?: string | null;
  contextAfter?: string | null;
  language?: "id" | "en";
  strength?: "light" | "balanced" | "strong";
  protectedTerms?: string[];
  protectedCitations?: string[];
  academicContext?: string; audience?: string | null; length?: string; humanizerContext?: string;
  preservation?: string; documentType?: string; creativeGoal?: string; creativityStrength?: string;
  targetAudience?: string; readingLevel?: string | null; outputFormat?: string; action?: string;
  activeMode?: string; format?: string; focus?: string[]; extraRequest?: string | null;
  failedOutput?: string; originalScope?: string; requiredProtectedTerms?: string[]; requiredProtectedCitations?: string[];
  customRequest?: Record<string, unknown>;
  context?: string; requested_dimensions?: string[]; rubric?: Record<string, string>;
  protected_terms?: string[]; protected_citations?: string[];
  required_protected_terms?: string[]; required_protected_citations?: string[];
  source_text?: string; selected_text?: string; context_before?: string | null; context_after?: string | null;
  academic_context?: string; humanizer_context?: string; document_type?: string; creative_goal?: string; creativity_strength?: string;
  target_audience?: string; reading_level?: string | null; output_format?: string; active_mode?: string; extra_request?: string | null;
  failed_output?: string; original_scope?: string; custom_request?: Record<string, unknown>;
};

export type AIResponse = Record<string, unknown>;
export type UsageMetadata = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
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
  outputSchema: z.ZodType<AIResponse>;
  responseFormat: Record<string, unknown>;
};
