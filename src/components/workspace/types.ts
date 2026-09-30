import type { JSONContent } from '@tiptap/core';
import type { Settings } from '@/lib/writing/settings';

export type Doc = { id: string; title: string; revision: number; language: 'auto' | 'id' | 'en'; content: JSONContent; preferences?: Record<string, unknown>; originalVersionId?: string | null; color?: string | null; icon?: string | null; pinned?: boolean };
export type VersionKind = 'original' | 'checkpoint' | 'ai_apply' | 'restore';
export type Version = { id: string; kind: VersionKind; label: string | null; revision: number; createdAt: string; promptId?: string | null; scopeType?: string | null };
export type Term = { id: string; term: string };
export type Draft = { owner: string; revision: number; content: JSONContent; title: string; settings: Settings; updatedAt: number };
// 'section' is the text between the headings around the caret ("Bagian ini").
export type Scope = 'selection' | 'section' | 'document';
export type SelectionRange = { from: number; to: number; text: string; pmFrom: number; pmTo: number };
export type SaveState = 'loading' | 'saved' | 'saving' | 'dirty' | 'error' | 'offline' | 'conflict' | 'local-unavailable';
// catchy, hook and cta are the creator actions (UX 3): Lebih catchy, Jadikan hook, Tambah CTA, on every plan.
export type InlineAction = 'alternatives' | 'clearer' | 'shorter' | 'formal' | 'natural' | 'catchy' | 'hook' | 'cta';
export const CREATOR_ACTIONS: readonly InlineAction[] = ['hook', 'catchy', 'cta'];
export const isCreatorAction = (action: string | undefined) => !!action && (CREATOR_ACTIONS as readonly string[]).includes(action);
// Where an AI request was started and where its result is shown: on the text itself or in the Assistant panel.
export type Surface = 'inline' | 'panel';

// A Draf dari brief result (UX 3): the section as blocks, inserted as real editor nodes when applied.
export type DraftBlock = { type: 'paragraph' | 'subheading' | 'bullet_list' | 'numbered_list'; text: string; items: string[] };
export type PreviewOutput = { transformed_text?: string; alternatives?: Array<{ text: string; variation_level?: string }>; warnings?: string[]; change_categories?: string[]; no_change_needed?: boolean; exceeds_preservation?: boolean; suggested_title?: string; blocks?: DraftBlock[]; repaired?: number };
export type Preview = {
  id: string; output: PreviewOutput; expiresAt: string; source: string; stamp: number; anchor?: { from: number; to: number };
  settings: Settings; scope: Scope; revision: number; inlineAction?: InlineAction; surface: Surface; label?: string;
  // Set for a draft: the section it was written for, whether the academic guard applied, and where to retry.
  draft?: { heading: string; academic: boolean; pos: number };
};

// A comparison side is a version id, the live working copy, or an AI preview.
export type CompareSide = string;
export const WORKING = 'working';
export const PREVIEW = 'preview';
export const SOURCE = 'source';

export type QualityDimension = 'clarity' | 'academic_fit' | 'naturalness' | 'formality';
export type QualityBand = 'rendah' | 'sedang' | 'tinggi' | 'tidak_berlaku';
export type QualityItem = { value: QualityBand; reason: string };
// Accepts the v3 flat shape and a `dimensions` wrapper.
export type Quality = Partial<Record<QualityDimension, QualityItem>> & { dimensions?: Partial<Record<QualityDimension, QualityItem>>; warnings?: string[]; analyzedRevision?: number };

export const draftPlainText = (blocks: DraftBlock[]) => blocks.flatMap((block) => (block.type === 'bullet_list' || block.type === 'numbered_list' ? block.items.map((item) => `- ${item}`) : [block.text])).join('\n');
export const previewText = (preview: Preview, alternative = 0) =>
  preview.output.alternatives?.[alternative]?.text ?? preview.output.transformed_text ?? (preview.output.blocks ? draftPlainText(preview.output.blocks) : '');
