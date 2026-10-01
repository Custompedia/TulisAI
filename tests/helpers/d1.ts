import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { applyMigrations } from './migrations';

// A D1 stand-in over node:sqlite: batch() is atomic like D1's, and R2 is an in-memory map.
export class Statement {
  constructor(readonly db: DatabaseSync, readonly sql: string, readonly values: SQLInputValue[] = []) {}
  bind(...values: SQLInputValue[]) { return new Statement(this.db, this.sql, values); }
  async first<T>() { return this.db.prepare(this.sql).get(...this.values) as T | undefined ?? null; }
  async all<T>() { return { results: this.db.prepare(this.sql).all(...this.values) as T[], success: true, meta: { changes: 0 } }; }
  execute() { const value = this.db.prepare(this.sql).run(...this.values); return { success: true, results: [], meta: { changes: Number(value.changes), last_row_id: Number(value.lastInsertRowid) } }; }
  async run() { return this.execute(); }
}

export function testEnv(extra: Record<string, unknown> = {}) {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys=ON');
  applyMigrations(db);
  const objects = new Map<string, string>();
  const env: Record<string, unknown> = {
    DB: {
      prepare: (sql: string) => new Statement(db, sql),
      batch: async (statements: Statement[]) => {
        db.exec('BEGIN IMMEDIATE');
        try { const results = statements.map((statement) => statement.execute()); db.exec('COMMIT'); return results; }
        catch (error) { db.exec('ROLLBACK'); throw error; }
      },
    },
    DOCUMENTS: {
      head: async (key: string) => (objects.has(key) ? { key, size: objects.get(key)!.length } : null),
      // Large bodies are written as UTF-8 bytes (src/server/storage/r2.ts); the double keeps text either way.
      put: async (key: string, value: string | Uint8Array) => { objects.set(key, typeof value === 'string' ? value : new TextDecoder().decode(value)); return { key }; },
      get: async (key: string) => { const value = objects.get(key); return value === undefined ? null : { size: value.length, text: async () => value, arrayBuffer: async () => new TextEncoder().encode(value).buffer }; },
      delete: async (keys: string | string[]) => { for (const key of Array.isArray(keys) ? keys : [keys]) objects.delete(key); },
      list: async () => ({ objects: [], truncated: false }),
    },
    AI_MONTHLY_REQUEST_LIMIT: '100', AI_PUBLIC_ENABLED: 'true', OPENROUTER_API_KEY: 'test-key', OPENROUTER_MODEL: 'test',
    ...extra,
  };
  const addUser = (id: string, role = 'user') => db.prepare('INSERT INTO user (id,name,email,username,role,tier,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)')
    .run(id, id, `${id}@example.test`, id, role, 'free', 1, 1);
  return { db, env, objects, addUser };
}
