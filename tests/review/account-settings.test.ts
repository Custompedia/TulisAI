import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { applyMigrations } from "../helpers/migrations";

const state = vi.hoisted(() => ({ env: {} as Record<string, unknown> }));
vi.mock("@/server/runtime", () => {
  class ConfigurationError extends Error {}
  return { runtime: () => state.env, requiredSetting: (value: string | undefined, name: string) => { if (!value) throw new ConfigurationError(`${name} missing`); return value; }, ConfigurationError };
});
import { auth } from "@/server/auth/auth";
import { ConfigurationError } from "@/server/runtime";
import { escapeHtml, renderEmail, sendEmail } from "@/server/email/send";
import { validateUsername } from "@/lib/auth/form";
import { ApiError, authErrorCode, errorText } from "@/lib/client/api";
import { GET } from "@/app/api/account/route";
import { POST as setPassword } from "@/app/api/account/password/route";

let db: DatabaseSync;
class Statement {
  constructor(readonly sql: string, readonly values: SQLInputValue[] = []) {}
  bind(...values: SQLInputValue[]) { return new Statement(this.sql, values); }
  async first<T>() { return db.prepare(this.sql).get(...this.values) as T | undefined ?? null; }
  async all<T>() { return { results: db.prepare(this.sql).all(...this.values) as T[], success: true }; }
  async raw<T>() { const statement = db.prepare(this.sql); statement.setReturnArrays(true); return statement.all(...this.values) as T[]; }
  async run() { const result = db.prepare(this.sql).run(...this.values); return { meta: { changes: Number(result.changes) } }; }
}
const sent: Array<{ from: string; to: string; subject: string; text: string; html: string }> = [];
const BASE = "http://localhost:3000";

beforeEach(() => {
  db = new DatabaseSync(":memory:");
  applyMigrations(db);
  sent.length = 0;
  state.env = { DB: { prepare: (sql: string) => new Statement(sql) }, BETTER_AUTH_SECRET: "a test secret that is long enough for Better Auth", BETTER_AUTH_URL: BASE, EMAIL: { send: async (message: (typeof sent)[number]) => { sent.push(message); return { messageId: "m" }; } }, EMAIL_FROM: "no-reply@example.test" };
});
afterEach(() => db.close());

const cookieOf = (response: Response) => response.headers.getSetCookie().map((cookie) => cookie.split(";")[0]).join("; ");
const authPost = (path: string, body: unknown, cookie?: string) => auth().handler(new Request(`${BASE}/api/auth${path}`, { method: "POST", headers: { "content-type": "application/json", origin: BASE, ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) }));
async function register() {
  const response = await authPost("/sign-up/email", { name: "Ada Lovelace", email: "ada@example.test", username: "ada", password: "correct horse battery" });
  expect(response.status).toBe(200);
  return cookieOf(response);
}
const getAccount = (cookie: string) => GET(new Request(`${BASE}/api/account`, { headers: { cookie } }));

