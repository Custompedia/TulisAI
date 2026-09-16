import { jsonData } from "@/lib/contracts";
import { auth, requireUser, UnauthorizedError } from "@/server/auth/auth";
import { handleRouteError, idempotencyKey } from "@/server/http";
import { deleteDocument } from "@/server/documents/service";
import { runtime } from "@/server/runtime";

export async function GET(request: Request) {
  try {
    const session = await auth().api.getSession({ headers: request.headers });
    if (!session?.user) throw new UnauthorizedError();
    const accounts = await auth().api.listUserAccounts({ headers: request.headers });
    const { user } = session; const providers = [...new Set(accounts.map((account) => account.providerId))];
    return jsonData({ id: user.id, name: user.name, email: user.email, username: user.username ?? null, emailVerified: user.emailVerified, image: user.image ?? null, createdAt: new Date(user.createdAt).toISOString(), hasPassword: providers.includes("credential"), providers });
  } catch (error) { return handleRouteError(error); }
}

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
