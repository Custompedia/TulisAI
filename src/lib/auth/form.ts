export type AuthField = "name" | "username" | "email" | "password" | "confirm";
export type AuthErrors = Partial<Record<AuthField, string>>;

export function normalizeName(value: string) { return value.trim(); }
export function normalizeIdentifier(value: string) { return value.trim().toLowerCase(); }
export function normalizeUsername(value: string) { return value.trim().toLowerCase(); }
export function validateUsername(value: string) { const normalized = normalizeUsername(value); return normalized.length >= 3 && normalized.length <= 30 && /^[a-z0-9](?:[a-z0-9._]*[a-z0-9])?$/.test(normalized); }
export function validateSignupPassword(value: string) { return value.length >= 10 && value.length <= 128; }
export function validateLoginPassword(value: string) { return value.length >= 1 && value.length <= 128; }
export function validateName(value: string) { const normalized = normalizeName(value); return normalized.length >= 1 && normalized.length <= 100; }
export function validateEmail(value: string) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeIdentifier(value)); }
export function validateLoginIdentifier(value: string) { const normalized = normalizeIdentifier(value); return normalized.includes("@") ? validateEmail(normalized) : validateUsername(normalized); }

export function validationMessages(en: boolean) {
  return {
    name: en ? "Enter a name of up to 100 characters." : "Masukkan nama hingga 100 karakter.", username: en ? "Use 3–30 letters, numbers, periods, or underscores." : "Gunakan 3–30 huruf, angka, titik, atau underscore.", email: en ? "Enter a valid email address." : "Masukkan alamat email yang valid.", password: en ? "Use a password of 10–128 characters." : "Gunakan kata sandi 10–128 karakter.", loginPassword: en ? "Enter a password of up to 128 characters." : "Masukkan kata sandi hingga 128 karakter.", confirm: en ? "Confirm your password." : "Konfirmasi kata sandimu.", generic: en ? "Authentication could not be completed. Please try again." : "Autentikasi belum berhasil. Coba lagi.", unavailable: en ? "Authentication is temporarily unavailable." : "Autentikasi sedang tidak tersedia.", google: en ? "Google sign-in is unavailable. Please use username or email." : "Login Google belum tersedia. Gunakan username atau email.", googleCallback: en ? "Google sign-in was cancelled or could not be completed. Please try again." : "Login Google dibatalkan atau belum berhasil. Coba lagi.", rateLimit: en ? "Too many attempts. Please wait a minute and try again." : "Terlalu banyak percobaan. Tunggu satu menit lalu coba lagi.",
  };
}

export function validateRegistration(values: { name: string; username: string; email: string; password: string; confirm: string }, en: boolean): AuthErrors {
  const copy = validationMessages(en);
  return { ...(!validateName(values.name) ? { name: copy.name } : {}), ...(!validateUsername(values.username) ? { username: copy.username } : {}), ...(!validateEmail(values.email) ? { email: copy.email } : {}), ...(!validateSignupPassword(values.password) ? { password: copy.password } : {}), ...(!values.confirm || values.password !== values.confirm ? { confirm: copy.confirm } : {}) };
}

export function validateLogin(values: { identifier: string; password: string }, en: boolean): AuthErrors {
  const copy = validationMessages(en);
  return { ...(!validateLoginIdentifier(values.identifier) ? { email: copy.email } : {}), ...(!validateLoginPassword(values.password) ? { password: copy.loginPassword } : {}) };
}

export function authErrorFromResponse(data: unknown, status: number, en: boolean): { message: string; fields: AuthErrors } {
  const copy = validationMessages(en); const object = data && typeof data === "object" ? data as Record<string, unknown> : {}; const nested = object.error && typeof object.error === "object" ? object.error as Record<string, unknown> : {}; const code = String(object.code ?? nested.code ?? "").toUpperCase();
  if (status === 429 || code === "RATE_LIMITED") return { message: copy.rateLimit, fields: {} };
  if (status === 503 || code === "SERVICE_UNAVAILABLE") return { message: copy.unavailable, fields: {} };
  if (code.includes("USERNAME") && (code.includes("TAKEN") || code.includes("ALREADY"))) return { message: copy.username, fields: { username: en ? "This username is already in use." : "Username ini sudah digunakan." } };
  if (code.includes("USER_ALREADY_EXISTS") || code.includes("EMAIL_ALREADY_EXISTS")) return { message: copy.email, fields: { email: en ? "This email is already registered." : "Email ini sudah terdaftar." } };
  if (code === "INVALID_USERNAME_OR_PASSWORD" || code === "INVALID_EMAIL_OR_PASSWORD" || code === "INVALID_CREDENTIALS") return { message: en ? "Username/email or password is incorrect." : "Username/email atau kata sandi salah.", fields: {} };
  if (code.includes("INVALID_EMAIL")) return { message: copy.email, fields: { email: copy.email } };
  if (code.includes("PASSWORD")) return { message: copy.password, fields: { password: copy.password } };
  return { message: copy.generic, fields: {} };
}

// Post-login destinations must stay on this origin, including after browser URL normalization.
export function safeAuthNext(value: string | null): string | null {
  return value && value.startsWith("/") && !value.startsWith("//") && !/[\\\u0000-\u001f\u007f]/.test(value) ? value : null;
}
