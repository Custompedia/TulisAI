import { z } from "zod";
import { jsonData } from "@/lib/contracts";
import { requireAdmin } from "@/server/auth/auth";
import { handleRouteError, readJson } from "@/server/http";
import { adminAttachLynk } from "@/server/payments/lynk";

// Admin -> Pembayaran: give a Lynk payment that waits for an account to the account with this email.
const AttachSchema = z.object({ ref: z.string().min(1).max(100), email: z.string().trim().min(3).max(254) }).strict();

export async function POST(request: Request) {
  try {
    const admin = await requireAdmin(request);
    const input = await readJson(request, AttachSchema);
    return jsonData(await adminAttachLynk(admin.id, input.ref, input.email), { headers: { "cache-control": "no-store" } });
  } catch (error) { return handleRouteError(error); }
}
