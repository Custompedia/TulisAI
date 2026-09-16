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

const fieldInfo = {
  name: { label: 'Full name', placeholder: 'Your name', maxLength: 100 },
  username: { label: 'Username', placeholder: 'yourname', maxLength: 30 },
  email: { label: 'Email address', placeholder: 'you@example.com', maxLength: 254 },
  password: { label: 'Password', placeholder: 'Enter your password', maxLength: 128 },
  confirm: { label: 'Confirm password', placeholder: 'Repeat your password', maxLength: 128 },
};

export function AuthView({ register = false, values, remember, busy, error, fieldErrors, next, inputRefs, onChange, onRemember, onSubmit, onGoogle }: Props) {
  const [shown, setShown] = useState({ password: false, confirm: false });
  const [capsLock, setCapsLock] = useState<AuthField | null>(null);
  const fields: AuthField[] = register ? ['name', 'username', 'email', 'password', 'confirm'] : ['email', 'password'];
  const alternate = `${register ? '/login' : '/register'}${next ? `?next=${encodeURIComponent(next)}` : ''}`;
  return <main className={styles.page} lang="en">
    <div className={styles.scenery} aria-hidden="true"><Image src="/images/auth/login-garden.webp" alt="" fill sizes="100vw" priority className={styles.sceneryImage} /></div>
    <div className={styles.stage}>
      <div className={`${styles.frame} ${register ? styles.register : ''}`}>
      <section className={styles.card} aria-labelledby="auth-title">
        <div className={styles.formPanel}>
          <div className={styles.heading}><div className={styles.brand}><Logo compact /></div><h1 id="auth-title">{register ? 'Create your account' : 'Welcome back'}</h1><p>{register ? 'A workspace for your words.' : next ? 'Sign in to pick up where you left off.' : 'Sign in to your writing workspace.'}</p></div>
          {error && <Toast tone="error">{error}</Toast>}
          <form onSubmit={onSubmit} noValidate aria-label={register ? 'Create account with email' : 'Sign in with email'} aria-busy={busy === 'form'}>
            <fieldset disabled={busy !== null} className={styles.fields}>
              <div className={styles.inputGrid}>
                {fields.map(field => {
                  const info = fieldInfo[field];
                  const secret = field === 'password' || field === 'confirm';
                  const revealed = secret && shown[field];
                  const hint = register && field === 'username' ? '3–30 letters, numbers, dots or underscores.' : register && field === 'password' ? 'Use 10–128 characters.' : undefined;
                  const autocomplete = secret ? (register ? 'new-password' : 'current-password') : field === 'email' ? (register ? 'email' : 'username') : field;
                  return <div key={field} className={`${styles.field} ${field === 'email' ? styles.fullWidth : ''}`}>
                    <label htmlFor={`auth-${field}`}>{info.label}</label>
                    <div className={`${styles.inputWrap} ${secret ? styles.passwordWrap : ''}`}>
                      <input ref={inputRefs[field]} id={`auth-${field}`} name={field} type={secret ? (revealed ? 'text' : 'password') : field === 'email' ? 'email' : 'text'} autoComplete={autocomplete} autoCapitalize={field === 'name' ? 'words' : 'none'} spellCheck={false} required maxLength={info.maxLength} value={values[field]} onChange={event => onChange(field, event.target.value)} placeholder={info.placeholder} aria-invalid={Boolean(fieldErrors[field])} aria-describedby={[fieldErrors[field] ? `${field}-error` : hint ? `${field}-hint` : '', capsLock === field ? `${field}-caps` : ''].filter(Boolean).join(' ') || undefined} onKeyUp={event => { if (secret) setCapsLock(event.getModifierState('CapsLock') ? field : null); }} onBlur={() => setCapsLock(null)} />
                      {secret && <button type="button" className={styles.reveal} aria-label={`${revealed ? 'Hide' : 'Show'} ${field === 'confirm' ? 'confirmed password' : 'password'}`} aria-pressed={Boolean(revealed)} onClick={() => setShown(current => ({ ...current, [field]: !current[field] }))}>{revealed ? <EyeOff size={17} aria-hidden="true" /> : <Eye size={17} aria-hidden="true" />}</button>}
                    </div>
                    {fieldErrors[field] ? <p id={`${field}-error`} role="alert" className={styles.fieldError}>{fieldErrors[field]}</p> : hint && <p id={`${field}-hint`} className={styles.hint}>{hint}</p>}
                    {capsLock === field && <p id={`${field}-caps`} className={styles.hint} role="status">Caps Lock is on.</p>}
                  </div>;
                })}
              </div>
              {!register && <div className={styles.rememberRow}><label className={styles.remember}><input type="checkbox" checked={remember} onChange={event => onRemember(event.target.checked)} />Keep me signed in</label><Link href="/forgot-password" className={styles.forgot}>Forgot password?</Link></div>}
              <button type="submit" className={styles.submit} disabled={busy !== null}>{busy === 'form' ? <><Spinner size={17} />{register ? 'Creating account…' : 'Signing in…'}</> : <>{register ? 'Create account' : 'Sign in'}<ArrowRight size={16} aria-hidden="true" /></>}</button>
            </fieldset>
          </form>
          <div className={styles.divider}><span />or<span /></div>
          <button type="button" className={styles.google} onClick={onGoogle} disabled={busy !== null} aria-busy={busy === 'google'}>
            {busy === 'google' ? <Spinner size={18} /> : <GoogleIcon />}
            {busy === 'google' ? 'Connecting to Google…' : 'Continue with Google'}
          </button>
        </div>
          <p className={styles.signup}>{register ? 'Already have an account?' : 'New here?'} <Link href={alternate}>{register ? 'Sign in' : 'Create an account'}<ArrowRight size={13} aria-hidden="true" /></Link></p>
      </section>
      </div>
    </div>
  </main>;
}
