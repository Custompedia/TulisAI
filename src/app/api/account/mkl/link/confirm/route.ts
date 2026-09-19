import { jsonData } from "@/lib/contracts";
import { writeAudit } from "@/server/audit";
import { requireUser } from "@/server/auth/auth";
import { mklConfig } from "@/server/auth/mkl-oidc";
import { mklCookieNames, readCookie, serializeCookie, sha256 } from "@/server/auth/mkl-state";
import { confirmMklLink, pendingConsent } from "@/server/identity/links";
import { handleRouteError, idempotencyKey, RequestError } from "@/server/http";
import { runtime } from "@/server/runtime";

function sameOrigin(request: Request, expected: string) {
  if (request.headers.get("origin") !== expected) throw new RequestError("ORIGIN_MISMATCH", "The request origin is not allowed.", 403);
}

function expireConsent(response: Response, name: string, secure: boolean): Response {
  response.headers.append("set-cookie", serializeCookie(name, "", secure, 0));
  response.headers.set("cache-control", "no-store");
  return response;
}

async function loadPending(request: Request) {
  const config = mklConfig(runtime()); const names = mklCookieNames(config);
  const receipt = readCookie(request.headers, names.consent);
  if (!receipt || !/^[A-Za-z0-9_-]{43}$/.test(receipt)) throw new RequestError("MKL_CONFIRMATION_REQUIRED", "Start MKL linking again.", 400);
  const pending = await pendingConsent(receipt);
  if (!pending) throw new RequestError("MKL_CONFIRMATION_REQUIRED", "Start MKL linking again.", 400);
  if (pending.row.expires_at <= Date.now()) {
    await runtime().DB.prepare("DELETE FROM verification WHERE id=?").bind(pending.row.id).run();
    throw new RequestError("MKL_CONFIRMATION_EXPIRED", "The MKL confirmation expired.", 410);
  }
  const browser = readCookie(request.headers, names.browser);
  if (!browser || await sha256(browser) !== pending.value.browserHash) throw new RequestError("MKL_CONFIRMATION_REQUIRED", "This confirmation belongs to another browser.", 400);
  return { config, names, receipt, pending };
}

export async function GET(request: Request) {
  try {
    const user = await requireUser(request); const { pending } = await loadPending(request);
    if (pending.value.userId !== user.id) throw new RequestError("MKL_CONFIRMATION_REQUIRED", "This confirmation belongs to another account.", 400);
    if (user.role !== "user") throw new RequestError("MKL_ADMIN_LINK_FORBIDDEN", "Local admin accounts cannot link MKL customer identities.", 403);
    return jsonData({ profile: { name: pending.value.name, email: pending.value.email, issuer: pending.value.issuer }, expiresAt: new Date(pending.row.expires_at).toISOString() }, { headers: { "cache-control": "no-store" } });
  } catch (error) { return handleRouteError(error); }
}

export async function POST(request: Request) {
  let clear: { name: string; secure: boolean } | null = null;
  try {
    const user = await requireUser(request); const loaded = await loadPending(request); clear = { name: loaded.names.consent, secure: loaded.names.secure };
    sameOrigin(request, loaded.config.appOrigin); idempotencyKey(request);
    if (loaded.pending.value.userId !== user.id) throw new RequestError("MKL_CONFIRMATION_REQUIRED", "This confirmation belongs to another account.", 400);
    try {
      const link = await confirmMklLink(loaded.receipt, loaded.pending);
      return expireConsent(jsonData({ linked: true, profile: { name: link.profileName, email: link.profileEmail } }), clear.name, clear.secure);
    } catch (error) {
      if (error instanceof RequestError) await writeAudit(user.id, user.id, "identity.mkl.link-refused", { code: error.code, issuer: loaded.pending.value.issuer, subject: loaded.pending.value.subject, method: "explicit-link", correlationRef: loaded.pending.value.correlationRef });
      throw error;
    }
  } catch (error) {
    const response = handleRouteError(error);
    return clear ? expireConsent(response, clear.name, clear.secure) : response;
  }
}
