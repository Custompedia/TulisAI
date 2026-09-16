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
export type InlineAction = 'alternatives' | 'clearer' | 'shorter' | 'formal' | 'natural';

export type PreviewOutput = { transformed_text?: string; alternatives?: Array<{ text: string; variation_level?: string }>; warnings?: string[]; change_categories?: string[]; no_change_needed?: boolean; exceeds_preservation?: boolean };
export type Preview = {
  id: string; output: PreviewOutput; expiresAt: string; source: string; stamp: number; anchor?: { from: number; to: number };
  settings: Settings; scope: Scope; revision: number; inlineAction?: InlineAction; pmTo?: number;
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

export const previewText = (preview: Preview, alternative = 0) =>
  preview.output.alternatives?.[alternative]?.text ?? preview.output.transformed_text ?? '';
