import { jsonData } from "@/lib/contracts";
import { NotebookAppearanceSchema } from "@/lib/notebook/appearance";
import { requireUser } from "@/server/auth/auth";
import { handleRouteError, idempotencyKey, readJson } from "@/server/http";
import { updateAppearance } from "@/server/documents/service";

type Context = { params: Promise<{ id: string }> };
export async function PATCH(request: Request, { params }: Context) { try { const user = await requireUser(request); idempotencyKey(request); const input = await readJson(request, NotebookAppearanceSchema); return jsonData(await updateAppearance(user.id, (await params).id, input)); } catch (error) { return handleRouteError(error); } }
