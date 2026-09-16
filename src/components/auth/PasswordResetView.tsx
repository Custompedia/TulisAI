'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { ArrowLeft, ArrowRight, CircleAlert, CircleCheck, Eye, EyeOff, MailCheck } from 'lucide-react';
import { Logo } from '@/components/ui/Logo';
import { Spinner } from '@/components/ui/Spinner';
import { Toast } from '@/components/ui/Toast';
import { ApiError, authRequest, errorText } from '@/lib/client/api';
import { useLocale } from '@/lib/client/locale';
import { normalizeIdentifier, validateEmail, validateSignupPassword } from '@/lib/auth/form';
import styles from './AuthView.module.css';

function AuthCard({ title, description, children, footer }: { title: string; description: string; children: React.ReactNode; footer: React.ReactNode }) {
  return <main className={styles.page}>
    <div className={styles.scenery} aria-hidden="true"><Image src="/images/auth/login-garden.webp" alt="" fill sizes="100vw" priority className={styles.sceneryImage} /></div>
    <div className={styles.stage}>
      <div className={styles.frame}>
        <section className={styles.card} aria-labelledby="auth-title">
          <div className={styles.formPanel}>
            <div className={styles.heading}><div className={styles.brand}><Logo compact /></div><h1 id="auth-title">{title}</h1><p>{description}</p></div>
            {children}
          </div>
          <p className={styles.signup}>{footer}</p>
        </section>
      </div>
    </div>
  </main>;
}

function BackToLogin() {
  const { t } = useLocale();
  return <Link href="/login"><ArrowLeft size={13} aria-hidden="true" />{t('Kembali ke halaman masuk', 'Back to sign in')}</Link>;
}

export function ForgotPasswordView() {
  const { t, locale } = useLocale();
  const [email, setEmail] = useState('');
  const [fieldError, setFieldError] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const normalized = normalizeIdentifier(email);
    if (!validateEmail(normalized)) { setFieldError(t('Masukkan alamat email yang valid.', 'Enter a valid email address.')); return; }
    setBusy(true); setError('');
    try { await authRequest('/request-password-reset', { email: normalized, redirectTo: '/reset-password' }); setSent(true); }
    catch (caught) { setError(errorText(caught, locale === 'en')); }
    finally { setBusy(false); }
  }

  return <AuthCard title={t('Lupa password', 'Forgot password')} description={t('Masukkan email akunmu. Kami kirim link untuk membuat password baru.', 'Enter your account email. We will send a link to create a new password.')} footer={<BackToLogin />}>
    {error && <Toast tone="error" onDismiss={() => setError('')} dismissLabel={t('Tutup', 'Dismiss')}>{error}</Toast>}
    {sent ? (
      <div className={styles.stack}>
        <div className={styles.notice} role="status"><MailCheck size={18} aria-hidden="true" /><span>{t('Jika email terdaftar, link sudah dikirim. Periksa kotak masuk atau folder spam. Link berlaku 1 jam.', 'If the email is registered, a link has been sent. Check your inbox or spam folder. The link expires in 1 hour.')}</span></div>
        <button type="button" className={styles.google} onClick={() => { setSent(false); setEmail(''); }}>{t('Kirim ke email lain', 'Use another email')}</button>
      </div>
    ) : (
      <form onSubmit={(event) => void submit(event)} noValidate aria-busy={busy}>
        <fieldset disabled={busy} className={styles.fields}>
          <div className={styles.field}>
            <label htmlFor="forgot-email">{t('Alamat email', 'Email address')}</label>
            <div className={styles.inputWrap}><input id="forgot-email" type="email" autoComplete="email" autoCapitalize="none" spellCheck={false} required maxLength={254} value={email} placeholder="you@example.com" aria-invalid={Boolean(fieldError)} aria-describedby={fieldError ? 'forgot-email-error' : undefined} onChange={(event) => { setEmail(event.target.value); setFieldError(''); }} /></div>
            {fieldError && <p id="forgot-email-error" role="alert" className={styles.fieldError}>{fieldError}</p>}
          </div>
          <button type="submit" className={styles.submit} disabled={busy}>{busy ? <><Spinner size={17} />{t('Mengirim…', 'Sending…')}</> : <>{t('Kirim link reset', 'Send reset link')}<ArrowRight size={16} aria-hidden="true" /></>}</button>
        </fieldset>
      </form>
    )}
  </AuthCard>;
}

type Secret = 'password' | 'confirm';

