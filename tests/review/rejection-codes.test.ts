import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { applyMigrations } from '../helpers/migrations';

const state = vi.hoisted(() => ({ env: {} as Record<string, unknown> }));
vi.mock('../../src/server/runtime', () => ({
  runtime: () => state.env,
  requiredSetting: (value: string) => value,
  ConfigurationError: class extends Error {},
}));

import { createDocument } from '../../src/server/documents/service';
import { generatePreview } from '../../src/server/ai/service';
import { defaults, runtimeControls } from '../../src/lib/writing/settings';
import { createLock } from '../../src/server/documents/locks';
import { ApiError, errorText } from '../../src/lib/client/api';
import { EditorDocumentSchema } from '../../src/lib/contracts';

let db: DatabaseSync;
class Statement {
  constructor(readonly sql: string, readonly values: SQLInputValue[] = []) {}
  bind(...values: SQLInputValue[]) { return new Statement(this.sql, values); }
  async first<T>() { return db.prepare(this.sql).get(...this.values) as T | undefined ?? null; }
  async all<T>() { return { results: db.prepare(this.sql).all(...this.values) as T[], success: true }; }
  execute() { const value = db.prepare(this.sql).run(...this.values); return { success: true, meta: { changes: Number(value.changes), last_row_id: Number(value.lastInsertRowid) } }; }
  async run() { return this.execute(); }
}

const objects = new Map<string, string>();
beforeEach(() => {
  db = new DatabaseSync(':memory:');
  applyMigrations(db);
  objects.clear();
  state.env = {
    DB: { prepare: (sql: string) => new Statement(sql), batch: async (statements: Statement[]) => {
      db.exec('BEGIN');
      try { const results = statements.map((statement) => statement.execute()); db.exec('COMMIT'); return results; }
      catch (error) { db.exec('ROLLBACK'); throw error; }
    } },
    DOCUMENTS: {
      head: async (key: string) => (objects.has(key) ? { key, size: objects.get(key)!.length } : null),
      put: async (key: string, value: string) => { objects.set(key, value); return { key }; },
      get: async (key: string) => { const value = objects.get(key); return value === undefined ? null : { size: value.length, text: async () => value, arrayBuffer: async () => new TextEncoder().encode(value).buffer }; },
      delete: async (keys: string | string[]) => { for (const key of Array.isArray(keys) ? keys : [keys]) objects.delete(key); },
    },
    AI_PUBLIC_ENABLED: 'true', OPENROUTER_API_KEY: 'test-key', AI_MONTHLY_REQUEST_LIMIT: '100', AI_FREE_CHARACTER_ALLOWANCE: '100000',
  };
});
afterEach(() => { vi.unstubAllGlobals(); db.close(); });

const content = (text: string) => EditorDocumentSchema.parse({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });
const reply = (output: unknown) => Response.json({ id: 'p', choices: [{ message: { content: JSON.stringify(output) }, finish_reason: 'stop' }], usage: { prompt_tokens: 5, completion_tokens: 5 } });
const transform = (text: string) => ({ transformed_text: text, change_categories: [], warnings: [], no_change_needed: false });
const run = (documentId: string, revision: number, text: string) =>
  generatePreview('owner-a', `key-${Math.random()}`, { documentId, promptId: 'P01_STANDARD_REWRITE', source: { text }, runtime: runtimeControls({ ...defaults, mode: 'standard', language: 'id' }, 'id'), expectedRevision: revision });

// Every reply is used for both the first call and the repair call, so a refusal is the pipeline's final word.
const always = (output: unknown) => vi.stubGlobal('fetch', vi.fn(async () => reply(output)));

