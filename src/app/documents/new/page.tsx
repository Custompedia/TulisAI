'use client';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { useLocale } from '@/lib/client/locale';
import { AppShell } from '@/components/app/AppShell';
import { Composer } from '@/components/compose/Composer';

export default function NewDocumentPage() {
  return <AppShell><NewDocument /></AppShell>;
}

function NewDocument() {
  const { t } = useLocale();
  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6 sm:py-12">
      <Link href="/app" className="mb-5 inline-flex items-center gap-1.5 text-sm font-semibold text-ink-500 hover:text-ink-900"><ArrowLeft size={16} />{t('Beranda', 'Home')}</Link>
      <h1 className="mb-6 font-serif text-3xl font-semibold tracking-tight text-ink-950">{t('Tulisan baru', 'New document')}</h1>
      <Composer variant="new" />
    </main>
  );
}
