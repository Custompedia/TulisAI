import { VersionLabelSchema, jsonData } from "@/lib/contracts";
import { requireUser } from "@/server/auth/auth";
import { handleRouteError, idempotencyKey, readJson } from "@/server/http";
import { getVersion, updateVersionLabel } from "@/server/documents/service";
type Context = { params: Promise<{ id: string; versionId: string }> };
export async function GET(request: Request, { params }: Context) { try { const user = await requireUser(request); const value = await params; return jsonData(await getVersion(user.id, value.id, value.versionId)); } catch (error) { return handleRouteError(error); } }
export async function PATCH(request: Request, { params }: Context) { try { const user = await requireUser(request); idempotencyKey(request); const value = await params; const input = await readJson(request, VersionLabelSchema); return jsonData(await updateVersionLabel(user.id, value.id, value.versionId, input.label)); } catch (error) { return handleRouteError(error); } }