describe("email rendering and delivery", () => {
  const template = { subject: "S", url: "https://app.test/r?token=a&b=\"x\"", heading: { id: "Halo <b>", en: "Hi <b>" }, body: { id: "Nama <script>alert(1)</script>", en: "Name & co" }, action: { id: "Buka", en: "Open" }, footnote: { id: "Catatan", en: "Note" } };
  it("escapes interpolated values and includes bilingual text", () => {
    const { html, text } = renderEmail(template);
    expect(escapeHtml(`<a href="x">'&`)).toBe("&lt;a href=&quot;x&quot;&gt;&#39;&amp;");
    expect(html).not.toContain("<script>");
    expect(html).toContain("Nama &lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain('href="https://app.test/r?token=a&amp;b=&quot;x&quot;"');
    expect(html).toContain("#5d7350");
    expect(html.indexOf('lang="id"')).toBeLessThan(html.indexOf('lang="en"'));
    expect(text.indexOf("Nama <script>")).toBeLessThan(text.indexOf("Name & co"));
  });
  it("requires the binding and a real sender address", async () => {
    const message = { to: "a@example.test", subject: "S", text: "t", html: "h" };
    state.env = { EMAIL_FROM: "no-reply@example.test" };
    await expect(sendEmail(message)).rejects.toBeInstanceOf(ConfigurationError);
    state.env = { EMAIL: { send: vi.fn() }, EMAIL_FROM: "no-reply@REPLACE_WITH_VERIFIED_DOMAIN" };
    await expect(sendEmail(message)).rejects.toBeInstanceOf(ConfigurationError);
    const send = vi.fn(async () => ({ messageId: "m" }));
    state.env = { EMAIL: { send }, EMAIL_FROM: "no-reply@example.test" };
    await sendEmail(message);
    expect(send).toHaveBeenCalledWith({ from: "no-reply@example.test", ...message });
  });
});

describe("account validation and error copy", () => {
  it.each(["ada", "ada.lovelace", "a_1.b", "ADA"])("accepts username %s", (value) => expect(validateUsername(value)).toBe(true));
  it.each(["ab", ".ada", "ada.", "ada lovelace", "ada!", "a".repeat(31)])("rejects username %s", (value) => expect(validateUsername(value)).toBe(false));
  it("maps Better Auth responses to codes", () => {
    expect(authErrorCode({ code: "INVALID_PASSWORD" }, 400)).toBe("INVALID_PASSWORD");
    expect(authErrorCode({ message: "Email is the same" }, 400)).toBe("EMAIL_THE_SAME");
    expect(authErrorCode(null, 429)).toBe("RATE_LIMITED");
    expect(authErrorCode({ error: { code: "SERVICE_UNAVAILABLE" } }, 503)).toBe("SERVICE_UNAVAILABLE");
    expect(authErrorCode(null, 400)).toBe("REQUEST_FAILED");
  });
  it.each([
    ["INVALID_PASSWORD", "Password saat ini salah."], ["PASSWORD_TOO_SHORT", "Password minimal 10 karakter."], ["PASSWORD_TOO_LONG", "Password maksimal 128 karakter."],
    ["SESSION_NOT_FRESH", "Masuk ulang dulu demi keamanan"], ["SESSION_EXPIRED", "Masuk ulang dulu demi keamanan"], ["USERNAME_IS_ALREADY_TAKEN", "sudah dipakai"],
    ["USERNAME_TOO_SHORT", "minimal 3"], ["USERNAME_TOO_LONG", "maksimal 30"], ["INVALID_USERNAME", "Username hanya boleh"], ["PASSWORD_ALREADY_SET", "sudah punya password"],
    ["EMAIL_THE_SAME", "sama dengan email saat ini"], ["INVALID_TOKEN", "tidak valid"], ["EMAIL_CONFIGURATION_REQUIRED", "Pengiriman email belum dikonfigurasi"], ["RATE_LIMITED", "Terlalu banyak"],
  ])("explains %s", (code, text) => {
    expect(errorText(new ApiError(code, 400), false)).toContain(text);
    expect(errorText(new ApiError(code, 400), true)).not.toBe(errorText(new ApiError("UNKNOWN", 400), true));
  });
});

describe("account routes", () => {
  it("returns the account shape for a credential user", async () => {
    const cookie = await register();
    const response = await getAccount(cookie);
    expect(response.status).toBe(200);
    const { data } = await response.json() as { data: Record<string, unknown> };
    expect(Object.keys(data).sort()).toEqual(["createdAt", "email", "emailVerified", "hasPassword", "id", "image", "name", "providers", "username"]);
    expect(data).toMatchObject({ name: "Ada Lovelace", email: "ada@example.test", username: "ada", emailVerified: false, image: null, hasPassword: true, providers: ["credential"] });
    expect(new Date(String(data.createdAt)).getTime()).not.toBeNaN();
    expect((await getAccount("")).status).toBe(401);
  });

  it("adds a password only for social-only accounts", async () => {
    const cookie = await register();
    const post = (body: unknown, key = "k1") => setPassword(new Request(`${BASE}/api/account/password`, { method: "POST", headers: { "content-type": "application/json", cookie, "Idempotency-Key": key }, body: JSON.stringify(body) }));
    expect((await post({ newPassword: "short" })).status).toBe(400);
    const already = await post({ newPassword: "another secure pass" });
    expect(already.status).toBe(400);
    expect(await already.json()).toMatchObject({ error: { code: "PASSWORD_ALREADY_SET" } });

    const user = db.prepare("SELECT id FROM user").get() as { id: string };
    db.prepare("DELETE FROM account WHERE provider_id='credential'").run();
    db.prepare("INSERT INTO account (id,account_id,provider_id,user_id,created_at,updated_at) VALUES ('g','google-1','google',?,1,1)").run(user.id);
    expect(await (await getAccount(cookie)).json()).toMatchObject({ data: { hasPassword: false, providers: ["google"] } });
    expect((await post({ newPassword: "another secure pass" }, "k2")).status).toBe(200);
    expect(await (await getAccount(cookie)).json()).toMatchObject({ data: { hasPassword: true } });
    expect((await authPost("/sign-in/email", { email: "ada@example.test", password: "another secure pass" })).status).toBe(200);
  }, 15000);

  it("validates profile names on update", async () => {
    const cookie = await register();
    const blank = await authPost("/update-user", { name: "   " }, cookie);
    expect(blank.status).toBe(400);
    expect(await blank.json()).toMatchObject({ code: "INVALID_NAME" });
    expect((await authPost("/update-user", { name: "  Ada King " }, cookie)).status).toBe(200);
    expect(db.prepare("SELECT name FROM user").get()).toEqual({ name: "Ada King" });
  });

  it("emails a reset link that sets a new password", async () => {
    await register();
    expect((await authPost("/request-password-reset", { email: "missing@example.test", redirectTo: "/reset-password" })).status).toBe(200);
    expect(sent).toHaveLength(0);
    expect((await authPost("/request-password-reset", { email: "ada@example.test", redirectTo: "/reset-password" })).status).toBe(200);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ from: "no-reply@example.test", to: "ada@example.test" });
    const link = /https?:\/\/[^\s]+/.exec(sent[0]!.text)?.[0] ?? "";
    const redirect = await auth().handler(new Request(link));
    const location = new URL(redirect.headers.get("location") ?? "", BASE);
    expect(location.pathname).toBe("/reset-password");
    const token = location.searchParams.get("token");
    expect(token).toBeTruthy();
    expect((await authPost("/reset-password", { newPassword: "brand new password", token })).status).toBe(200);
    expect(await (await authPost("/reset-password", { newPassword: "brand new password", token })).json()).toMatchObject({ code: "INVALID_TOKEN" });
    expect((await authPost("/sign-in/email", { email: "ada@example.test", password: "brand new password" })).status).toBe(200);
  });

  it("reports unconfigured email delivery with a dedicated code", async () => {
    await register();
    state.env = { ...state.env, EMAIL: undefined };
    const response = await authPost("/request-password-reset", { email: "ada@example.test", redirectTo: "/reset-password" });
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: "EMAIL_CONFIGURATION_REQUIRED" });
  });

  it("sends a verification link to the new email when changing email", async () => {
    const cookie = await register();
    expect((await authPost("/change-email", { newEmail: "ada@example.test" }, cookie)).status).toBe(400);
    expect((await authPost("/change-email", { newEmail: "ada.new@example.test", callbackURL: "/settings?email=changed#profil" }, cookie)).status).toBe(200);
    expect(sent.at(-1)?.to).toBe("ada.new@example.test");
    expect(db.prepare("SELECT email FROM user").get()).toEqual({ email: "ada@example.test" });
    const link = /https?:\/\/[^\s]+/.exec(sent.at(-1)!.text)?.[0] ?? "";
    const verified = await auth().handler(new Request(link, { headers: { cookie } }));
    expect(verified.headers.get("location")).toContain("/settings?email=changed");
    expect(db.prepare("SELECT email,email_verified FROM user").get()).toEqual({ email: "ada.new@example.test", email_verified: 1 });
  });
});
