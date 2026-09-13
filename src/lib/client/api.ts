export class ApiError extends Error {
  constructor(public code: string, public status: number, public details?: unknown) { super(code); this.name = 'ApiError'; }
}

export async function request<T>(path: string, method = 'GET', body?: unknown, key?: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', ...(key ? { 'Idempotency-Key': key } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch {
    throw new ApiError('NETWORK_ERROR', 0);
  }
  const result = (await response.json().catch(() => null)) as { data?: T; error?: { code?: string; details?: unknown } } | null;
  if (!response.ok) throw new ApiError(result?.error?.code ?? 'REQUEST_FAILED', response.status, result?.error?.details);
  return result?.data as T;
}

export const newKey = () => crypto.randomUUID();
export const isUnauthenticated = (error: unknown) => error instanceof ApiError && error.status === 401;

export function errorText(error: unknown, english: boolean): string {
  const code = error instanceof ApiError ? error.code : '';
  const t = (id: string, en: string) => (english ? en : id);
  switch (true) {
    case code === 'UNAUTHENTICATED': return t('Sesi berakhir. Masuk kembali untuk melanjutkan.', 'Your session expired. Sign in again to continue.');
    case code === 'NETWORK_ERROR': return t('Koneksi terputus. Periksa internet lalu coba lagi.', 'Connection lost. Check your internet and try again.');
    case code === 'REVISION_CONFLICT' || code === 'SOURCE_MISMATCH': return t('Dokumen berubah di tempat lain. Tulisanmu tetap aman; muat ulang atau simpan sebagai salinan.', 'The document changed elsewhere. Your writing is safe; reload or save a copy.');
    case code.includes('CONFIGURATION'): return t('Layanan AI belum dikonfigurasi. Tulisanmu tetap tersedia.', 'The AI service is not configured yet. Your writing is still available.');
    case code === 'QUOTA_EXCEEDED': return t('Batas pemakaian AI bulan ini tercapai. Coba lagi nanti.', 'You have reached this month’s AI limit. Try again later.');
    case code === 'RATE_LIMITED': return t('Terlalu banyak permintaan. Tunggu sebentar lalu coba lagi.', 'Too many requests. Wait a moment and try again.');
    case code === 'SCOPE_TOO_LARGE' || code === 'PAYLOAD_TOO_LARGE': return t('Teks terlalu panjang untuk sekali proses. Pilih paragraf atau bagian tertentu.', 'The text is too long for one run. Select a paragraph or a shorter passage.');
    case code === 'AI_OUTPUT_REJECTED': return t('Hasil ini mengubah istilah yang dikunci atau angka. Teks belum diterapkan.', 'This result changed a locked term or number. Nothing was applied.');
    case code === 'PROTECTED_SELECTION': return t('Istilah yang dikunci tidak bisa diganti. Buka kuncinya dulu.', 'A locked term cannot be replaced. Unlock it first.');
    case code === 'AI_UNAVAILABLE': return t('AI gagal memproses. Teksmu tidak berubah — coba lagi.', 'The AI could not finish. Your text is unchanged — try again.');
    case code === 'LOCK_EXISTS': return t('Istilah ini sudah dikunci.', 'This term is already locked.');
    case code === 'LOCK_NOT_IN_DOCUMENT': return t('Istilah harus ada di dokumen yang tersimpan. Tunggu tersimpan lalu coba lagi.', 'The term must exist in the saved document. Wait for saving and retry.');
    case code === 'LOCK_LIMIT_REACHED': return t('Maksimal 200 istilah terkunci per dokumen.', 'A document can have at most 200 locked terms.');
    case code.includes('EXPIRED'): return t('Pratinjau kedaluwarsa. Buat hasil baru.', 'This preview expired. Generate a new one.');
    case code === 'IDEMPOTENCY_PENDING': return t('Permintaan yang sama sedang diproses.', 'The same request is already being processed.');
    case code === 'NOT_FOUND': return t('Data tidak ditemukan atau kamu tidak punya akses.', 'Not found, or you do not have access.');
    case code === 'INVALID_DOCUMENT': return t('Format dokumen belum didukung.', 'This document format is not supported.');
    default: return t('Tindakan belum berhasil. Coba lagi.', 'The action did not finish. Please try again.');
  }
}
