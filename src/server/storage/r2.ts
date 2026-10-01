import { runtime } from "../runtime";
import { MAX_DOCUMENT_BYTES } from "@/lib/limits";

// A serialized notebook body: canonical JSON as UTF-8 bytes (see src/lib/editor/serialize.ts) and its SHA-256.
export type StoredBody = { bytes: Uint8Array; hash: string };

const hex = (digest: ArrayBuffer) => [...new Uint8Array(digest)].map((part) => part.toString(16).padStart(2, "0")).join("");
export async function sha256(value: string): Promise<string> { return hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))); }
export async function sha256Bytes(bytes: Uint8Array): Promise<string> { return hex(await crypto.subtle.digest("SHA-256", bytes as BufferSource)); }
export async function storedBody(bytes: Uint8Array): Promise<StoredBody> { return { bytes, hash: await sha256Bytes(bytes) }; }

export class SnapshotUnavailableError extends Error { constructor() { super("Snapshot object is unavailable."); this.name = "SnapshotUnavailableError"; } }

// Small bodies go to R2 as text, large ones as their UTF-8 bytes, so a 2,000-page notebook is never held as one
// more JavaScript string just to be written. R2 stores both identically.
const putValue = (bytes: Uint8Array) => (bytes.length <= 262_144 ? new TextDecoder().decode(bytes) : bytes);
const tooLarge = (size: number) => size > MAX_DOCUMENT_BYTES;

// Versions are immutable and content-addressed: the same version id and hash always name the same object.
export async function putImmutableSnapshot(documentId: string, versionId: string, body: StoredBody): Promise<{ key: string; hash: string }> {
  if (tooLarge(body.bytes.length)) throw new Error("Snapshot exceeds the document size limit.");
  const key = `documents/${documentId}/versions/${versionId}-${body.hash}.json`;
  const bucket = runtime().DOCUMENTS; const existing = await bucket.head(key);
  if (existing) return { key, hash: body.hash };
  await bucket.put(key, putValue(body.bytes), { httpMetadata: { contentType: "application/json" }, customMetadata: { hash: body.hash, immutable: "true" } });
  return { key, hash: body.hash };
}

// The current body of a notebook between versions (what autosave writes). One object per saved revision; the
// previous one is deleted once the row points at the new one, and the hourly orphan sweep catches any left behind.
export const BODY_PREFIX = "/body/";
export async function putBody(documentId: string, revision: number, body: StoredBody): Promise<string> {
  if (tooLarge(body.bytes.length)) throw new Error("Body exceeds the document size limit.");
  const key = `documents/${documentId}${BODY_PREFIX}${revision}-${body.hash.slice(0, 16)}.json`;
  await runtime().DOCUMENTS.put(key, putValue(body.bytes), { httpMetadata: { contentType: "application/json" }, customMetadata: { hash: body.hash } });
  return key;
}
export const isBodyKey = (key: string | null | undefined): key is string => typeof key === "string" && key.includes(BODY_PREFIX);

export async function getSnapshot(key: string): Promise<string> {
  const object = await runtime().DOCUMENTS.get(key);
  if (!object) throw new SnapshotUnavailableError();
  if (tooLarge(object.size)) throw new Error("Snapshot exceeds the document size limit.");
  return object.text();
}
