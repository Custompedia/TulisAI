'use client';
import Link from 'next/link';
import { useState } from 'react';
import { ArrowLeft, ChevronDown, RefreshCw, type LucideIcon } from 'lucide-react';
import { useLocale } from '@/lib/client/locale';
import { Logo } from './Logo';
import { raisedBlack } from './Button';
import { Spinner } from './Spinner';

export type StatusKind = 'error' | 'not-found' | 'offline';

type Action = { label: string; href?: string; onClick?: () => void | Promise<void>; icon?: LucideIcon };

function Illustration({ kind }: { kind: StatusKind }) {
  return (
    <svg viewBox="0 0 240 150" aria-hidden="true" className="mx-auto h-auto w-full max-w-[240px]">
      <ellipse cx="120" cy="138" rx="84" ry="7" fill="var(--color-brand-100)" />
      <path d="M52 44a12 12 0 0 1 12-12h34l10 10h68a12 12 0 0 1 12 12v68a12 12 0 0 1-12 12H64a12 12 0 0 1-12-12Z" fill="var(--color-brand-200)" />
      <rect x="70" y="22" width="96" height="84" rx="8" transform="rotate(-5 118 64)" fill="#fff" stroke="var(--color-line-strong)" />
      <path d="M86 44h52M86 56h64M86 68h40" transform="rotate(-5 118 64)" stroke="var(--color-line-strong)" strokeWidth="4" strokeLinecap="round" />
      <path d="M52 62a10 10 0 0 1 10-10h116a10 10 0 0 1 10 10v60a14 14 0 0 1-14 14H66a14 14 0 0 1-14-14Z" fill="var(--color-brand-400)" />
      <path d="M62 60h116" stroke="#fff" strokeOpacity=".35" strokeWidth="2" strokeLinecap="round" />
      {kind === 'not-found' ? (
        <text x="120" y="112" textAnchor="middle" fontFamily="var(--font-serif), Georgia, serif" fontSize="40" fontWeight="600" fill="#fff">404</text>
      ) : kind === 'offline' ? (
        <g stroke="#fff" strokeWidth="5" strokeLinecap="round" fill="none"><path d="M98 96a32 32 0 0 1 44 0" /><path d="M108 106a17 17 0 0 1 24 0" /><path d="M96 80l48 36" /></g>
      ) : (
        <g><circle cx="120" cy="96" r="20" fill="#fff" /><path d="M120 85v13" stroke="var(--color-brand-700)" strokeWidth="5" strokeLinecap="round" /><circle cx="120" cy="106" r="3" fill="var(--color-brand-700)" /></g>
      )}
    </svg>
  );
}

// Full-page status screen for load failures, 404s, and crashes.
export function StatusScreen({ kind = 'error', title, description, primary, secondary, detail, code }: { kind?: StatusKind; title: string; description: string; primary?: Action; secondary?: Action; detail?: string; code?: string }) {
  const { t } = useLocale();
  const [running, setRunning] = useState(false);
  const [showDetail, setShowDetail] = useState(false);

  const run = async (action: Action) => { if (!action.onClick || running) return; setRunning(true); try { await action.onClick(); } finally { setRunning(false); } };
  const button = (action: Action, main: boolean) => {
    const Icon = action.icon;
    const className = main
      ? `inline-flex h-10 items-center justify-center gap-2 rounded-full px-5 text-sm font-semibold transition-transform hover:-translate-y-px disabled:opacity-60 ${raisedBlack}`
      : 'inline-flex h-10 items-center justify-center gap-2 rounded-full border border-line-strong bg-white px-5 text-sm font-semibold text-ink-800 transition-colors hover:border-ink-300 hover:text-ink-950';
    const content = <>{main && running ? <Spinner size={15} /> : Icon && <Icon size={16} aria-hidden="true" />}{action.label}</>;
    return action.href ? <Link href={action.href} className={className}>{content}</Link> : <button type="button" onClick={() => void run(action)} disabled={running} className={className}>{content}</button>;
  };

  return (
    <main className="flex min-h-dvh flex-col bg-brand-50 px-4 py-5 sm:px-6">
      <div className="mx-auto w-full max-w-5xl"><Logo href="/app" /></div>
      <div className="grid flex-1 place-items-center py-8">
        <section role={kind === 'not-found' ? undefined : 'alert'} aria-labelledby="status-title" className="w-full max-w-[460px] rounded-[24px] border border-line bg-paper px-6 pb-7 pt-8 text-center shadow-[0_24px_60px_-32px_rgb(66_91_52/0.45)] sm:px-10">
          <Illustration kind={kind} />
          {code && <p className="mt-5 inline-flex rounded-full border border-line bg-white px-2.5 py-0.5 font-mono text-[11px] font-medium text-ink-500">{code}</p>}
          <h1 id="status-title" className={`${code ? 'mt-3' : 'mt-6'} text-[22px] font-medium leading-tight tracking-[-0.04em] text-ink-950 sm:text-2xl`}>{title}</h1>
          <p className="mx-auto mt-2 max-w-sm text-[14px] leading-relaxed text-ink-500">{description}</p>
          {(primary || secondary) && (
            <div className="mt-6 flex flex-col-reverse justify-center gap-2 sm:flex-row">
              {secondary && button(secondary, false)}
              {primary && button(primary, true)}
            </div>
          )}
          {detail && (
            <div className="mt-6 border-t border-line pt-4 text-left">
              <button type="button" onClick={() => setShowDetail(!showDetail)} aria-expanded={showDetail} className="mx-auto flex items-center gap-1 text-xs font-medium text-ink-500 hover:text-ink-900">
                {t('Detail teknis', 'Technical details')}<ChevronDown size={13} aria-hidden="true" className={`transition-transform ${showDetail ? 'rotate-180' : ''}`} />
              </button>
              {showDetail && <pre className="scrollbar-thin mt-3 max-h-32 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-line bg-white px-3 py-2 font-mono text-[11px] leading-relaxed text-ink-600">{detail}</pre>}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

export const statusIcons = { retry: RefreshCw, back: ArrowLeft };
