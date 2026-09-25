import { APIError, createAuthEndpoint, formCsrfMiddleware, getAuthoritativeSessionFromCtx, sensitiveSessionMiddleware } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { z } from "zod";
import { writeAudit } from "../audit";
import { activeBan, emailOwner, getIdentityOwner, getMklLinkByUserId, provisionMklUser, updateAuthenticatedLink } from "../identity/links";
import { runtime } from "../runtime";
import { refreshMklAuthority } from "../entitlements/authority";
import { authorizationUrl, discoverMkl, exchangeMklCode, mklConfig, MklProtocolError, safeLocalReturnTo, verifyMklIdToken, type MklConfig, type MklIdentity } from "./mkl-oidc";
import { cookieAttributes, createAuthorizationState, createConsentState, mklCookieNames, randomToken, readCookie, sha256, consumeAuthorizationState, stateIdentifier } from "./mkl-state";
import { clearReauth, markReauthOnSignOut, reauthRequested } from "./mkl-reauth";

/** Clock drift allowed when comparing MKL's auth_time with when the ceremony started. */
const AUTH_TIME_TOLERANCE_MS = 5_000;

const startBody = z.object({ returnTo: z.string().max(2048).optional() }).default({});
const callbackQuery = z.object({ state: z.string().min(1).max(2048).optional(), code: z.string().min(1).max(4096).optional(), error: z.string().max(200).optional() });

function apiError(error: unknown): never {
  if (error instanceof APIError) throw error;
  if (error instanceof MklProtocolError) {
    const status = error.status >= 500 ? "SERVICE_UNAVAILABLE" : error.status === 403 ? "FORBIDDEN" : "BAD_REQUEST";
    throw APIError.from(status, { code: error.code, message: error.message });
  }
  throw error;
}

function redirectError(ctx: { redirect: (url: string) => unknown; setHeader: (name: string, value: string) => void }, config: MklConfig, code: string): never {
  ctx.setHeader("cache-control", "no-store");
  const url = new URL("/login", config.appOrigin); url.searchParams.set("error", "mkl"); url.searchParams.set("code", code);
  throw ctx.redirect(url.toString());
}

function headersOf(ctx: { headers?: Headers; request?: Request }): Headers { return ctx.headers ?? ctx.request?.headers ?? new Headers(); }
const validOpaqueCookie = (value: string | null): string | null => value && /^[A-Za-z0-9_-]{43}$/.test(value) ? value : null;
const isAdmin = (role: unknown) => typeof role === "string" && role.split(",").some((value) => value.trim() === "admin");

async function begin(rawContext: unknown, intent: "sign_in" | "link") {
  const ctx = rawContext as Parameters<typeof getAuthoritativeSessionFromCtx>[0] & { body?: z.infer<typeof startBody> };
  try {
    const config = mklConfig(runtime()); const names = mklCookieNames(config);
    let userId: string | null = null; let sessionId: string | null = null;
    if (intent === "sign_in") {
      if (await getAuthoritativeSessionFromCtx(ctx)) throw APIError.from("BAD_REQUEST", { code: "MKL_ALREADY_AUTHENTICATED", message: "Sign out before switching accounts." });
    } else {
      const session = ctx.context.session;
      if (!session?.user) throw APIError.from("UNAUTHORIZED", { code: "UNAUTHENTICATED", message: "Sign in locally before linking MKL." });
      const sessionUserId = String(session.user.id); userId = sessionUserId; sessionId = String(session.session.id);
      if (isAdmin(session.user.role)) {
        await writeAudit(sessionUserId, sessionUserId, "identity.mkl.link-refused", { code: "MKL_ADMIN_LINK_FORBIDDEN", method: "explicit-link" });
        throw APIError.from("FORBIDDEN", { code: "MKL_ADMIN_LINK_FORBIDDEN", message: "Local admin accounts cannot link MKL customer identities." });
      }
      if (await getMklLinkByUserId(sessionUserId)) {
        await writeAudit(sessionUserId, sessionUserId, "identity.mkl.link-refused", { code: "MKL_ACCOUNT_ALREADY_LINKED", method: "explicit-link" });
        throw APIError.from("BAD_REQUEST", { code: "MKL_ACCOUNT_ALREADY_LINKED", message: "This account already has an MKL identity." });
      }
    }
    const discovery = await discoverMkl(config);
    const existing = validOpaqueCookie(readCookie(headersOf(ctx), names.browser)); const browser = existing ?? randomToken();
    const flow = await createAuthorizationState(ctx.context.internalAdapter, config, { intent, browser, userId, sessionId, returnTo: safeLocalReturnTo(ctx.body?.returnTo, "/app") });
    ctx.setCookie(names.browser, browser, cookieAttributes(names.secure));
    ctx.setHeader("cache-control", "no-store");
    // A link must prove fresh control of the MKL identity, and the first
    // sign-in after an explicit sign-out must not be answered by MKL's old
    // session: both ask MKL for a real authentication.
    const prompt = intent === "link" || reauthRequested(config, headersOf(ctx)) ? "login" as const : undefined;
    return ctx.json({ url: authorizationUrl(discovery, config, { ...flow, prompt }), redirect: true });
  } catch (error) { apiError(error); }
}

