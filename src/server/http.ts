import { ZodError, type ZodType } from "zod";
import { apiError } from "@/lib/contracts";
import { MAX_DOCUMENT_REQUEST_BYTES, MAX_DOCUMENT_WIRE_BYTES, MAX_JSON_CONTAINERS, MAX_JSON_DEPTH, MAX_SMALL_REQUEST_BYTES } from "@/lib/limits";
import { ConfigurationError } from "./runtime";
import { APIError } from "better-auth/api";
import { ForbiddenError, UnauthorizedError } from "./auth/auth";

export type JsonLimits = { maxBytes: number; maxWireBytes?: number; maxContainers?: number };
// The small routes keep their old ceiling of 40,000 JSON values, counted as containers now (a stricter count never refuses
// a body the old one accepted).
const SMALL: JsonLimits = { maxBytes: MAX_SMALL_REQUEST_BYTES, maxContainers: 40_000 };
// The routes that carry a whole notebook (create, autosave, checkpoint with content).
export const DOCUMENT_JSON: JsonLimits = { maxBytes: MAX_DOCUMENT_REQUEST_BYTES, maxWireBytes: MAX_DOCUMENT_WIRE_BYTES };
const tooLarge = () => new RequestError("PAYLOAD_TOO_LARGE", "Request body is too large.", 413);
const tooComplex = () => new RequestError("PAYLOAD_TOO_LARGE", "Request structure is too complex.", 413);

// Reads a stream into one buffer, refusing as soon as it passes `limit`; a lying content-length cannot exhaust memory.
async function collect(stream: ReadableStream<Uint8Array>, limit: number, onTooLarge: () => Error): Promise<Uint8Array> {
  const reader = stream.getReader(); const chunks: Uint8Array[] = []; let bytes = 0;
  try {
    for (;;) {
      const item = await reader.read();
      if (item.done) break;
      bytes += item.value.byteLength;
      if (bytes > limit) { await reader.cancel().catch(() => undefined); throw onTooLarge(); }
      chunks.push(item.value);
    }
  } finally { reader.releaseLock(); }
  if (chunks.length === 1) return chunks[0]!;
  const joined = new Uint8Array(bytes); let offset = 0;
  for (const chunk of chunks) { joined.set(chunk, offset); offset += chunk.byteLength; }
  return joined;
}

// Counts objects and arrays and their nesting on the raw bytes, before JSON.parse allocates anything: a body of a
// million empty braces would otherwise cost about 60 MB the moment it is parsed. UTF-8 never puts an ASCII byte inside
// a multi-byte character, so quotes and brackets can be read byte by byte.
export function jsonShapeProblem(bytes: Uint8Array, maxContainers = MAX_JSON_CONTAINERS, maxDepth = MAX_JSON_DEPTH): string | null {
  let containers = 0; let depth = 0; let inString = false;
  for (let index = 0; index < bytes.length; index++) {
    const byte = bytes[index]!;
    if (inString) { if (byte === 0x5c) index++; else if (byte === 0x22) inString = false; continue; }
    if (byte === 0x22) inString = true;
    else if (byte === 0x7b || byte === 0x5b) { if (++containers > maxContainers) return "containers"; if (++depth > maxDepth) return "depth"; }
    else if (byte === 0x7d || byte === 0x5d) depth--;
  }
  return null;
}

