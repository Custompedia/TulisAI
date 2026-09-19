export class ApiError extends Error {
  constructor(public code: string, public status: number, public details?: unknown) { super(code); this.name = 'ApiError'; }
}

// `contentType` switches the body from JSON to raw bytes, which is what a file upload needs.
export async function request<T>(path: string, method = 'GET', body?: unknown, key?: string, contentType?: string): Promise<T> {
  let response: Response;
  const binary = contentType !== undefined;
  try {
    response = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: { 'Content-Type': contentType ?? 'application/json', ...(key ? { 'Idempotency-Key': key } : {}) },
      ...(body === undefined ? {} : { body: binary ? (body as BodyInit) : JSON.stringify(body) }),
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

// The offending string the server named, quoted into the message so the user can see what blocked the result.
const offending = (error: unknown): string | null => {
  const details = error instanceof ApiError ? error.details : null;
  const token = details && typeof details === 'object' && 'token' in details ? (details as { token?: unknown }).token : null;
  return typeof token === 'string' && token.trim() ? token.trim().slice(0, 60) : null;
};

export function errorText(error: unknown, english: boolean): string {
  const code = error instanceof ApiError ? error.code : '';
  const t = (id: string, en: string) => (english ? en : id);
  const token = offending(error);
  const about = (id: string, en: string) => (token ? t(`${id} (“${token}”)`, `${en} (“${token}”)`) : t(id, en));
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
    case code === 'QUOTA_EXCEEDED': return t('Jatah karakter AI-mu habis. Persingkat teks, tunggu kuota terisi lagi, atau naikkan paket.', 'Your AI character allowance is used up. Shorten the text, wait for it to refill, or upgrade.');
    case code === 'REQUEST_LIMIT_REACHED': return t('Batas jumlah permintaan AI untuk paket ini sudah tercapai pada periode berjalan.', 'This plan’s AI request limit for the current period has been reached.');
    case code === 'FEATURE_LOCKED': return t('Fitur ini tersedia di paket berbayar.', 'This feature is available on a paid plan.');
    case code === 'RATE_LIMITED': return t('Terlalu banyak permintaan. Tunggu sebentar lalu coba lagi.', 'Too many requests. Wait a moment and try again.');
    case code === 'SCOPE_TOO_LARGE' || code === 'PAYLOAD_TOO_LARGE': return t('Teks terlalu panjang untuk sekali proses. Pilih paragraf atau bagian tertentu.', 'The text is too long for one run. Select a paragraph or a shorter passage.');
    case code === 'STYLE_SAMPLE_COPIED': return t('Hasil menyalin kalimat dari contoh tulisan skill, jadi dibatalkan. Coba lagi atau ganti contohnya dengan teks yang lebih umum.', 'The result copied sentences from the skill’s writing sample, so it was discarded. Try again or use a more generic sample.');
    case code === 'AI_STRUCTURE_REJECTED': return t('Susunan paragraf hasilnya beda dari teks asli, padahal format yang dipilih menjaga jumlah paragraf. Kalau hasilnya memang harus berbentuk email atau poin, ganti Format di Sesuaikan.', 'The result’s paragraph count differs from the source, but the chosen format keeps it. If the result should be an email or a list, change Format in Customize.');
    case code === 'AI_LOCKED_TERM_REJECTED': return about('Hasil ini menghilangkan istilah yang kamu kunci, jadi belum diterapkan. Buka kuncinya kalau istilah itu memang boleh berubah.', 'The result dropped a term you locked, so nothing was applied. Unlock it if that term may change.');
    case code === 'AI_NUMBER_REJECTED': return about('Hasil ini mengubah salah satu angka, jadi belum diterapkan. Coba jalankan ulang.', 'The result changed one of the numbers, so nothing was applied. Try running it again.');
    case code === 'AI_CITATION_REJECTED': return about('Hasil ini mengubah atau menambah sitasi, jadi belum diterapkan.', 'The result altered or added a citation, so nothing was applied.');
    case code === 'AI_PLACEHOLDER_REJECTED': return about('Hasil ini menghilangkan bagian yang masih harus kamu isi sendiri, jadi belum diterapkan.', 'The result dropped a placeholder you still need to fill in, so nothing was applied.');
    case code === 'AI_OUTPUT_REJECTED': return t('Hasil ini tidak lolos pemeriksaan keamanan. Teks belum diterapkan.', 'This result did not pass the safety checks. Nothing was applied.');
    case code === 'PROTECTED_SELECTION': return t('Istilah yang dikunci tidak bisa diganti. Buka kuncinya dulu.', 'A locked term cannot be replaced. Unlock it first.');
    case code === 'AI_UNAVAILABLE': return t('AI gagal memproses. Teksmu tidak berubah — coba lagi.', 'The AI could not finish. Your text is unchanged — try again.');
    case code === 'LOCK_EXISTS': return t('Istilah ini sudah dikunci.', 'This term is already locked.');
    case code === 'LOCK_NOT_IN_DOCUMENT': return t('Istilah harus ada di dokumen yang tersimpan. Tunggu tersimpan lalu coba lagi.', 'The term must exist in the saved document. Wait for saving and retry.');
    case code === 'LOCK_LIMIT_REACHED': return t('Maksimal 200 istilah terkunci per dokumen.', 'A document can have at most 200 locked terms.');
    case code.includes('EXPIRED'): return t('Pratinjau kedaluwarsa. Buat hasil baru.', 'This preview expired. Generate a new one.');
    case code === 'IDEMPOTENCY_PENDING': return t('Permintaan yang sama sedang diproses.', 'The same request is already being processed.');
    case code === 'STYLE_EXISTS': return t('Sudah ada skill dengan nama ini. Pakai nama lain.', 'A skill with this name already exists. Use another name.');
    case code === 'STYLE_LIMIT_REACHED': return t('Skill tersimpan sudah penuh. Hapus salah satu dulu.', 'Your saved skills are full. Delete one first.');
    case code === 'STYLE_NOT_FOUND': return t('Skill ini sudah tidak ada. Muat ulang daftar skill.', 'This skill no longer exists. Reload your skills.');
    case code === 'NOT_FOUND': return t('Data tidak ditemukan atau kamu tidak punya akses.', 'Not found, or you do not have access.');
    case code === 'FORBIDDEN': return t('Halaman ini khusus admin.', 'This page is for admins only.');
    case code === 'ACCOUNT_DISABLED' || code === 'BANNED_USER': return t('Akun ini dinonaktifkan. Hubungi admin.', 'This account has been disabled. Contact the administrator.');
    case code === 'SELF_DEMOTION': return t('Kamu tidak bisa mencabut role admin milikmu sendiri.', 'You cannot remove your own admin role.');
    case code === 'SELF_BAN' || code === 'YOU_CANNOT_BAN_YOURSELF': return t('Kamu tidak bisa menonaktifkan akunmu sendiri.', 'You cannot disable your own account.');
    case code === 'SELF_DELETE' || code === 'YOU_CANNOT_REMOVE_YOURSELF': return t('Kamu tidak bisa menghapus akunmu sendiri dari sini.', 'You cannot delete your own account from here.');
    case code === 'LAST_ADMIN': return t('Harus tersisa minimal satu admin aktif.', 'At least one active admin must remain.');
    case code === 'ADMIN_DELETE': return t('Cabut role admin dulu sebelum menghapus akun ini.', 'Remove the admin role before deleting this account.');
    case code === 'USER_ALREADY_EXISTS' || code === 'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL': return t('Email ini sudah terdaftar.', 'This email is already registered.');
    case code === 'USER_NOT_FOUND': return t('Pengguna tidak ditemukan.', 'User not found.');
    case code === 'INVALID_CURSOR': return t('Halaman tidak valid. Muat ulang daftar.', 'Invalid page. Reload the list.');
    case code === 'INVALID_DOCUMENT': return t('Format dokumen belum didukung.', 'This document format is not supported.');
    default: return t('Tindakan belum berhasil. Coba lagi.', 'The action did not finish. Please try again.');
  }
}
