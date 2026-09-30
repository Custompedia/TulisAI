'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useState, type FormEvent, type RefObject } from 'react';
import { ArrowRight, Eye, EyeOff } from 'lucide-react';
import { GoogleIcon } from '@/components/ui/GoogleIcon';
import { Logo } from '@/components/ui/Logo';
import { Spinner } from '@/components/ui/Spinner';
import { Toast } from '@/components/ui/Toast';
import type { AuthErrors, AuthField } from '@/lib/auth/form';
import { useLocale } from '@/lib/client/locale';
import styles from './AuthView.module.css';

type Props = {
  register?: boolean;
  values: Record<AuthField, string>;
  remember: boolean;
  busy: 'form' | 'google' | null;
  error: string;
  fieldErrors: AuthErrors;
  next: string | null;
  inputRefs: Record<AuthField, RefObject<HTMLInputElement | null>>;
  onChange: (field: AuthField, value: string) => void;
  onRemember: (value: boolean) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onGoogle: () => void;
};

type T = (id: string, en: string) => string;
// Indonesian first like the rest of the app; English follows the saved interface language.
const fieldInfo = (t: T) => ({
  name: { label: t('Nama lengkap', 'Full name'), placeholder: t('Namamu', 'Your name'), maxLength: 100 },
  username: { label: 'Username', placeholder: t('namamu', 'yourname'), maxLength: 30 },
  email: { label: t('Alamat email', 'Email address'), placeholder: t('kamu@contoh.com', 'you@example.com'), maxLength: 254 },
  password: { label: t('Kata sandi', 'Password'), placeholder: t('Masukkan kata sandi', 'Enter your password'), maxLength: 128 },
  confirm: { label: t('Ulangi kata sandi', 'Confirm password'), placeholder: t('Ketik ulang kata sandi', 'Repeat your password'), maxLength: 128 },
});

