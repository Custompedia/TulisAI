import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { username } from "better-auth/plugins";
import { APIError } from "better-auth/api";
import { drizzle } from "drizzle-orm/d1";
import { ConfigurationError, runtime, requiredSetting } from "../runtime";
import { renderEmail, sendEmail, type EmailTemplate } from "../email/send";
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
    })],
  });
}

async function deliver(to: string, template: EmailTemplate) {
  try { await sendEmail({ to, ...renderEmail(template) }); }
  catch (error) {
    if (error instanceof ConfigurationError) throw APIError.from("SERVICE_UNAVAILABLE", { code: "EMAIL_CONFIGURATION_REQUIRED", message: "Email delivery is not configured." });
    console.error("email delivery failure", error instanceof Error ? error.name : "unknown");
    throw APIError.from("BAD_GATEWAY", { code: "EMAIL_SEND_FAILED", message: "Email could not be sent." });
  }
}

export async function requireUser(request: Request): Promise<{ id: string; email: string; name: string; image: string | null }> {
  const session = await auth().api.getSession({ headers: request.headers });
  if (!session?.user) throw new UnauthorizedError();
  return { id: session.user.id, email: session.user.email, name: session.user.name, image: session.user.image ?? null };
}

export class UnauthorizedError extends Error { constructor() { super("Sign in is required."); this.name = "UnauthorizedError"; } }
