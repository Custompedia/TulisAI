'use client';
import { useEffect } from 'react';
import { useLocale } from '@/lib/client/locale';
import { StatusScreen, statusIcons } from '@/components/ui/StatusScreen';

export default function RouteError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const { t } = useLocale();
  useEffect(() => { console.error(error); }, [error]);
  return (
    <StatusScreen kind="error"
      title={t('Ada yang tidak beres', 'Something went wrong')}
      description={t('Halaman ini gagal dimuat. Tulisanmu yang sudah tersimpan tetap aman.', 'This page failed to load. Your saved writing is safe.')}
      secondary={{ label: t('Ke beranda', 'Go home'), href: '/app' }}
      primary={{ label: t('Coba lagi', 'Try again'), onClick: reset, icon: statusIcons.retry }} />
  );
}
