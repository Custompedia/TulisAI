import { describe, expect, it } from "vitest";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { authorizationUrl, discoverMkl, exchangeMklCode, safeLocalReturnTo, verifyMklIdToken, type MklConfig } from "@/server/auth/mkl-oidc";
import { consumeAuthorizationState, createAuthorizationState, sha256 } from "@/server/auth/mkl-state";

const config: MklConfig = { issuer: "https://mkl.test", clientId: "tulis-test", clientSecret: "test-secret", appOrigin: "https://tulis.marikitalembur.com", redirectUri: "https://tulis.marikitalembur.com/api/auth/mkl/callback" };
const discovery = { issuer: config.issuer, authorization_endpoint: `${config.issuer}/sso/authorize`, token_endpoint: `${config.issuer}/sso/token`, jwks_uri: `${config.issuer}/.well-known/jwks.json` };

const discoveryResponse = (overrides: Record<string, unknown> = {}) => Response.json({ ...discovery, ...overrides });

describe("MKL OIDC protocol", () => {
  it("requires exact discovery and builds the locked authorization request", async () => {
    const fetched = await discoverMkl(config, async () => discoveryResponse());
    const url = new URL(authorizationUrl(fetched, config, { state: "state", nonce: "nonce", codeChallenge: "challenge" }));
    expect(url.toString()).toContain("/sso/authorize?");
    expect(Object.fromEntries(url.searchParams)).toEqual({ response_type: "code", client_id: "tulis-test", redirect_uri: config.redirectUri, scope: "openid profile email", state: "state", nonce: "nonce", code_challenge: "challenge", code_challenge_method: "S256" });
    await expect(discoverMkl(config, async () => discoveryResponse({ issuer: "https://evil.test" }))).rejects.toMatchObject({ code: "MKL_TOKEN_INVALID" });
    await expect(discoverMkl(config, async () => discoveryResponse({ token_endpoint: "https://evil.test/token" }))).rejects.toMatchObject({ code: "MKL_TOKEN_INVALID" });
  });

  it("adds prompt=login only when asked, and reads auth_time support from discovery", async () => {
    const fetched = await discoverMkl(config, async () => discoveryResponse());
    expect(fetched.authTimeSupported).toBe(false);
    const fresh = new URL(authorizationUrl(fetched, config, { state: "state", nonce: "nonce", codeChallenge: "challenge", prompt: "login" }));
    expect(fresh.searchParams.get("prompt")).toBe("login");
    const advertised = await discoverMkl(config, async () => discoveryResponse({ claims_supported: ["sub", "auth_time"] }));
    expect(advertised.authTimeSupported).toBe(true);
  });

  it("posts the exact code exchange without persisting or accepting an access token", async () => {
    let form: URLSearchParams | null = null;
    const token = await exchangeMklCode(discovery, config, { code: "one-time", codeVerifier: "verifier" }, async (_input, init) => {
      form = new URLSearchParams(String(init?.body)); return Response.json({ id_token: "header.payload.signature", token_type: "id_token", expires_in: 300 });
    });
    expect(token).toBe("header.payload.signature");
    expect(Object.fromEntries(form!)).toEqual({ grant_type: "authorization_code", code: "one-time", client_id: config.clientId, client_secret: config.clientSecret, redirect_uri: config.redirectUri, code_verifier: "verifier" });
  });

  it("pins RS256 and verifies issuer, exact audience, expiry, nonce, subject, signature, kid, and rotation", async () => {
    const first = await generateKeyPair("RS256"); const second = await generateKeyPair("RS256");
    const firstJwk = { ...await exportJWK(first.publicKey), kid: "old", alg: "RS256", use: "sig" };
    const secondJwk = { ...await exportJWK(second.publicKey), kid: "new", alg: "RS256", use: "sig" };
    const sign = (overrides: Record<string, unknown> = {}, key = second.privateKey, kid = "new", alg = "RS256") => new SignJWT({ email: "ADA@EXAMPLE.TEST", email_verified: true, name: "Ada", nonce: "expected", mkl_organization_id: "org-1", ...overrides }).setProtectedHeader({ alg, kid }).setIssuer(config.issuer).setSubject("subject-1").setAudience(config.clientId).setIssuedAt().setExpirationTime("5m").sign(key);
    let jwksReads = 0;
    const rotatingFetch: typeof fetch = async () => { jwksReads += 1; return Response.json({ keys: jwksReads === 1 ? [firstJwk] : [secondJwk, firstJwk] }); };
    await expect(verifyMklIdToken(await sign(), discovery, config, "expected", rotatingFetch)).resolves.toMatchObject({ issuer: config.issuer, subject: "subject-1", organizationId: "org-1", email: "ada@example.test", emailVerified: true, name: "Ada" });
    expect(jwksReads).toBe(2);
    const onlySecond: typeof fetch = async () => Response.json({ keys: [secondJwk] });
    await expect(verifyMklIdToken(await sign({ nonce: "wrong" }), discovery, config, "expected", onlySecond)).rejects.toMatchObject({ code: "MKL_TOKEN_INVALID" });
    await expect(verifyMklIdToken(await sign({ mkl_organization_id: "" }), discovery, config, "expected", onlySecond)).rejects.toMatchObject({ code: "MKL_TOKEN_INVALID" });
    const multipleAudience = new SignJWT({ nonce: "expected" }).setProtectedHeader({ alg: "RS256", kid: "new" }).setIssuer(config.issuer).setSubject("s").setAudience([config.clientId, "other"]).setExpirationTime("5m").sign(second.privateKey);
    await expect(verifyMklIdToken(await multipleAudience, discovery, config, "expected", onlySecond)).rejects.toMatchObject({ code: "MKL_TOKEN_INVALID" });
    const expired = new SignJWT({ nonce: "expected" }).setProtectedHeader({ alg: "RS256", kid: "new" }).setIssuer(config.issuer).setSubject("s").setAudience(config.clientId).setExpirationTime(Math.floor(Date.now() / 1000) - 10).sign(second.privateKey);
    await expect(verifyMklIdToken(await expired, discovery, config, "expected", onlySecond)).rejects.toMatchObject({ code: "MKL_TOKEN_INVALID" });
    const missingExpiry = new SignJWT({ nonce: "expected" }).setProtectedHeader({ alg: "RS256", kid: "new" }).setIssuer(config.issuer).setSubject("s").setAudience(config.clientId).sign(second.privateKey);
    await expect(verifyMklIdToken(await missingExpiry, discovery, config, "expected", onlySecond)).rejects.toMatchObject({ code: "MKL_TOKEN_INVALID" });
    const wrongIssuer = new SignJWT({ nonce: "expected" }).setProtectedHeader({ alg: "RS256", kid: "new" }).setIssuer("https://wrong.test").setSubject("s").setAudience(config.clientId).setExpirationTime("5m").sign(second.privateKey);
    await expect(verifyMklIdToken(await wrongIssuer, discovery, config, "expected", onlySecond)).rejects.toMatchObject({ code: "MKL_TOKEN_INVALID" });
    const missingSub = new SignJWT({ nonce: "expected" }).setProtectedHeader({ alg: "RS256", kid: "new" }).setIssuer(config.issuer).setAudience(config.clientId).setExpirationTime("5m").sign(second.privateKey);
    await expect(verifyMklIdToken(await missingSub, discovery, config, "expected", onlySecond)).rejects.toMatchObject({ code: "MKL_TOKEN_INVALID" });
    const stranger = await generateKeyPair("RS256");
    await expect(verifyMklIdToken(await sign({}, stranger.privateKey), discovery, config, "expected", onlySecond)).rejects.toMatchObject({ code: "MKL_TOKEN_INVALID" });
    const unknownKid = await sign({}, second.privateKey, "missing");
    await expect(verifyMklIdToken(unknownKid, discovery, config, "expected", onlySecond)).rejects.toMatchObject({ code: "MKL_TOKEN_INVALID" });
    const symmetricSecret = new TextEncoder().encode("test-only-symmetric-key-that-is-at-least-32-bytes");
    const wrongAlgorithm = await new SignJWT({ nonce: "expected" }).setProtectedHeader({ alg: "HS256", kid: "new" }).setIssuer(config.issuer).setSubject("s").setAudience(config.clientId).setExpirationTime("5m").sign(symmetricSecret);
    await expect(verifyMklIdToken(wrongAlgorithm, discovery, config, "expected", onlySecond)).rejects.toMatchObject({ code: "MKL_TOKEN_INVALID" });
  }, 20000);
});

