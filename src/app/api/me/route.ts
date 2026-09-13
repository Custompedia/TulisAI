import { jsonData } from "@/lib/contracts";
import { requireUser } from "@/server/auth/auth";
import { handleRouteError } from "@/server/http";
export async function GET(request: Request) { try { return jsonData(await requireUser(request)); } catch (error) { return handleRouteError(error); } }
