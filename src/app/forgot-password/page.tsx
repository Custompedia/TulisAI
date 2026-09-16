import type { Metadata } from 'next';
import { ForgotPasswordView } from '@/components/auth/PasswordResetView';
import { LocaleScope } from '@/lib/client/locale';

export const metadata: Metadata = { title: 'Forgot password', description: 'Request a password reset link for AI Writing Workspace.', robots: { index: false, follow: false } };

export default function ForgotPasswordPage() {
  return <LocaleScope locale="en"><ForgotPasswordView /></LocaleScope>;
}
