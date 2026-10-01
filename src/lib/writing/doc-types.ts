import type { EditorDocument, EditorNode } from '@/lib/editor/document';
import type { InlineAction } from '@/components/workspace/types';
import type { Mode, Settings } from './settings';

type T = (id: string, en: string) => string;
type Language = 'id' | 'en';

// The kinds of writing a notebook can be. A skeleton is a static outline, sent as `content` when the notebook is
// created: no AI is involved, which is why the dialog labels the group "tanpa AI".
export const DOC_TYPES = ['article', 'script', 'caption', 'essay', 'report', 'email', 'product', 'story'] as const;
export type DocType = (typeof DOC_TYPES)[number];
export const isDocType = (value: unknown): value is DocType => typeof value === 'string' && (DOC_TYPES as readonly string[]).includes(value);

type Section = { heading: [string, string]; level?: 1 | 2 };
type Definition = {
  label: [string, string];
  // The short name used in the default title, "Artikel · 1 Okt".
  short: [string, string];
  hint: [string, string];
  sections: Section[];
  // The mode a new notebook starts in, with the controls that go with it (section 8 of the UX plan).
  settings: Partial<Pick<Settings, 'mode' | 'strength' | 'academic' | 'recipient' | 'context'>> & { mode: Mode };
  // Modes and selection actions this kind of writing reaches for first; the rest keep their usual order.
  modes: Mode[];
  actions: InlineAction[];
  // Script and caption are read aloud, so the status bar also shows how long they take to say.
  spoken?: boolean;
};

const DEFINITIONS: Record<DocType, Definition> = {
  article: {
    label: ['Artikel / Blog', 'Article / Blog'], short: ['Artikel', 'Article'],
    hint: ['Satu gagasan per subjudul. Pembuka yang kuat membuat orang terus membaca.', 'One idea per subheading. A strong opening keeps people reading.'],
    sections: [{ heading: ['Judul artikel', 'Article title'], level: 1 }, { heading: ['Pembuka', 'Opening'] }, { heading: ['Subjudul 1', 'Subheading 1'] }, { heading: ['Subjudul 2', 'Subheading 2'] }, { heading: ['Subjudul 3', 'Subheading 3'] }, { heading: ['Penutup', 'Closing'] }, { heading: ['Ajakan (CTA)', 'Call to action'] }],
    settings: { mode: 'standard', strength: 'balanced' }, modes: ['standard', 'humanize'], actions: ['alternatives', 'clearer', 'shorter', 'natural', 'formal'],
  },
  script: {
    label: ['Script konten', 'Content script'], short: ['Script', 'Script'],
    hint: ['Tulis seperti diucapkan: kalimat pendek, satu ide per baris.', 'Write it the way it is spoken: short sentences, one idea per line.'],
    sections: [{ heading: ['Hook (0–3 detik)', 'Hook (0–3 seconds)'] }, { heading: ['Masalah', 'Problem'] }, { heading: ['Isi 1', 'Point 1'] }, { heading: ['Isi 2', 'Point 2'] }, { heading: ['Isi 3', 'Point 3'] }, { heading: ['Ajakan (CTA)', 'Call to action'] }, { heading: ['Caption', 'Caption'] }],
    settings: { mode: 'creative', strength: 'balanced' }, modes: ['creative', 'humanize'], actions: ['alternatives', 'shorter', 'natural', 'clearer', 'formal'], spoken: true,
  },
  caption: {
    label: ['Caption / Post', 'Caption / Post'], short: ['Caption', 'Caption'],
    hint: ['Baris pertama menentukan orang berhenti menggulir atau tidak.', 'The first line decides whether people stop scrolling.'],
    sections: [{ heading: ['Hook', 'Hook'] }, { heading: ['Isi', 'Body'] }, { heading: ['Ajakan (CTA)', 'Call to action'] }, { heading: ['Tagar', 'Hashtags'] }],
    settings: { mode: 'creative', strength: 'light' }, modes: ['creative', 'humanize'], actions: ['shorter', 'alternatives', 'natural', 'clearer', 'formal'], spoken: true,
  },
  essay: {
    label: ['Esai / Skripsi', 'Essay / Thesis'], short: ['Esai', 'Essay'],
    hint: ['Sitasi seperti (Penulis, Tahun) otomatis dilindungi dari perubahan AI.', 'Citations like (Author, Year) are protected from AI changes automatically.'],
    sections: [{ heading: ['Bab I Pendahuluan', 'Chapter I Introduction'] }, { heading: ['Bab II Tinjauan Pustaka', 'Chapter II Literature Review'] }, { heading: ['Bab III Metode', 'Chapter III Method'] }, { heading: ['Bab IV Hasil dan Pembahasan', 'Chapter IV Results and Discussion'] }, { heading: ['Bab V Penutup', 'Chapter V Conclusion'] }, { heading: ['Daftar Pustaka', 'References'] }],
    settings: { mode: 'academic', academic: 'thesis' }, modes: ['academic', 'standard'], actions: ['clearer', 'formal', 'shorter', 'alternatives', 'natural'],
  },
  report: {
    label: ['Laporan / Proposal', 'Report / Proposal'], short: ['Laporan', 'Report'],
    hint: ['Taruh kesimpulan di depan. Pembaca sibuk membaca ringkasan dulu.', 'Put the conclusion first. Busy readers read the summary first.'],
    sections: [{ heading: ['Ringkasan eksekutif', 'Executive summary'] }, { heading: ['Latar belakang', 'Background'] }, { heading: ['Temuan / Rencana', 'Findings / Plan'] }, { heading: ['Rekomendasi', 'Recommendations'] }],
    settings: { mode: 'professional', recipient: 'atasan' }, modes: ['professional', 'simplify'], actions: ['formal', 'clearer', 'shorter', 'natural', 'alternatives'],
  },
  email: {
    label: ['Email / Surat', 'Email / Letter'], short: ['Email', 'Email'],
    hint: ['Sebut maksud di kalimat pertama, lalu satu permintaan yang jelas.', 'State the purpose in the first sentence, then one clear request.'],
    sections: [{ heading: ['Salam', 'Greeting'] }, { heading: ['Maksud', 'Purpose'] }, { heading: ['Isi', 'Body'] }, { heading: ['Penutup', 'Closing'] }],
    settings: { mode: 'professional', recipient: 'umum' }, modes: ['professional', 'humanize'], actions: ['formal', 'clearer', 'shorter', 'natural', 'alternatives'],
  },
  product: {
    label: ['Deskripsi produk', 'Product description'], short: ['Produk', 'Product'],
    hint: ['Manfaat dulu, fitur kemudian. AI tidak menambah klaim baru.', 'Benefits first, then features. The AI never adds new claims.'],
    sections: [{ heading: ['Nama produk', 'Product name'] }, { heading: ['Manfaat', 'Benefits'] }, { heading: ['Fitur', 'Features'] }, { heading: ['Ajakan (CTA)', 'Call to action'] }],
    settings: { mode: 'creative', strength: 'light' }, modes: ['creative', 'professional'], actions: ['shorter', 'alternatives', 'clearer', 'natural', 'formal'],
  },
  story: {
    label: ['Cerita', 'Story'], short: ['Cerita', 'Story'],
    hint: ['Tunjukkan lewat adegan, bukan penjelasan.', 'Show it through scenes, not explanation.'],
    sections: [{ heading: ['Pembuka', 'Opening'] }, { heading: ['Konflik', 'Conflict'] }, { heading: ['Klimaks', 'Climax'] }, { heading: ['Penutup', 'Ending'] }],
    settings: { mode: 'creative', strength: 'balanced' }, modes: ['creative', 'humanize'], actions: ['alternatives', 'natural', 'shorter', 'clearer', 'formal'],
  },
};