export function ResetPasswordView() {
  const { t, locale } = useLocale();
  const params = useSearchParams();
  const token = params.get('token');
  const [values, setValues] = useState<Record<Secret, string>>({ password: '', confirm: '' });
  const [shown, setShown] = useState<Record<Secret, boolean>>({ password: false, confirm: false });
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<Secret, string>>>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState<'form' | 'done' | 'invalid'>(!token || params.get('error') ? 'invalid' : 'form');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !token) return;
    const errors = {
      ...(!validateSignupPassword(values.password) ? { password: t('Gunakan password 10–128 karakter.', 'Use a password of 10–128 characters.') } : {}),
      ...(!values.confirm || values.confirm !== values.password ? { confirm: t('Konfirmasi password belum sama.', 'Passwords do not match.') } : {}),
    };
    setFieldErrors(errors);
    if (Object.keys(errors).length) return;
    setBusy(true); setError('');
    try { await authRequest('/reset-password', { newPassword: values.password, token }); setValues({ password: '', confirm: '' }); setState('done'); }
    catch (caught) { if (caught instanceof ApiError && (caught.code === 'INVALID_TOKEN' || caught.code === 'USER_NOT_FOUND')) setState('invalid'); else setError(errorText(caught, locale === 'en')); }
    finally { setBusy(false); }
  }

  const titles = { form: t('Buat password baru', 'Create a new password'), done: t('Password diperbarui', 'Password updated'), invalid: t('Link tidak valid', 'Invalid link') };
  const descriptions = { form: t('Gunakan password yang belum pernah kamu pakai di akun ini.', 'Use a password you have not used for this account.'), done: t('Kamu bisa masuk dengan password baru sekarang.', 'You can sign in with your new password now.'), invalid: t('Link reset sudah kedaluwarsa atau pernah dipakai.', 'The reset link has expired or was already used.') };

  return <AuthCard title={titles[state]} description={descriptions[state]} footer={state === 'invalid' ? <Link href="/forgot-password">{t('Minta link baru', 'Request a new link')}<ArrowRight size={13} aria-hidden="true" /></Link> : <BackToLogin />}>
    {error && <Toast tone="error" onDismiss={() => setError('')} dismissLabel={t('Tutup', 'Dismiss')}>{error}</Toast>}
    {state === 'done' && <div className={styles.stack}>
      <div className={styles.notice} role="status"><CircleCheck size={18} aria-hidden="true" /><span>{t('Password berhasil diganti.', 'Your password was changed.')}</span></div>
      <Link href="/login" className={styles.submit}>{t('Masuk', 'Sign in')}<ArrowRight size={16} aria-hidden="true" /></Link>
    </div>}
    {state === 'invalid' && <div className={styles.stack}>
      <div className={`${styles.notice} ${styles.noticeError}`} role="alert"><CircleAlert size={18} aria-hidden="true" /><span>{t('Minta link reset baru untuk melanjutkan. Link hanya berlaku 1 jam.', 'Request a new reset link to continue. Links are valid for 1 hour.')}</span></div>
      <Link href="/login" className={styles.submit}>{t('Kembali ke halaman masuk', 'Back to sign in')}<ArrowRight size={16} aria-hidden="true" /></Link>
    </div>}
    {state === 'form' && <form onSubmit={(event) => void submit(event)} noValidate aria-busy={busy}>
      <fieldset disabled={busy} className={styles.fields}>
        {(['password', 'confirm'] as Secret[]).map((field) => <div key={field} className={styles.field}>
          <label htmlFor={`reset-${field}`}>{field === 'password' ? t('Password baru', 'New password') : t('Ulangi password', 'Confirm password')}</label>
          <div className={`${styles.inputWrap} ${styles.passwordWrap}`}>
            <input id={`reset-${field}`} type={shown[field] ? 'text' : 'password'} autoComplete="new-password" required maxLength={128} value={values[field]} aria-invalid={Boolean(fieldErrors[field])} aria-describedby={fieldErrors[field] ? `reset-${field}-error` : field === 'password' ? 'reset-password-hint' : undefined} onChange={(event) => { setValues((current) => ({ ...current, [field]: event.target.value })); setFieldErrors((current) => ({ ...current, [field]: undefined })); }} />
            <button type="button" className={styles.reveal} aria-pressed={shown[field]} aria-label={shown[field] ? t('Sembunyikan password', 'Hide password') : t('Tampilkan password', 'Show password')} onClick={() => setShown((current) => ({ ...current, [field]: !current[field] }))}>{shown[field] ? <EyeOff size={17} aria-hidden="true" /> : <Eye size={17} aria-hidden="true" />}</button>
          </div>
          {fieldErrors[field] ? <p id={`reset-${field}-error`} role="alert" className={styles.fieldError}>{fieldErrors[field]}</p> : field === 'password' && <p id="reset-password-hint" className={styles.hint}>{t('10–128 karakter.', '10–128 characters.')}</p>}
        </div>)}
        <button type="submit" className={styles.submit} disabled={busy}>{busy ? <><Spinner size={17} />{t('Menyimpan…', 'Saving…')}</> : <>{t('Simpan password', 'Save password')}<ArrowRight size={16} aria-hidden="true" /></>}</button>
      </fieldset>
    </form>}
  </AuthCard>;
}
