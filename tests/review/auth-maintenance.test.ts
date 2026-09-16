import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { readFileSync } from "node:fs";
import { purgeExpiredPreviewPayloads, sweepOrphanSnapshots } from "@/server/storage/maintenance";

const authState = vi.hoisted(() => ({ env: {} as Record<string, unknown> }));
vi.mock("@/server/runtime", () => {
  class ConfigurationError extends Error {}
  return { runtime: () => authState.env, requiredSetting: (value: string | undefined, name: string) => { if (!value) throw new ConfigurationError(`${name} missing`); return value; }, ConfigurationError };
});
import { auth } from "@/server/auth/auth";

let db: DatabaseSync;
const objects = new Map<string, { body: string; uploaded: Date }>();
class Statement {
  constructor(readonly sql: string, readonly values: SQLInputValue[] = []) {}
  bind(...values: SQLInputValue[]) { return new Statement(this.sql, values); }
  async first<T>() { return db.prepare(this.sql).get(...this.values) as T | undefined ?? null; }
  async all<T>() { return { results: db.prepare(this.sql).all(...this.values) as T[], success: true }; }
  async raw<T>() { const statement = db.prepare(this.sql); statement.setReturnArrays(true); return statement.all(...this.values) as T[]; }
  async run() { const result = db.prepare(this.sql).run(...this.values); return { meta: { changes: Number(result.changes) } }; }
}
const env = {
  DB: { prepare: (sql: string) => new Statement(sql) },
  DOCUMENTS: {
    list: async () => ({ objects: [...objects].map(([key, object]) => ({ key, uploaded: object.uploaded })), truncated: false }),
    delete: async (keys: string | string[]) => { for (const key of Array.isArray(keys) ? keys : [keys]) objects.delete(key); }
  }
} as unknown as { DB: D1Database; DOCUMENTS: R2Bucket };

beforeEach(() => { db = new DatabaseSync(":memory:"); db.exec(readFileSync("migrations/0000_initial.sql", "utf8")); db.exec(readFileSync("migrations/0001_username_auth.sql", "utf8")); db.exec(readFileSync("migrations/0002_workspace_metadata.sql", "utf8")); db.exec(readFileSync("migrations/0003_notebook_appearance.sql", "utf8")); db.exec(readFileSync("migrations/0005_user_role.sql", "utf8")); db.exec(readFileSync("migrations/0006_admin_panel.sql", "utf8")); db.exec(readFileSync("migrations/0007_usage_created_index.sql", "utf8")); objects.clear(); });
afterEach(() => db.close());
const documentRow = () => db.prepare("INSERT INTO documents (id,owner_id,title,language,created_at,updated_at) VALUES ('d','u','D','id',1,1)").run();

describe("scheduled retention maintenance", () => {
  it("scrubs expired payload but retains transformation metadata", async () => {
    documentRow();
    db.prepare("INSERT INTO transformations (id,document_id,owner_id,prompt_id,prompt_version,model,source_revision,source_text,runtime_json,output_json,status,idempotency_key,expires_at,created_at) VALUES ('t','d','u','P01_STANDARD_REWRITE','v1','m',0,'secret','{\"x\":1}','{\"transformed_text\":\"secret\"}','applied','k',1,1)").run();
    expect(await purgeExpiredPreviewPayloads(env, 2)).toBe(1);
    expect(db.prepare("SELECT prompt_id,status,source_text,output_json FROM transformations WHERE id='t'").get()).toMatchObject({ prompt_id: "P01_STANDARD_REWRITE", status: "applied", source_text: "", output_json: "{}" });
  });
  it("keeps referenced snapshots and deletes only old unreferenced objects in one sweep", async () => {
    documentRow();
    const old = new Date(0); objects.set("documents/d/versions/keep.json", { body: "x", uploaded: old }); objects.set("documents/d/versions/orphan.json", { body: "x", uploaded: old }); objects.set("documents/d/versions/new.json", { body: "x", uploaded: new Date(Date.now()) });
    db.prepare("INSERT INTO document_versions (id,document_id,owner_id,kind,revision,snapshot_r2_key,snapshot_hash,created_at) VALUES ('v','d','u','original',0,'documents/d/versions/keep.json','h',1)").run();
    const result = await sweepOrphanSnapshots(env, Date.now());
    expect(result.deleted).toBe(1); expect(objects.has("documents/d/versions/keep.json")).toBe(true); expect(objects.has("documents/d/versions/orphan.json")).toBe(false); expect(objects.has("documents/d/versions/new.json")).toBe(true);
  });
});

