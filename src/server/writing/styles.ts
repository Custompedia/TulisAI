import { runtime } from "../runtime";
import { RequestError } from "../http";
import { requireFeature } from "../usage/features";
import { isNotebookColor } from "@/lib/notebook/appearance";
import { STYLE_LIMIT, styleSettings, type StyleInput, type StylePatch, type WritingStyle } from "@/lib/writing/styles";
import { entitlement } from "../usage/quota";
import { storedSettingsForAccess } from "../usage/premium";

type StyleRow = { id: string; name: string; description: string | null; color: string | null; icon: string | null; settings_json: string; created_at: number; updated_at: number };
const now = () => Date.now();
const isUnique = (error: unknown) => /UNIQUE/i.test(error instanceof Error ? error.message : String(error));
const parse = (json: string): Record<string, unknown> => { try { const value: unknown = JSON.parse(json); return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; } catch { return {}; } };
const dto = (row: StyleRow): WritingStyle => ({ id: row.id, name: row.name, description: row.description?.trim() || null, color: isNotebookColor(row.color) ? row.color : null, icon: row.icon, settings: styleSettings(parse(row.settings_json)), createdAt: new Date(row.created_at).toISOString(), updatedAt: new Date(row.updated_at).toISOString() });
const SELECT = "SELECT id,name,description,color,icon,settings_json,created_at,updated_at FROM writing_styles";

async function rowForOwner(styleId: string, ownerId: string): Promise<StyleRow> {
  const row = await runtime().DB.prepare(`${SELECT} WHERE id=? AND owner_id=?`).bind(styleId, ownerId).first<StyleRow>();
  if (!row) throw new RequestError("STYLE_NOT_FOUND", "Style not found.", 404);
  return row;
}

export async function listStyles(ownerId: string): Promise<WritingStyle[]> {
  const rows = await runtime().DB.prepare(`${SELECT} WHERE owner_id=? ORDER BY created_at ASC,id ASC`).bind(ownerId).all<StyleRow>();
  return (rows.results ?? []).map(dto);
}

// Saved styles start at Plus; listing and deleting stay open so a downgrade never holds saved work hostage.
// The per-owner limit is enforced inside the INSERT so concurrent creates cannot exceed it.
export async function createStyle(ownerId: string, input: StyleInput): Promise<WritingStyle> {
  const rights = await requireFeature(ownerId, "saved_styles");
  const id = crypto.randomUUID(); const created = now(); const settings = JSON.stringify(styleSettings(storedSettingsForAccess(rights, input.settings)));
  try {
    const result = await runtime().DB.prepare("INSERT INTO writing_styles (id,owner_id,name,description,color,icon,settings_json,created_at,updated_at) SELECT ?,?,?,?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM writing_styles WHERE owner_id=?)<?").bind(id, ownerId, input.name, input.description, input.color, input.icon, settings, created, created, ownerId, STYLE_LIMIT).run();
    if ((result.meta.changes ?? 0) !== 1) throw new RequestError("STYLE_LIMIT_REACHED", `You can save at most ${STYLE_LIMIT} styles.`, 409);
  } catch (error) { if (isUnique(error)) throw new RequestError("STYLE_EXISTS", "A style with this name already exists.", 409); throw error; }
  return dto({ id, name: input.name, description: input.description, color: input.color, icon: input.icon, settings_json: settings, created_at: created, updated_at: created });
}

export async function updateStyle(ownerId: string, styleId: string, changes: StylePatch): Promise<WritingStyle> {
  await requireFeature(ownerId, "saved_styles");
  const existing = await rowForOwner(styleId, ownerId); const updated = now();
  const rights = await entitlement(ownerId); const oldSettings = parse(existing.settings_json);
  const next: StyleRow = { ...existing, name: changes.name ?? existing.name, description: changes.description === undefined ? existing.description : changes.description, color: changes.color === undefined ? existing.color : changes.color, icon: changes.icon === undefined ? existing.icon : changes.icon, settings_json: changes.settings === undefined ? existing.settings_json : JSON.stringify(styleSettings(storedSettingsForAccess(rights, changes.settings, oldSettings))), updated_at: updated };
  try { await runtime().DB.prepare("UPDATE writing_styles SET name=?,description=?,color=?,icon=?,settings_json=?,updated_at=? WHERE id=? AND owner_id=?").bind(next.name, next.description, next.color, next.icon, next.settings_json, updated, styleId, ownerId).run(); }
  catch (error) { if (isUnique(error)) throw new RequestError("STYLE_EXISTS", "A style with this name already exists.", 409); throw error; }
  return dto(next);
}

export async function deleteStyle(ownerId: string, styleId: string): Promise<void> {
  const result = await runtime().DB.prepare("DELETE FROM writing_styles WHERE id=? AND owner_id=?").bind(styleId, ownerId).run();
  if ((result.meta.changes ?? 0) !== 1) throw new RequestError("STYLE_NOT_FOUND", "Style not found.", 404);
}
