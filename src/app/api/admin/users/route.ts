import { jsonData } from "@/lib/contracts";
import { auth, requireAdmin } from "@/server/auth/auth";
import { handleRouteError, idempotencyKey, readJson } from "@/server/http";
import { audit, CreateUserSchema, getUser, listUsers, pageOf, setTier, USER_SORTS, type UserFilter } from "@/server/admin/service";
import { TIERS } from "@/server/usage/quota";

export async function GET(request: Request) {
  try {
    await requireAdmin(request);
    const url = new URL(request.url); const pick = (key: string, allowed: readonly string[]) => { const value = url.searchParams.get(key); return value && allowed.includes(value) ? value : undefined; };
    const filter: UserFilter = { q: url.searchParams.get("q") ?? "", role: pick("role", ["user", "admin"]) as UserFilter["role"], tier: pick("tier", TIERS) as UserFilter["tier"], status: pick("status", ["active", "banned"]) as UserFilter["status"], sort: pick("sort", USER_SORTS) as UserFilter["sort"] };
    return jsonData(await listUsers(filter, pageOf(url.searchParams.get("page"))));
  } catch (error) { return handleRouteError(error); }
}

export async function POST(request: Request) {
  try {
    const admin = await requireAdmin(request); idempotencyKey(request);
    const input = await readJson(request, CreateUserSchema);
    const created = await auth().api.createUser({ headers: request.headers, body: { email: input.email, password: input.password, name: input.name, role: input.role, data: { username: input.username, emailVerified: input.emailVerified } } });
    if (input.tier !== "free") await setTier(created.user.id, input.tier);
    await audit(admin.id, created.user.id, "user.create", { email: input.email, role: input.role, tier: input.tier });
    return jsonData(await getUser(created.user.id), { status: 201 });
  } catch (error) { return handleRouteError(error); }
}
