import { jsonData } from "@/lib/contracts";
import { requireUser } from "@/server/auth/auth";
import { handleRouteError } from "@/server/http";
import { deleteLock } from "@/server/documents/locks";
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string; lockId: string }> }) { try { const user = await requireUser(request); const value = await params; await deleteLock(user.id, value.id, value.lockId); return jsonData({ deleted: true }); } catch (error) { return handleRouteError(error); } }