describe('review: a refused result names what it broke', () => {
  it('reports a changed number as a number rejection and quotes the figure', async () => {
    const source = 'Kami memiliki 10 unit gudang.';
    const doc = await createDocument('owner-a', { title: 'N', language: 'id', content: content(source) });
    always(transform('Kami memiliki 12 unit gudang.'));
    // The token names the source figure that went missing, which is the fact the writer has to check.
    await expect(run(doc.id, doc.revision, source)).rejects.toMatchObject({ code: 'AI_NUMBER_REJECTED', status: 422, details: { token: '10' } });
  });

  it('reports a dropped locked term as a locked-term rejection and quotes the term', async () => {
    const source = 'Sistem Merdeka dipakai di seluruh kampus.';
    const doc = await createDocument('owner-a', { title: 'T', language: 'id', content: content(source) });
    await createLock('owner-a', doc.id, 'Sistem Merdeka');
    always(transform('Aplikasi itu dipakai di seluruh kampus.'));
    await expect(run(doc.id, doc.revision, source)).rejects.toMatchObject({ code: 'AI_LOCKED_TERM_REJECTED', status: 422, details: { token: 'Sistem Merdeka' } });
  });

  it('accepts the notation and multiplicity changes that used to be refused', async () => {
    const source = 'Biaya 1.500.000 rupiah untuk 10 unit.';
    const doc = await createDocument('owner-a', { title: 'B', language: 'id', content: content(source) });
    const transport = vi.fn(async () => reply(transform('Biayanya 1,500,000 rupiah untuk 10 unit, dan 10 unit itu siap kirim.')));
    vi.stubGlobal('fetch', transport);
    const preview = await run(doc.id, doc.revision, source);
    expect(preview.output.transformed_text).toContain('1,500,000');
    // One call only: nothing triggered the repair pass.
    expect(transport).toHaveBeenCalledTimes(1);
  });
});

describe('review: rejection copy tells the user which check failed', () => {
  const message = (code: string, details?: unknown) => errorText(new ApiError(code, 422, details), false);
  it('gives a different message per cause instead of one catch-all', () => {
    const number = message('AI_NUMBER_REJECTED', { token: '12' });
    const term = message('AI_LOCKED_TERM_REJECTED', { token: 'Sistem Merdeka' });
    expect(number).toContain('angka');
    expect(number).toContain('12');
    expect(term).toContain('kunci');
    expect(term).toContain('Sistem Merdeka');
    expect(number).not.toBe(term);
    expect(message('AI_CITATION_REJECTED')).toContain('sitasi');
    expect(message('FEATURE_LOCKED')).toContain('berbayar');
    expect(message('QUOTA_EXCEEDED')).toContain('karakter');
  });
  it('still has a generic message for an untyped refusal', () => {
    expect(message('AI_OUTPUT_REJECTED')).toContain('pemeriksaan keamanan');
  });
});

