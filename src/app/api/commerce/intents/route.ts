import { z } from "zod";
import { jsonData } from "@/lib/contracts";
import { requireUser } from "@/server/auth/auth";
import { commerceConfig } from "@/server/commerce/mkl-client";
import { createPurchaseIntent, listPurchaseIntents } from "@/server/commerce/intents";
import { handleRouteError, idempotencyKey, readJson, RequestError } from "@/server/http";
import { runtime } from "@/server/runtime";

const CreateIntent = z.object({
  kind: z.enum(["access", "consumable"]), planCode: z.string().min(1).max(64),
  planVersion: z.string().min(1).max(64), buyerPhone: z.string().min(1).max(32),
}).strict();

function sameOrigin(request: Request) {
  const expected = new URL(commerceConfig(runtime()).returnUri).origin;
  if (request.headers.get("origin") !== expected) throw new RequestError("ORIGIN_MISMATCH", "The request origin is not allowed.", 403);
}

export async function GET(request: Request) {
  try {
    const user = await requireUser(request); const limit = Number(new URL(request.url).searchParams.get("limit") ?? 20);
    return jsonData(await listPurchaseIntents(user.id, Number.isFinite(limit) ? limit : 20), { headers: { "cache-control": "no-store" } });
  } catch (error) { return handleRouteError(error); }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser(request); sameOrigin(request); const key = idempotencyKey(request); const body = await readJson(request, CreateIntent);
    const result = await createPurchaseIntent({ ownerId: user.id, kind: body.kind, planCode: body.planCode, planVersion: body.planVersion,
      buyerPhone: body.buyerPhone, clientRequestKey: key });
    return jsonData(result, { status: result.created ? 201 : 200, headers: { "cache-control": "no-store" } });
  } catch (error) { return handleRouteError(error); }
}
