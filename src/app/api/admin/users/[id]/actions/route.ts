import { jsonData } from "@/lib/contracts";
import { auth, requireAdmin } from "@/server/auth/auth";
import { handleRouteError, idempotencyKey, readJson } from "@/server/http";
import { ActionSchema, assertBan, assertRoleChange, audit, getUser } from "@/server/admin/service";
type Context = { params: Promise<{ id: string }> };

// One endpoint for account lifecycle actions; each delegates to the Better Auth admin plugin and writes an audit entry.
export async function POST(request: Request, { params }: Context) {
  try {
    const admin = await requireAdmin(request); idempotencyKey(request); const { id } = await params;
    const input = await readJson(request, ActionSchema); const target = await getUser(id); const headers = request.headers;
    switch (input.action) {
      case "set-role": await assertRoleChange(admin.id, target, input.role); await auth().api.setRole({ headers, body: { userId: id, role: input.role } }); await audit(admin.id, id, "user.role", { from: target.role, to: input.role }); break;
      case "ban": await assertBan(admin.id, target); await auth().api.banUser({ headers, body: { userId: id, banReason: input.reason, ...(input.expiresInDays ? { banExpiresIn: input.expiresInDays * 86_400 } : {}) } }); await audit(admin.id, id, "user.ban", { reason: input.reason, expiresInDays: input.expiresInDays }); break;
      case "unban": await auth().api.unbanUser({ headers, body: { userId: id } }); await audit(admin.id, id, "user.unban"); break;
      case "set-password": await auth().api.setUserPassword({ headers, body: { userId: id, newPassword: input.newPassword } }); await auth().api.revokeUserSessions({ headers, body: { userId: id } }); await audit(admin.id, id, "user.password"); break;
      case "revoke-sessions":
        if (input.sessionToken) await auth().api.revokeUserSession({ headers, body: { sessionToken: input.sessionToken } }); else await auth().api.revokeUserSessions({ headers, body: { userId: id } });
        await audit(admin.id, id, input.sessionToken ? "session.revoke" : "session.revoke-all"); break;
    }
    return jsonData(await getUser(id));
  } catch (error) { return handleRouteError(error); }
}
