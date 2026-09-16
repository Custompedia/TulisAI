import { z } from "zod";
import { APIError } from "better-auth/api";
import { apiError, jsonData } from "@/lib/contracts";
import { auth, requireUser } from "@/server/auth/auth";
import { handleRouteError, idempotencyKey, readJson } from "@/server/http";

const SetPasswordSchema = z.object({ newPassword: z.string().min(10).max(128) });

export async function POST(request: Request) {
  try {
    await requireUser(request); idempotencyKey(request);
    const { newPassword } = await readJson(request, SetPasswordSchema);
    await auth().api.setPassword({ body: { newPassword }, headers: request.headers });
    return jsonData({ passwordSet: true });
  } catch (error) {
    if (error instanceof APIError) return apiError(typeof error.body?.code === "string" ? error.body.code : "REQUEST_FAILED", error.body?.message ?? error.message, error.statusCode);
    return handleRouteError(error);
  }
}
