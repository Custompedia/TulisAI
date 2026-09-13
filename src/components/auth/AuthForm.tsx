"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { ArrowLeft, AtSign, Eye, EyeOff, LockKeyhole, Mail, UserRound, type LucideIcon } from "lucide-react";
import {
  authErrorFromResponse, type AuthErrors, type AuthField, normalizeIdentifier,
  normalizeName, normalizeUsername, validateLogin, validateRegistration, validationMessages,
} from "@/lib/auth/form";
import { useLocale } from "@/lib/client/locale";
import { Logo } from "@/components/ui/Logo";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";

const TIMEOUT_MS = 30_000;
type AuthResponse = { url?: string };

// Only same-origin relative paths are accepted as post-login destinations.
const safeNext = (value: string | null) => (value && value.startsWith("/") && !value.startsWith("//") ? value : null);

type InputProps = { id: AuthField; label: string; icon: LucideIcon; value: string; onChange: (value: string) => void; error?: string; hint?: string; type?: string; autoComplete: string; maxLength: number; inputRef: React.RefObject<HTMLInputElement | null>; toggle?: { shown: boolean; onToggle: () => void; showLabel: string; hideLabel: string } };

function AuthInput({ id, label, icon: Icon, value, onChange, error, hint, type = "text", autoComplete, maxLength, inputRef, toggle }: InputProps) {
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  return (
    <div>
      <label htmlFor={`auth-${id}`} className="mb-1.5 block text-[13px] font-semibold text-ink-700">{label}</label>
      <div className="relative">
        <Icon size={17} aria-hidden="true" className={`pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 ${error ? "text-red-500" : "text-ink-400"}`} />
        <input
          ref={inputRef} id={`auth-${id}`} type={toggle ? (toggle.shown ? "text" : "password") : type} value={value} maxLength={maxLength} autoComplete={autoComplete}
          onChange={(event) => onChange(event.target.value)} aria-invalid={Boolean(error)} aria-describedby={describedBy}
          className={`h-11 w-full rounded-xl border bg-white pl-10 text-[15px] text-ink-900 transition-colors placeholder:text-ink-300 focus:outline-none focus:ring-3 ${toggle ? "pr-11" : "pr-3.5"} ${error ? "border-red-400 focus:ring-red-100" : "border-line-strong hover:border-ink-300 focus:border-brand-500 focus:ring-brand-100"}`}
        />
        {toggle && (
          <button type="button" onClick={toggle.onToggle} aria-label={toggle.shown ? toggle.hideLabel : toggle.showLabel} aria-pressed={toggle.shown} className="absolute right-1.5 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-lg text-ink-400 hover:bg-ink-50 hover:text-ink-700">
            {toggle.shown ? <EyeOff size={17} /> : <Eye size={17} />}
          </button>
        )}
      </div>
      {error ? <p id={`${id}-error`} role="alert" className="mt-1.5 text-xs font-medium text-red-600">{error}</p> : hint ? <p id={`${id}-hint`} className="mt-1.5 text-xs text-ink-400">{hint}</p> : null}
    </div>
  );
}

