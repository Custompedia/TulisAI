import { plainTextDocument } from '@/lib/editor/document';
import { ADVANCED_PREFERENCE } from '@/lib/plans';
import { defaultTitle, docTypeSettings, skeletonDocument, type DocType } from './doc-types';
import { clampPreferenceValues, type DocSource } from './notebook-meta';
import { defaults, modeFromPrompt, normalizeSettings, type WritingLanguage } from './settings';

export type NewKind = DocType | 'blank';
export type NewOptions = { title?: string; language?: WritingLanguage; color?: string | null; icon?: string | null; paged?: boolean };

// The body POST /api/documents gets for a skeleton or an empty notebook. Pure, so the gates can be tested:
// the canvas flag is only sent when the account has advanced_notebook, because create refuses it otherwise.
// `defaultPaged` is the account's Kanvas bawaan; an explicit `options.paged` from the dialog wins.
export function newNotebookBody(kind: NewKind, options: NewOptions, context: { defaultMode: string; writingLanguage: WritingLanguage; humanizerContext: string; locale: 'id' | 'en'; advancedNotebook: boolean; now: Date; defaultPaged?: boolean }) {
  const language = options.language ?? context.writingLanguage;
  const contentLanguage = language === 'en' || language === 'id' ? language : context.locale;
  const type = kind === 'blank' ? null : kind;
  const settings = normalizeSettings({ ...defaults, mode: modeFromPrompt(context.defaultMode) ?? 'humanize', language, context: context.humanizerContext, ...(type ? docTypeSettings(type) : {}) });
  const source: DocSource = type ? 'skeleton' : 'blank';
  const preferences = clampPreferenceValues({
    ...settings, ...(type ? { docType: type } : {}), docSource: source,
    ...((options.paged ?? context.defaultPaged) && context.advancedNotebook ? { [ADVANCED_PREFERENCE]: true } : {}),
  });
  return {
    title: (options.title?.trim() || defaultTitle(type, context.now, context.locale)).slice(0, 180),
    language, content: type ? skeletonDocument(type, contentLanguage) : plainTextDocument(''), preferences,
    ...(options.color ? { color: options.color } : {}), ...(options.icon ? { icon: options.icon } : {}),
  };
}

