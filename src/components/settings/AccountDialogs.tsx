'use client';
import { useId, useState, type FormEvent } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { useLocale } from '@/lib/client/locale';
import { authRequest, newKey, request } from '@/lib/client/api';
import { normalizeIdentifier, normalizeName, normalizeUsername, validateEmail, validateName, validateSignupPassword, validateUsername } from '@/lib/auth/form';
import { Button } from '@/components/ui/Button';
import { FieldLabel, inputClass } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';

// Runs a request and reports success; returns false when the request failed.
export type Submit = (action: () => Promise<unknown>, success: string) => Promise<boolean>;
type DialogProps = { busy: boolean; submit: Submit; onClose: () => void };

function FieldError({ id, children }: { id: string; children?: string }) {
  return children ? <p id={id} role="alert" className="mt-1.5 text-xs text-red-700">{children}</p> : null;
}

function FormModal({ title, description, busy, onClose, onSubmit, submitLabel, children }: { title: string; description?: string; busy: boolean; onClose: () => void; onSubmit: () => void; submitLabel: string; children: React.ReactNode }) {
  const { t } = useLocale();
  const formId = useId();
  const handle = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); if (!busy) onSubmit(); };
  return (
    <Modal title={title} description={description} busy={busy} onClose={onClose} size="sm"
      footer={<><Button onClick={onClose} disabled={busy}>{t('Batal', 'Cancel')}</Button><Button type="submit" form={formId} variant="primary" loading={busy}>{submitLabel}</Button></>}>
      <form id={formId} onSubmit={handle} noValidate aria-busy={busy}><fieldset disabled={busy} className="space-y-4">{children}</fieldset></form>
    </Modal>
  );
}