const pick = ([id, en]: [string, string], t: T) => t(id, en);
const inLanguage = ([id, en]: [string, string], language: Language) => (language === 'en' ? en : id);

export const docTypeLabel = (type: DocType, t: T) => pick(DEFINITIONS[type].label, t);
export const docTypeShort = (type: DocType, t: T) => pick(DEFINITIONS[type].short, t);
export const docTypeHint = (type: DocType, t: T) => pick(DEFINITIONS[type].hint, t);
export const docTypeSettings = (type: DocType) => DEFINITIONS[type].settings;
export const isSpoken = (type: string | null | undefined) => isDocType(type) && DEFINITIONS[type].spoken === true;

// Headings with an empty paragraph under each, in the notebook's language: the outline appears straight away and
// the writer fills the sections in.
export function skeletonDocument(type: DocType, language: Language): EditorDocument {
  const content: EditorNode[] = DEFINITIONS[type].sections.flatMap(({ heading, level = 2 }) => [
    { type: 'heading', attrs: { level }, content: [{ type: 'text', text: inLanguage(heading, language) }] },
    { type: 'paragraph' },
  ]);
  return { type: 'doc', content };
}

// Recommended modes first, the rest in the usual order; the chosen mode never changes, only the order shown.
export function orderModes(modes: readonly Mode[], type: string | null | undefined): Mode[] {
  if (!isDocType(type)) return [...modes];
  const first = DEFINITIONS[type].modes.filter((mode) => modes.includes(mode));
  return [...first, ...modes.filter((mode) => !first.includes(mode))];
}

export const DEFAULT_ACTIONS: InlineAction[] = ['alternatives', 'shorter', 'clearer', 'formal', 'natural'];
export const orderActions = (type: string | null | undefined): InlineAction[] => (isDocType(type) ? DEFINITIONS[type].actions : DEFAULT_ACTIONS);

// Beranda's chips follow the onboarding answer: academic writers see Esai first, professional ones Email and
// Laporan, everyone else Artikel and Script.
export function skeletonOrder(useCase: string | null | undefined): DocType[] {
  const first: DocType[] = useCase === 'academic' ? ['essay', 'report'] : useCase === 'professional' ? ['email', 'report'] : ['article', 'script', 'caption'];
  return [...first, ...DOC_TYPES.filter((type) => !first.includes(type))];
}

const MONTHS: Record<Language, string[]> = {
  id: ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'],
  en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
};

// "Artikel · 1 Okt": a label the writer can rename in the editor header, never an AI title.
export function defaultTitle(type: DocType | null, date: Date, locale: Language): string {
  const name = type ? inLanguage(DEFINITIONS[type].short, locale) : 'Notebook';
  return `${name} · ${date.getDate()} ${MONTHS[locale][date.getMonth()]}`;
}
