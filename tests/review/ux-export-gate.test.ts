import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ assert: vi.fn(), record: vi.fn() }));
vi.mock('@/server/runtime', () => ({ runtime: () => ({}), ConfigurationError: class extends Error {} }));
vi.mock('@/server/auth/auth', () => ({ requireUser: async () => ({ id: 'u' }) }));
vi.mock('@/server/documents/service', () => ({
  getDocument: async () => ({ id: 'doc', title: 'Esai <1>', language: 'id', preferences: {}, revision: 1, content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Isi' }] }] }, createdAt: '', updatedAt: '' }),
}));
vi.mock('@/server/documents/portability', () => ({ assertDocxExport: mocks.assert, recordDocxExportEvidence: mocks.record }));

import { GET } from '@/app/api/documents/[id]/export/route';
import { RequestError } from '@/server/http';

const call = (format: string) => GET(new Request(`https://tulis.test/api/documents/doc/export?format=${format}`), { params: Promise.resolve({ id: 'doc' }) });
const locked = () => new RequestError('FEATURE_LOCKED', 'This feature is available on a paid plan.', 403, { feature: 'docx_export', requiredTier: 'pro' });

beforeEach(() => { mocks.assert.mockReset(); mocks.record.mockReset(); });

describe('HTML export gate', () => {
  it('refuses HTML below Pro, like DOCX', async () => {
    mocks.assert.mockRejectedValue(locked());
    const response = await call('html');
    expect(response.status).toBe(403);
    expect((await response.json()).error).toMatchObject({ code: 'FEATURE_LOCKED', details: { requiredTier: 'pro' } });
    expect(mocks.assert).toHaveBeenCalledWith('u', 'doc');
  });

  it('allows HTML with Pro, or with DOCX evidence kept after a downgrade, without recording evidence', async () => {
    for (const historical of [false, true]) {
      mocks.assert.mockResolvedValue({ rights: {}, historical });
      const response = await call('html');
      expect(response.status).toBe(200);
      expect(response.headers.get('Content-Type')).toContain('text/html');
      expect(await response.text()).toContain('<title>Esai &lt;1&gt;</title>');
    }
    expect(mocks.record).not.toHaveBeenCalled();
  });

  it('keeps DOCX on the same rule', async () => {
    mocks.assert.mockRejectedValue(locked());
    expect((await call('docx')).status).toBe(403);
  });
});
