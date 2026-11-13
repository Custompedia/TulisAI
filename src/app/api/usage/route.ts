import { jsonData } from "@/lib/contracts";
import { requireUser } from "@/server/auth/auth";
import { handleRouteError } from "@/server/http";
import { usageSummary } from "@/server/usage/quota";
import { claimQuietly } from "@/server/payments/lynk";
// A Lynk purchase made with this account's verified email is granted before the allowance is read (docs/lynk-payments.md).
export async function GET(request: Request) { try { const user = await requireUser(request); await claimQuietly(user.id); return jsonData(await usageSummary(user.id)); } catch (error) { return handleRouteError(error); } }
