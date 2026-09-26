import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { applyMigrations } from "../helpers/migrations";

const state = vi.hoisted(() => ({ env: {} as Record<string, unknown> }));
vi.mock("@/server/runtime", () => ({ runtime: () => state.env, ConfigurationError: class extends Error {} }));

import { AuthorityError, normalizeAuthority, persistAuthority, refreshMklAuthority, type AuthorityProvenance } from "@/server/entitlements/authority";
import { entitlement } from "@/server/usage/quota";
import type { ExternalIdentityLink } from "@/server/identity/links";
import { FEATURES } from "@/lib/plans";
import { normalizeRuntime } from "@/server/ai/core";
import { runtimeForAccess } from "@/server/usage/premium";
import { autosaveDocument, createDocument, getDocument } from "@/server/documents/service";
import { createStyle, listStyles, updateStyle } from "@/server/writing/styles";
import { assertDocxExport, createDocxImportReceipt, recordDocxExportEvidence } from "@/server/documents/portability";
import { EditorDocumentSchema } from "@/lib/contracts";

let db: DatabaseSync;
const objects = new Map<string, string>();
class Statement {
  constructor(readonly sql: string, readonly values: SQLInputValue[] = []) {}
  bind(...values: SQLInputValue[]) { return new Statement(this.sql, values); }
  async first<T>() { return db.prepare(this.sql).get(...this.values) as T | undefined ?? null; }
  async all<T>() { return { results: db.prepare(this.sql).all(...this.values) as T[], success: true, meta: { changes: 0 } }; }
  execute() { const result = db.prepare(this.sql).run(...this.values); return { success: true, results: [], meta: { changes: Number(result.changes) } }; }
  async run() { return this.execute(); }
}

const expected: AuthorityProvenance = {
  issuer: "https://mkl.test", clientId: "tulis-client", appKey: "tulisai", catalogItemId: "catalog-tulisai",
  subject: "subject-1", organizationId: "org-1",
};
const at = "2026-09-20T08:00:00.000Z";
const candidate = (overrides: Record<string, unknown> = {}) => ({
  entitlement_id: "ent-1", status: "active", active: true, plan_code: "plus", plan_version: "pricing-v1",
  period_start: "2026-09-01T00:00:00.000Z", period_end: "2026-10-01T00:00:00.000Z",
  access_deadline: "2026-10-01T00:00:00.000Z", commercial_kind: "access", created_at: "2026-09-01T00:00:00.000Z", ...overrides,
});
const envelope = (candidates: unknown[] = [candidate()], overrides: Record<string, unknown> = {}) => ({
  active: false, entitlement_id: "compatibility-is-ignored", status: "revoked", plan_code: "max", plan_version: "wrong",
  server_time: at,
  application: { client_id: expected.clientId, app_key: expected.appKey, catalog_item_id: expected.catalogItemId },
  holder: { subject: expected.subject, organization_id: expected.organizationId },
  access_entitlements_complete: true, access_entitlements_revision: 1,
  cancellation_semantics: "no_separate_cancellation_state", access_entitlements: candidates, ...overrides,
});
const codeOf = async (value: unknown) => normalizeAuthority(value, expected).then(() => "ok", (error: AuthorityError) => error.code);

beforeEach(() => {
  db = new DatabaseSync(":memory:"); applyMigrations(db); objects.clear();
  state.env = { DB: { prepare: (sql: string) => new Statement(sql), batch: async (statements: Statement[]) => statements.map((statement) => statement.execute()) },
    DOCUMENTS: { head: async (key: string) => objects.has(key) ? { key, size: objects.get(key)!.length } : null, put: async (key: string, value: string) => { objects.set(key, value); return { key }; }, get: async (key: string) => { const value = objects.get(key); return value === undefined ? null : { size: value.length, text: async () => value }; }, delete: async () => undefined },
    AI_MONTHLY_REQUEST_LIMIT: "100", AI_FREE_CHARACTER_ALLOWANCE: "3000" };
});
afterEach(() => db.close());

