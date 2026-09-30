import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { testEnv } from '../helpers/d1';

const state = vi.hoisted(() => ({ env: {} as Record<string, unknown> }));
vi.mock('@/server/runtime', () => ({ runtime: () => state.env, requiredSetting: (value: string) => value, ConfigurationError: class extends Error {} }));

import { autosaveDocument, createDocument, getDocument } from '@/server/documents/service';
import { DocumentCreateSchema, DocumentPatchSchema, EditorDocumentSchema } from '@/lib/contracts';
import { BRIEF_KEYS, BRIEF_VALUE_LIMIT, clampPreferenceValues, META_VALUE_LIMIT, metaLimit, readMeta } from '@/lib/writing/notebook-meta';
import { PREMIUM_PERSISTED_KEYS } from '@/server/usage/premium';

let db: DatabaseSync;
beforeEach(() => { const made = testEnv(); db = made.db; state.env = made.env; made.addUser('owner-a'); });
afterEach(() => db.close());

const content = EditorDocumentSchema.parse({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'isi' }] }] });

describe('UX 3: the brief may hold 2,000 characters per value, nothing else may', () => {
  it('accepts long brief values on create and PATCH and keeps 500 for every other string', () => {
    expect(BRIEF_VALUE_LIMIT).toBe(2_000);
    expect(BRIEF_KEYS[0]).toBe('briefTopic');
    for (const key of [...BRIEF_KEYS, 'notes']) {
      expect(metaLimit(key)).toBe(BRIEF_VALUE_LIMIT);
      expect((PREMIUM_PERSISTED_KEYS as readonly string[]).includes(key), key).toBe(false);
      expect(() => DocumentCreateSchema.parse({ title: 'B', preferences: { [key]: 'b'.repeat(BRIEF_VALUE_LIMIT) } })).not.toThrow();
      expect(() => DocumentCreateSchema.parse({ title: 'B', preferences: { [key]: 'b'.repeat(BRIEF_VALUE_LIMIT + 1) } })).toThrow();
      expect(() => DocumentPatchSchema.parse({ expectedRevision: 0, preferences: { [key]: 'b'.repeat(BRIEF_VALUE_LIMIT) } })).not.toThrow();
    }
    for (const key of ['docType', 'sample', 'extra', 'anything']) {
      expect(metaLimit(key)).toBe(META_VALUE_LIMIT);
      expect(() => DocumentCreateSchema.parse({ title: 'B', preferences: { [key]: 'x'.repeat(META_VALUE_LIMIT + 1) } })).toThrow();
    }
  });

  it('clamps on the client with the same per-key rule', () => {
    const clamped = clampPreferenceValues({ briefMessage: 'm'.repeat(2500), docType: 'd'.repeat(600), notes: 'n'.repeat(2500) });
    expect(clamped).toEqual({ briefMessage: 'm'.repeat(2000), docType: 'd'.repeat(500), notes: 'n'.repeat(2000) });
    expect(readMeta({ briefTopic: 't'.repeat(2500), docType: 'essay' })).toEqual({ briefTopic: 't'.repeat(2000), docType: 'essay' });
  });

  it('stores a long brief through create and autosave, cutting anything past the limit instead of failing', async () => {
    const created = await createDocument('owner-a', { title: 'B', language: 'id', content, preferences: { briefTopic: 'a'.repeat(1800) } });
    expect((created.preferences!.briefTopic as string).length).toBe(1800);
    await autosaveDocument('owner-a', created.id, 0, content, { preferences: { briefTopic: 'a'.repeat(1800), briefMessage: 'b'.repeat(5000), sample: 's'.repeat(900) } });
    const saved = (await getDocument('owner-a', created.id)).preferences!;
    expect((saved.briefMessage as string).length).toBe(BRIEF_VALUE_LIMIT);
    expect((saved.briefTopic as string).length).toBe(1800);
  });
});
