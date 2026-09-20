import type { MklConfig, MklIdentity } from "./mkl-oidc";

export const MKL_STATE_TTL_MS = 10 * 60 * 1000;
export const MKL_BROWSER_COOKIE_PROD = "__Host-tulis_mkl_browser";
export const MKL_CONSENT_COOKIE_PROD = "__Host-tulis_mkl_consent";
export const MKL_PURCHASE_COOKIE_PROD = "__Host-tulis_mkl_purchase";

export type MklIntent = "sign_in" | "link" | "purchase";
export type AuthorizationState = {
  version: 1; intent: MklIntent; codeVerifier: string; expectedNonce: string; issuer: string; clientId: string; redirectUri: string;
  browserHash: string; userId: string | null; sessionId: string | null; purchaseId: string | null; returnTo: string; createdAt: number; correlationRef: string;
};
export type ConsentState = {
  version: 1; userId: string; issuer: string; subject: string; organizationId: string; email: string | null; name: string | null;
  browserHash: string; createdAt: number; correlationRef: string;
};

type VerificationAdapter = {
  createVerificationValue: (data: { identifier: string; value: string; expiresAt: Date }) => Promise<unknown>;
  consumeVerificationValue: (identifier: string) => Promise<{ value: string; expiresAt: Date } | null>;
};

const bytes = (length: number) => { const value = new Uint8Array(length); crypto.getRandomValues(value); return value; };
const base64url = (value: Uint8Array) => btoa(String.fromCharCode(...value)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
export const randomToken = (length = 32) => base64url(bytes(length));
export async function sha256(value: string): Promise<string> { return base64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)))); }
export const stateIdentifier = async (state: string) => `mkl:authorize:${await sha256(state)}`;
export const consentIdentifier = (receipt: string) => `mkl:consent:${receipt}`;

export function mklCookieNames(config: MklConfig) {
  const secure = new URL(config.appOrigin).protocol === "https:";
  return { browser: secure ? MKL_BROWSER_COOKIE_PROD : "tulis_mkl_browser", consent: secure ? MKL_CONSENT_COOKIE_PROD : "tulis_mkl_consent",
    purchase: secure ? MKL_PURCHASE_COOKIE_PROD : "tulis_mkl_purchase", secure };
}

export function readCookie(headers: Headers, name: string): string | null {
  const raw = headers.get("cookie");
  if (!raw) return null;
  for (const part of raw.split(";")) {
    const index = part.indexOf("=");
    if (index > 0 && part.slice(0, index).trim() === name) return decodeURIComponent(part.slice(index + 1).trim());
  }
  return null;
}

export function cookieAttributes(secure: boolean, maxAge = 600) { return { httpOnly: true, secure, sameSite: "lax" as const, path: "/", maxAge }; }
export function serializeCookie(name: string, value: string, secure: boolean, maxAge = 600): string {
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? "; Secure" : ""}`;
}

export async function createAuthorizationState(adapter: VerificationAdapter, config: MklConfig, input: { intent: MklIntent; browser: string; userId: string | null; sessionId: string | null; purchaseId?: string | null; returnTo: string }) {
  const state = randomToken(); const nonce = randomToken(); const codeVerifier = randomToken(64); const now = Date.now();
  const value: AuthorizationState = {
    version: 1, intent: input.intent, codeVerifier, expectedNonce: nonce, issuer: config.issuer, clientId: config.clientId,
    redirectUri: config.redirectUri, browserHash: await sha256(input.browser), userId: input.userId, sessionId: input.sessionId, purchaseId: input.purchaseId ?? null, returnTo: input.returnTo,
    createdAt: now, correlationRef: crypto.randomUUID(),
  };
  await adapter.createVerificationValue({ identifier: await stateIdentifier(state), value: JSON.stringify(value), expiresAt: new Date(now + MKL_STATE_TTL_MS) });
  return { state, nonce, codeVerifier, codeChallenge: await sha256(codeVerifier) };
}

export async function consumeAuthorizationState(adapter: VerificationAdapter, state: string): Promise<AuthorizationState | null> {
  const consumed = await adapter.consumeVerificationValue(await stateIdentifier(state));
  if (!consumed) return null;
  try {
    const value = JSON.parse(consumed.value) as AuthorizationState;
    if (value.version !== 1 || !["sign_in", "link", "purchase"].includes(value.intent) || typeof value.codeVerifier !== "string" || typeof value.expectedNonce !== "string" || typeof value.browserHash !== "string") return null;
    if ((value.intent === "link" || value.intent === "purchase") && (typeof value.userId !== "string" || typeof value.sessionId !== "string")) return null;
    if (value.intent === "purchase" && typeof value.purchaseId !== "string") return null;
    return value;
  } catch { return null; }
}

export async function createConsentState(adapter: VerificationAdapter, input: { userId: string; browserHash: string; identity: MklIdentity; correlationRef: string }) {
  const receipt = randomToken(); const now = Date.now();
  const value: ConsentState = { version: 1, userId: input.userId, issuer: input.identity.issuer, subject: input.identity.subject, organizationId: input.identity.organizationId, email: input.identity.email, name: input.identity.name, browserHash: input.browserHash, createdAt: now, correlationRef: input.correlationRef };
  await adapter.createVerificationValue({ identifier: consentIdentifier(receipt), value: JSON.stringify(value), expiresAt: new Date(now + MKL_STATE_TTL_MS) });
  return receipt;
}

export function parseConsentState(raw: string): ConsentState | null {
  try {
    const value = JSON.parse(raw) as ConsentState;
    if (value.version !== 1 || typeof value.userId !== "string" || typeof value.issuer !== "string" || typeof value.subject !== "string" || typeof value.organizationId !== "string" || !value.organizationId || typeof value.browserHash !== "string") return null;
    return value;
  } catch { return null; }
}
