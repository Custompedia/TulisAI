import { FREEFORM_RESERVE_FACTOR } from '@/lib/plans';

export class ApiError extends Error {
  constructor(public code: string, public status: number, public details?: unknown) { super(code); this.name = 'ApiError'; }
}

// Editor JSON carries every attribute TipTap knows, mostly null; the server drops them anyway, so they are not sent.
const compactAttrs = (key: string, value: unknown) => (key === 'attrs' && value && typeof value === 'object' && !Array.isArray(value)
  ? Object.fromEntries(Object.entries(value).filter(([, item]) => item !== null && item !== undefined)) : value);
// Bodies past this size are gzipped: a 2,000-page notebook is ~12 MB of JSON and ~1.5 MB compressed. The server
// recognises gzip by its magic bytes, so no proxy can mistake what it receives.
const COMPRESS_FROM = 32_768;
export async function jsonBody(body: unknown): Promise<{ body: BodyInit; compressed: boolean }> {
  const json = JSON.stringify(body, compactAttrs);
  if (json.length < COMPRESS_FROM || typeof CompressionStream === 'undefined') return { body: json, compressed: false };
  try {
    const stream = new Blob([json]).stream().pipeThrough(new CompressionStream('gzip') as unknown as TransformStream<Uint8Array, Uint8Array>);
    return { body: await new Response(stream).arrayBuffer(), compressed: true };
  } catch { return { body: json, compressed: false }; }
}

