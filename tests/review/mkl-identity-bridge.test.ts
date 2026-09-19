import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { exportJWK, generateKeyPair, SignJWT, type CryptoKey } from "jose";
import { applyMigrations, migrationFiles } from "../helpers/migrations";

const state = vi.hoisted(() => ({ env: {} as Record<string, unknown> }));
vi.mock("@/server/runtime", () => {
  class ConfigurationError extends Error {}
  return { runtime: () => state.env, requiredSetting: (value: string | undefined, name: string) => { if (!value) throw new ConfigurationError(`${name} missing`); return value; }, ConfigurationError };
});

import { auth } from "@/server/auth/auth";
import { DELETE as deleteAccount } from "@/app/api/account/route";
import { GET as getConfirmation, POST as confirmLink } from "@/app/api/account/mkl/link/confirm/route";
import { assertRoleChange, getUser } from "@/server/admin/service";

let db: DatabaseSync;
class Statement {
  constructor(readonly sql: string, readonly values: SQLInputValue[] = []) {}
  bind(...values: SQLInputValue[]) { return new Statement(this.sql, values); }
  execute() { const value = db.prepare(this.sql).run(...this.values); return { success: true, results: [], meta: { changes: Number(value.changes) } }; }
  async first<T>() { return db.prepare(this.sql).get(...this.values) as T | undefined ?? null; }
  async all<T>() { return { results: db.prepare(this.sql).all(...this.values) as T[], success: true, meta: { changes: 0 } }; }
  async raw<T>() { const statement = db.prepare(this.sql); statement.setReturnArrays(true); return statement.all(...this.values) as T[]; }
  async run() { return this.execute(); }
}
const d1 = () => ({
  prepare: (sql: string) => new Statement(sql),
  batch: async (statements: Statement[]) => {
    db.exec("BEGIN");
    try { const results = statements.map((statement) => statement.execute()); db.exec("COMMIT"); return results; }
    catch (error) { db.exec("ROLLBACK"); throw error; }
  },
});

const APP = "https://tulis.marikitalembur.com"; const ISSUER = "https://mkl.test";
let privateKey: CryptoKey; let publicJwk: Record<string, unknown>; let subject = "mkl-subject-1"; let profileEmail = "ada@example.test"; let profileName = "Ada MKL"; let profileVerified = true; let tokenCalls = 0; let tokenFailure = false;

const cookiePairs = (response: Response) => response.headers.getSetCookie().map((value) => value.split(";", 1)[0]!);
function cookieJar(...parts: Array<string | Response>): string {
  const values = parts.flatMap((part) => typeof part === "string" ? part.split(/;\s*/) : cookiePairs(part)); const jar = new Map<string, string>();
  for (const value of values) { const index = value.indexOf("="); if (index > 0) jar.set(value.slice(0, index), value.slice(index + 1)); }
  return [...jar].map(([name, value]) => `${name}=${value}`).join("; ");
}
const post = (path: string, body: unknown, cookie?: string) => auth().handler(new Request(`${APP}/api/auth${path}`, { method: "POST", headers: { "content-type": "application/json", origin: APP, ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) }));

async function begin(path = "/mkl/start", cookie?: string) {
  const response = await post(path, { returnTo: "/documents/123?panel=history" }, cookie); expect(response.status).toBe(200);
  const body = await response.json() as { url: string }; return { response, url: new URL(body.url), cookie: cookieJar(cookie ?? "", response) };
}
async function callback(flow: Awaited<ReturnType<typeof begin>>, cookie = flow.cookie) {
  return auth().handler(new Request(`${APP}/api/auth/mkl/callback?code=one-time-code&state=${encodeURIComponent(flow.url.searchParams.get("state")!)}`, { headers: { cookie } }));
}

