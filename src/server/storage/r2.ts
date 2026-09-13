import { runtime } from "../runtime";

export async function sha256(value: string): Promise<string> { const bytes = new TextEncoder().encode(value); const digest = await crypto.subtle.digest("SHA-256", bytes); return [...new Uint8Array(digest)].map((part) => part.toString(16).padStart(2, "0")).join(""); }
export async function putImmutableSnapshot(documentId: string, versionId: string, body: string): Promise<{ key: string; hash: string }> {
  if (body.length > 1_600_000) throw new Error("Snapshot exceeds the MVP document limit.");
  const hash = await sha256(body); const key = `documents/${documentId}/versions/${versionId}-${hash}.json`;
  const bucket = runtime().DOCUMENTS; const existing = await bucket.head(key);
  if (existing) return { key, hash };
  await bucket.put(key, body, { httpMetadata: { contentType: "application/json" }, customMetadata: { hash, immutable: "true" } });
  return { key, hash };
}
export async function getSnapshot(key: string): Promise<string> { const object = await runtime().DOCUMENTS.get(key); if (!object) throw new Error("Snapshot object is unavailable."); if (object.size > 1_600_000) throw new Error("Snapshot exceeds the MVP document limit."); return object.text(); }
