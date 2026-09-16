'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ArrowRight, Briefcase, Check, GraduationCap, PenLine, type LucideIcon } from 'lucide-react';
import { useLocale } from '@/lib/client/locale';
import { errorText, isUnauthenticated, newKey, request } from '@/lib/client/api';
import { Logo } from '@/components/ui/Logo';
import { Button } from '@/components/ui/Button';
import { Toast } from '@/components/ui/Toast';
import { LoadingBlock } from '@/components/ui/Spinner';

type UseCase = 'academic' | 'professional' | 'general';
type Language = 'id' | 'en' | 'auto';
const modeFor: Record<UseCase, string> = { academic: 'P02_ACADEMIC', professional: 'P04_PROFESSIONAL', general: 'P01_STANDARD_REWRITE' };

function Choice({ active, onClick, icon: Icon, title, hint }: { active: boolean; onClick: () => void; icon?: LucideIcon; title: string; hint?: string }) {
  return (
    <button type="button" role="radio" aria-checked={active} onClick={onClick}
      className={`relative flex w-full items-center gap-3 rounded-xl border p-4 text-left transition-colors ${active ? 'border-brand-600 bg-brand-50/60 ring-1 ring-brand-600' : 'border-line-strong bg-white hover:border-ink-300'}`}>
      {Icon && <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-lg ${active ? 'bg-brand-600 text-white' : 'bg-paper-deep text-ink-500'}`}><Icon size={19} aria-hidden="true" /></span>}
      <span className="min-w-0 flex-1"><span className="block text-sm font-semibold text-ink-900">{title}</span>{hint && <span className="block text-[13px] text-ink-500">{hint}</span>}</span>
      {active && <Check size={18} className="text-brand-600" aria-hidden="true" />}
    </button>
  );
}

export default function OnboardingPage() {
  const { t, locale } = useLocale();
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [language, setLanguage] = useState<Language>('id');
  const [useCase, setUseCase] = useState<UseCase>('academic');
  const [busy, setBusy] = useState<'continue' | 'skip' | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    request<{ onboarded: boolean }>('/api/settings')
      .then((settings) => { if (settings.onboarded) router.replace('/app'); else setReady(true); })
      .catch((caught) => { if (isUnauthenticated(caught)) router.replace('/login'); else { setError(errorText(caught, false)); setReady(true); } });
  }, [router]);

  async function finish(skip: boolean) {
    setBusy(skip ? 'skip' : 'continue'); setError('');
    const choice: UseCase = skip ? 'general' : useCase;
    try {
      await request('/api/settings', 'PATCH', { interfaceLanguage: locale, writingLanguage: skip ? 'auto' : language, defaultMode: modeFor[choice], primaryUseCase: choice, humanizerContext: choice, localDrafts: true }, newKey());
      router.replace('/app');
    } catch (caught) { if (isUnauthenticated(caught)) router.replace('/login'); else { setError(errorText(caught, locale === 'en')); setBusy(null); } }
  }

  return (
    <main className="min-h-dvh bg-paper px-4 py-8">
      <div className="mx-auto flex max-w-xl flex-col">
        <Logo href="/" />
        {!ready ? <LoadingBlock label={t('Memuat…', 'Loading…')} /> : (
          <div className="mt-10 animate-fade-up rounded-2xl border border-line bg-white p-6 shadow-sm sm:p-8">
            <p className="text-xs font-semibold uppercase tracking-[0.08em] text-brand-700">{t('Satu langkah lagi', 'One more step')}</p>
            <h1 className="mt-2 font-serif text-[28px] font-semibold leading-tight text-ink-950">{t('Sesuaikan ruang kerjamu', 'Tailor your workspace')}</h1>
            <p className="mt-2 text-sm text-ink-500">{t('Bisa diubah kapan saja di Pengaturan.', 'You can change this anytime in Settings.')}</p>

            <fieldset className="mt-7">
              <legend className="mb-3 text-sm font-semibold text-ink-800">{t('Bahasa tulisan utama', 'Main writing language')}</legend>
              <div role="radiogroup" className="grid grid-cols-3 gap-2">
                {([['id', 'Indonesia'], ['en', 'English'], ['auto', 'Auto']] as Array<[Language, string]>).map(([value, label]) => (
                  <button key={value} type="button" role="radio" aria-checked={language === value} onClick={() => setLanguage(value)}
                    className={`h-11 rounded-xl border text-sm font-semibold transition-colors ${language === value ? 'border-brand-600 bg-brand-600 text-white' : 'border-line-strong bg-white text-ink-700 hover:border-ink-300'}`}>{label}</button>
                ))}
              </div>
            </fieldset>

            <fieldset className="mt-7">
              <legend className="mb-3 text-sm font-semibold text-ink-800">{t('Paling sering untuk', 'Mostly for')}</legend>
              <div role="radiogroup" className="space-y-2">
                <Choice active={useCase === 'academic'} onClick={() => setUseCase('academic')} icon={GraduationCap} title={t('Akademik', 'Academic')} hint={t('Skripsi, tesis, jurnal, tugas kuliah', 'Theses, journals, coursework')} />
                <Choice active={useCase === 'professional'} onClick={() => setUseCase('professional')} icon={Briefcase} title={t('Profesional', 'Professional')} hint={t('Email, laporan, proposal', 'Emails, reports, proposals')} />
                <Choice active={useCase === 'general'} onClick={() => setUseCase('general')} icon={PenLine} title={t('Umum', 'General')} hint={t('Tulisan sehari-hari dan konten', 'Everyday writing and content')} />
              </div>
            </fieldset>

            {error && <Toast tone="error" onDismiss={() => setError('')} dismissLabel={t('Tutup', 'Dismiss')}>{error}</Toast>}
            <div className="mt-8 flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
              <Button variant="ghost" loading={busy === 'skip'} disabled={busy !== null} onClick={() => void finish(true)}>{t('Lewati dulu', 'Skip for now')}</Button>
              <Button variant="primary" size="lg" iconRight={ArrowRight} loading={busy === 'continue'} disabled={busy !== null} onClick={() => void finish(false)}>{t('Lanjutkan', 'Continue')}</Button>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