beforeEach(async () => {
  db = new DatabaseSync(":memory:"); applyMigrations(db);
  state.env = { DB: d1(), BETTER_AUTH_SECRET: "a test secret that is long enough for Better Auth", BETTER_AUTH_URL: APP, MKL_ISSUER: ISSUER, MKL_CLIENT_ID: "tulis-test", MKL_CLIENT_SECRET: "test-client-secret" };
  const pair = await generateKeyPair("RS256"); privateKey = pair.privateKey; publicJwk = { ...await exportJWK(pair.publicKey), kid: "current", alg: "RS256", use: "sig" };
  subject = "mkl-subject-1"; profileEmail = "ada@example.test"; profileName = "Ada MKL"; profileVerified = true; tokenCalls = 0; tokenFailure = false;
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input : input.url);
    if (url.pathname === "/.well-known/openid-configuration") return Response.json({ issuer: ISSUER, authorization_endpoint: `${ISSUER}/sso/authorize`, token_endpoint: `${ISSUER}/sso/token`, jwks_uri: `${ISSUER}/.well-known/jwks.json` });
    if (url.pathname === "/.well-known/jwks.json") return Response.json({ keys: [publicJwk] });
    if (url.pathname === "/sso/token") {
      tokenCalls += 1; const form = new URLSearchParams(String(init?.body)); expect(form.get("client_secret")).toBe("test-client-secret");
      if (tokenFailure) return Response.json({ error: "invalid_code" }, { status: 400 });
      const nonce = (globalThis as typeof globalThis & { __mklNonce?: string }).__mklNonce;
      const idToken = await new SignJWT({ nonce, email: profileEmail, email_verified: profileVerified, name: profileName, role: "admin", tier: "max", entitlement: "paid" }).setProtectedHeader({ alg: "RS256", kid: "current" }).setIssuer(ISSUER).setSubject(subject).setAudience("tulis-test").setIssuedAt().setExpirationTime("5m").sign(privateKey);
      return Response.json({ id_token: idToken, token_type: "id_token", expires_in: 300, scope: "email openid profile" });
    }
    throw new Error(`unexpected fetch ${url}`);
  }));
});
afterEach(() => { vi.unstubAllGlobals(); db.close(); delete (globalThis as typeof globalThis & { __mklNonce?: string }).__mklNonce; });

function rememberNonce(flow: Awaited<ReturnType<typeof begin>>) { (globalThis as typeof globalThis & { __mklNonce?: string }).__mklNonce = flow.url.searchParams.get("nonce")!; }

