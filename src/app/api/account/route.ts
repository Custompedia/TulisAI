import { jsonData } from "@/lib/contracts";
import { auth, requireUser, UnauthorizedError } from "@/server/auth/auth";
import { handleRouteError, idempotencyKey } from "@/server/http";
import { purgeUserData } from "@/server/account/purge";
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
    await purgeUserData(user.id);
    await runtime().DB.prepare("DELETE FROM user WHERE id=?").bind(user.id).run();
    return jsonData({ deleted: true });
  } catch (error) { return handleRouteError(error); }
}