export function AuthForm({ register = false }: { register?: boolean }) {
  const { locale, setLocale, t } = useLocale();
  const searchParams = useSearchParams();
  const router = useRouter();
  const en = locale === "en";
  const copy = validationMessages(en);
  const next = safeNext(searchParams.get("next"));
  const [name, setName] = useState("");
  const [identifier, setIdentifier] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState<"form" | "google" | null>(null);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<AuthErrors>({});
  const inFlight = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const refs: Record<AuthField, React.RefObject<HTMLInputElement | null>> = { name: useRef(null), username: useRef(null), email: useRef(null), password: useRef(null), confirm: useRef(null) };

  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => { if (searchParams.get("error")) setError(copy.googleCallback); }, [copy.googleCallback, searchParams]);

  const focusFirst = (errors: AuthErrors) => {
    const first = (["name", "username", "email", "password", "confirm"] as AuthField[]).find((field) => errors[field]);
    if (first) requestAnimationFrame(() => refs[first].current?.focus());
  };

  async function post(path: string, body: Record<string, unknown>) {
    const active = new AbortController(); controller.current = active;
    const timeout = window.setTimeout(() => active.abort(), TIMEOUT_MS);
    try {
      const response = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, credentials: "same-origin", signal: active.signal, body: JSON.stringify(body) });
      return { response, data: (await response.json().catch(() => null)) as AuthResponse | null };
    } finally { window.clearTimeout(timeout); if (controller.current === active) controller.current = null; }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current) return;
    const normalized = { name: normalizeName(name), username: normalizeUsername(username), identifier: normalizeIdentifier(identifier) };
    const errors = register
      ? validateRegistration({ name: normalized.name, username: normalized.username, email: normalized.identifier, password, confirm }, en)
      : validateLogin({ identifier: normalized.identifier, password }, en);
    setFieldErrors(errors);
    if (Object.keys(errors).length) { setError(""); focusFirst(errors); return; }
    inFlight.current = true; setBusy("form"); setError("");
    try {
      const usesEmail = normalized.identifier.includes("@");
      const destination = register ? "/onboarding" : next ?? "/app";
      const { response, data } = await post(
        register ? "/api/auth/sign-up/email" : usesEmail ? "/api/auth/sign-in/email" : "/api/auth/sign-in/username",
        register ? { name: normalized.name, email: normalized.identifier, username: normalized.username, password, callbackURL: destination } : { [usesEmail ? "email" : "username"]: normalized.identifier, password, rememberMe: remember, callbackURL: destination },
      );
      if (!response.ok) { const mapped = authErrorFromResponse(data, response.status, en); setError(mapped.message); setFieldErrors(mapped.fields); focusFirst(mapped.fields); return; }
      setPassword(""); setConfirm("");
      router.replace(destination);
    } catch (caught) {
      setError(caught instanceof DOMException && caught.name === "AbortError" ? t("Permintaan terlalu lama. Coba lagi.", "The request timed out. Please try again.") : copy.unavailable);
    } finally { inFlight.current = false; setBusy(null); }
  }

  async function google() {
    if (inFlight.current) return;
    inFlight.current = true; setBusy("google"); setError("");
    try {
      const { response, data } = await post("/api/auth/sign-in/social", { provider: "google", callbackURL: next ?? "/app", newUserCallbackURL: "/onboarding", errorCallbackURL: register ? "/register?error=google" : "/login?error=google" });
      if (!response.ok || !data?.url) { setError(response.status === 404 ? copy.google : authErrorFromResponse(data, response.status, en).message); return; }
      window.location.assign(data.url);
    } catch { setError(copy.google); } finally { inFlight.current = false; setBusy(null); }
  }

  const passwordToggle = (shown: boolean, onToggle: () => void) => ({ shown, onToggle, showLabel: t("Tampilkan kata sandi", "Show password"), hideLabel: t("Sembunyikan kata sandi", "Hide password") });

  return (
    <main className="grid min-h-dvh bg-white lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
      <aside className="relative hidden overflow-hidden bg-ink-950 lg:block">
        <Image src="/images/auth-writing-studio.jpg" alt="" fill priority unoptimized sizes="50vw" className="object-cover opacity-80" />
        <div className="absolute inset-0 bg-linear-to-t from-ink-950/90 via-ink-950/25 to-ink-950/40" />
        <div className="absolute left-10 top-9"><Logo tone="light" /></div>
        <p className="absolute bottom-12 left-10 right-10 max-w-md font-serif text-[28px] font-semibold leading-snug text-white">
          {t("Tulisanmu, lebih jelas. Maknanya tetap milikmu.", "Your writing, clearer. The meaning stays yours.")}
        </p>
      </aside>

      <section className="flex min-h-dvh flex-col px-5 py-6 sm:px-10">
        <div className="flex items-center justify-between">
          <Link href="/" className="inline-flex items-center gap-1.5 rounded-lg text-sm font-semibold text-ink-500 hover:text-ink-900"><ArrowLeft size={16} />{t("Beranda", "Home")}</Link>
          <div role="radiogroup" aria-label={t("Bahasa", "Language")} className="flex rounded-lg border border-line bg-paper p-0.5 text-xs font-semibold">
            {(["id", "en"] as const).map((value) => (
              <button key={value} type="button" role="radio" aria-checked={locale === value} onClick={() => setLocale(value)} className={`h-7 rounded-md px-2.5 ${locale === value ? "bg-white text-ink-900 shadow-sm" : "text-ink-500"}`}>{value.toUpperCase()}</button>
            ))}
          </div>
        </div>

        <div className="mx-auto flex w-full max-w-[400px] flex-1 flex-col justify-center py-10">
          <div className="mb-8 lg:hidden"><Logo /></div>
          <h1 className="text-[28px] font-bold tracking-tight text-ink-950">{register ? t("Buat akun", "Create account") : t("Masuk", "Sign in")}</h1>
          <p className="mt-1.5 text-sm text-ink-500">{register ? t("Gratis, hanya butuh satu menit.", "Free, takes one minute.") : next ? t("Masuk lagi untuk melanjutkan tulisanmu.", "Sign in again to continue your writing.") : t("Lanjutkan tulisanmu.", "Continue your writing.")}</p>

          <button type="button" onClick={() => void google()} disabled={busy !== null} className="mt-7 flex h-11 w-full items-center justify-center gap-3 rounded-xl border border-line-strong bg-white text-sm font-semibold text-ink-800 transition-colors hover:bg-ink-50 disabled:opacity-50">
            <Image src="/images/google-sign-in-icon.png" alt="" width={20} height={20} unoptimized />{t("Lanjut dengan Google", "Continue with Google")}
          </button>
          <div className="my-6 flex items-center gap-3 text-xs font-medium text-ink-400"><span className="h-px flex-1 bg-line" />{t("atau", "or")}<span className="h-px flex-1 bg-line" /></div>

          {error && <Alert tone="error" className="mb-5">{error}</Alert>}
          <form onSubmit={submit} noValidate>
            <fieldset disabled={busy !== null} className="space-y-4">
              {register && <AuthInput id="name" label={t("Nama lengkap", "Full name")} icon={UserRound} value={name} onChange={setName} error={fieldErrors.name} autoComplete="name" maxLength={100} inputRef={refs.name} />}
              {register && <AuthInput id="username" label="Username" icon={AtSign} value={username} onChange={setUsername} error={fieldErrors.username} hint={t("3–30 karakter: huruf, angka, titik, underscore", "3–30 characters: letters, numbers, dot, underscore")} autoComplete="username" maxLength={30} inputRef={refs.username} />}
              <AuthInput id="email" label={register ? "Email" : t("Username atau email", "Username or email")} icon={register ? Mail : UserRound} type={register ? "email" : "text"} value={identifier} onChange={setIdentifier} error={fieldErrors.email} autoComplete={register ? "email" : "username"} maxLength={254} inputRef={refs.email} />
              <AuthInput id="password" label={t("Kata sandi", "Password")} icon={LockKeyhole} value={password} onChange={setPassword} error={fieldErrors.password} hint={register ? t("Minimal 10 karakter", "At least 10 characters") : undefined} autoComplete={register ? "new-password" : "current-password"} maxLength={128} inputRef={refs.password} toggle={passwordToggle(showPassword, () => setShowPassword((value) => !value))} />
              {register && <AuthInput id="confirm" label={t("Ulangi kata sandi", "Confirm password")} icon={LockKeyhole} value={confirm} onChange={setConfirm} error={fieldErrors.confirm} autoComplete="new-password" maxLength={128} inputRef={refs.confirm} toggle={passwordToggle(showConfirm, () => setShowConfirm((value) => !value))} />}
              {!register && (
                <label className="flex cursor-pointer items-center gap-2.5 text-sm text-ink-600">
                  <input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} className="h-4 w-4 accent-brand-600" />{t("Tetap masuk", "Keep me signed in")}
                </label>
              )}
              <Button type="submit" variant="primary" size="lg" className="w-full rounded-xl" loading={busy === "form"}>{register ? t("Buat akun", "Create account") : t("Masuk", "Sign in")}</Button>
            </fieldset>
          </form>

          <p className="mt-7 text-center text-sm text-ink-500">
            {register ? t("Sudah punya akun?", "Already have an account?") : t("Belum punya akun?", "No account yet?")}{" "}
            <Link href={register ? "/login" : "/register"} className="font-semibold text-brand-700 hover:text-brand-800">{register ? t("Masuk", "Sign in") : t("Daftar", "Sign up")}</Link>
          </p>
        </div>
      </section>
    </main>
  );
}
