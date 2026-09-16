import Link from 'next/link';
import { Feather } from 'lucide-react';
import { raisedBlack } from './Button';

export function Logo({ href = '/', tone = 'dark', compact = false }: { href?: string; tone?: 'dark' | 'light'; compact?: boolean }) {
  const light = tone === 'light';
  return (
    <Link href={href} className="group inline-flex items-center gap-2.5 rounded-lg" aria-label="AI Writing Workspace">
      <span className={`grid h-8 w-8 place-items-center rounded-lg ${light ? 'bg-white text-ink-950' : raisedBlack}`}>
        <Feather size={17} strokeWidth={2.2} aria-hidden="true" />
      </span>
      {!compact && (
        <span className={`text-[15px] font-semibold tracking-tight ${light ? 'text-white' : 'text-ink-950'}`}>
          AI Writing <span className={light ? 'text-brand-200' : 'text-brand-600'}>Workspace</span>
        </span>
      )}
    </Link>
  );
}
