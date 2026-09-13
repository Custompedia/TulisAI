import { runtime } from "../runtime";
import { RequestError } from "../http";
import { currentText } from "./service";

export async function listLocks(ownerId: string, documentId: string) { const rows = await runtime().DB.prepare("SELECT id,term,created_at FROM locked_terms WHERE document_id=? AND owner_id=? ORDER BY created_at ASC,id ASC").bind(documentId, ownerId).all<{ id: string; term: string; created_at: number }>(); return (rows.results ?? []).map((row) => ({ id: row.id, term: row.term, createdAt: new Date(row.created_at).toISOString() })); }
export async function createLock(ownerId: string, documentId: string, term: string) {
  const source = await currentText(ownerId, documentId);
  if (!source.text.includes(term)) throw new RequestError("LOCK_NOT_IN_DOCUMENT", "A locked term must match text in the document.", 422);
  const lock = { id: crypto.randomUUID(), term, createdAt: new Date().toISOString() };
  try {
    const result = await runtime().DB.prepare("INSERT INTO locked_terms (id,document_id,owner_id,term,created_at) SELECT ?,?,?,?,? WHERE (SELECT COUNT(*) FROM locked_terms WHERE document_id=? AND owner_id=?)<200").bind(lock.id, documentId, ownerId, term, Date.now(), documentId, ownerId).run();
    if ((result.meta.changes ?? 0) === 1) return lock;
  } catch (error) { if (error instanceof Error && error.message.includes("UNIQUE")) throw new RequestError("LOCK_EXISTS", "That exact term is already locked.", 409); throw error; }
  throw new RequestError("LOCK_LIMIT_REACHED", "A document can have at most 200 locked terms.", 429);
}
export async function deleteLock(ownerId: string, documentId: string, lockId: string) { const result = await runtime().DB.prepare("DELETE FROM locked_terms WHERE id=? AND document_id=? AND owner_id=?").bind(lockId, documentId, ownerId).run(); if ((result.meta.changes ?? 0) !== 1) throw new RequestError("NOT_FOUND", "Locked term not found.", 404); }
