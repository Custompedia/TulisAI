'use client';
import { useLocale } from '@/lib/client/locale';
import { AppShell, useShell } from '@/components/app/AppShell';
import { Composer } from '@/components/compose/Composer';

export default function HomePage() {
  return <AppShell><Home /></AppShell>;
}

function Home() {
  const { t } = useLocale();
  const { user } = useShell();
  const name = user.name.split(' ')[0] || user.name;
  return (
    <main className="mx-auto flex min-h-[calc(100dvh-3.5rem)] w-full max-w-[880px] flex-col justify-center px-4 py-8 sm:px-6">
      <h1 className="mb-7 text-center text-2xl font-medium leading-tight tracking-[-0.045em] text-ink-900 sm:text-[32px]">
        {t(`Hai, ${name}! Mau menulis apa hari ini?`, `Hi, ${name}! What are you writing today?`)}
      </h1>
      <Composer />
    </main>
  );
}