describe('review: a free-form instruction is paid, scoped and free', () => {
  const paid = (id: string) => db.prepare(`INSERT INTO user (id,name,email,username,role,tier,created_at,updated_at) VALUES ('${id}','U','${id}@example.test','${id}','user','max',1,1)`).run();
  // null means "send no anchor at all"; a default parameter would be replaced by `undefined`.
  const instruct = (owner: string, documentId: string, revision: number, text: string, instruction: string, anchor: { from: number; to: number } | null = { from: 0, to: text.length }) =>
    generatePreview(owner, `key-${Math.random()}`, {
      documentId, promptId: 'P08_CUSTOM_TRANSFORM', source: { text, ...(anchor ? { anchor } : {}) },
      runtime: runtimeControls({ ...defaults, mode: 'standard', language: 'id', customized: true }, 'id'),
      expectedRevision: revision, instruction,
    });

  it('is locked on a free account', async () => {
    const source = 'Kami memiliki 10 unit gudang.';
    const doc = await createDocument('free-user', { title: 'F', language: 'id', content: content(source) });
    const transport = vi.fn();
    vi.stubGlobal('fetch', transport);
    await expect(instruct('free-user', doc.id, doc.revision, source, 'ubah ini ke english'))
      .rejects.toMatchObject({ code: 'FEATURE_LOCKED', status: 403, details: { feature: 'freeform_prompt' } });
    expect(transport).not.toHaveBeenCalled();
  });

  it('is still locked on Pro, because AI Mode is what Max sells', async () => {
    db.prepare("INSERT INTO user (id,name,email,username,role,tier,created_at,updated_at) VALUES ('pro-user','U','pro@example.test','pro-user','user','pro',1,1)").run();
    const source = 'Kami memiliki 10 unit gudang.';
    const doc = await createDocument('pro-user', { title: 'F', language: 'id', content: content(source) });
    const transport = vi.fn();
    vi.stubGlobal('fetch', transport);
    await expect(instruct('pro-user', doc.id, doc.revision, source, 'ubah ini ke english'))
      .rejects.toMatchObject({ code: 'FEATURE_LOCKED', status: 403, details: { feature: 'freeform_prompt', requiredTier: 'max' } });
    expect(transport).not.toHaveBeenCalled();
  });

  // AI Mode is charged MAX(source, output): the hold taken before the call is released down to what was really used.
  const charge = () => Number((db.prepare("SELECT COALESCE(SUM(charge_characters),0) AS total FROM usage_ledger WHERE operation='generate'").get() as { total: number }).total);

  it('charges the generated output when it is longer than the source', async () => {
    paid('payer-i');
    const source = 'Kami memiliki 10 unit gudang.';
    const longer = 'Kami memiliki 10 unit gudang di Bandung.';
    const doc = await createDocument('payer-i', { title: 'F', language: 'id', content: content(source) });
    always(transform(longer));
    await instruct('payer-i', doc.id, doc.revision, source, 'tambahkan lokasinya');
    expect(longer.length).toBeGreaterThan(source.length);
    expect(charge()).toBe(longer.length);
  });

  it('charges the source when the output came back shorter', async () => {
    paid('payer-j');
    const source = 'Kami memiliki 10 unit gudang.';
    const doc = await createDocument('payer-j', { title: 'F', language: 'id', content: content(source) });
    always(transform('Kami punya 10 gudang.'));
    await instruct('payer-j', doc.id, doc.revision, source, 'persingkat ini');
    expect(charge()).toBe(source.length);
  });

  it('needs a selected passage, so it cannot be aimed at a whole notebook', async () => {
    paid('payer-a');
    const source = 'Kami memiliki 10 unit gudang.';
    const doc = await createDocument('payer-a', { title: 'F', language: 'id', content: content(source) });
    vi.stubGlobal('fetch', vi.fn());
    await expect(instruct('payer-a', doc.id, doc.revision, source, 'persingkat ini', null))
      .rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  });

  it('reaches the model as its own user block and leaves the system prompt alone', async () => {
    paid('payer-b');
    const source = 'Kami memiliki 10 unit gudang.';
    const doc = await createDocument('payer-b', { title: 'F', language: 'id', content: content(source) });
    let body: { messages: Array<{ role: string; content: string }> } | null = null;
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: { body: string }) => {
      body = JSON.parse(init.body);
      return reply(transform('We have 10 warehouse units.'));
    }));
    await instruct('payer-b', doc.id, doc.revision, source, 'ubah ini ke english');
    const messages = body!.messages;
    expect(messages[0]!.role).toBe('system');
    expect(messages[0]!.content).not.toContain('ubah ini ke english');
    expect(messages[1]!.content).toContain('<user_instruction>');
    expect(messages[1]!.content).toContain('ubah ini ke english');
  });

  it('may change a number when the writer asks for it', async () => {
    paid('payer-c');
    const source = 'Kami memiliki 10 unit gudang.';
    const doc = await createDocument('payer-c', { title: 'F', language: 'id', content: content(source) });
    always(transform('Kami memiliki 12 unit gudang.'));
    const preview = await instruct('payer-c', doc.id, doc.revision, source, 'ganti angkanya jadi 12');
    expect(preview.output.transformed_text).toBe('Kami memiliki 12 unit gudang.');
  });

  it('still keeps a term the writer locked', async () => {
    paid('payer-e');
    const source = 'Sistem Merdeka memiliki 10 unit gudang.';
    const doc = await createDocument('payer-e', { title: 'F', language: 'id', content: content(source) });
    await createLock('payer-e', doc.id, 'Sistem Merdeka');
    always(transform('The Independent System has 10 warehouse units.'));
    await expect(instruct('payer-e', doc.id, doc.revision, source, 'inggriskan')).rejects.toMatchObject({ status: 422 });
  });

  it('translates Indonesian to English even when the notebook language is Indonesian', async () => {
    paid('payer-f');
    const source = 'Laporan ini disusun sebagai hasil kegiatan magang (Pratama, 2024).';
    const doc = await createDocument('payer-f', { title: 'F', language: 'id', content: content(source) });
    let body: { messages: Array<{ role: string; content: string }> } | null = null;
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: { body: string }) => { body = JSON.parse(init.body); return reply(transform('This report was prepared as the result of an internship.')); }));
    const preview = await instruct('payer-f', doc.id, doc.revision, source, 'inggriskan');
    expect(preview.output.transformed_text).toBe('This report was prepared as the result of an internship.');
    expect(body!.messages[0]!.content).toContain('When the instruction names a language or asks for a translation');
    expect(body!.messages[0]!.content).not.toContain('the rules win');
    expect(body!.messages[1]!.content).not.toContain('<protected>\n');
  });

  // Regression: the P10 repair used the full rewrite checks, so a translation that also changed a figure or a citation could never be repaired.
  it('repairs a dropped locked term without restoring the numbers and citations the instruction changed', async () => {
    paid('payer-g');
    const source = 'Sistem Merdeka memiliki 10 unit gudang (Pratama, 2024).';
    const doc = await createDocument('payer-g', { title: 'F', language: 'id', content: content(source) });
    await createLock('payer-g', doc.id, 'Sistem Merdeka');
    const bodies: Array<{ messages: Array<{ role: string; content: string }> }> = [];
    const replies = [transform('The Independent System has 12 warehouse units (Pratama et al., 2024).'), { corrected_text: 'Sistem Merdeka has 12 warehouse units (Pratama et al., 2024).', unrepairable_spans: [] }];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: { body: string }) => { bodies.push(JSON.parse(init.body)); return reply(replies[bodies.length - 1]); }));
    const preview = await instruct('payer-g', doc.id, doc.revision, source, 'inggriskan dan ganti angkanya jadi 12');
    expect(preview.output.transformed_text).toBe('Sistem Merdeka has 12 warehouse units (Pratama et al., 2024).');
    expect(bodies[1]!.messages[1]!.content).toContain('<violations>\nrequired: Sistem Merdeka | appeared instead: (missing)\n</violations>');
  });

  it('refuses a custom transform that carries no instruction', async () => {
    paid('payer-h');
    const source = 'Kami memiliki 10 unit gudang.';
    const doc = await createDocument('payer-h', { title: 'F', language: 'id', content: content(source) });
    const transport = vi.fn();
    vi.stubGlobal('fetch', transport);
    await expect(instruct('payer-h', doc.id, doc.revision, source, '')).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    expect(transport).not.toHaveBeenCalled();
  });

  it('accepts a translation that keeps the figure, spelled out or not', async () => {
    paid('payer-d');
    const source = 'Kami memiliki 10 unit gudang.';
    const doc = await createDocument('payer-d', { title: 'F', language: 'id', content: content(source) });
    always(transform('We have ten warehouse units.'));
    const preview = await instruct('payer-d', doc.id, doc.revision, source, 'ubah ini ke english');
    expect(preview.output.transformed_text).toBe('We have ten warehouse units.');
  });
});
