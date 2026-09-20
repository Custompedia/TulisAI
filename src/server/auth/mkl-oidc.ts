import { createRemoteJWKSet, customFetch, jwtVerify, type JWTPayload } from "jose";
import type { RuntimeEnv } from "../runtime";

export const MKL_CALLBACK_PATH = "/api/auth/mkl/callback";
export const MKL_SCOPE = "openid profile email";

export type MklConfig = {
  issuer: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  appOrigin: string;
};

export type MklDiscovery = {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
};

export type MklIdentity = {
  issuer: string;
  subject: string;
  organizationId: string;
  email: string | null;
  emailVerified: boolean;
  name: string | null;
};

export class MklProtocolError extends Error {
  constructor(public code: string, message: string, public status = 400) {
    super(message);
    this.name = "MklProtocolError";
  }
}

export function mklConfig(env: RuntimeEnv): MklConfig {
  const issuer = normalizeIssuer(env.MKL_ISSUER);
  const clientId = env.MKL_CLIENT_ID?.trim();
  const clientSecret = env.MKL_CLIENT_SECRET?.trim();
  const appUrl = env.BETTER_AUTH_URL?.trim();
  if (!issuer || !clientId || !clientSecret || !appUrl) throw new MklProtocolError("MKL_NOT_CONFIGURED", "MKL sign-in is not configured.", 503);
  let appOrigin: string;
  try { appOrigin = new URL(appUrl).origin; } catch { throw new MklProtocolError("MKL_NOT_CONFIGURED", "The application origin is invalid.", 503); }
  return { issuer, clientId, clientSecret, appOrigin, redirectUri: new URL(MKL_CALLBACK_PATH, appOrigin).toString() };
}

function normalizeIssuer(value: string | undefined): string | null {
  if (!value?.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (url.username || url.password || url.search || url.hash || (url.pathname !== "/" && url.pathname !== "")) return null;
    if (url.protocol !== "https:" && url.hostname !== "localhost") return null;
    return url.origin;
  } catch { return null; }
}

function exactIssuerEndpoint(config: MklConfig, value: unknown, path: string): string {
  if (typeof value !== "string") throw new MklProtocolError("MKL_TOKEN_INVALID", "MKL discovery is invalid.");
  const expected = new URL(path, `${config.issuer}/`).toString();
  if (value !== expected) throw new MklProtocolError("MKL_TOKEN_INVALID", "MKL discovery does not match the configured issuer.");
  return value;
}

export async function discoverMkl(config: MklConfig, fetcher: typeof fetch = fetch): Promise<MklDiscovery> {
  let response: Response;
  try {
    response = await fetcher(new URL("/.well-known/openid-configuration", `${config.issuer}/`), { headers: { accept: "application/json" }, redirect: "error" });
  } catch { throw new MklProtocolError("MKL_UNAVAILABLE", "MKL is temporarily unavailable.", 503); }
  if (!response.ok) throw new MklProtocolError("MKL_UNAVAILABLE", "MKL is temporarily unavailable.", 503);
  let document: Record<string, unknown>;
  try { document = await response.json() as Record<string, unknown>; } catch { throw new MklProtocolError("MKL_TOKEN_INVALID", "MKL discovery is invalid."); }
  if (document.issuer !== config.issuer) throw new MklProtocolError("MKL_TOKEN_INVALID", "MKL discovery issuer mismatch.");
  return {
    issuer: config.issuer,
    authorization_endpoint: exactIssuerEndpoint(config, document.authorization_endpoint, "/sso/authorize"),
    token_endpoint: exactIssuerEndpoint(config, document.token_endpoint, "/sso/token"),
    jwks_uri: exactIssuerEndpoint(config, document.jwks_uri, "/.well-known/jwks.json"),
  };
}

export function authorizationUrl(discovery: MklDiscovery, config: MklConfig, input: { state: string; nonce: string; codeChallenge: string }): string {
  const url = new URL(discovery.authorization_endpoint);
  url.search = new URLSearchParams({
    response_type: "code", client_id: config.clientId, redirect_uri: config.redirectUri, scope: MKL_SCOPE,
    state: input.state, nonce: input.nonce, code_challenge: input.codeChallenge, code_challenge_method: "S256",
  }).toString();
  return url.toString();
}

export async function exchangeMklCode(discovery: MklDiscovery, config: MklConfig, input: { code: string; codeVerifier: string }, fetcher: typeof fetch = fetch): Promise<string> {
  let response: Response;
  try {
    response = await fetcher(discovery.token_endpoint, {
      method: "POST", redirect: "error", headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: new URLSearchParams({ grant_type: "authorization_code", code: input.code, client_id: config.clientId, client_secret: config.clientSecret, redirect_uri: config.redirectUri, code_verifier: input.codeVerifier }),
    });
  } catch { throw new MklProtocolError("MKL_UNAVAILABLE", "MKL is temporarily unavailable.", 503); }
  if (!response.ok) throw new MklProtocolError("MKL_TOKEN_INVALID", "MKL rejected the authorization code.");
  let body: Record<string, unknown>;
  try { body = await response.json() as Record<string, unknown>; } catch { throw new MklProtocolError("MKL_TOKEN_INVALID", "MKL returned an invalid token response."); }
  if (typeof body.id_token !== "string" || !body.id_token) throw new MklProtocolError("MKL_TOKEN_INVALID", "MKL did not return an ID token.");
  return body.id_token;
}

export async function verifyMklIdToken(token: string, discovery: MklDiscovery, config: MklConfig, expectedNonce: string, fetcher: typeof fetch = fetch): Promise<MklIdentity> {
  let payload: JWTPayload;
  try {
    const jwks = createRemoteJWKSet(new URL(discovery.jwks_uri), { [customFetch]: fetcher, cooldownDuration: 0 });
    ({ payload } = await jwtVerify(token, jwks, { algorithms: ["RS256"], issuer: config.issuer, audience: config.clientId, requiredClaims: ["exp"], clockTolerance: 5 }));
  } catch { throw new MklProtocolError("MKL_TOKEN_INVALID", "The MKL ID token is invalid."); }
  const organizationId = typeof payload.mkl_organization_id === "string" ? payload.mkl_organization_id.trim() : "";
  if (payload.aud !== config.clientId || payload.nonce !== expectedNonce || typeof payload.sub !== "string" || !payload.sub.trim() || !organizationId) {
    throw new MklProtocolError("MKL_TOKEN_INVALID", "The MKL ID token claims are invalid.");
  }
  const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase() : null;
  const usableEmail = email && email.length <= 254 && /^[^\s@]+@[^\s@]+$/.test(email) ? email : null;
  return {
    issuer: config.issuer,
    subject: payload.sub,
    organizationId,
    email: usableEmail,
    emailVerified: usableEmail !== null && payload.email_verified === true,
    name: typeof payload.name === "string" && payload.name.trim() ? payload.name.trim().slice(0, 100) : null,
  };
}

export function safeLocalReturnTo(value: string | null | undefined, fallback = "/app"): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\") || /[\u0000-\u001f\u007f]/.test(value)) return fallback;
  try {
    const url = new URL(value, "https://local.invalid");
    return url.origin === "https://local.invalid" ? `${url.pathname}${url.search}${url.hash}` : fallback;
  } catch { return fallback; }
}
