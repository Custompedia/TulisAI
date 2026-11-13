import type { Metadata } from 'next';
import { Suspense } from 'react';
import { LynkClaimView } from '@/components/billing/LynkClaimView';
import { LocaleScope } from '@/lib/client/locale';

export const metadata: Metadata = { title: 'Aktifkan pembelian', robots: { index: false, follow: false }, referrer: 'no-referrer' };

// The link in the "activate your purchase" email after a Lynk payment (docs/lynk-payments.md). The token in the link
// proves it came from that email; the purchase goes to whichever account signs in here.
export default function LynkClaimPage() {
  return <LocaleScope locale="id"><Suspense><LynkClaimView /></Suspense></LocaleScope>;
}
