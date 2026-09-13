import { env } from "cloudflare:workers";

export interface RuntimeEnv { DB: D1Database; DOCUMENTS: R2Bucket; BETTER_AUTH_SECRET?: string; BETTER_AUTH_URL?: string; GOOGLE_CLIENT_ID?: string; GOOGLE_CLIENT_SECRET?: string; OPENROUTER_API_KEY?: string; OPENROUTER_MODEL?: string; AI_MONTHLY_REQUEST_LIMIT?: string; AI_PUBLIC_ENABLED?: string; }

export function runtime(): RuntimeEnv { return env as RuntimeEnv; }

export function requiredSetting(value: string | undefined, name: string): string {
  if (!value) throw new ConfigurationError(`${name} is not configured.`);
  return value;
}

export class ConfigurationError extends Error { constructor(message: string) { super(message); this.name = "ConfigurationError"; } }
