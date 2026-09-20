import { runtime } from "../runtime";
import { entitlement, type AccessAuthority, type Entitlement } from "../usage/quota";
import { FeatureLockedError } from "../usage/features";
import { hasFeature } from "@/lib/plans";

const IMPORT_RECEIPT_TTL_MS = 15 * 60 * 1000;
type EvidenceAuthority = Exclude<AccessAuthority, "free">;

async function hash(value: unknown): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(value)));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function evidenceAuthority(rights: Entitlement): EvidenceAuthority {
  return rights.access.authority === "free" ? "support" : rights.access.authority;
}

export async function createDocxImportReceipt(ownerId: string, content: unknown, rights: Entitlement): Promise<string> {
  if (!hasFeature(rights.features, "docx_import")) throw new FeatureLockedError("docx_import");
  const id = crypto.randomUUID(); const now = Date.now();
  await runtime().DB.prepare("DELETE FROM pending_docx_import_evidence WHERE owner_id=? AND expires_at<=?").bind(ownerId, now).run();
  await runtime().DB.prepare("INSERT INTO pending_docx_import_evidence (id,owner_id,content_hash,authority,projection_revision,expires_at,created_at) VALUES (?,?,?,?,?,?,?)")
    .bind(id, ownerId, await hash(content), evidenceAuthority(rights), rights.access.projectionRevision, now + IMPORT_RECEIPT_TTL_MS, now).run();
  return id;
}

export async function validDocxImportReceipt(ownerId: string, receipt: string, content: unknown) {
  return runtime().DB.prepare("SELECT id,authority,projection_revision FROM pending_docx_import_evidence WHERE id=? AND owner_id=? AND content_hash=? AND expires_at>?")
    .bind(receipt, ownerId, await hash(content), Date.now()).first<{ id: string; authority: EvidenceAuthority; projection_revision: number | null }>();
}

export async function assertDocxExport(ownerId: string, documentId: string): Promise<{ rights: Entitlement; historical: boolean }> {
  const rights = await entitlement(ownerId);
  if (hasFeature(rights.features, "docx_export")) return { rights, historical: false };
  const evidence = await runtime().DB.prepare("SELECT document_id FROM document_portability_evidence WHERE document_id=? AND owner_id=?")
    .bind(documentId, ownerId).first();
  if (!evidence) throw new FeatureLockedError("docx_export");
  return { rights, historical: true };
}

export async function recordDocxExportEvidence(ownerId: string, documentId: string, rights: Entitlement): Promise<void> {
  await runtime().DB.prepare(`INSERT INTO document_portability_evidence (document_id,owner_id,kind,authority,projection_revision,created_at)
    VALUES (?,?,?,?,?,?) ON CONFLICT(document_id) DO NOTHING`)
    .bind(documentId, ownerId, "docx_export", evidenceAuthority(rights), rights.access.projectionRevision, Date.now()).run();
}
