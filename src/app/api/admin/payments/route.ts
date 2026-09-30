import { jsonData } from "@/lib/contracts";
import { requireAdmin } from "@/server/auth/auth";
import { handleRouteError } from "@/server/http";
import { paymentReport } from "@/server/payments/report";

export async function GET(request: Request) {
  try {
    await requireAdmin(request);
    return jsonData(await paymentReport(new URL(request.url).searchParams.get("month")), { headers: { "cache-control": "no-store" } });
  } catch (error) { return handleRouteError(error); }
}