async function rejectLink(userId: string, code: string, identity?: MklIdentity) {
  await writeAudit(userId, userId, "identity.mkl.link-refused", { code, method: "explicit-link", ...(identity ? { issuer: identity.issuer, subject: identity.subject } : {}) });
}

export function mklIdentityPlugin() {
  return {
    id: "mkl-identity" as const,
    hooks: { after: [markReauthOnSignOut] },
    endpoints: {
      mklStart: createAuthEndpoint("/mkl/start", { method: "POST", requireHeaders: true, use: [formCsrfMiddleware], body: startBody }, (ctx) => begin(ctx, "sign_in")),
      mklLinkStart: createAuthEndpoint("/mkl/link/start", { method: "POST", requireHeaders: true, use: [formCsrfMiddleware, sensitiveSessionMiddleware], body: startBody }, (ctx) => begin(ctx, "link")),
      mklCallback: createAuthEndpoint("/mkl/callback", { method: "GET", requireHeaders: true, query: callbackQuery }, async (ctx) => {
        let config: MklConfig;
        try { config = mklConfig(runtime()); } catch (error) { apiError(error); }
        const stateToken = ctx.query.state;
        if (!stateToken) redirectError(ctx, config!, "MKL_STATE_INVALID");
        const peek = await ctx.context.internalAdapter.findVerificationValue(await stateIdentifier(stateToken!));
        const state = await consumeAuthorizationState(ctx.context.internalAdapter, stateToken!);
        if (!state) redirectError(ctx, config!, peek?.expiresAt && new Date(peek.expiresAt).getTime() <= Date.now() ? "MKL_STATE_EXPIRED" : "MKL_STATE_INVALID");
        const names = mklCookieNames(config!); const browser = validOpaqueCookie(readCookie(headersOf(ctx), names.browser));
        if (!browser || await sha256(browser) !== state.browserHash) redirectError(ctx, config!, "MKL_STATE_INVALID");
        if (state.issuer !== config!.issuer || state.clientId !== config!.clientId || state.redirectUri !== config!.redirectUri) redirectError(ctx, config!, "MKL_STATE_INVALID");
        if (ctx.query.error) redirectError(ctx, config!, "MKL_AUTH_CANCELLED");
        if (!ctx.query.code) redirectError(ctx, config!, "MKL_TOKEN_INVALID");

        let localSession: Awaited<ReturnType<typeof getAuthoritativeSessionFromCtx>> = null;
        if (state.intent === "link") {
          localSession = await getAuthoritativeSessionFromCtx(ctx);
          if (!localSession?.user || localSession.user.id !== state.userId || localSession.session.id !== state.sessionId) redirectError(ctx, config!, "UNAUTHENTICATED");
          if (isAdmin(localSession.user.role)) { await rejectLink(localSession.user.id, "MKL_ADMIN_LINK_FORBIDDEN"); redirectError(ctx, config!, "MKL_ADMIN_LINK_FORBIDDEN"); }
        }

        let identity: MklIdentity; let verifiedIdToken: string; let authTimeSupported = false;
        try {
          const discovery = await discoverMkl(config!);
          authTimeSupported = discovery.authTimeSupported;
          verifiedIdToken = await exchangeMklCode(discovery, config!, { code: ctx.query.code!, codeVerifier: state.codeVerifier });
          identity = await verifyMklIdToken(verifiedIdToken, discovery, config!, state.expectedNonce);
        } catch (error) {
          if (error instanceof MklProtocolError) redirectError(ctx, config!, error.code);
          throw error;
        }

        if (state.intent === "link") {
          const userId = localSession!.user.id;
          // Fresh verified control: once MKL reports auth_time, the MKL sign-in
          // behind this link must have happened after the ceremony started, not
          // be a session somebody left open.
          if (authTimeSupported && (identity.authTime === null || identity.authTime * 1000 + AUTH_TIME_TOLERANCE_MS < state.createdAt)) {
            await rejectLink(userId, "MKL_REAUTH_REQUIRED", identity); redirectError(ctx, config!, "MKL_REAUTH_REQUIRED");
          }
          if (await getMklLinkByUserId(userId)) { await rejectLink(userId, "MKL_ACCOUNT_ALREADY_LINKED", identity); redirectError(ctx, config!, "MKL_ACCOUNT_ALREADY_LINKED"); }
          if (await getIdentityOwner(identity.issuer, identity.subject)) { await rejectLink(userId, "MKL_IDENTITY_LINKED_ELSEWHERE", identity); redirectError(ctx, config!, "MKL_IDENTITY_LINKED_ELSEWHERE"); }
          const receipt = await createConsentState(ctx.context.internalAdapter, { userId, browserHash: state.browserHash, identity, correlationRef: state.correlationRef });
          ctx.setCookie(names.browser, browser, cookieAttributes(names.secure));
          ctx.setCookie(names.consent, receipt, cookieAttributes(names.secure));
          ctx.setHeader("cache-control", "no-store");
          throw ctx.redirect(new URL("/settings?mkl=confirm#profil", config!.appOrigin).toString());
        }

        let owner = await getIdentityOwner(identity.issuer, identity.subject); let isNewUser = false;
        if (owner) {
          if (activeBan(owner.user)) redirectError(ctx, config!, "ACCOUNT_DISABLED");
          if (isAdmin(owner.user.role)) redirectError(ctx, config!, "MKL_ADMIN_LINK_FORBIDDEN");
          await updateAuthenticatedLink(owner.link.id, identity);
        } else {
          if (!identity.email || !identity.emailVerified) redirectError(ctx, config!, "MKL_PROFILE_INCOMPLETE");
          if (await emailOwner(identity.email)) redirectError(ctx, config!, "MKL_EMAIL_CONFLICT");
          const name = (identity.name || identity.email.split("@")[0] || "MKL user").slice(0, 100);
          try {
            const user = await provisionMklUser(identity, name, state.correlationRef);
            owner = { link: (await getMklLinkByUserId(user.id))!, user: { ...user, banExpires: null } };
            isNewUser = true;
          } catch {
            owner = await getIdentityOwner(identity.issuer, identity.subject);
            if (!owner) {
              if (await emailOwner(identity.email)) redirectError(ctx, config!, "MKL_EMAIL_CONFLICT");
              redirectError(ctx, config!, "MKL_UNAVAILABLE");
            }
            if (activeBan(owner.user)) redirectError(ctx, config!, "ACCOUNT_DISABLED");
            if (isAdmin(owner.user.role)) redirectError(ctx, config!, "MKL_ADMIN_LINK_FORBIDDEN");
          }
        }
        // Entitlement refresh is tied to this just-verified authorization
        // ceremony. Identity sign-in remains available while B3 is locally
        // uncommissioned or MKL is unavailable; the resolver independently
        // fails closed once no fresh verified projection exists.
        const freshLink = await getMklLinkByUserId(owner!.user.id);
        if (freshLink) await refreshMklAuthority(owner!.user.id, freshLink, verifiedIdToken!).catch(() => undefined);
        const session = await ctx.context.internalAdapter.createSession(owner!.user.id);
        if (!session) redirectError(ctx, config!, "MKL_TOKEN_INVALID");
        await setSessionCookie(ctx, { session, user: owner!.user });
        clearReauth(ctx, config!);
        ctx.setHeader("cache-control", "no-store");
        throw ctx.redirect(new URL(isNewUser ? "/onboarding" : state.returnTo, config!.appOrigin).toString());
      }),
    },
    rateLimit: [{ pathMatcher: (path: string) => path.startsWith("/mkl/"), window: 60, max: 10 }],
  };
}
