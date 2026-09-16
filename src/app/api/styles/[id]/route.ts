import { jsonData } from "@/lib/contracts";
import { StylePatchSchema } from "@/lib/writing/styles";
import { requireUser } from "@/server/auth/auth";
import { handleRouteError, idempotencyKey, readJson } from "@/server/http";
import { deleteStyle, updateStyle } from "@/server/writing/styles";

type Context = { params: Promise<{ id: string }> };
export async function PATCH(request: Request, { params }: Context) { try { const user = await requireUser(request); idempotencyKey(request); const input = await readJson(request, StylePatchSchema); return jsonData(await updateStyle(user.id, (await params).id, input)); } catch (error) { return handleRouteError(error); } }
export async function DELETE(request: Request, { params }: Context) { try { const user = await requireUser(request); idempotencyKey(request); await deleteStyle(user.id, (await params).id); return jsonData({ deleted: true }); } catch (error) { return handleRouteError(error); } }