describe("MKL sign-in", () => {
  it("provisions one free local customer, creates an ordinary session, and consumes state once", async () => {
    const flow = await begin(); rememberNonce(flow);
    expect(flow.url.searchParams.get("redirect_uri")).toBe(`${APP}/api/auth/mkl/callback`);
    const browserCookie = flow.response.headers.getSetCookie().find((cookie) => cookie.startsWith("__Host-tulis_mkl_browser="))!;
    expect(browserCookie).toContain("Path=/"); expect(browserCookie).toContain("HttpOnly"); expect(browserCookie).toContain("SameSite=Lax"); expect(browserCookie).toContain("Secure"); expect(browserCookie).not.toContain("Domain=");
    const response = await callback(flow); expect(response.status).toBe(302); expect(response.headers.get("location")).toBe(`${APP}/onboarding`);
    expect(response.headers.getSetCookie().join(";")).toContain("__Secure-better-auth.session_token=");
    expect(db.prepare("SELECT email,role,tier,username FROM user").get()).toEqual({ email: "ada@example.test", role: "user", tier: "free", username: null });
    expect(db.prepare("SELECT issuer,subject,provider,profile_email FROM external_identity_link").get()).toMatchObject({ issuer: ISSUER, subject, provider: "mkl", profile_email: "ada@example.test" });
    expect(db.prepare("SELECT action FROM admin_audit_log").all()).toEqual([{ action: "identity.mkl.account-created" }]);
    const auditDetails = String((db.prepare("SELECT details_json FROM admin_audit_log").get() as { details_json: string }).details_json);
    expect(auditDetails).not.toContain("test-client-secret"); expect(auditDetails).not.toContain("one-time-code"); expect(auditDetails).not.toContain(flow.url.searchParams.get("state")!); expect(auditDetails).not.toContain(flow.url.searchParams.get("nonce")!);
    expect(tokenCalls).toBe(1);
    const replay = await callback(flow); expect(replay.status).toBe(302); expect(replay.headers.get("location")).toContain("code=MKL_STATE_INVALID"); expect(tokenCalls).toBe(1);
    expect(db.prepare("SELECT COUNT(*) AS n FROM user").get()).toEqual({ n: 1 });
  }, 20000);

  it("signs a known subject into its owner, preserves local authority, and leaves the link on local logout", async () => {
    const first = await begin(); rememberNonce(first); const created = await callback(first); const sessionCookie = cookieJar(created);
    db.prepare("UPDATE user SET tier='pro' WHERE email=?").run(profileEmail);
    const second = await begin(); rememberNonce(second); const signedIn = await callback(second);
    expect(signedIn.headers.get("location")).toBe(`${APP}/documents/123?panel=history`);
    expect(db.prepare("SELECT role,tier FROM user").get()).toEqual({ role: "user", tier: "pro" });
    const logout = await post("/sign-out", {}, sessionCookie); expect(logout.status).toBe(200);
    expect(db.prepare("SELECT COUNT(*) AS n FROM external_identity_link").get()).toEqual({ n: 1 });
  }, 20000);

  it("refuses a case-insensitive local email collision without adopting the account", async () => {
    db.prepare("INSERT INTO user (id,name,email,email_verified,role,tier,banned,created_at,updated_at) VALUES ('local','Local','Ada@Example.Test',1,'user','free',0,1,1)").run();
    const flow = await begin(); rememberNonce(flow); const response = await callback(flow);
    expect(response.headers.get("location")).toContain("code=MKL_EMAIL_CONFLICT");
    expect(db.prepare("SELECT COUNT(*) AS n FROM external_identity_link").get()).toEqual({ n: 0 });
    expect(db.prepare("SELECT COUNT(*) AS n FROM user").get()).toEqual({ n: 1 });
  }, 20000);

  it("allows exactly one concurrent callback and never revives cancelled or failed exchanges", async () => {
    const concurrent = await begin(); rememberNonce(concurrent);
    const results = await Promise.all([callback(concurrent), callback(concurrent)]);
    expect(results.map((response) => response.headers.get("location")).sort()).toEqual([`${APP}/login?error=mkl&code=MKL_STATE_INVALID`, `${APP}/onboarding`].sort());
    expect(tokenCalls).toBe(1); expect(db.prepare("SELECT COUNT(*) AS n FROM user").get()).toEqual({ n: 1 });

    subject = "cancelled"; profileEmail = "cancelled@example.test"; tokenCalls = 0;
    const cancelled = await begin(); rememberNonce(cancelled);
    const cancelledResponse = await auth().handler(new Request(`${APP}/api/auth/mkl/callback?error=access_denied&state=${encodeURIComponent(cancelled.url.searchParams.get("state")!)}`, { headers: { cookie: cancelled.cookie } }));
    expect(cancelledResponse.headers.get("location")).toContain("code=MKL_AUTH_CANCELLED");
    expect((await callback(cancelled)).headers.get("location")).toContain("code=MKL_STATE_INVALID"); expect(tokenCalls).toBe(0);

    const failed = await begin(); rememberNonce(failed); tokenFailure = true;
    expect((await callback(failed)).headers.get("location")).toContain("code=MKL_TOKEN_INVALID");
    tokenFailure = false; expect((await callback(failed)).headers.get("location")).toContain("code=MKL_STATE_INVALID"); expect(tokenCalls).toBe(1);
  }, 30000);

  it("requires a verified email for provisioning and refuses a banned linked owner", async () => {
    profileVerified = false; const incomplete = await begin(); rememberNonce(incomplete);
    expect((await callback(incomplete)).headers.get("location")).toContain("code=MKL_PROFILE_INCOMPLETE"); expect(db.prepare("SELECT COUNT(*) AS n FROM user").get()).toEqual({ n: 0 });
    profileVerified = true; const create = await begin(); rememberNonce(create); await callback(create);
    db.prepare("UPDATE user SET banned=1,ban_expires=NULL").run(); const banned = await begin(); rememberNonce(banned);
    expect((await callback(banned)).headers.get("location")).toContain("code=ACCOUNT_DISABLED");
  }, 30000);
});

