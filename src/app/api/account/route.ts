import { jsonData } from "@/lib/contracts";
import { requireUser } from "@/server/auth/auth";
import { handleRouteError, idempotencyKey } from "@/server/http";
import { deleteDocument } from "@/server/documents/service";
import { runtime } from "@/server/runtime";

export async function DELETE(request: Request) {
  try {
    const user = await requireUser(request); idempotencyKey(request);
    while (true) { const documents = await runtime().DB.prepare("SELECT id FROM documents WHERE owner_id=? ORDER BY id ASC LIMIT 100").bind(user.id).all<{ id: string }>(); if (!(documents.results ?? []).length) break; for (const document of documents.results ?? []) await deleteDocument(user.id, document.id); }
    await runtime().DB.batch([
      runtime().DB.prepare("DELETE FROM user_preferences WHERE user_id=?").bind(user.id),
      runtime().DB.prepare("DELETE FROM usage_ledger WHERE owner_id=?").bind(user.id),
      runtime().DB.prepare("DELETE FROM user WHERE id=?").bind(user.id)
    ]);
    return jsonData({ deleted: true });
  } catch (error) { return handleRouteError(error); }
}
