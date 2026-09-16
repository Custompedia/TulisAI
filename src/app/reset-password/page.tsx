import type { Metadata } from 'next';
import { ResetPasswordView } from '@/components/auth/PasswordResetView';
import { LocaleScope } from '@/lib/client/locale';

export const metadata: Metadata = { title: 'Reset password', description: 'Create a new password for AI Writing Workspace.', robots: { index: false, follow: false }, referrer: 'no-referrer' };

export default function ResetPasswordPage() {
  return <LocaleScope locale="en"><ResetPasswordView /></LocaleScope>;
}
