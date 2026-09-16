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

// Better Auth endpoints answer with { code, message } instead of the app envelope.
export async function authRequest<T>(path: string, body: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api/auth${path}`, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  } catch {
    throw new ApiError('NETWORK_ERROR', 0);
  }
  const result = (await response.json().catch(() => null)) as (T & { code?: unknown; message?: unknown; error?: { code?: unknown } }) | null;
  if (!response.ok) throw new ApiError(authErrorCode(result, response.status), response.status);
  return result as T;
}

export function authErrorCode(result: { code?: unknown; message?: unknown; error?: { code?: unknown } } | null, status: number): string {
  if (status === 429) return 'RATE_LIMITED';
  if (typeof result?.code === 'string' && result.code) return result.code;
  if (typeof result?.error?.code === 'string' && result.error.code) return result.error.code;
  if (result?.message === 'Email is the same') return 'EMAIL_THE_SAME';
  if (status === 401) return 'UNAUTHENTICATED';
  if (status === 503) return 'SERVICE_UNAVAILABLE';
  return 'REQUEST_FAILED';
}

export const newKey = () => crypto.randomUUID();
export const isUnauthenticated = (error: unknown) => error instanceof ApiError && error.status === 401;

export function errorText(error: unknown, english: boolean): string {
  const code = error instanceof ApiError ? error.code : '';
  const t = (id: string, en: string) => (english ? en : id);
  switch (true) {
    case code === 'UNAUTHENTICATED': return t('Sesi berakhir. Masuk kembali untuk melanjutkan.', 'Your session expired. Sign in again to continue.');
    case code === 'NETWORK_ERROR': return t('Koneksi terputus. Periksa internet lalu coba lagi.', 'Connection lost. Check your internet and try again.');
    case code === 'INVALID_PASSWORD': return t('Password saat ini salah.', 'Your current password is incorrect.');
    case code === 'PASSWORD_TOO_SHORT': return t('Password minimal 10 karakter.', 'Password must be at least 10 characters.');
    case code === 'PASSWORD_TOO_LONG': return t('Password maksimal 128 karakter.', 'Password must be at most 128 characters.');
    case code === 'SESSION_NOT_FRESH' || code === 'SESSION_EXPIRED': return t('Masuk ulang dulu demi keamanan, lalu coba lagi.', 'Sign in again for security, then try again.');
    case code === 'USERNAME_IS_ALREADY_TAKEN': return t('Username ini sudah dipakai. Coba yang lain.', 'This username is already taken. Try another.');
    case code === 'USERNAME_TOO_SHORT': return t('Username minimal 3 karakter.', 'Username must be at least 3 characters.');
    case code === 'USERNAME_TOO_LONG': return t('Username maksimal 30 karakter.', 'Username must be at most 30 characters.');
    case code === 'INVALID_USERNAME': return t('Username hanya boleh huruf kecil, angka, titik, atau underscore.', 'Usernames may only use lowercase letters, numbers, periods, or underscores.');
    case code === 'INVALID_NAME': return t('Nama harus 1–100 karakter.', 'Name must be 1–100 characters.');
    case code === 'PASSWORD_ALREADY_SET': return t('Akun ini sudah punya password.', 'This account already has a password.');
    case code === 'EMAIL_THE_SAME': return t('Email baru sama dengan email saat ini.', 'The new email is the same as your current email.');
    case code === 'INVALID_EMAIL': return t('Alamat email tidak valid.', 'The email address is invalid.');
    case code === 'INVALID_TOKEN' || code === 'TOKEN_EXPIRED': return t('Link tidak valid atau sudah kedaluwarsa. Minta link baru.', 'The link is invalid or has expired. Request a new one.');
    case code === 'CREDENTIAL_ACCOUNT_NOT_FOUND': return t('Akun ini belum punya password.', 'This account does not have a password yet.');
    case code === 'EMAIL_CONFIGURATION_REQUIRED': return t('Pengiriman email belum dikonfigurasi. Hubungi admin.', 'Email delivery is not configured yet. Contact the administrator.');
    case code === 'SERVICE_UNAVAILABLE': return t('Layanan akun sedang tidak tersedia. Coba lagi nanti.', 'Account services are temporarily unavailable. Try again later.');
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