describe("MKL state primitives", () => {
  it("stores hashed state, independent nonce and verifier, then consumes it exactly once", async () => {
    const rows = new Map<string, { value: string; expiresAt: Date }>();
    const adapter = {
      async createVerificationValue(row: { identifier: string; value: string; expiresAt: Date }) { rows.set(row.identifier, row); },
      async consumeVerificationValue(identifier: string) { const row = rows.get(identifier) ?? null; rows.delete(identifier); return row && row.expiresAt > new Date() ? row : null; },
    };
    const created = await createAuthorizationState(adapter, config, { intent: "sign_in", browser: "browser-secret", userId: null, sessionId: null, returnTo: "/documents/1" });
    expect(created.state).not.toBe(created.nonce); expect(created.codeVerifier).not.toBe(created.nonce); expect(created.codeChallenge).toBe(await sha256(created.codeVerifier));
    expect([...rows.keys()][0]).toBe(`mkl:authorize:${await sha256(created.state)}`); expect([...rows.keys()][0]).not.toContain(created.state);
    await expect(consumeAuthorizationState(adapter, created.state)).resolves.toMatchObject({ intent: "sign_in", returnTo: "/documents/1" });
    await expect(consumeAuthorizationState(adapter, created.state)).resolves.toBeNull();
  });

  it("rejects expired authorization state while still consuming it", async () => {
    const rows = new Map<string, { value: string; expiresAt: Date }>();
    const adapter = {
      async createVerificationValue(row: { identifier: string; value: string; expiresAt: Date }) { rows.set(row.identifier, row); },
      async consumeVerificationValue(identifier: string) { const row = rows.get(identifier) ?? null; rows.delete(identifier); return row && row.expiresAt > new Date() ? row : null; },
    };
    const created = await createAuthorizationState(adapter, config, { intent: "sign_in", browser: "browser-secret", userId: null, sessionId: null, returnTo: "/app" });
    const key = `mkl:authorize:${await sha256(created.state)}`; const row = rows.get(key)!; rows.set(key, { ...row, expiresAt: new Date(0) });
    await expect(consumeAuthorizationState(adapter, created.state)).resolves.toBeNull();
    expect(rows.has(key)).toBe(false);
  });

  it("rejects unsafe local destinations", () => {
    expect(safeLocalReturnTo("/documents/1?panel=history")).toBe("/documents/1?panel=history");
    for (const value of ["https://evil.test", "//evil.test", "/\\evil.test", "/\nevil"]) expect(safeLocalReturnTo(value)).toBe("/app");
  });
});
