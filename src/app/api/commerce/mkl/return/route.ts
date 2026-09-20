import { requireUser } from "@/server/auth/auth";
import { mklConfig } from "@/server/auth/mkl-oidc";
import { mklCookieNames, readCookie, serializeCookie } from "@/server/auth/mkl-state";
import { recoverPurchaseIntent } from "@/server/commerce/intents";
import { handleRouteError, RequestError } from "@/server/http";
import { runtime } from "@/server/runtime";

export async function GET(request: Request) {
  try {
    const user = await requireUser(request); const config = mklConfig(runtime()); const names = mklCookieNames(config);
    const purchaseId = readCookie(request.headers, names.purchase);
    if (!purchaseId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(purchaseId)) {
      throw new RequestError("PURCHASE_RETURN_NOT_BOUND", "Recover the purchase from your TulisAI account.", 400);
    }
    // The browser return is only a recovery signal. This call asks MKL for the
    // order/purchase authority; the URL and cookie themselves grant nothing.
    const recovered = await recoverPurchaseIntent({ ownerId: user.id, purchaseId });
    const url = new URL("/app", config.appOrigin); url.searchParams.set("purchase", purchaseId); url.searchParams.set("purchase_status", recovered.outcome);
    const response = Response.redirect(url.toString(), 303); response.headers.set("cache-control", "no-store");
    if (recovered.outcome === "terminal" || recovered.outcome === "reconciled") response.headers.append("set-cookie", serializeCookie(names.purchase, "", names.secure, 0));
    return response;
  } catch (error) { return handleRouteError(error); }
}
