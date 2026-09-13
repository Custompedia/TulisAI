'use client';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

export type Locale = 'id' | 'en';
type LocaleContext = { locale: Locale; setLocale: (locale: Locale) => void; t: (id: string, en: string) => string };

const Context = createContext<LocaleContext>({ locale: 'id', setLocale: () => {}, t: (id) => id });

export function LocaleProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>('id');
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem('locale');
      if (saved === 'id' || saved === 'en') { setLocaleState(saved); document.documentElement.lang = saved; }
    } catch { /* storage unavailable */ }
  }, []);
  const setLocale = useCallback((value: Locale) => {
    setLocaleState(value);
    document.documentElement.lang = value;
    try { window.localStorage.setItem('locale', value); } catch { /* storage unavailable */ }
  }, []);
  const value = useMemo(() => ({ locale, setLocale, t: (id: string, en: string) => (locale === 'en' ? en : id) }), [locale, setLocale]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function LocaleScope({ locale, children }: { locale: Locale; children?: React.ReactNode }) {
  const value = useMemo(() => ({ locale, setLocale: () => {}, t: (id: string, en: string) => locale === 'en' ? en : id }), [locale]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export const useLocale = () => useContext(Context);