describe("B3 complete authority parsing", () => {
  it("maps exactly Plus, Pro and Max at pricing-v1 and ignores the compatibility singleton", async () => {
    for (const plan of ["plus", "pro", "max"] as const) {
      const parsed = await normalizeAuthority(envelope([candidate({ plan_code: plan })]), expected);
      expect(parsed.active?.plan_code).toBe(plan);
    }
  });

  it("rejects incomplete, invalid revision, duplicate candidates, wrong provenance and malformed times", async () => {
    expect(await codeOf(envelope([], { access_entitlements_complete: false }))).toBe("authority_incomplete");
    for (const revision of [-1, 1.2, Number.MAX_SAFE_INTEGER + 1]) expect(await codeOf(envelope([], { access_entitlements_revision: revision }))).toBe("authority_revision_invalid");
    expect(await codeOf(envelope([], { application: { client_id: "other", app_key: expected.appKey, catalog_item_id: expected.catalogItemId } }))).toBe("authority_provenance_mismatch");
    expect(await codeOf(envelope([], { holder: { subject: expected.subject, organization_id: "other" } }))).toBe("authority_provenance_mismatch");
    expect(await codeOf(envelope([candidate(), candidate()]))).toBe("authority_duplicate_candidate");
    expect(await codeOf(envelope([candidate({ period_end: "yesterday", access_deadline: "yesterday" })]))).toBe("authority_malformed");
  });

  it("rejects unsupported, null, wrong-version, perpetual and conflicting paid facts", async () => {
    for (const plan_code of ["team", "free", "unknown", null]) expect(await codeOf(envelope([candidate({ plan_code })]))).toBe("unsupported_plan");
    expect(await codeOf(envelope([candidate({ plan_version: "pricing-v2" })]))).toBe("unsupported_plan");
    expect(await codeOf(envelope([candidate({ period_end: null, access_deadline: null })]))).toBe("authority_malformed");
    expect(await codeOf(envelope([candidate({ access_deadline: "2026-10-02T00:00:00.000Z" })]))).toBe("authority_fact_conflict");
    expect(await codeOf(envelope([candidate({ active: false })]))).toBe("authority_fact_conflict");
    expect(await codeOf(envelope([candidate({ period_start: "2026-09-21T00:00:00.000Z" })]))).toBe("authority_fact_conflict");
  });

  it("accepts expired/revoked/suspended candidates as inactive but never resolves overlapping active rows", async () => {
    const inactive = [
      candidate({ entitlement_id: "expired", status: "active", active: false, period_start: "2026-08-01T00:00:00.000Z", period_end: "2026-09-01T00:00:00.000Z", access_deadline: "2026-09-01T00:00:00.000Z" }),
      candidate({ entitlement_id: "revoked", status: "revoked", active: false }),
      candidate({ entitlement_id: "suspended", status: "suspended", active: false }),
    ];
    expect((await normalizeAuthority(envelope(inactive), expected)).active).toBeNull();
    expect(await codeOf(envelope([candidate(), candidate({ entitlement_id: "ent-2", plan_code: "max", created_at: "2026-09-02T00:00:00.000Z" })]))).toBe("authority_conflict");
  });

  it("hashes only normalized provenance and candidate facts, not array order or derived server-time state", async () => {
    const rows = [candidate({ entitlement_id: "b", created_at: "2026-09-02T00:00:00+00:00" }), candidate({ entitlement_id: "a", status: "revoked", active: false })];
    const first = await normalizeAuthority(envelope(rows), expected);
    const second = await normalizeAuthority(envelope([...rows].reverse(), { server_time: "2026-09-20T08:01:00.000Z" }), expected);
    expect(second.payloadHash).toBe(first.payloadHash);
  });
});

