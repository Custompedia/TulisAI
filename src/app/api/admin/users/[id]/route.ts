import { jsonData } from "@/lib/contracts";
import { auth, requireAdmin } from "@/server/auth/auth";
import { handleRouteError, idempotencyKey, readJson } from "@/server/http";
import { assertRemove, audit, getUser, listAudit, updateUser, UserPatchSchema } from "@/server/admin/service";
import { purgeUserData } from "@/server/account/purge";
type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Context) {
  try {
    await requireAdmin(request); const { id } = await params;
    const [user, sessions, history] = await Promise.all([getUser(id), auth().api.listUserSessions({ headers: request.headers, body: { userId: id } }), listAudit({ targetUserId: id })]);
    return jsonData({ user, sessions: sessions.sessions.map((session) => ({ id: session.id, token: session.token, createdAt: session.createdAt, expiresAt: session.expiresAt, ipAddress: session.ipAddress ?? null, userAgent: session.userAgent ?? null })), history: history.items });
  } catch (error) { return handleRouteError(error); }
}

export async function PATCH(request: Request, { params }: Context) {
  try {
    const admin = await requireAdmin(request); idempotencyKey(request); const { id } = await params;
    const patch = await readJson(request, UserPatchSchema);
    const before = await getUser(id);
    const user = await updateUser(id, patch);
    await audit(admin.id, id, "user.update", { changes: patch, before: { name: before.name, emailVerified: before.emailVerified, tier: before.tier, aiLimitOverride: before.aiLimitOverride } });
    return jsonData(user);
  } catch (error) { return handleRouteError(error); }
}

export async function DELETE(request: Request, { params }: Context) {
  try {
    const admin = await requireAdmin(request); idempotencyKey(request); const { id } = await params;
    const target = await getUser(id); await assertRemove(admin.id, target);
    await purgeUserData(id);
    await auth().api.removeUser({ headers: request.headers, body: { userId: id } });
    await audit(admin.id, id, "user.delete", { email: target.email, name: target.name });
    return jsonData({ deleted: true });
  } catch (error) { return handleRouteError(error); }
}
