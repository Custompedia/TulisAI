// Dependency-free Indonesian/English detector: function words carry most of the weight, morphology breaks ties.
export type DetectedLanguage = 'id' | 'en';

// Indonesian function and very-high-frequency words, formal and casual; kept disjoint from EN_FUNCTION_WORDS.
export const ID_FUNCTION_WORDS = new Set([
  'yang', 'dan', 'atau', 'untuk', 'dengan', 'pada', 'ini', 'itu', 'adalah', 'ialah', 'dalam', 'tidak', 'tak', 'bukan', 'belum', 'sudah', 'telah', 'masih', 'akan', 'sedang',
  'saya', 'aku', 'kami', 'kita', 'anda', 'kamu', 'mereka', 'dia', 'ia', 'beliau', 'nya', 'tersebut', 'dari', 'daripada', 'bahwa', 'juga', 'sebagai', 'karena', 'sebab', 'agar',
  'supaya', 'sehingga', 'namun', 'tetapi', 'tapi', 'melainkan', 'serta', 'oleh', 'kepada', 'terhadap', 'antara', 'setiap', 'semua', 'seluruh', 'banyak', 'sedikit', 'lebih',
  'kurang', 'paling', 'sangat', 'amat', 'hanya', 'saja', 'bisa', 'dapat', 'harus', 'perlu', 'ingin', 'mau', 'boleh', 'jangan', 'ada', 'di', 'ke', 'para', 'sebuah', 'suatu',
  'seorang', 'beberapa', 'ketika', 'saat', 'setelah', 'sebelum', 'selama', 'hingga', 'sampai', 'jika', 'kalau', 'bila', 'apabila', 'maka', 'lalu', 'kemudian', 'jadi', 'yaitu',
  'yakni', 'misalnya', 'seperti', 'sesuai', 'berdasarkan', 'melalui', 'menurut', 'terkait', 'tentang', 'mengenai', 'hal', 'demi', 'tanpa', 'bagi', 'atas', 'bawah',
  'sini', 'situ', 'sana', 'begitu', 'begini', 'sendiri', 'mungkin', 'memang', 'apakah', 'kenapa', 'mengapa', 'bagaimana', 'siapa', 'kapan', 'mana', 'dimana', 'adanya',
  'tolong', 'mohon', 'silakan', 'terima', 'kasih', 'baik', 'sekali', 'cukup', 'lain', 'lagi', 'pula', 'pun', 'nah', 'sih', 'dong', 'deh', 'nih', 'kok', 'yuk', 'aja', 'udah',
  'gak', 'nggak', 'enggak', 'banget', 'biar', 'emang', 'kayak', 'gimana', 'bikin', 'terus', 'bareng', 'nanti', 'tadi', 'besok', 'kemarin', 'sekarang', 'orang', 'tahun',
]);

// English function and very-high-frequency words; kept disjoint from ID_FUNCTION_WORDS.
export const EN_FUNCTION_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'if', 'then', 'so', 'because', 'as', 'of', 'to', 'in', 'on', 'at', 'for', 'with', 'from', 'by', 'into', 'about', 'over', 'under',
  'between', 'through', 'during', 'before', 'after', 'while', 'until', 'this', 'that', 'these', 'those', 'it', 'its', 'he', 'she', 'they', 'them', 'their', 'we', 'our', 'us',
  'you', 'your', 'i', 'my', 'me', 'his', 'her', 'him', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'am', 'do', 'does', 'did', 'done', 'have', 'has', 'had', 'will',
  'would', 'can', 'could', 'should', 'must', 'may', 'might', 'shall', 'not', 'no', 'yes', 'very', 'more', 'most', 'much', 'many', 'some', 'any', 'all', 'each', 'every',
  'other', 'another', 'such', 'than', 'too', 'also', 'only', 'just', 'even', 'still', 'well', 'please', 'make', 'makes', 'made', 'need', 'needs', 'want', 'wants', 'help',
  'use', 'get', 'got', 'there', 'here', 'when', 'where', 'what', 'which', 'who', 'whom', 'whose', 'how', 'why', 'out', 'up', 'down', 'off', 'again', 'both', 'few', 'own',
  'same', 'said', 'say', 'says', 'like', 'one', 'two', 'three', 'new', 'good', 'time', 'work', 'take', 'know', 'think', 'see', 'look', 'come', 'go', 'goes', 'let', 'now',
  'however', 'therefore', 'although', 'though', 'whether', 'upon', 'within', 'without', 'across', 'against', 'among', 'per', 'via', 'thus', 'hence',
]);

