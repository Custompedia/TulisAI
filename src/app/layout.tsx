import './globals.css';
import type { Metadata, Viewport } from 'next';
import { LocaleProvider } from '@/lib/client/locale';

export const metadata: Metadata = {
  title: { default: 'AI Writing Workspace', template: '%s · AI Writing Workspace' },
  icons: { icon: [{ url: '/favicon.svg', type: 'image/svg+xml' }] },
  description: 'Ruang kerja menulis berbahasa Indonesia: parafrase, akademik, humanize, dengan pratinjau, kunci istilah, dan riwayat versi.',
};

export const viewport: Viewport = { themeColor: '#0a1024', width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="id">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font -- the root layout loads fonts for every route */}
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&family=Source+Serif+4:opsz,wght@8..60,400;8..60,600&display=swap" />
      </head>
      <body><LocaleProvider>{children}</LocaleProvider></body>
    </html>
  );
}