function TextField({ label, value, onChange, error, hint, type = 'text', autoComplete, maxLength, prefix }: { label: string; value: string; onChange: (value: string) => void; error?: string; hint?: string; type?: string; autoComplete?: string; maxLength?: number; prefix?: string }) {
  const id = useId();
  return (
    <div>
      <FieldLabel htmlFor={id} hint={hint}>{label}</FieldLabel>
      <div className="relative">
        {prefix && <span aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-ink-400">{prefix}</span>}
        <input id={id} type={type} value={value} autoComplete={autoComplete} maxLength={maxLength} spellCheck={false} autoCapitalize="none" autoFocus onChange={(event) => onChange(event.target.value)}
          aria-invalid={Boolean(error)} aria-describedby={error ? `${id}-error` : undefined} className={`${inputClass} ${prefix ? 'pl-7' : ''} ${error ? 'border-red-300' : ''}`} />
      </div>
      <FieldError id={`${id}-error`}>{error}</FieldError>
    </div>
  );
}

function PasswordField({ label, value, onChange, error, hint, autoComplete, autoFocus }: { label: string; value: string; onChange: (value: string) => void; error?: string; hint?: string; autoComplete: string; autoFocus?: boolean }) {
  const { t } = useLocale();
  const id = useId();
  const [shown, setShown] = useState(false);
  return (
    <div>
      <FieldLabel htmlFor={id} hint={hint}>{label}</FieldLabel>
      <div className="relative">
        <input id={id} type={shown ? 'text' : 'password'} value={value} autoComplete={autoComplete} maxLength={128} autoFocus={autoFocus} onChange={(event) => onChange(event.target.value)}
          aria-invalid={Boolean(error)} aria-describedby={error ? `${id}-error` : undefined} className={`${inputClass} pr-10 ${error ? 'border-red-300' : ''}`} />
        <button type="button" onClick={() => setShown(!shown)} aria-pressed={shown} aria-label={shown ? t('Sembunyikan password', 'Hide password') : t('Tampilkan password', 'Show password')}
          className="absolute right-1 top-1 grid h-8 w-8 place-items-center rounded-md text-ink-400 hover:bg-paper-deep hover:text-ink-800">{shown ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}</button>
      </div>
      <FieldError id={`${id}-error`}>{error}</FieldError>
    </div>
  );
}

export function NameDialog({ current, busy, submit, onClose }: DialogProps & { current: string }) {
  const { t } = useLocale();
  const [value, setValue] = useState(current);
  const [error, setError] = useState('');
  const save = () => {
    const name = normalizeName(value);
    if (!validateName(name)) { setError(t('Nama harus 1–100 karakter.', 'Name must be 1–100 characters.')); return; }
    if (name === current) { onClose(); return; }
    void submit(() => authRequest('/update-user', { name }), t('Nama diperbarui.', 'Name updated.'));
  };
  return (
    <FormModal title={t('Ubah nama', 'Change name')} description={t('Nama tampil di akun dan menu.', 'Shown on your account and menu.')} busy={busy} onClose={onClose} onSubmit={save} submitLabel={t('Simpan', 'Save')}>
      <TextField label={t('Nama', 'Name')} value={value} maxLength={100} autoComplete="name" hint={`${normalizeName(value).length}/100`} error={error} onChange={(next) => { setValue(next); setError(''); }} />
    </FormModal>
  );
}

export function UsernameDialog({ current, busy, submit, onClose }: DialogProps & { current: string | null }) {
  const { t } = useLocale();
  const [value, setValue] = useState(current ?? '');
  const [error, setError] = useState('');
  const save = () => {
    const username = normalizeUsername(value);
    if (!validateUsername(username)) { setError(t('Gunakan 3–30 huruf kecil, angka, titik, atau underscore; awali dan akhiri dengan huruf/angka.', 'Use 3–30 lowercase letters, numbers, periods, or underscores; start and end with a letter or number.')); return; }
    if (username === current) { onClose(); return; }
    void submit(() => authRequest('/update-user', { username }), t('Username diperbarui.', 'Username updated.'));
  };
  return (
    <FormModal title={t('Ubah username', 'Change username')} description={t('Username bisa dipakai untuk masuk.', 'You can use your username to sign in.')} busy={busy} onClose={onClose} onSubmit={save} submitLabel={t('Simpan', 'Save')}>
      <TextField label="Username" prefix="@" value={value} maxLength={30} autoComplete="username" error={error} onChange={(next) => { setValue(next.toLowerCase()); setError(''); }} />
    </FormModal>
  );
}

export function EmailDialog({ current, busy, submit, onClose }: DialogProps & { current: string }) {
  const { t } = useLocale();
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  const save = () => {
    const newEmail = normalizeIdentifier(value);
    if (!validateEmail(newEmail)) { setError(t('Masukkan alamat email yang valid.', 'Enter a valid email address.')); return; }
    if (newEmail === current.toLowerCase()) { setError(t('Email baru sama dengan email saat ini.', 'The new email is the same as your current email.')); return; }
    void submit(() => authRequest('/change-email', { newEmail, callbackURL: '/settings?email=changed#profil' }), t(`Link verifikasi dikirim ke ${newEmail}. Email berubah setelah link diklik.`, `A verification link was sent to ${newEmail}. Your email changes after you click it.`));
  };
  return (
    <FormModal title={t('Ubah email', 'Change email')} description={t(`Email saat ini: ${current}. Kami kirim link verifikasi ke email baru.`, `Current email: ${current}. We will send a verification link to the new email.`)} busy={busy} onClose={onClose} onSubmit={save} submitLabel={t('Kirim link verifikasi', 'Send verification link')}>
      <TextField label={t('Email baru', 'New email')} type="email" value={value} maxLength={254} autoComplete="email" error={error} onChange={(next) => { setValue(next); setError(''); }} />
    </FormModal>
  );
}

type PasswordErrors = Partial<Record<'current' | 'password' | 'confirm', string>>;

function passwordErrors(values: { password: string; confirm: string }, t: (id: string, en: string) => string): PasswordErrors {
  return {
    ...(!validateSignupPassword(values.password) ? { password: t('Gunakan password 10–128 karakter.', 'Use a password of 10–128 characters.') } : {}),
    ...(!values.confirm || values.confirm !== values.password ? { confirm: t('Konfirmasi password belum sama.', 'Passwords do not match.') } : {}),
  };
}

export function ChangePasswordDialog({ busy, submit, onClose }: DialogProps) {
  const { t } = useLocale();
  const [values, setValues] = useState({ current: '', password: '', confirm: '' });
  const [revoke, setRevoke] = useState(true);
  const [errors, setErrors] = useState<PasswordErrors>({});
  const set = (key: keyof typeof values) => (value: string) => { setValues((previous) => ({ ...previous, [key]: value })); setErrors((previous) => ({ ...previous, [key]: undefined })); };
  const save = () => {
    const next: PasswordErrors = { ...(!values.current ? { current: t('Masukkan password saat ini.', 'Enter your current password.') } : {}), ...passwordErrors(values, t) };
    if (!next.password && values.current && values.current === values.password) next.password = t('Password baru harus berbeda.', 'The new password must be different.');
    setErrors(next);
    if (Object.values(next).some(Boolean)) return;
    void submit(() => authRequest('/change-password', { currentPassword: values.current, newPassword: values.password, revokeOtherSessions: revoke }), t('Password diganti.', 'Password changed.'));
  };
  return (
    <FormModal title={t('Ganti password', 'Change password')} busy={busy} onClose={onClose} onSubmit={save} submitLabel={t('Ganti password', 'Change password')}>
      <PasswordField label={t('Password saat ini', 'Current password')} autoComplete="current-password" autoFocus value={values.current} error={errors.current} onChange={set('current')} />
      <PasswordField label={t('Password baru', 'New password')} hint={t('10–128 karakter', '10–128 characters')} autoComplete="new-password" value={values.password} error={errors.password} onChange={set('password')} />
      <PasswordField label={t('Ulangi password baru', 'Confirm new password')} autoComplete="new-password" value={values.confirm} error={errors.confirm} onChange={set('confirm')} />
      <label className="flex cursor-pointer items-center gap-2.5 text-sm text-ink-700"><input type="checkbox" checked={revoke} onChange={(event) => setRevoke(event.target.checked)} className="h-4 w-4 accent-brand-600" />{t('Keluar dari perangkat lain', 'Sign out of other devices')}</label>
    </FormModal>
  );
}

export function SetPasswordDialog({ busy, submit, onClose }: DialogProps) {
  const { t } = useLocale();
  const [values, setValues] = useState({ password: '', confirm: '' });
  const [errors, setErrors] = useState<PasswordErrors>({});
  const set = (key: keyof typeof values) => (value: string) => { setValues((previous) => ({ ...previous, [key]: value })); setErrors((previous) => ({ ...previous, [key]: undefined })); };
  const save = () => {
    const next = passwordErrors(values, t);
    setErrors(next);
    if (Object.values(next).some(Boolean)) return;
    void submit(() => request('/api/account/password', 'POST', { newPassword: values.password }, newKey()), t('Password ditambahkan. Kamu bisa masuk dengan email dan password.', 'Password added. You can now sign in with email and password.'));
  };
  return (
    <FormModal title={t('Tambah password', 'Add password')} description={t('Masuk dengan email dan password selain lewat Google.', 'Sign in with email and password in addition to Google.')} busy={busy} onClose={onClose} onSubmit={save} submitLabel={t('Tambah password', 'Add password')}>
      <PasswordField label={t('Password baru', 'New password')} hint={t('10–128 karakter', '10–128 characters')} autoComplete="new-password" autoFocus value={values.password} error={errors.password} onChange={set('password')} />
      <PasswordField label={t('Ulangi password', 'Confirm password')} autoComplete="new-password" value={values.confirm} error={errors.confirm} onChange={set('confirm')} />
    </FormModal>
  );
}
