'use client';
import { useLinkStatus } from 'next/link';

// Place inside a <Link>: a small dot from the click until the next page is on screen, so a slow load
// never looks like a missed click.
export function LinkPending({ className = '' }: { className?: string }) {
  const { pending } = useLinkStatus();
  if (!pending) return null;
  return <span aria-hidden="true" className={`pointer-events-none absolute h-1.5 w-1.5 animate-pulse rounded-full bg-brand-600 ${className}`} />;
}
