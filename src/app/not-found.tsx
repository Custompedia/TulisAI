'use client';
import { useLocale } from '@/lib/client/locale';
import { StatusScreen, statusIcons } from '@/components/ui/StatusScreen';

export default function NotFound() {
  const { t } = useLocale();
  return (
    <StatusScreen kind="not-found"
      title={t('Halaman tidak ditemukan', 'Page not found')}
      description={t('Halaman yang kamu cari tidak ada, sudah dipindah, atau kamu tidak punya akses.', 'The page you are looking for does not exist, has moved, or you do not have access.')}
      secondary={{ label: t('Ke notebook', 'Go to notebooks'), href: '/notebooks' }}
      primary={{ label: t('Ke beranda', 'Go home'), href: '/app', icon: statusIcons.back }} />
  );
}
