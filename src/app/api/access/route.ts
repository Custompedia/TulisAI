import { jsonData } from "@/lib/contracts";
import { requireUser } from "@/server/auth/auth";
import { handleRouteError } from "@/server/http";
import { entitlement } from "@/server/usage/quota";
import { FEATURES } from "@/lib/plans";

export async function GET(request: Request) {
  try {
    const user = await requireUser(request);
    const rights = await entitlement(user.id);
    const access = rights.access;
    return jsonData({
      authority: access.authority,
      commercial: { active: access.commercialActive, plan: access.plan, topupEligible: access.topupEligible },
      capabilityTier: access.tier,
      features: access.features,
      capabilities: Object.fromEntries(FEATURES.map((feature) => [feature, access.features.includes(feature)])),
      identity: { linked: access.linked },
      freshness: {
        fresh: access.fresh, staleReason: access.staleReason, projectionRevision: access.projectionRevision,
        verifiedAt: access.verifiedAt, freshUntil: access.freshUntil, periodEnd: access.periodEnd, paidUntil: access.paidUntil,
      },
    }, { headers: { "cache-control": "no-store" } });
  } catch (error) { return handleRouteError(error); }
}
