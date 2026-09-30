import type { Metadata } from 'next';
import { Suspense } from 'react';
import { BillingReturnView } from '@/components/billing/BillingReturnView';
import { LocaleScope } from '@/lib/client/locale';

export const metadata: Metadata = { title: 'Status pembayaran', robots: { index: false, follow: false }, referrer: 'no-referrer' };

// Midtrans sends the buyer here after the payment page. Arriving proves nothing:
// the view asks the server, which asks Midtrans, before showing any result.
export default function BillingReturnPage() {
  return <LocaleScope locale="id"><Suspense><BillingReturnView /></Suspense></LocaleScope>;
}
