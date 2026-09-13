import type { JSONContent } from '@tiptap/core';
import type { Settings } from '@/lib/writing/settings';

export type Doc = { id: string; title: string; revision: number; language: 'auto' | 'id' | 'en'; content: JSONContent; preferences?: Partial<Settings>; originalVersionId?: string | null };
export type VersionKind = 'original' | 'checkpoint' | 'ai_apply' | 'restore';
export type Version = { id: string; kind: VersionKind; label: string | null; revision: number; createdAt: string; promptId?: string | null; scopeType?: string | null };
export type Term = { id: string; term: string };
export type Draft = { owner: string; revision: number; content: JSONContent; title: string; settings: Settings; updatedAt: number };
export type Scope = 'selection' | 'paragraph' | 'document';
export type SelectionRange = { from: number; to: number; text: string; pmTo: number };
export type SaveState = 'loading' | 'saved' | 'saving' | 'dirty' | 'error' | 'offline' | 'conflict' | 'local-unavailable';
export type InlineAction = 'alternatives' | 'clearer' | 'shorter' | 'paraphrase';

export type PreviewOutput = { transformed_text?: string; humanized_text?: string; alternatives?: Array<{ text: string }>; warnings?: string[]; change_categories?: string[] };
export type Preview = {
  id: string; output: PreviewOutput; expiresAt: string; source: string; stamp: number; anchor?: { from: number; to: number };
  settings: Settings; scope: Scope; revision: number; inlineAction?: InlineAction; pmTo?: number;
};

// A comparison side is a version id, the live working copy, or an AI preview.
export type CompareSide = string;
export const WORKING = 'working';
export const PREVIEW = 'preview';
export const SOURCE = 'source';

export type Quality = { dimensions: Record<'clarity' | 'naturalness' | 'formality' | 'academic_fit', { score: number | null; reason: string }>; warnings: string[]; analyzedRevision: number };

export const previewText = (preview: Preview, alternative = 0) =>
  preview.output.alternatives?.[alternative]?.text ?? preview.output.transformed_text ?? preview.output.humanized_text ?? '';
