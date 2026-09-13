import type { Metadata } from 'next';
import { AuthForm } from '@/components/auth/AuthForm';
import { LocaleScope } from '@/lib/client/locale';

export const metadata: Metadata = { title: 'Sign in', description: 'Sign in to AI Writing Workspace with Google or your email and password.', robots: { index: false, follow: false } };

export default function LoginPage() {
  return <LocaleScope locale="en"><AuthForm /></LocaleScope>;
}
