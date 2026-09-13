"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { type FormEvent, useEffect, useRef, useState } from "react";
import {
  authErrorFromResponse, type AuthErrors, type AuthField, normalizeIdentifier,
  normalizeName, normalizeUsername, validateLogin, validateEmail, validateRegistration, validationMessages, safeAuthNext,
} from "@/lib/auth/form";
import { useLocale } from "@/lib/client/locale";
import { AuthView } from "./AuthView";

const TIMEOUT_MS = 30_000;
type AuthResponse = { url?: string };

export function AuthForm({ register = false }: { register?: boolean }) {
  const { locale, t } = useLocale();
  const searchParams = useSearchParams();
  const router = useRouter();
  const en = locale === "en";
  const copy = validationMessages(en);
  const next = safeAuthNext(searchParams.get("next"));
  const [name, setName] = useState("");
  const [identifier, setIdentifier] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
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
      : { ...validateLogin({ identifier: normalized.identifier, password }, en), ...(!validateEmail(normalized.identifier) ? { email: copy.email } : {}) };
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
      const { response, data } = await post("/api/auth/sign-in/social", { provider: "google", callbackURL: next ?? "/app", newUserCallbackURL: "/onboarding", errorCallbackURL: `${register ? "/register" : "/login"}?error=google${next ? `&next=${encodeURIComponent(next)}` : ""}` });
      if (!response.ok || !data?.url) { setError(response.status === 404 ? copy.google : authErrorFromResponse(data, response.status, en).message); return; }
      window.location.assign(data.url);
    } catch { setError(copy.google); } finally { inFlight.current = false; setBusy(null); }
  }

  const setters = { name: setName, username: setUsername, email: setIdentifier, password: setPassword, confirm: setConfirm };
  return <AuthView
    register={register} values={{ name, username, email: identifier, password, confirm }}
    remember={remember} busy={busy} error={error.replace("Username/email", "Email").replace("username or email", "email and password")}
    fieldErrors={fieldErrors} next={next} inputRefs={refs}
    onChange={(field, value) => { setters[field](value); setFieldErrors(current => ({ ...current, [field]: undefined })); setError(""); }}
    onRemember={setRemember} onSubmit={event => void submit(event)} onGoogle={() => void google()}
  />;
}
