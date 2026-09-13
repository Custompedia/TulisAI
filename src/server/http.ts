import { ZodError, type ZodType } from "zod";
import { apiError } from "@/lib/contracts";
import { ConfigurationError } from "./runtime";
import { UnauthorizedError } from "./auth/auth";

export async function readJson<T>(request: Request, schema: ZodType<T>): Promise<T> {
  const length = Number(request.headers.get("content-length") ?? "0");
  if (length > 1_600_000) throw new RequestError("PAYLOAD_TOO_LARGE", "Request body is too large.", 413);
  if (!request.body) throw new RequestError("INVALID_REQUEST", "Request body is required.");
  const reader = request.body.getReader(); const chunks: Uint8Array[] = []; let bytes = 0;
  try { while (true) { const item = await reader.read(); if (item.done) break; bytes += item.value.byteLength; if (bytes > 1_600_000) { await reader.cancel(); throw new RequestError("PAYLOAD_TOO_LARGE", "Request body is too large.", 413); } chunks.push(item.value); } } catch (error) { if (error instanceof RequestError) throw error; throw new RequestError("INVALID_REQUEST", "Request body could not be read."); } finally { reader.releaseLock(); }
  const joined = new Uint8Array(bytes); let offset = 0; for (const chunk of chunks) { joined.set(chunk, offset); offset += chunk.byteLength; } const raw = new TextDecoder().decode(joined);
  try { const data:unknown=JSON.parse(raw);const queue:Array<{value:unknown;depth:number}>=[{value:data,depth:0}];let count=0;while(queue.length){const entry=queue.pop()!;if(++count>40000||entry.depth>40)throw new RequestError("PAYLOAD_TOO_LARGE","Request structure is too complex.",413);if(entry.value&&typeof entry.value==='object')for(const value of Object.values(entry.value))queue.push({value,depth:entry.depth+1});}return schema.parse(data); } catch (error) { if (error instanceof ZodError || error instanceof RequestError) throw error; throw new RequestError("INVALID_REQUEST", "Request body must be valid JSON."); }
}
export function idempotencyKey(request: Request): string { const key = request.headers.get("Idempotency-Key"); if (!key || key.length > 200) throw new RequestError("IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key is required.", 400); return key; }
export class RequestError extends Error { constructor(public code: string, message: string, public status = 400, public details?: unknown) { super(message); this.name = "RequestError"; } }
export function handleRouteError(error: unknown): Response {
  if (error instanceof ZodError) return apiError("INVALID_REQUEST", "Request data is invalid.", 400, error.flatten());
  if (error instanceof RequestError) return apiError(error.code, error.message, error.status, error.details);
  if (error instanceof UnauthorizedError) return apiError("UNAUTHENTICATED", error.message, 401);
  if (error instanceof ConfigurationError) return apiError("CONFIGURATION_REQUIRED", error.message, 503);
  console.error("route failure", error instanceof Error ? error.name : "unknown");
  return apiError("INTERNAL_ERROR", "The request could not be completed.", 500);
}