export function AuthView({ register = false, values, remember, busy, error, fieldErrors, next, inputRefs, onChange, onRemember, onSubmit, onGoogle }: Props) {
  const { t, locale } = useLocale();
  const info = fieldInfo(t);
  const [shown, setShown] = useState({ password: false, confirm: false });
  const [capsLock, setCapsLock] = useState<AuthField | null>(null);
  const fields: AuthField[] = register ? ['name', 'username', 'email', 'password', 'confirm'] : ['email', 'password'];
  const alternate = `${register ? '/login' : '/register'}${next ? `?next=${encodeURIComponent(next)}` : ''}`;
  return <main className={styles.page} lang={locale}>
    <div className={styles.scenery} aria-hidden="true"><Image src="/images/auth/login-garden.webp" alt="" fill sizes="100vw" priority className={styles.sceneryImage} /></div>
    <div className={styles.stage}>
      <div className={`${styles.frame} ${register ? styles.register : ''}`}>
      <section className={styles.card} aria-labelledby="auth-title">
        <div className={styles.formPanel}>
          <div className={styles.heading}><div className={styles.brand}><Logo compact /></div><h1 id="auth-title">{register ? t('Buat akunmu', 'Create your account') : t('Selamat datang kembali', 'Welcome back')}</h1><p>{register ? t('Ruang kerja untuk tulisanmu.', 'A workspace for your words.') : next ? t('Masuk untuk melanjutkan yang tadi.', 'Sign in to pick up where you left off.') : t('Masuk ke ruang kerja menulismu.', 'Sign in to your writing workspace.')}</p></div>
          {error && <Toast tone="error">{error}</Toast>}
          <form onSubmit={onSubmit} noValidate aria-label={register ? t('Buat akun dengan email', 'Create account with email') : t('Masuk dengan email', 'Sign in with email')} aria-busy={busy === 'form'}>
            <fieldset disabled={busy !== null} className={styles.fields}>
              <div className={styles.inputGrid}>
                {fields.map(field => {
                  const meta = info[field];
                  const secret = field === 'password' || field === 'confirm';
                  const revealed = secret && shown[field];
                  const hint = register && field === 'username' ? t('3–30 huruf, angka, titik, atau underscore.', '3–30 letters, numbers, dots or underscores.') : register && field === 'password' ? t('Gunakan 10–128 karakter.', 'Use 10–128 characters.') : undefined;
                  const autocomplete = secret ? (register ? 'new-password' : 'current-password') : field === 'email' ? (register ? 'email' : 'username') : field;
                  return <div key={field} className={`${styles.field} ${field === 'email' ? styles.fullWidth : ''}`}>
                    <label htmlFor={`auth-${field}`}>{meta.label}</label>
                    <div className={`${styles.inputWrap} ${secret ? styles.passwordWrap : ''}`}>
                      <input ref={inputRefs[field]} id={`auth-${field}`} name={field} type={secret ? (revealed ? 'text' : 'password') : field === 'email' ? 'email' : 'text'} autoComplete={autocomplete} autoCapitalize={field === 'name' ? 'words' : 'none'} spellCheck={false} required maxLength={meta.maxLength} value={values[field]} onChange={event => onChange(field, event.target.value)} placeholder={meta.placeholder} aria-invalid={Boolean(fieldErrors[field])} aria-describedby={[fieldErrors[field] ? `${field}-error` : hint ? `${field}-hint` : '', capsLock === field ? `${field}-caps` : ''].filter(Boolean).join(' ') || undefined} onKeyUp={event => { if (secret) setCapsLock(event.getModifierState('CapsLock') ? field : null); }} onBlur={() => setCapsLock(null)} />
                      {secret && <button type="button" className={styles.reveal} aria-label={field === 'confirm' ? (revealed ? t('Sembunyikan ulangan kata sandi', 'Hide confirmed password') : t('Tampilkan ulangan kata sandi', 'Show confirmed password')) : (revealed ? t('Sembunyikan kata sandi', 'Hide password') : t('Tampilkan kata sandi', 'Show password'))} aria-pressed={Boolean(revealed)} onClick={() => setShown(current => ({ ...current, [field]: !current[field] }))}>{revealed ? <EyeOff size={17} aria-hidden="true" /> : <Eye size={17} aria-hidden="true" />}</button>}
                    </div>
                    {fieldErrors[field] ? <p id={`${field}-error`} role="alert" className={styles.fieldError}>{fieldErrors[field]}</p> : hint && <p id={`${field}-hint`} className={styles.hint}>{hint}</p>}
                    {capsLock === field && <p id={`${field}-caps`} className={styles.hint} role="status">{t('Caps Lock sedang aktif.', 'Caps Lock is on.')}</p>}
                  </div>;
                })}
              </div>
              {!register && <div className={styles.rememberRow}><label className={styles.remember}><input type="checkbox" checked={remember} onChange={event => onRemember(event.target.checked)} />{t('Tetap masuk', 'Keep me signed in')}</label><Link href="/forgot-password" className={styles.forgot}>{t('Lupa kata sandi?', 'Forgot password?')}</Link></div>}
              <button type="submit" className={styles.submit} disabled={busy !== null}>{busy === 'form' ? <><Spinner size={17} />{register ? t('Membuat akun…', 'Creating account…') : t('Sedang masuk…', 'Signing in…')}</> : <>{register ? t('Buat akun', 'Create account') : t('Masuk', 'Sign in')}<ArrowRight size={16} aria-hidden="true" /></>}</button>
            </fieldset>
          </form>
          <div className={styles.divider}><span />{t('atau', 'or')}<span /></div>
          <button type="button" className={styles.google} onClick={onGoogle} disabled={busy !== null} aria-busy={busy === 'google'}>
            {busy === 'google' ? <Spinner size={18} /> : <GoogleIcon />}
            {busy === 'google' ? t('Menghubungkan ke Google…', 'Connecting to Google…') : t('Lanjutkan dengan Google', 'Continue with Google')}
          </button>
        </div>
          <p className={styles.signup}>{register ? t('Sudah punya akun?', 'Already have an account?') : t('Baru di sini?', 'New here?')} <Link href={alternate}>{register ? t('Masuk', 'Sign in') : t('Buat akun', 'Create an account')}<ArrowRight size={13} aria-hidden="true" /></Link></p>
      </section>
      </div>
    </div>
  </main>;
}
