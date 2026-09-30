import { jsonData } from "@/lib/contracts";
import { requireUser } from "@/server/auth/auth";
import { handleRouteError } from "@/server/http";
import { runtime } from "@/server/runtime";
import { planState } from "@/server/access/periods";
import { checkoutEnabled, listOrders } from "@/server/payments/orders";
import { midtransConfig } from "@/server/payments/midtrans";

export async function GET(request: Request) {
  try {
    const user = await requireUser(request); const config = midtransConfig(runtime());
    const [orders, state] = await Promise.all([listOrders(user.id), planState(user.id)]);
    return jsonData({
      checkoutOpen: Boolean(config) && checkoutEnabled(runtime()), mode: config?.mode ?? null, orders,
      plan: state.current ? { code: state.current.plan_code, source: state.current.source, periodEnd: state.current.period_end, paidThrough: state.paidThrough } : null,
    }, { headers: { "cache-control": "no-store" } });
  } catch (error) { return handleRouteError(error); }
}
