import type { Metadata } from 'next';
import { AuthForm } from '@/components/auth/AuthForm';
import { LocaleScope } from '@/lib/client/locale';

export const metadata: Metadata = { title: 'Create account', description: 'Create your AI Writing Workspace account.', robots: { index: false, follow: false } };

export default function RegisterPage() {
  return <LocaleScope locale="en"><AuthForm register /></LocaleScope>;
}