describe("B3 checkpoint and capability resolver", () => {
  let link: ExternalIdentityLink;
  beforeEach(() => {
    db.prepare("INSERT INTO user (id,name,email,role,tier,created_at,updated_at) VALUES ('u','U','u@example.test','user','max',1,1)").run();
    db.prepare("INSERT INTO external_identity_link (id,provider,issuer,subject,user_id,link_method,created_at,updated_at,organization_id) VALUES ('l','mkl',?,?, 'u','mkl-sign-in',1,1,?)").run(expected.issuer, expected.subject, expected.organizationId);
    link = { id: "l", provider: "mkl", issuer: expected.issuer, subject: expected.subject, organizationId: expected.organizationId, userId: "u", profileEmail: null, profileName: null, linkMethod: "mkl-sign-in", createdAt: 1, updatedAt: 1, lastAuthenticatedAt: 1 };
  });

  it("accepts forward facts, refreshes an identical replay, and rejects stale/inconsistent revisions", async () => {
    const first = await normalizeAuthority(envelope(), expected);
    expect(await persistAuthority("u", link, first, Date.parse(at))).toBe("forward");
    expect(await persistAuthority("u", link, first, Date.parse(at) + 1000)).toBe("replay");
    const newer = await normalizeAuthority(envelope([candidate({ plan_code: "pro" })], { access_entitlements_revision: 2 }), expected);
    expect(await persistAuthority("u", link, newer, Date.parse(at) + 2000)).toBe("forward");
    await expect(persistAuthority("u", link, first)).rejects.toMatchObject({ code: "stale_authority" });
    const inconsistent = await normalizeAuthority(envelope([candidate({ plan_code: "max" })], { access_entitlements_revision: 2 }), expected);
    await expect(persistAuthority("u", link, inconsistent)).rejects.toMatchObject({ code: "authority_inconsistency" });
    expect(db.prepare("SELECT invalidation_reason FROM mkl_entitlement_projection WHERE user_id='u'").get()).toEqual({ invalidation_reason: "authority_inconsistency" });
  });

  it("ignores linked local tier, grants only a fresh projection, and fails closed when stale", async () => {
    expect((await entitlement("u")).access).toMatchObject({ tier: "free", plan: null, commercialActive: false, linked: true, staleReason: "unverified" });
    const now = Date.now();
    const live = await normalizeAuthority(envelope([candidate({ period_start: new Date(now - 60_000).toISOString(), period_end: new Date(now + 3_600_000).toISOString(), access_deadline: new Date(now + 3_600_000).toISOString() })], { server_time: new Date(now).toISOString() }), expected);
    await persistAuthority("u", link, live, now);
    expect((await entitlement("u")).access).toMatchObject({ tier: "plus", plan: "plus", authority: "mkl", commercialActive: true, topupEligible: true, fresh: true });
    db.prepare("UPDATE mkl_entitlement_projection SET fresh_until=? WHERE user_id='u'").run(now - 1);
    expect((await entitlement("u")).access).toMatchObject({ tier: "free", plan: null, commercialActive: false, fresh: false, staleReason: "stale" });
  });

  it("keeps admin/support authority noncommercial and unable to grant top-up", async () => {
    db.prepare("INSERT INTO user (id,name,email,role,tier,created_at,updated_at) VALUES ('admin','A','a@example.test','admin','max',1,1),('support','S','s@example.test','user','free',1,1)").run();
    db.prepare("INSERT INTO capability_grants (id,user_id,authority,capabilities_json,reason,issued_by,expires_at,created_at) VALUES ('g','support','support',?,'case','admin',?,1)").run(JSON.stringify(["docx_export", "purchase_topup"]), Date.now() + 60_000);
    const admin = await entitlement("admin"); const support = await entitlement("support");
    expect(admin.access).toMatchObject({ authority: "local_admin", plan: null, commercialActive: false, topupEligible: false });
    expect(admin.features).not.toContain("purchase_topup"); expect(admin.features).toEqual(expect.arrayContaining(FEATURES.filter((feature) => feature !== "purchase_topup")));
    expect(support.access).toMatchObject({ authority: "support", plan: null, commercialActive: false, topupEligible: false });
    expect(support.features).toContain("docx_export"); expect(support.features).not.toContain("purchase_topup");
  });

  it("persists no raw token or secret-shaped column", () => {
    const names = (db.prepare("PRAGMA table_info(mkl_entitlement_projection)").all() as Array<{ name: string }>).map((row) => row.name);
    expect(names.some((name) => /token|secret|auth_code|pkce/i.test(name))).toBe(false);
  });

  it("uses a still-fresh positive cache during provider outage without persisting credentials", async () => {
    const now = Date.now(); const response = envelope([candidate({ period_start: new Date(now - 60_000).toISOString(), period_end: new Date(now + 3_600_000).toISOString(), access_deadline: new Date(now + 3_600_000).toISOString() })], { server_time: new Date(now).toISOString() });
    state.env = { ...state.env, MKL_CLIENT_ID: expected.clientId, MKL_APP_KEY: expected.appKey, MKL_CATALOG_ITEM_ID: expected.catalogItemId, MKL_APP_API_SECRET: "distinct-app-secret" };
    let headers = new Headers();
    await refreshMklAuthority("u", link, "distinct-raw-id-token", async (_input, init) => { headers = new Headers(init?.headers); return Response.json(response); });
    expect(headers.get("authorization")).toBe("Bearer distinct-app-secret"); expect(headers.get("mkl-id-token")).toBe("distinct-raw-id-token");
    await expect(refreshMklAuthority("u", link, "another-token", async () => { throw new Error("offline"); })).rejects.toMatchObject({ code: "MKL_ENTITLEMENTS_UNAVAILABLE" });
    // Workers only accept redirect "follow" or "manual"; a redirect is refused, never followed.
    let mode: RequestRedirect | undefined;
    await expect(refreshMklAuthority("u", link, "another-token", async (_input, init) => { mode = init?.redirect; return new Response(null, { status: 302, headers: { location: "https://elsewhere.test/" } }); }))
      .rejects.toMatchObject({ code: "MKL_ENTITLEMENTS_UNAVAILABLE" });
    expect(mode).toBe("manual");
    expect((await entitlement("u")).access).toMatchObject({ commercialActive: true, plan: "plus", fresh: true });
    const persisted = JSON.stringify(db.prepare("SELECT * FROM mkl_entitlement_projection").all());
    expect(persisted).not.toContain("distinct-raw-id-token"); expect(persisted).not.toContain("distinct-app-secret");
  });

  it("enforces Max-only runtime fields after alias normalization", async () => {
    const free = await entitlement("u");
    const aliases = normalizeRuntime("P01_STANDARD_REWRITE", { language: "id", sourceText: "Teks", strength: "balanced", styleSample: "contoh", customRequest: { format: "paragraph", extraRequest: "rahasia" } });
    const filtered = runtimeForAccess(free, aliases);
    expect(filtered.style_reference).toBeUndefined();
    expect(filtered.request).toMatchObject({ additional_instruction: "" });
    expect(() => runtimeForAccess(free, normalizeRuntime("P01_STANDARD_REWRITE", { language: "id", sourceText: "Teks", strength: "balanced", style_reference: "bypass", request: { format: "paragraf", focus: [], additional_instruction: "bypass" } }))).not.toThrow();
    const content = EditorDocumentSchema.parse({ type: "doc", content: [] });
    await expect(createDocument("u", { title: "Bypass", language: "id", content, preferences: { styleId: crypto.randomUUID() } })).rejects.toMatchObject({ code: "FEATURE_LOCKED" });
  });

  it("preserves premium and Advanced Workspace data on downgrade while blocking mutations", async () => {
    const now = Date.now();
    const max = await normalizeAuthority(envelope([candidate({ plan_code: "max", period_start: new Date(now - 60_000).toISOString(), period_end: new Date(now + 3_600_000).toISOString(), access_deadline: new Date(now + 3_600_000).toISOString() })], { server_time: new Date(now).toISOString() }), expected);
    await persistAuthority("u", link, max, now);
    const content = EditorDocumentSchema.parse({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "awal" }] }] });
    const doc = await createDocument("u", { title: "D", language: "id", content, preferences: { advanced: true, pageSize: "letter", extra: "Instruksi lama", sample: "Sampel lama", customized: true } });
    await createStyle("u", { name: "Gaya", description: null, color: null, icon: null, settings: { extra: "Instruksi lama", sample: "Sampel lama", customized: true } });

    const pro = await normalizeAuthority(envelope([candidate({ plan_code: "pro", period_start: new Date(now - 60_000).toISOString(), period_end: new Date(now + 3_600_000).toISOString(), access_deadline: new Date(now + 3_600_000).toISOString() })], { server_time: new Date(now).toISOString(), access_entitlements_revision: 2 }), expected);
    await persistAuthority("u", link, pro, now + 1);
    await updateStyle("u", (await listStyles("u"))[0]!.id, { settings: { extra: "bypass", sample: "bypass", customized: false }, name: "Gaya baru" });
    const plus = await normalizeAuthority(envelope([candidate({ plan_code: "plus", period_start: new Date(now - 60_000).toISOString(), period_end: new Date(now + 3_600_000).toISOString(), access_deadline: new Date(now + 3_600_000).toISOString() })], { server_time: new Date(now).toISOString(), access_entitlements_revision: 3 }), expected);
    await persistAuthority("u", link, plus, now + 2);
    const changed = EditorDocumentSchema.parse({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "isi tetap dapat disimpan" }] }] });
    await autosaveDocument("u", doc.id, doc.revision, changed, { preferences: { advanced: false, pageSize: "a4", extra: "bypass", sample: "bypass", customized: false } });
    expect((await getDocument("u", doc.id)).preferences).toMatchObject({ advanced: true, pageSize: "letter", extra: "Instruksi lama", sample: "Sampel lama", customized: true });
    expect((await listStyles("u"))[0]!.settings).toMatchObject({ extra: "Instruksi lama", sample: "Sampel lama", customized: true });
  });

  it("uses only server-issued DOCX evidence for downgrade portability", async () => {
    const now = Date.now();
    const pro = await normalizeAuthority(envelope([candidate({ plan_code: "pro", period_start: new Date(now - 60_000).toISOString(), period_end: new Date(now + 3_600_000).toISOString(), access_deadline: new Date(now + 3_600_000).toISOString() })], { server_time: new Date(now).toISOString() }), expected);
    await persistAuthority("u", link, pro, now);
    const content = EditorDocumentSchema.parse({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "DOCX" }] }] });
    const ordinary = await createDocument("u", { title: "Ordinary", language: "id", content, preferences: { advanced: true } });
    const importReceipt = await createDocxImportReceipt("u", content, await entitlement("u"));
    const imported = await createDocument("u", { title: "Imported", language: "id", content, preferences: { advanced: true }, docxImportReceipt: importReceipt });
    await recordDocxExportEvidence("u", ordinary.id, await entitlement("u"));
    db.prepare("UPDATE mkl_entitlement_projection SET fresh_until=? WHERE user_id='u'").run(now - 1);
    await expect(assertDocxExport("u", ordinary.id)).resolves.toMatchObject({ historical: true });
    await expect(assertDocxExport("u", imported.id)).resolves.toMatchObject({ historical: true });
    const neverEligible = await createDocument("u", { title: "Never", language: "id", content });
    await expect(assertDocxExport("u", neverEligible.id)).rejects.toMatchObject({ code: "FEATURE_LOCKED" });
  });
});
