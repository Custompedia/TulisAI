import type { Metadata } from 'next';
import { ForgotPasswordView } from '@/components/auth/PasswordResetView';

export const metadata: Metadata = { title: 'Lupa kata sandi', description: 'Minta link untuk membuat kata sandi baru Tulis Lab.', robots: { index: false, follow: false } };

export default function ForgotPasswordPage() {
  return <ForgotPasswordView />;
}