describe("explicit MKL linking", () => {
  it("requires a local session and writes no link until browser-bound confirmation", async () => {
    const unauthenticated = await post("/mkl/link/start", { returnTo: "/settings#profil" }); expect(unauthenticated.status).toBe(401);
    const registered = await post("/sign-up/email", { name: "Local Ada", email: "ada@example.test", username: "ada", password: "correct horse battery" });
    const localCookie = cookieJar(registered); const flow = await begin("/mkl/link/start", localCookie); rememberNonce(flow);
    const returned = await callback(flow); expect(returned.headers.get("location")).toBe(`${APP}/settings?mkl=confirm#profil`);
    expect(db.prepare("SELECT COUNT(*) AS n FROM external_identity_link").get()).toEqual({ n: 0 });
    const allCookies = cookieJar(flow.cookie, returned); expect(allCookies).toContain("__Host-tulis_mkl_consent=");
    const preview = await getConfirmation(new Request(`${APP}/api/account/mkl/link/confirm`, { headers: { cookie: allCookies } }));
    expect(preview.status).toBe(200); expect(await preview.json()).toMatchObject({ data: { profile: { name: "Ada MKL", email: "ada@example.test", issuer: ISSUER } } });
    const confirmed = await confirmLink(new Request(`${APP}/api/account/mkl/link/confirm`, { method: "POST", headers: { cookie: allCookies, origin: APP, "Idempotency-Key": "confirm-1" } }));
    expect(confirmed.status).toBe(200); expect(db.prepare("SELECT link_method FROM external_identity_link").get()).toEqual({ link_method: "explicit-link" });
    expect(db.prepare("SELECT action FROM admin_audit_log").all()).toEqual([{ action: "identity.mkl.linked" }]);
    const replay = await confirmLink(new Request(`${APP}/api/account/mkl/link/confirm`, { method: "POST", headers: { cookie: allCookies, origin: APP, "Idempotency-Key": "confirm-2" } }));
    expect(replay.status).toBe(400); expect(db.prepare("SELECT COUNT(*) AS n FROM admin_audit_log").get()).toEqual({ n: 1 });
    const deletion = await deleteAccount(new Request(`${APP}/api/account`, { method: "DELETE", headers: { cookie: localCookie, "Idempotency-Key": "delete-1" } }));
    expect(deletion.status).toBe(409); expect(await deletion.json()).toMatchObject({ error: { code: "MKL_LINKED_ACCOUNT_DELETE_FORBIDDEN" } });
    const linked = await getUser((db.prepare("SELECT id FROM user").get() as { id: string }).id);
    await expect(assertRoleChange("admin", linked, "admin")).rejects.toMatchObject({ code: "MKL_LINKED_ADMIN_FORBIDDEN" });
  }, 30000);

  it("rejects a callback in a different browser before token exchange", async () => {
    const registered = await post("/sign-up/email", { name: "Local Ada", email: "ada@example.test", username: "ada", password: "correct horse battery" });
    const flow = await begin("/mkl/link/start", cookieJar(registered)); rememberNonce(flow);
    const wrongBrowser = cookieJar(cookieJar(registered), "__Host-tulis_mkl_browser=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
    const response = await callback(flow, wrongBrowser); expect(response.headers.get("location")).toContain("code=MKL_STATE_INVALID"); expect(tokenCalls).toBe(0);
  }, 20000);

  it("rejects missing browser binding and an unknown state before token exchange", async () => {
    const flow = await begin(); rememberNonce(flow);
    const missingBrowser = await callback(flow, ""); expect(missingBrowser.headers.get("location")).toContain("code=MKL_STATE_INVALID"); expect(tokenCalls).toBe(0);
    const unknown = await auth().handler(new Request(`${APP}/api/auth/mkl/callback?code=x&state=${"A".repeat(43)}`, { headers: { cookie: flow.cookie } }));
    expect(unknown.headers.get("location")).toContain("code=MKL_STATE_INVALID"); expect(tokenCalls).toBe(0);
    const expiredFlow = await begin(); rememberNonce(expiredFlow); db.prepare("UPDATE verification SET expires_at=0 WHERE identifier LIKE 'mkl:authorize:%'").run();
    const expired = await callback(expiredFlow); expect(expired.headers.get("location")).toContain("code=MKL_STATE_EXPIRED"); expect(tokenCalls).toBe(0);
  }, 20000);

  it("requires the same local session after callback and refuses local admins before authorization", async () => {
    const registered = await post("/sign-up/email", { name: "Local Ada", email: "ada@example.test", username: "ada", password: "correct horse battery" });
    const localCookie = cookieJar(registered); const flow = await begin("/mkl/link/start", localCookie); rememberNonce(flow);
    const browserOnly = flow.cookie.split("; ").filter((value) => value.startsWith("__Host-tulis_mkl_browser=")).join("; ");
    expect((await callback(flow, browserOnly)).headers.get("location")).toContain("code=UNAUTHENTICATED"); expect(tokenCalls).toBe(0);
    const replacement = await post("/sign-in/email", { email: "ada@example.test", password: "correct horse battery" });
    const replacementWithBrowser = cookieJar(replacement, browserOnly);
    const secondFlow = await begin("/mkl/link/start", localCookie); rememberNonce(secondFlow);
    const secondBrowser = secondFlow.cookie.split("; ").filter((value) => value.startsWith("__Host-tulis_mkl_browser=")).join("; ");
    expect((await callback(secondFlow, cookieJar(replacementWithBrowser, secondBrowser))).headers.get("location")).toContain("code=UNAUTHENTICATED"); expect(tokenCalls).toBe(0);
    db.prepare("UPDATE user SET role='admin'").run();
    const refused = await post("/mkl/link/start", { returnTo: "/settings#profil" }, localCookie); expect(refused.status).toBe(403); expect(await refused.json()).toMatchObject({ code: "MKL_ADMIN_LINK_FORBIDDEN" });
  }, 20000);

  it("keeps Better Auth local sessions and disables provider email auto-linking", async () => {
    expect((await auth().$context).options.account?.accountLinking?.disableImplicitLinking).toBe(true);
    const registered = await post("/sign-up/email", { name: "Local Ada", email: "ada@example.test", username: "ada", password: "correct horse battery" }); expect(registered.status).toBe(200);
    expect((await post("/sign-in/email", { email: "ada@example.test", password: "correct horse battery" })).status).toBe(200);
    state.env = { ...state.env, GOOGLE_CLIENT_ID: "google-test-client", GOOGLE_CLIENT_SECRET: "google-test-secret" };
    const google = await post("/sign-in/social", { provider: "google", callbackURL: "/app", newUserCallbackURL: "/onboarding" });
    expect(google.status).toBe(200); expect((await google.json() as { url: string }).url).toContain("accounts.google.com");
    expect((await post("/mkl/unlink", {}, cookieJar(registered))).status).toBe(404);
  }, 20000);

  it("blocks direct Better Auth promotion and deletion endpoints for linked customers", async () => {
    const adminRegistration = await post("/sign-up/email", { name: "Local Admin", email: "admin@example.test", username: "admin", password: "correct horse battery" });
    const adminId = (db.prepare("SELECT id FROM user WHERE email='admin@example.test'").get() as { id: string }).id;
    db.prepare("UPDATE user SET role='admin' WHERE id=?").run(adminId);
    const customerRegistration = await post("/sign-up/email", { name: "Customer", email: "customer@example.test", username: "customer", password: "correct horse battery" });
    const customerId = (db.prepare("SELECT id FROM user WHERE email='customer@example.test'").get() as { id: string }).id;
    db.prepare("INSERT INTO external_identity_link (id,provider,issuer,subject,user_id,link_method,created_at,updated_at) VALUES ('linked','mkl',?,'linked-subject',?,'explicit-link',1,1)").run(ISSUER, customerId);
    const adminCookie = cookieJar(adminRegistration); expect(cookieJar(customerRegistration)).not.toBe(adminCookie);
    const setRole = await post("/admin/set-role", { userId: customerId, role: "admin" }, adminCookie);
    expect(setRole.status).toBe(403); expect(await setRole.json()).toMatchObject({ code: "MKL_LINKED_ADMIN_FORBIDDEN" });
    const updateRole = await post("/admin/update-user", { userId: customerId, data: { role: ["admin"] } }, adminCookie);
    expect(updateRole.status).toBe(403); expect(await updateRole.json()).toMatchObject({ code: "MKL_LINKED_ADMIN_FORBIDDEN" });
    const remove = await post("/admin/remove-user", { userId: customerId }, adminCookie);
    expect(remove.status).toBe(403); expect(await remove.json()).toMatchObject({ code: "MKL_LINKED_ACCOUNT_DELETE_FORBIDDEN" });
    expect(db.prepare("SELECT role FROM user WHERE id=?").get(customerId)).toEqual({ role: "user" });
  }, 30000);

  it("refuses an MKL identity owned by another user and a user already linked to MKL", async () => {
    const first = await post("/sign-up/email", { name: "First", email: "first@example.test", username: "first", password: "correct horse battery" });
    const firstId = (db.prepare("SELECT id FROM user WHERE email='first@example.test'").get() as { id: string }).id;
    db.prepare("INSERT INTO external_identity_link (id,provider,issuer,subject,user_id,link_method,created_at,updated_at) VALUES ('first-link','mkl',?,? ,?,'explicit-link',1,1)").run(ISSUER, subject, firstId);
    const second = await post("/sign-up/email", { name: "Second", email: "second@example.test", username: "second", password: "correct horse battery" });
    const secondFlow = await begin("/mkl/link/start", cookieJar(second)); rememberNonce(secondFlow);
    const refused = await callback(secondFlow); expect(refused.headers.get("location")).toContain("code=MKL_IDENTITY_LINKED_ELSEWHERE");
    expect(db.prepare("SELECT COUNT(*) AS n FROM external_identity_link").get()).toEqual({ n: 1 });
    const alreadyLinked = await post("/mkl/link/start", { returnTo: "/settings#profil" }, cookieJar(first));
    expect(alreadyLinked.status).toBe(400); expect(await alreadyLinked.json()).toMatchObject({ code: "MKL_ACCOUNT_ALREADY_LINKED" });
  }, 30000);

  it("allows only one of two pending users to confirm the same MKL subject", async () => {
    const first = await post("/sign-up/email", { name: "First", email: "first@example.test", username: "first", password: "correct horse battery" });
    const second = await post("/sign-up/email", { name: "Second", email: "second@example.test", username: "second", password: "correct horse battery" });
    const firstFlow = await begin("/mkl/link/start", cookieJar(first)); rememberNonce(firstFlow); const firstCallback = await callback(firstFlow); const firstCookies = cookieJar(firstFlow.cookie, firstCallback);
    const secondFlow = await begin("/mkl/link/start", cookieJar(second)); rememberNonce(secondFlow); const secondCallback = await callback(secondFlow); const secondCookies = cookieJar(secondFlow.cookie, secondCallback);
    const confirm = (cookies: string, key: string) => confirmLink(new Request(`${APP}/api/account/mkl/link/confirm`, { method: "POST", headers: { cookie: cookies, origin: APP, "Idempotency-Key": key } }));
    const responses = await Promise.all([confirm(firstCookies, "first-confirm"), confirm(secondCookies, "second-confirm")]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    expect(db.prepare("SELECT COUNT(*) AS n FROM external_identity_link WHERE issuer=? AND subject=?").get(ISSUER, subject)).toEqual({ n: 1 });
    expect(db.prepare("SELECT action,COUNT(*) AS n FROM admin_audit_log GROUP BY action ORDER BY action").all()).toEqual([
      { action: "identity.mkl.link-refused", n: 1 }, { action: "identity.mkl.linked", n: 1 },
    ]);
  }, 30000);
});

describe("migration authority", () => {
  it("enforces one owner per issuer/subject and one MKL identity per local user", () => {
    const columns = db.prepare("PRAGMA table_info(external_identity_link)").all() as Array<{ name: string }>;
    expect(columns.map((column) => column.name)).toEqual(["id", "provider", "issuer", "subject", "user_id", "profile_email", "profile_name", "link_method", "created_at", "updated_at", "last_authenticated_at"]);
    db.prepare("INSERT INTO user (id,name,email,email_verified,role,tier,banned,created_at,updated_at) VALUES ('u','U','u@example.test',1,'user','free',0,1,1)").run();
    db.prepare("INSERT INTO external_identity_link (id,provider,issuer,subject,user_id,link_method,created_at,updated_at) VALUES ('l','mkl','i','s','u','explicit-link',1,1)").run();
    expect(() => db.prepare("INSERT INTO external_identity_link (id,provider,issuer,subject,user_id,link_method,created_at,updated_at) VALUES ('l2','mkl','i','s2','u','explicit-link',1,1)").run()).toThrow();
    expect(() => db.prepare("INSERT INTO external_identity_link (id,provider,issuer,subject,user_id,link_method,created_at,updated_at) VALUES ('l3','other','i','s','u','explicit-link',1,1)").run()).toThrow();
    expect(() => db.prepare("UPDATE user SET role='admin' WHERE id='u'").run()).toThrow(/MKL_LINKED_ADMIN_FORBIDDEN/);
    expect(() => db.prepare("DELETE FROM user WHERE id='u'").run()).toThrow(/MKL_LINKED_ACCOUNT_DELETE_FORBIDDEN/);
    db.prepare("INSERT INTO user (id,name,email,email_verified,role,tier,banned,created_at,updated_at) VALUES ('a','A','a@example.test',1,'admin','free',0,1,1)").run();
    expect(() => db.prepare("INSERT INTO external_identity_link (id,provider,issuer,subject,user_id,link_method,created_at,updated_at) VALUES ('la','mkl','i','sa','a','explicit-link',1,1)").run()).toThrow(/MKL_ADMIN_LINK_FORBIDDEN/);
  });

  it("upgrades representative credential and Google accounts without changing them", () => {
    const existing = new DatabaseSync(":memory:");
    try {
      for (const name of migrationFiles().filter((name) => name !== "0011_mkl_identity_bridge.sql")) existing.exec(readFileSync(join("migrations", name), "utf8"));
      existing.prepare("INSERT INTO user (id,name,email,email_verified,username,role,tier,banned,created_at,updated_at) VALUES ('credential-user','Credential','credential@example.test',1,'credential','user','free',0,1,1),('google-user','Google','google@example.test',1,NULL,'user','free',0,1,1)").run();
      existing.prepare("INSERT INTO account (id,account_id,provider_id,user_id,password,created_at,updated_at) VALUES ('credential-account','credential-user','credential','credential-user','hash',1,1),('google-account','google-sub','google','google-user',NULL,1,1)").run();
      existing.exec(readFileSync(join("migrations", "0011_mkl_identity_bridge.sql"), "utf8"));
      expect(existing.prepare("SELECT id,email,role,tier FROM user ORDER BY id").all()).toEqual([
        { id: "credential-user", email: "credential@example.test", role: "user", tier: "free" },
        { id: "google-user", email: "google@example.test", role: "user", tier: "free" },
      ]);
      expect(existing.prepare("SELECT id,provider_id,user_id FROM account ORDER BY id").all()).toEqual([
        { id: "credential-account", provider_id: "credential", user_id: "credential-user" },
        { id: "google-account", provider_id: "google", user_id: "google-user" },
      ]);
    } finally { existing.close(); }
  });
});
