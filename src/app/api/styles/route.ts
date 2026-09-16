import { jsonData } from "@/lib/contracts";
import { StyleInputSchema } from "@/lib/writing/styles";
import { requireUser } from "@/server/auth/auth";
import { handleRouteError, idempotencyKey, readJson } from "@/server/http";
import { createStyle, listStyles } from "@/server/writing/styles";

export async function GET(request: Request) { try { const user = await requireUser(request); return jsonData(await listStyles(user.id)); } catch (error) { return handleRouteError(error); } }
export async function POST(request: Request) { try { const user = await requireUser(request); idempotencyKey(request); return jsonData(await createStyle(user.id, await readJson(request, StyleInputSchema)), { status: 201 }); } catch (error) { return handleRouteError(error); } }
