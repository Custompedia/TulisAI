import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { testEnv } from '../helpers/d1';

const state = vi.hoisted(() => ({ env: {} as Record<string, unknown> }));
vi.mock('@/server/runtime', () => ({ runtime: () => state.env, ConfigurationError: class extends Error {} }));

import { adminActivatePlan } from '@/server/access/periods';
import { entitlement } from '@/server/usage/quota';
import { createDocument } from '@/server/documents/service';
import { assertDocxExport, createDocxImportReceipt, recordDocxExportEvidence } from '@/server/documents/portability';
import { EditorDocumentSchema } from '@/lib/contracts';

let setup: ReturnType<typeof testEnv>;
const content = EditorDocumentSchema.parse({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Bab satu' }] }] });

beforeEach(() => {
  setup = testEnv();
  state.env = setup.env;
  setup.addUser('admin', 'admin');
  setup.addUser('u');
});
afterEach(() => setup.db.close());

// Local plans give paid accounts the authority 'admin_grant' or 'payment'. The
// DOCX evidence tables used to accept only MKL-era values, so import failed with 500.
describe('DOCX evidence with local plan authorities', () => {
  it('imports and exports DOCX on an admin-granted Pro plan', async () => {
    await adminActivatePlan({ actorId: 'admin', ownerId: 'u', plan: 'pro' });
    const rights = await entitlement('u');
    expect(rights.access.authority).toBe('admin_grant');

    const receipt = await createDocxImportReceipt('u', content, rights);
    const imported = await createDocument('u', { title: 'Impor', language: 'id', content, preferences: { advanced: true }, docxImportReceipt: receipt });
    const evidence = setup.db.prepare('SELECT kind, authority FROM document_portability_evidence WHERE document_id=?').get(imported.id);
    expect(evidence).toMatchObject({ kind: 'docx_import', authority: 'admin_grant' });

    const ordinary = await createDocument('u', { title: 'Biasa', language: 'id', content, preferences: { advanced: true } });
    await expect(recordDocxExportEvidence('u', ordinary.id, rights)).resolves.toBeUndefined();
    await expect(assertDocxExport('u', ordinary.id)).resolves.toMatchObject({ historical: false });
  });

  it('accepts the payment authority in both evidence tables', () => {
    setup.db.prepare('INSERT INTO pending_docx_import_evidence (id,owner_id,content_hash,authority,projection_revision,expires_at,created_at) VALUES (?,?,?,?,?,?,?)')
      .run('r1', 'u', 'hash', 'payment', null, Date.now() + 60_000, Date.now());
    expect(() => setup.db.prepare('INSERT INTO pending_docx_import_evidence (id,owner_id,content_hash,authority,projection_revision,expires_at,created_at) VALUES (?,?,?,?,?,?,?)')
      .run('r2', 'u', 'hash', 'free', null, Date.now() + 60_000, Date.now())).toThrow(/CHECK/);
  });
});
