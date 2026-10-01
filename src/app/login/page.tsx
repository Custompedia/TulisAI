import type { Metadata } from 'next';
import { AuthForm } from '@/components/auth/AuthForm';

// Indonesian by default like the app; the shared locale provider switches it for accounts that chose English.
export const metadata: Metadata = { title: 'Masuk', description: 'Masuk ke Tulis Lab dengan Google atau email dan kata sandi.', robots: { index: false, follow: false } };

export default function LoginPage() {
  return <AuthForm />;
}
