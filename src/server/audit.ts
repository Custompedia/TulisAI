import { runtime } from "./runtime";

export type AuditWrite = {
  id?: string;
  actorId: string;
  targetUserId: string | null;
  action: string;
  details?: Record<string, unknown>;
  createdAt?: number;
};

const forbiddenKey = /(?:secret|password|token|cookie|nonce|verifier|authorization[_-]?code|\bstate\b)/i;

function assertSafe(value: unknown, path = "details"): void {
  if (!value || typeof value !== "object") return;
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (forbiddenKey.test(key)) throw new Error(`Unsafe audit field: ${path}.${key}`);
    assertSafe(nested, `${path}.${key}`);
  }
}

export function auditStatement(db: D1Database, event: AuditWrite): D1PreparedStatement {
  const details = event.details ?? {};
  assertSafe(details);
  return db.prepare("INSERT INTO admin_audit_log (id,actor_id,target_user_id,action,details_json,created_at) VALUES (?,?,?,?,?,?)")
    .bind(event.id ?? crypto.randomUUID(), event.actorId, event.targetUserId, event.action, JSON.stringify(details), event.createdAt ?? Date.now());
}

export async function writeAudit(actorId: string, targetUserId: string | null, action: string, details: Record<string, unknown> = {}): Promise<void> {
  await auditStatement(runtime().DB, { actorId, targetUserId, action, details }).run();
}