describe("Better Auth D1 adapter", () => {
  it("uses the mapped user and session tables through the real Drizzle adapter", async () => {
    authState.env = { DB: env.DB, BETTER_AUTH_SECRET: "a test secret that is long enough for Better Auth", BETTER_AUTH_URL: "http://localhost:3000", GOOGLE_CLIENT_ID: "client", GOOGLE_CLIENT_SECRET: "secret" };
    const context = await auth().$context;
    const created = await context.internalAdapter.createUser({ id: "u1", name: "Ada", email: "ada@example.test", emailVerified: true, createdAt: new Date(1), updatedAt: new Date(1) });
    const createdSession = await context.internalAdapter.createSession(created.id);
    expect((await context.internalAdapter.findUserById("u1"))?.id).toBe("u1");
    expect((await context.internalAdapter.findSession(createdSession.token))?.session.id).toBe(createdSession.id);
    expect(await context.internalAdapter.findSession("missing")).toBeNull();
  });

  it("registers, signs in, and signs out with a normalized username through the real handler", async () => {
    authState.env = { DB: env.DB, BETTER_AUTH_SECRET: "a test secret that is long enough for Better Auth", BETTER_AUTH_URL: "http://localhost:3000" };
    const request = (path: string, body: Record<string, unknown>, cookie?: string) => new Request(`http://localhost:3000/api/auth${path}`, { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost:3000", ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });
    const registered = await auth().handler(request("/sign-up/email", { name: "Ada Lovelace", email: "ada@example.test", username: " Ada.Lovelace ", password: "correct horse battery" }));
    expect(registered.status).toBe(200);
    expect(db.prepare("SELECT username FROM user WHERE email = ?").get("ada@example.test")).toEqual({ username: "ada.lovelace" });
    const credential = db.prepare("SELECT password FROM account WHERE provider_id = 'credential'").get() as { password: string };
    expect(credential.password).not.toContain("correct horse battery");

    const duplicate = await auth().handler(request("/sign-up/email", { name: "Other", email: "other@example.test", username: "ADA.LOVELACE", password: "another secure pass" }));
    expect(duplicate.status).toBe(400);
    expect(await duplicate.json()).toMatchObject({ code: "USERNAME_IS_ALREADY_TAKEN" });

    const invalid = await auth().handler(request("/sign-in/username", { username: "Ada.Lovelace", password: "wrong password" }));
    expect(invalid.status).toBe(401);
    expect(await invalid.json()).toMatchObject({ code: "INVALID_USERNAME_OR_PASSWORD" });

    const signedIn = await auth().handler(request("/sign-in/username", { username: "ADA.LOVELACE", password: "correct horse battery" }));
    expect(signedIn.status).toBe(200);
    const signedInBody = await signedIn.json() as { token: string };
    const cookie = signedIn.headers.get("set-cookie");
    expect(cookie).toContain("better-auth.session_token=");
    const signedOut = await auth().handler(request("/sign-out", {}, cookie ?? undefined));
    expect(signedOut.status).toBe(200);
    expect(db.prepare("SELECT id FROM session WHERE token = ?").get(signedInBody.token)).toBeUndefined();
  });

  it("rejects usernames and passwords outside the configured bounds", async () => {
    authState.env = { DB: env.DB, BETTER_AUTH_SECRET: "a test secret that is long enough for Better Auth", BETTER_AUTH_URL: "http://localhost:3000" };
    const request = (body: Record<string, unknown>) => new Request("http://localhost:3000/api/auth/sign-up/email", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const invalidUsername = await auth().handler(request({ name: "Ada", email: "ada@example.test", username: "not allowed!", password: "correct horse battery" }));
    expect(invalidUsername.status).toBe(400);
    expect(await invalidUsername.json()).toMatchObject({ code: "INVALID_USERNAME" });
    const trimmedShortUsername = await auth().handler(request({ name: "Ada", email: "ada2@example.test", username: " a ", password: "correct horse battery" }));
    expect(trimmedShortUsername.status).toBe(400);
    const shortPassword = await auth().handler(request({ name: "Ada", email: "ada@example.test", username: "adalovelace", password: "too-short" }));
    expect(shortPassword.status).toBe(400);
  });

  it("requires a complete credential registration and supports email sign-in", async () => {
    authState.env = { DB: env.DB, BETTER_AUTH_SECRET: "a test secret that is long enough for Better Auth", BETTER_AUTH_URL: "http://localhost:3000" };
    const request = (body: Record<string, unknown>) => new Request("http://localhost:3000/api/auth/sign-up/email", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const missingUsername = await auth().handler(request({ name: "Ada", email: "ada@example.test", password: "correct horse battery" }));
    expect(missingUsername.status).toBe(400);
    expect(await missingUsername.json()).toMatchObject({ code: "USERNAME_REQUIRED" });
    expect(db.prepare("SELECT id FROM user").all()).toHaveLength(0);
    const invalidEmail = await auth().handler(request({ name: "Ada", email: "not-an-email", username: "adalovelace", password: "correct horse battery" }));
    expect(invalidEmail.status).toBe(400);

    const registered = await auth().handler(request({ name: " Ada ", email: "ADA@EXAMPLE.TEST", username: "adalovelace", password: "correct horse battery" }));
    expect(registered.status).toBe(200);
    expect(db.prepare("SELECT name,email FROM user").get()).toEqual({ name: "Ada", email: "ada@example.test" });
    const duplicateEmail = await auth().handler(request({ name: "Other", email: "ada@example.test", username: "otheruser", password: "correct horse battery" }));
    expect(duplicateEmail.status).toBe(422);

    const emailSignIn = await auth().handler(new Request("http://localhost:3000/api/auth/sign-in/email", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "ADA@EXAMPLE.TEST", password: "correct horse battery" }) }));
    expect(emailSignIn.status).toBe(200);
  });

  it("rejects cross-site registration and persists per-IP route limits in D1", async () => {
    authState.env = { DB: env.DB, BETTER_AUTH_SECRET: "a test secret that is long enough for Better Auth", BETTER_AUTH_URL: "http://localhost:3000" };
    const crossSite = await auth().handler(new Request("http://localhost:3000/api/auth/sign-up/email", { method: "POST", headers: { "content-type": "application/json", origin: "https://attacker.test" }, body: JSON.stringify({ name: "Ada", email: "ada@example.test", username: "adalovelace", password: "correct horse battery" }) }));
    expect(crossSite.status).toBe(403);

    const signIn = (ip: string) => auth().handler(new Request("http://localhost:3000/api/auth/sign-in/username", { method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": ip }, body: JSON.stringify({ username: "missinguser", password: "correct horse battery" }) }));
    for (let attempt = 0; attempt < 10; attempt += 1) expect((await signIn("203.0.113.8")).status).toBe(401);
    expect((await signIn("203.0.113.8")).status).toBe(429);
    expect((await signIn("203.0.113.9")).status).toBe(401);
    expect(db.prepare("SELECT count FROM rate_limit WHERE key LIKE ?").get("%203.0.113.8% ".trim())).toEqual({ count: 10 });
  }, 20000);

  it("returns JSON 503 from the auth catch-all when required configuration is absent", async () => {
    authState.env = { DB: env.DB };
    const { POST } = await import("@/app/api/auth/[...all]/route");
    const response = await POST(new Request("http://localhost:3000/api/auth/sign-in/username", { method: "POST" }));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: { code: "SERVICE_UNAVAILABLE" } });
  });
});
