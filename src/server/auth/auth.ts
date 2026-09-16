import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { admin, username } from "better-auth/plugins";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { drizzle } from "drizzle-orm/d1";
import { runtime, requiredSetting } from "../runtime";
import { emailConfigured, renderEmail, sendEmail, type EmailTemplate } from "../email/send";

const EMAIL_PATHS = new Set(["/request-password-reset", "/change-email", "/send-verification-email"]);
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
    emailAndPassword: {
      enabled: true, minPasswordLength: 10, maxPasswordLength: 128, resetPasswordTokenExpiresIn: 3600,
      sendResetPassword: async ({ user, url }) => deliver(user.email, {
        subject: "Reset password · AI Writing Workspace", url,
        heading: { id: "Reset password", en: "Reset your password" },
        body: { id: `Halo ${user.name}, kami menerima permintaan untuk mengganti password akunmu.`, en: `Hi ${user.name}, we received a request to reset your account password.` },
        action: { id: "Buat password baru", en: "Create a new password" },
        footnote: { id: "Link berlaku 1 jam. Abaikan email ini jika kamu tidak memintanya.", en: "The link expires in 1 hour. Ignore this email if you did not request it." },
      }),
    },
    emailVerification: {
      sendOnSignUp: false,
      sendVerificationEmail: async ({ user, url }) => deliver(user.email, {
        subject: "Verifikasi email · AI Writing Workspace", url,
        heading: { id: "Verifikasi alamat email", en: "Verify your email address" },
        body: { id: `Halo ${user.name}, klik tombol di bawah untuk memverifikasi ${user.email}.`, en: `Hi ${user.name}, click the button below to verify ${user.email}.` },
        action: { id: "Verifikasi email", en: "Verify email" },
        footnote: { id: "Abaikan email ini jika kamu tidak memintanya.", en: "Ignore this email if you did not request it." },
      }),
    },
    user: { changeEmail: { enabled: true } },
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
        "/request-password-reset": { window: 60, max: 3 },
        "/change-password": { window: 60, max: 5 },
        "/change-email": { window: 60, max: 3 },
      },
    },
    // Better Auth swallows sender failures, so reject email flows up front when delivery is unconfigured.
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (EMAIL_PATHS.has(ctx.path) && !emailConfigured()) throw APIError.from("SERVICE_UNAVAILABLE", { code: "EMAIL_CONFIGURATION_REQUIRED", message: "Email delivery is not configured." });
      }),
    },
    databaseHooks: {
      user: {
        create: {
          before: async (user, context) => {
            if (context?.path !== "/sign-up/email" && context?.path !== "/admin/create-user") return;
            const name = user.name.trim();
            if (!name || name.length > 100) throw APIError.from("BAD_REQUEST", { code: "INVALID_NAME", message: "Name must be 1 to 100 characters." });
            if (typeof user.username !== "string" || !user.username.trim()) throw APIError.from("BAD_REQUEST", { code: "USERNAME_REQUIRED", message: "Username is required." });
            return { data: { ...user, name } };
          },
        },
        update: {
          before: async (user) => {
            if (user.name === undefined) return;
            const name = typeof user.name === "string" ? user.name.trim() : "";
            if (!name || name.length > 100) throw APIError.from("BAD_REQUEST", { code: "INVALID_NAME", message: "Name must be 1 to 100 characters." });
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
    }), admin({ adminRoles: ["admin"], defaultRole: "user", bannedUserMessage: "This account has been disabled. Contact the administrator." })],
  });
}

async function deliver(to: string, template: EmailTemplate) { await sendEmail({ to, ...renderEmail(template) }); }

export type Role = "user" | "admin";
export type SessionUser = { id: string; email: string; name: string; username: string | null; image: string | null; role: Role };

export async function requireUser(request: Request): Promise<SessionUser> {
  const session = await auth().api.getSession({ headers: request.headers });
  if (!session?.user) throw new UnauthorizedError();
  const user = session.user as typeof session.user & { username?: string | null; role?: string | null; banned?: boolean | null; banExpires?: Date | string | null };
  // Ban is enforced at sign-in by the admin plugin; this covers sessions that were issued before the ban.
  if (user.banned && (!user.banExpires || new Date(user.banExpires).getTime() > Date.now())) throw new ForbiddenError("ACCOUNT_DISABLED", "This account has been disabled.");
  return { id: user.id, email: user.email, name: user.name, username: user.username ?? null, image: user.image ?? null, role: isAdminRole(user.role) ? "admin" : "user" };
}
export const isAdminRole = (role: string | null | undefined) => (role ?? "").split(",").map((item) => item.trim()).includes("admin");

export async function requireAdmin(request: Request): Promise<SessionUser> {
  const user = await requireUser(request);
  if (user.role !== "admin") throw new ForbiddenError();
  return user;
}

export class ForbiddenError extends Error { constructor(public code = "FORBIDDEN", message = "Admin access is required.") { super(message); this.name = "ForbiddenError"; } }

export class UnauthorizedError extends Error { constructor() { super("Sign in is required."); this.name = "UnauthorizedError"; } }