// JSON request bodies. Every route gets the small cap unless it passes its own (the document routes take a whole
// notebook). A body may arrive gzip-compressed (the editor compresses large notebooks with CompressionStream); it is
// recognised by its magic bytes rather than by a header, so a proxy that already inflated it changes nothing, and it
// is inflated through the same cap, so a small zip bomb is refused as soon as it passes the limit.
export async function readJson<T>(request: Request, schema: ZodType<T>, limits: JsonLimits = SMALL): Promise<T> {
  const wireLimit = limits.maxWireBytes ?? limits.maxBytes;
  const length = Number(request.headers.get("content-length") ?? "0");
  if (length > wireLimit) throw tooLarge();
  if (!request.body) throw new RequestError("INVALID_REQUEST", "Request body is required.");
  let bytes: Uint8Array;
  try {
    const wire = await collect(request.body, wireLimit, tooLarge);
    if (wire.length >= 2 && wire[0] === 0x1f && wire[1] === 0x8b) {
      const inflated = new Blob([wire as BlobPart]).stream().pipeThrough(new DecompressionStream("gzip") as unknown as TransformStream<Uint8Array, Uint8Array>);
      bytes = await collect(inflated, limits.maxBytes, tooLarge);
    } else {
      if (wire.length > limits.maxBytes) throw tooLarge();
      bytes = wire;
    }
  } catch (error) { if (error instanceof RequestError) throw error; throw new RequestError("INVALID_REQUEST", "Request body could not be read."); }
  if (jsonShapeProblem(bytes, limits.maxContainers ?? MAX_JSON_CONTAINERS)) throw tooComplex();
  let data: unknown;
  try { data = JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new RequestError("INVALID_REQUEST", "Request body must be valid JSON."); }
  return schema.parse(data);
}
// Binary upload body, read with a hard cap and no buffering past it, so an oversized or lying content-length cannot
// be used to exhaust the worker. A declared length (browsers always send one for a file) is allocated once and filled
// in place, so a 50 MB .docx costs 50 MB, not twice that while its chunks are joined.
export async function readBinary(request: Request, maxBytes: number): Promise<Uint8Array> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > maxBytes) throw new RequestError("PAYLOAD_TOO_LARGE", "The file is too large.", 413);
  if (!request.body) throw new RequestError("INVALID_REQUEST", "A file is required.");
  const reader = request.body.getReader();
  const exact = Number.isSafeInteger(declared) && declared > 0 ? new Uint8Array(declared) : null;
  const chunks: Uint8Array[] = []; let bytes = 0;
  try {
    while (true) {
      const item = await reader.read();
      if (item.done) break;
      const end = bytes + item.value.byteLength;
      if (end > maxBytes || (exact && end > exact.length)) { await reader.cancel(); throw new RequestError("PAYLOAD_TOO_LARGE", "The file is too large.", 413); }
      if (exact) exact.set(item.value, bytes); else chunks.push(item.value);
      bytes = end;
    }
  } catch (error) { if (error instanceof RequestError) throw error; throw new RequestError("INVALID_REQUEST", "The file could not be read."); }
  finally { reader.releaseLock(); }
  if (!bytes) throw new RequestError("INVALID_REQUEST", "The file is empty.");
  if (exact) return bytes === exact.length ? exact : exact.subarray(0, bytes);
  const joined = new Uint8Array(bytes); let offset = 0;
  for (const chunk of chunks) { joined.set(chunk, offset); offset += chunk.byteLength; }
  return joined;
}

export function idempotencyKey(request: Request): string { const key = request.headers.get("Idempotency-Key"); if (!key || key.length > 200) throw new RequestError("IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key is required.", 400); return key; }
export class RequestError extends Error { constructor(public code: string, message: string, public status = 400, public details?: unknown) { super(message); this.name = "RequestError"; } }
export function handleRouteError(error: unknown): Response {
  if (error instanceof ZodError) return apiError("INVALID_REQUEST", "Request data is invalid.", 400, error.flatten());
  if (error instanceof RequestError) return apiError(error.code, error.message, error.status, error.details);
  if (error instanceof UnauthorizedError) return apiError("UNAUTHENTICATED", error.message, 401);
  if (error instanceof ForbiddenError) return apiError(error.code, error.message, 403);
  if (error instanceof APIError) { const body = error.body as { code?: string; message?: string } | undefined; return apiError(body?.code ?? "AUTH_ERROR", body?.message ?? error.message, error.statusCode); }
  if (error instanceof ConfigurationError) return apiError("CONFIGURATION_REQUIRED", error.message, 503);
  console.error("route failure", error instanceof Error ? error.name : "unknown");
  return apiError("INTERNAL_ERROR", "The request could not be completed.", 500);
}
