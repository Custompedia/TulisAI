type MaintenanceEnv = { DB: D1Database; DOCUMENTS: R2Bucket };
const DAY = 24 * 60 * 60 * 1000;

export async function purgeExpiredPreviewPayloads(env: MaintenanceEnv, now = Date.now()) {
  const result = await env.DB.prepare("UPDATE transformations SET source_text='',output_json='{}',runtime_json='{}',anchor_json=NULL,status=CASE WHEN status='preview' THEN 'expired' ELSE status END WHERE id IN (SELECT id FROM transformations WHERE expires_at<? AND (length(source_text)>0 OR output_json<>'{}' OR runtime_json<>'{}') ORDER BY expires_at ASC LIMIT 100)").bind(now).run();
  return result.meta.changes ?? 0;
}

export async function sweepOrphanSnapshots(env: MaintenanceEnv, now = Date.now()) {
  const state = await env.DB.prepare("SELECT cursor FROM maintenance_state WHERE name='r2-orphan-sweep'").first<{ cursor: string | null }>();
  const listed = await env.DOCUMENTS.list({ prefix: "documents/", cursor: state?.cursor ?? undefined, limit: 100 }); let deleted = 0;
  const candidates = listed.objects.filter((object) => now - object.uploaded.getTime() >= DAY); const keys = candidates.map((object) => object.key);
  if (keys.length) { const placeholders = keys.map(() => "?").join(","); const refs = await env.DB.prepare(`SELECT snapshot_r2_key AS key FROM document_versions WHERE snapshot_r2_key IN (${placeholders}) UNION SELECT body_r2_key AS key FROM documents WHERE body_r2_key IN (${placeholders})`).bind(...keys, ...keys).all<{ key: string }>(); const referenced = new Set((refs.results ?? []).map((row) => row.key)); const orphanKeys = keys.filter((key) => !referenced.has(key)); if (orphanKeys.length) { await env.DOCUMENTS.delete(orphanKeys); deleted = orphanKeys.length; } }
  await env.DB.prepare("INSERT INTO maintenance_state (name,cursor,updated_at) VALUES ('r2-orphan-sweep',?,?) ON CONFLICT(name) DO UPDATE SET cursor=excluded.cursor,updated_at=excluded.updated_at").bind(listed.truncated ? listed.cursor : null, now).run();
  return { scanned: listed.objects.length, deleted, nextCursor: listed.truncated ? listed.cursor : null };
}

export async function runMaintenance(env: MaintenanceEnv, now = Date.now()) { const [purged, sweep] = await Promise.all([purgeExpiredPreviewPayloads(env, now), sweepOrphanSnapshots(env, now)]); return { purged, ...sweep }; }
