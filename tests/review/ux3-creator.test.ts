import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { testEnv } from '../helpers/d1';

const state = vi.hoisted(() => ({ env: {} as Record<string, unknown> }));
vi.mock('@/server/runtime', () => ({ runtime: () => state.env, requiredSetting: (value: string) => value, ConfigurationError: class extends Error {} }));

import { createDocument, getDocument } from '@/server/documents/service';
import { applyFormat, applyPreview, generatePreview } from '@/server/ai/service';
import { buildSystemMessage, normalizeRuntime, validateGeneration } from '@/server/ai/core';
import { P07_CREATOR_RULES } from '@/server/ai/core/prompts';
import { defaults, runtimeControls } from '@/lib/writing/settings';
import { documentText } from '@/lib/editor/document';
import { EditorDocumentSchema } from '@/lib/contracts';
import { orderActions } from '@/lib/writing/doc-types';
import { planSelectionCommand } from '@/components/workspace/selection-commands';
import { PLAN_LIMITS } from '@/lib/plans';

let db: DatabaseSync;
beforeEach(() => { const made = testEnv(); db = made.db; state.env = made.env; made.addUser('owner-a'); });
afterEach(() => { vi.unstubAllGlobals(); db.close(); });

const t = (id: string) => id;
const base = { language: 'id' as const, selectedText: 'Kopi Gayo disangrai tiap minggu', contextBefore: null, contextAfter: null, protectedTerms: [], protectedCitations: [] };
const options = (...texts: string[]) => ({ alternatives: texts.map((text) => ({ text, variation_level: 'struktur' })), warnings: [] });

describe('UX 3: creator intents on P07', () => {
  it('maps the three actions and adds their option line and rules only for them', () => {
    for (const [action, intent] of [['catchy', 'lebih catchy'], ['hook', 'jadikan hook'], ['cta', 'tambah cta']] as const) {
      const runtime = normalizeRuntime('P07_INLINE_ALTERNATIVES', { ...base, ...runtimeControls(defaults, 'id', action, 5) });
      expect(runtime).toMatchObject({ intent, n: 5 });
      const system = buildSystemMessage('P07_INLINE_ALTERNATIVES', runtime);
      expect(system).toContain(`INTENT ${intent}:\n- ${intent} = `);
      expect(system).not.toContain('- alternatif = ');
      expect(system.endsWith(P07_CREATOR_RULES)).toBe(true);
    }
    // The five original intents send exactly what they sent before: no creator line, no creator rules.
    for (const action of ['alternatives', 'shorter', 'clearer', 'formal', 'natural']) {
      const system = buildSystemMessage('P07_INLINE_ALTERNATIVES', normalizeRuntime('P07_INLINE_ALTERNATIVES', { ...base, action }));
      expect(system).not.toContain('jadikan hook');
      expect(system).not.toContain('CREATOR INTENT');
    }
  });

  it('drops options that add a link, an account, a hashtag, an emoji or a number the selection lacks', () => {
    const runtime = { ...base, action: 'cta' };
    const checked = validateGeneration('P07_INLINE_ALTERNATIVES', base.selectedText, options(
      'Kopi Gayo disangrai tiap minggu. Mampir ke bio!', 'Kopi Gayo disangrai tiap minggu. Follow @kopikita', 'Kopi Gayo disangrai tiap minggu #kopilokal',
      'Kopi Gayo disangrai tiap minggu ☕', 'Kopi Gayo disangrai tiap minggu, diskon 20 persen', 'Kopi Gayo disangrai tiap minggu. Cek www.kopi.id',
    ), runtime);
    expect((checked.alternatives as Array<{ text: string }>).map((option) => option.text)).toEqual(['Kopi Gayo disangrai tiap minggu. Mampir ke bio!']);
    // The same extras are fine for an ordinary intent's own checks, which never looked for them.
    expect(() => validateGeneration('P07_INLINE_ALTERNATIVES', base.selectedText, options('Kopi Gayo disangrai tiap minggu #kopilokal'), { ...base, action: 'alternatives' })).not.toThrow();
  });

  it('keeps a multi-line caption as paragraphs when applied, and leaves other intents inline', () => {
    const creator = { intent: 'jadikan hook' } as never; const plain = { intent: 'alternatif' } as never;
    expect(applyFormat('P07_INLINE_ALTERNATIVES', 'a\nb', 'x\ny', creator, true)).toBe('paragraph');
    expect(applyFormat('P07_INLINE_ALTERNATIVES', 'a', 'x\ny', creator, false)).toBe('paragraph');
    expect(applyFormat('P07_INLINE_ALTERNATIVES', 'a', 'x', creator, false)).toBeUndefined();
    expect(applyFormat('P07_INLINE_ALTERNATIVES', 'a\nb', 'x\ny', plain, true)).toBeUndefined();
  });

  it('runs on a multi-line selection for every plan, and orders first for Script and Caption', () => {
    const selection = { from: 0, to: 20, text: 'Baris satu\nBaris dua', pmFrom: 1, pmTo: 21 };
    expect(planSelectionCommand('hook', selection, defaults, t, String, PLAN_LIMITS.free)).toEqual({ kind: 'generate', label: 'Jadikan hook', inlineAction: 'hook' });
    expect(planSelectionCommand('cta', { ...selection, text: 'Satu baris' }, defaults, t, String, PLAN_LIMITS.free)).toMatchObject({ kind: 'generate', inlineAction: 'cta' });
    expect(planSelectionCommand('alternatives', selection, defaults, t, String, PLAN_LIMITS.free).kind).toBe('error');
    expect(orderActions('script').slice(0, 3)).toEqual(['hook', 'catchy', 'cta']);
    expect(orderActions('caption').slice(0, 3)).toEqual(['hook', 'catchy', 'cta']);
    expect(orderActions('article').slice(-3)).toEqual(['hook', 'catchy', 'cta']);
  });

  it('generates and applies a caption variation end to end, charged as P07 (source characters)', async () => {
    const para = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] });
    const created = await createDocument('owner-a', { title: 'Caption', language: 'id', content: EditorDocumentSchema.parse({ type: 'doc', content: [para('Kopi Gayo baru datang.'), para('Disangrai tiap minggu.')] }) });
    const full = documentText(created.content);
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ id: 'p', choices: [{ message: { content: JSON.stringify(options('Kopi Gayo baru mendarat.\nDisangrai tiap minggu.\nMau coba yang mana?')) }, finish_reason: 'stop' }], usage: {} })));
    const preview = await generatePreview('owner-a', 'k-cta', { documentId: created.id, promptId: 'P07_INLINE_ALTERNATIVES', source: { text: full, anchor: { from: 0, to: full.length } }, runtime: runtimeControls(defaults, 'id', 'cta', 3), expectedRevision: 0 });
    const charged = db.prepare('SELECT settled_amount,source_characters FROM character_reservations').get() as { settled_amount: number; source_characters: number };
    expect(charged).toEqual({ settled_amount: [...full].length, source_characters: [...full].length });
    await applyPreview('owner-a', preview.id, 0, 0);
    const blocks = (await getDocument('owner-a', created.id)).content.content;
    expect(blocks.map((block) => block.type)).toEqual(['paragraph', 'paragraph', 'paragraph']);
    expect(JSON.stringify(blocks)).not.toContain('hardBreak');
  });
});