// `contentType` switches the body from JSON to raw bytes, which is what a file upload needs.
export async function request<T>(path: string, method = 'GET', body?: unknown, key?: string, contentType?: string): Promise<T> {
  let response: Response;
  const binary = contentType !== undefined;
  try {
    const payload = body === undefined ? null : binary ? { body: body as BodyInit, compressed: false } : await jsonBody(body);
    response = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: { 'Content-Type': contentType ?? 'application/json', ...(payload?.compressed ? { 'X-Body-Encoding': 'gzip' } : {}), ...(key ? { 'Idempotency-Key': key } : {}) },
      ...(payload ? { body: payload.body } : {}),
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
// Resolves once no request is held in the ref, waiting again for any that started while it waited. Nothing awaits
// between this returning and the caller storing its own request, so callers proceed strictly one at a time.
export async function whenIdle(ref: { current: Promise<unknown> | null }): Promise<void> {
  while (ref.current) {
    const seen = ref.current;
    await seen.catch(() => undefined);
    // The owner clears the ref right after its request settles; if it has not yet, give it a turn instead of spinning.
    if (ref.current === seen) await new Promise((resolve) => setTimeout(resolve, 0));
  }
}
export const isUnauthenticated = (error: unknown) => error instanceof ApiError && error.status === 401;

// The offending string the server named, quoted into the message so the user can see what blocked the result.
const offending = (error: unknown): string | null => {
  const details = error instanceof ApiError ? error.details : null;
  const token = details && typeof details === 'object' && 'token' in details ? (details as { token?: unknown }).token : null;
  return typeof token === 'string' && token.trim() ? token.trim().slice(0, 60) : null;
};

// A Perintah AI hold the balance could not cover names what it needed (see freeformHold on the server).
const reserveOf = (error: unknown): number | null => {
  const details = error instanceof ApiError ? error.details : null;
  const reserve = details && typeof details === 'object' && 'reserve' in details ? (details as { reserve?: unknown }).reserve : null;
  return typeof reserve === 'number' && Number.isSafeInteger(reserve) && reserve > 0 ? reserve : null;
};

const draftHold = (error: unknown) => { const details = error instanceof ApiError ? error.details : null; return !!details && typeof details === 'object' && (details as { draft?: unknown }).draft === true; };
const draftReason = (error: unknown) => { const details = error instanceof ApiError ? error.details : null; const reason = details && typeof details === 'object' ? (details as { reason?: unknown }).reason : null; return typeof reason === 'string' ? reason : ''; };

export function errorText(error: unknown, english: boolean): string {
  const code = error instanceof ApiError ? error.code : '';
  const t = (id: string, en: string) => (english ? en : id);
  const token = offending(error);
  const about = (id: string, en: string) => (token ? t(`${id} (“${token}”)`, `${en} (“${token}”)`) : t(id, en));
  const reserve = reserveOf(error);
  switch (true) {
    case code === 'QUOTA_EXCEEDED' && reserve !== null && draftHold(error): {
      const amount = new Intl.NumberFormat(english ? 'en' : 'id').format(reserve);
      return t(`Draf dari brief menyiapkan hingga ${amount} karakter sebelum menulis, dan saldomu tidak cukup. Yang ditagih hanya panjang draf yang jadi.`, `Draft from brief sets aside up to ${amount} characters before writing, and your balance is not enough. Only the finished draft’s length is charged.`);
    }
    case code === 'QUOTA_EXCEEDED' && reserve !== null: {
      const amount = new Intl.NumberFormat(english ? 'en' : 'id').format(reserve);
      return t(`Perintah AI menyiapkan hingga ${amount} karakter (${FREEFORM_RESERVE_FACTOR}× teks terpilih) sebelum berjalan, dan saldomu tidak cukup. Pilih teks yang lebih pendek.`, `AI instructions set aside up to ${amount} characters (${FREEFORM_RESERVE_FACTOR}× the selected text) before running, and your balance is not enough. Select a shorter passage.`);
    }
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
    case code === 'MKL_NOT_CONFIGURED': return t('Masuk dengan MKL belum dikonfigurasi.', 'MKL sign-in is not configured yet.');
    case code === 'MKL_UNAVAILABLE': return t('MKL sedang tidak tersedia. Coba lagi nanti.', 'MKL is temporarily unavailable. Try again later.');
    case code === 'MKL_AUTH_CANCELLED': return t('Masuk dengan MKL dibatalkan.', 'MKL sign-in was cancelled.');
    case code === 'MKL_STATE_INVALID' || code === 'MKL_STATE_EXPIRED': return t('Permintaan MKL tidak valid atau sudah kedaluwarsa. Mulai lagi.', 'The MKL request is invalid or expired. Start again.');
    case code === 'MKL_TOKEN_INVALID': return t('Identitas MKL tidak dapat diverifikasi.', 'The MKL identity could not be verified.');
    case code === 'MKL_PROFILE_INCOMPLETE': return t('MKL harus menyediakan email terverifikasi untuk membuat akun baru.', 'MKL must provide a verified email to create a new account.');
    case code === 'MKL_EMAIL_CONFLICT': return t('Email ini sudah dipakai akun lokal. Masuk secara lokal lalu hubungkan MKL dari Pengaturan.', 'This email belongs to a local account. Sign in locally, then link MKL from Settings.');
    case code === 'MKL_REAUTH_REQUIRED': return t('Masuk ulang di MKL untuk menautkan akun, lalu coba lagi.', 'Sign in to MKL again to link your account, then try again.');
    case code === 'MKL_IDENTITY_LINKED_ELSEWHERE': return t('Identitas MKL ini tidak dapat dihubungkan ke akun tersebut.', 'This MKL identity cannot be linked to that account.');
    case code === 'MKL_ACCOUNT_ALREADY_LINKED': return t('Akun lokal ini sudah terhubung ke identitas MKL.', 'This local account is already linked to an MKL identity.');
    case code === 'MKL_ADMIN_LINK_FORBIDDEN' || code === 'MKL_LINKED_ADMIN_FORBIDDEN': return t('Identitas pelanggan MKL harus terpisah dari akun admin lokal.', 'MKL customer identity must remain separate from local admin accounts.');
    case code === 'MKL_CONFIRMATION_REQUIRED' || code === 'MKL_CONFIRMATION_EXPIRED': return t('Konfirmasi MKL tidak tersedia atau kedaluwarsa. Mulai lagi.', 'The MKL confirmation is unavailable or expired. Start again.');
    case code === 'MKL_LINKED_ACCOUNT_DELETE_FORBIDDEN': return t('Akun yang terhubung ke MKL belum dapat dihapus.', 'An MKL-linked account cannot be deleted.');
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
    case code === 'BRIEF_REQUIRED': return t('Isi dulu Topik atau Pesan utama di Brief, lalu coba lagi.', 'Fill in the Topic or the Key message in the Brief first, then try again.');
    case code === 'DRAFT_TARGET_INVALID': return t('Letakkan kursor di judul bagian yang masih kosong, atau di baris kosong di bawah sebuah judul.', 'Put the cursor on a heading whose section is still empty, or on an empty line under a heading.');
    case code === 'AI_DRAFT_REJECTED': return draftReason(error) === 'length' ? t('Draf terlalu panjang untuk satu bagian, jadi dibatalkan tanpa biaya. Coba lagi.', 'The draft was too long for one section, so it was discarded at no charge. Try again.')
      : draftReason(error) === 'reference_list' ? t('Draf mencoba menulis daftar pustaka, jadi dibatalkan tanpa biaya. Sumber harus kamu cari dan tulis sendiri.', 'The draft tried to write a reference list, so it was discarded at no charge. Sources are yours to find and write.')
      : t('Draf memuat terlalu banyak angka, sumber, atau tautan yang tidak ada di brief, jadi dibatalkan tanpa biaya. Lengkapi brief atau coba lagi.', 'The draft carried too many figures, sources or links that are not in your brief, so it was discarded at no charge. Add to the brief or try again.');
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
    case code === 'PAYMENTS_CLOSED': return t('Pembayaran belum dibuka. Paket dan kuota yang sudah kamu punya tetap berlaku.', 'Payments are not open yet. Your current plan and allowance stay as they are.');
    case code === 'PLAN_ACTIVE': return t('Paket lain masih berjalan. Paket bisa diganti setelah periodenya berakhir.', 'Another plan is still running. You can switch after its period ends.');
    case code === 'PAID_PLAN_REQUIRED': return t('Tambahan karakter hanya untuk paket Plus, Pro, atau Max yang sedang aktif.', 'Top-ups are only for an active Plus, Pro, or Max plan.');
    case code === 'RENEWAL_LIMIT': return t('Paket sudah dibayar lebih dari setahun ke depan.', 'This plan is already paid more than a year ahead.');
    case code === 'PAYMENT_PAGE_UNAVAILABLE': return t('Halaman pembayaran belum bisa dibuka. Coba lagi sebentar lagi.', 'The payment page could not be opened. Try again shortly.');
    case code === 'PAYMENT_STATUS_UNAVAILABLE': return t('Status pembayaran belum bisa dicek. Coba lagi sebentar lagi.', 'The payment status could not be checked. Try again shortly.');
    case code === 'TIER_READ_ONLY': return t('Tier tidak diubah langsung. Pakai tab Paket untuk memberi atau mengakhiri paket.', 'The tier is not edited directly. Use the Plan tab to grant or end a plan.');
    case code === 'NO_ACTIVE_PLAN': return t('Akun ini tidak punya paket yang berjalan.', 'This account has no running plan.');
    case code === 'PLAN_CHANGED_CONCURRENTLY': return t('Paket berubah saat disimpan. Muat ulang lalu coba lagi.', 'The plan changed while saving. Reload and try again.');
    case code === 'ADMIN_DELETE': return t('Cabut role admin dulu sebelum menghapus akun ini.', 'Remove the admin role before deleting this account.');
    case code === 'USER_ALREADY_EXISTS' || code === 'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL': return t('Email ini sudah terdaftar.', 'This email is already registered.');
    case code === 'USER_NOT_FOUND': return t('Pengguna tidak ditemukan.', 'User not found.');
    case code === 'INVALID_CURSOR': return t('Halaman tidak valid. Muat ulang daftar.', 'Invalid page. Reload the list.');
    case code === 'INVALID_DOCUMENT': return t('Format dokumen belum didukung.', 'This document format is not supported.');
    case code === 'PDF_SCANNED': return t('PDF ini berisi gambar hasil scan; teksnya belum bisa dibaca. Gunakan PDF dengan teks atau DOCX.', 'This PDF contains scanned images; its text cannot be read yet. Use a PDF with text, or a DOCX.');
    case code === 'PDF_ENCRYPTED': return t('PDF ini dilindungi kata sandi. Buka kuncinya dan simpan ulang tanpa kata sandi, atau gunakan DOCX.', 'This PDF is password-protected. Unlock it and save it again without a password, or use a DOCX.');
    case code === 'PDF_UNREADABLE': return t('PDF ini rusak atau tidak bisa dibaca. Coba simpan ulang PDF-nya, atau gunakan DOCX.', 'This PDF is damaged or cannot be read. Try saving the PDF again, or use a DOCX.');
    case code === 'DOCX_UNREADABLE': return t('Berkas DOCX ini rusak, terlalu panjang, atau terlalu rumit untuk dibaca. Simpan ulang atau pisahkan dokumennya, lalu coba lagi.', 'This DOCX file is damaged, too long or too complex to read. Save it again or split it, then try again.');
    default: return t('Tindakan belum berhasil. Coba lagi.', 'The action did not finish. Please try again.');
  }
}
