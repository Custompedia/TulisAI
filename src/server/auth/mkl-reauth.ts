import { createAuthMiddleware } from "better-auth/api";
import { runtime } from "../runtime";
import { mklConfig, type MklConfig } from "./mkl-oidc";
import { cookieAttributes, readCookie } from "./mkl-state";

/**
 * "This browser explicitly signed out of TulisAI."
 *
 * Signing out ends only TulisAI's session; the MKL session is shared with other
 * applications and stays. Without this marker the next "Continue with MKL" is
 * answered by that MKL session silently and the previous person comes back.
 * While it is present, the next sign-in asks MKL for `prompt=login`; a
 * completed sign-in clears it.
 */
export const MKL_REAUTH_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

export function mklReauthCookieName(config: MklConfig) {
  return new URL(config.appOrigin).protocol === "https:" ? "__Host-tulis_mkl_reauth" : "tulis_mkl_reauth";
}

export function reauthRequested(config: MklConfig, headers: Headers): boolean {
  return readCookie(headers, mklReauthCookieName(config)) === "1";
}

type CookieContext = { setCookie: (name: string, value: string, attributes: ReturnType<typeof cookieAttributes>) => unknown };

export function clearReauth(ctx: CookieContext, config: MklConfig) {
  const secure = new URL(config.appOrigin).protocol === "https:";
  ctx.setCookie(mklReauthCookieName(config), "", cookieAttributes(secure, 0));
}

/** After-hook on Better Auth's `/sign-out`: every way out of TulisAI marks the browser. */
export const markReauthOnSignOut = {
  matcher: (context: { path?: string }) => context.path === "/sign-out",
  handler: createAuthMiddleware(async (ctx) => {
    let config: MklConfig;
    try {
      config = mklConfig(runtime());
    } catch {
      return; // MKL is not configured here; there is no MKL session to reuse.
    }
    const secure = new URL(config.appOrigin).protocol === "https:";
    ctx.setCookie(mklReauthCookieName(config), "1", cookieAttributes(secure, MKL_REAUTH_MAX_AGE_SECONDS));
  }),
};
