import type { Metadata } from 'next';
import { AuthForm } from '@/components/auth/AuthForm';

export const metadata: Metadata = { title: 'Buat akun', description: 'Buat akun Tulis Lab.', robots: { index: false, follow: false } };

export default function RegisterPage() {
  return <AuthForm register />;
}
