import type { Metadata } from 'next';
import { ResetPasswordView } from '@/components/auth/PasswordResetView';

export const metadata: Metadata = { title: 'Buat kata sandi baru', description: 'Buat kata sandi baru untuk Tulis Lab.', robots: { index: false, follow: false }, referrer: 'no-referrer' };

export default function ResetPasswordPage() {
  return <ResetPasswordView />;
}