const ID_PREFIXES = ['meng', 'meny', 'mem', 'men', 'peng', 'peny', 'pem', 'pen', 'ber', 'ter', 'per', 'di'];
const ID_SUFFIXES: Array<[string, number]> = [['kan', 6], ['nya', 5], ['lah', 5], ['an', 6]];
const EN_SUFFIXES: Array<[string, number]> = [['tion', 7], ['sion', 7], ['ment', 7], ['ness', 7], ['able', 7], ['ing', 7], ['ed', 5], ['ly', 5]];

// Scanning is bounded twice over: a character slice first, then a word cap, so a 20,000-character document stays cheap.
export const SCAN_CHARS = 8_000;
export const SCAN_WORDS = 600;
const FUNCTION_WEIGHT = 1;
const ID_MORPHOLOGY_WEIGHT = 0.5;
const EN_MORPHOLOGY_WEIGHT = 0.4;
const CONTRACTION_WEIGHT = 0.8;
// A decision needs this much total evidence, this much of a lead, and this much evidence per word examined.
export const MIN_EVIDENCE = 2;
export const MIN_MARGIN = 0.25;
export const MIN_DENSITY = 0.06;

const endsWith = (word: string, suffix: string, minLength: number) => word.length >= minLength && word.endsWith(suffix);
const hasIdPrefix = (word: string) => word.length >= 6 && ID_PREFIXES.some((prefix) => word.startsWith(prefix));
const hasIdSuffix = (word: string) => ID_SUFFIXES.some(([suffix, minLength]) => endsWith(word, suffix, minLength));
const hasEnSuffix = (word: string) => EN_SUFFIXES.some(([suffix, minLength]) => endsWith(word, suffix, minLength));

export type LanguageScores = { id: number; en: number; words: number };

// Words only; digits, punctuation and symbols are ignored so citations and numbers score nothing.
export function languageScores(text: string): LanguageScores {
  const words = (text.slice(0, SCAN_CHARS).toLowerCase().match(/[\p{L}][\p{L}\p{M}'’]*/gu) ?? []).slice(0, SCAN_WORDS);
  let id = 0; let en = 0;
  for (const raw of words) {
    const word = raw.replace(/['’]+$/u, '');
    if (!word) continue;
    const isId = ID_FUNCTION_WORDS.has(word);
    const isEn = EN_FUNCTION_WORDS.has(word);
    if (isId) id += FUNCTION_WEIGHT;
    if (isEn) en += FUNCTION_WEIGHT;
    if (isId || isEn) continue;
    // One morphology point per word at most, and a word already shaped like Indonesian is never read as English.
    const indonesian = hasIdPrefix(word) || hasIdSuffix(word);
    if (indonesian) { id += ID_MORPHOLOGY_WEIGHT; continue; }
    if (/['’]/u.test(word)) { en += CONTRACTION_WEIGHT; continue; }
    if (hasEnSuffix(word)) en += EN_MORPHOLOGY_WEIGHT;
  }
  return { id, en, words: words.length };
}

// Returns null whenever the evidence is thin or the two languages are close, so the UI keeps asking the user.
export function detectLanguage(text: string): DetectedLanguage | null {
  if (typeof text !== 'string' || !text.trim()) return null;
  const { id, en, words } = languageScores(text);
  const total = id + en;
  const top = Math.max(id, en);
  if (words < 2 || total < MIN_EVIDENCE) return null;
  if (top / words < MIN_DENSITY) return null;
  if ((top - Math.min(id, en)) / total < MIN_MARGIN) return null;
  return id > en ? 'id' : 'en';
}
