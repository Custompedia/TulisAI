import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { username } from "better-auth/plugins";
import { APIError } from "better-auth/api";
import { drizzle } from "drizzle-orm/d1";
import { runtime, requiredSetting } from "../runtime";
import * as schema from "@/db/schema";

export function auth() {
  const value = runtime();
  const google = value.GOOGLE_CLIENT_ID && value.GOOGLE_CLIENT_SECRET
    ? { google: { clientId: value.GOOGLE_CLIENT_ID, clientSecret: value.GOOGLE_CLIENT_SECRET } }
    : undefined;
  return betterAuth({
    database: drizzleAdapter(drizzle(value.DB, { schema }), { provider: "sqlite", schema }),
    baseURL: requiredSetting(value.BETTER_AUTH_URL, "BETTER_AUTH_URL"),
    secret: requiredSetting(value.BETTER_AUTH_SECRET, "BETTER_AUTH_SECRET"),
    emailAndPassword: { enabled: true, minPasswordLength: 10, maxPasswordLength: 128 },
    socialProviders: google,
    advanced: { disableOriginCheck: false, ipAddress: { ipAddressHeaders: ["cf-connecting-ip"] } },
    rateLimit: {
      enabled: true,
      storage: "database",
      window: 60,
      max: 100,
      customRules: {
        "/sign-in/username": { window: 60, max: 10 },
        "/sign-in/email": { window: 60, max: 10 },
        "/sign-up/email": { window: 60, max: 5 },
      },
    },
    databaseHooks: {
      user: {
        create: {
          before: async (user, context) => {
            if (context?.path !== "/sign-up/email") return;
            const name = user.name.trim();
            if (!name || name.length > 100) throw APIError.from("BAD_REQUEST", { code: "INVALID_NAME", message: "Name must be 1 to 100 characters." });
            if (typeof user.username !== "string" || !user.username.trim()) throw APIError.from("BAD_REQUEST", { code: "USERNAME_REQUIRED", message: "Username is required." });
            return { data: { ...user, name } };
          },
        },
      },
    },
    plugins: [username({
      displayUsername: false,
      minUsernameLength: 3,
      maxUsernameLength: 30,
      usernameNormalization: (value) => value.trim().toLowerCase(),
      usernameValidator: (value) => {
        const normalized = value.trim();
        return normalized.length >= 3 && normalized.length <= 30 && /^[a-z0-9](?:[a-z0-9._]*[a-z0-9])?$/i.test(normalized);
      },
    })],
  });
}

export async function requireUser(request: Request): Promise<{ id: string; email: string; name: string }> {
  const session = await auth().api.getSession({ headers: request.headers });
  if (!session?.user) throw new UnauthorizedError();
  return { id: session.user.id, email: session.user.email, name: session.user.name };
}

export class UnauthorizedError extends Error { constructor() { super("Sign in is required."); this.name = "UnauthorizedError"; } }
