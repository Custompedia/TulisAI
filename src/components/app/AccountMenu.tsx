'use client';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useId, useRef, useState } from 'react';
import { Check, ChevronDown, ChevronRight, Gauge, Globe, House, KeyRound, Keyboard, LogOut, PenLine, ShieldCheck, UserRound, type LucideIcon } from 'lucide-react';
import { useLocale, type Locale } from '@/lib/client/locale';
import { numberFormat } from '@/lib/client/format';
import { errorText, newKey, request } from '@/lib/client/api';
import { setHash } from '@/lib/client/hash';
import { guardedPush } from '@/lib/client/navigation-guard';
import { planLine, quotaLevel } from '@/lib/client/quota';
import { sectionFor } from '@/lib/navigation/sections';
import { ConfirmDialog } from '@/components/ui/Modal';
import { Spinner } from '@/components/ui/Spinner';
import { Toast } from '@/components/ui/Toast';
import { Avatar } from '@/components/ui/Avatar';
import { useEntitlements, useSessionGuard, useShell, useSignOut, type UserSettings } from './AppShell';
import { openShortcuts } from './shell-events';

const LANGUAGES: Array<{ value: Locale; label: string }> = [{ value: 'id', label: 'Bahasa Indonesia' }, { value: 'en', label: 'English' }];
const ITEM = 'flex h-8 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-[13px] text-ink-700 outline-none transition-colors hover:bg-paper-deep hover:text-ink-900 focus-visible:bg-paper-deep disabled:opacity-50';

function Item({ icon: Icon, label, onSelect, trailing, expanded, tone, className = '' }: { icon: LucideIcon; label: string; onSelect: () => void; trailing?: React.ReactNode; expanded?: boolean; tone?: 'danger'; className?: string }) {
  return (
    <button type="button" role="menuitem" aria-expanded={expanded} onClick={onSelect} className={`${ITEM} ${tone === 'danger' ? 'text-red-700 hover:bg-red-50 focus-visible:bg-red-50' : ''} ${className}`}>
      <Icon size={15} strokeWidth={1.8} aria-hidden="true" className="shrink-0 text-ink-500" />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {trailing}
    </button>
  );
}

// The avatar menu. Beranda and Notebook are not repeated here: the rail (desktop) and the bottom bar (phone)
// already hold them. On a phone Admin moves in here, and inside the editor, where the bottom bar is hidden,
// so does Beranda.
export function AccountMenu() {
  const { t, locale, setLocale } = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const guard = useSessionGuard();
  const { user, usage, settings, setSettings } = useShell();
  const { tier } = useEntitlements();
  const { signOut, busy: signingOut } = useSignOut();
  const [open, setOpen] = useState(false);
  const [languageOpen, setLanguageOpen] = useState(false);
  const [switching, setSwitching] = useState<Locale | null>(null);
  const [error, setError] = useState('');
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const usedPercent = usage ? Math.min(100, Math.round((usage.charactersUsed / Math.max(1, usage.characterLimit)) * 100)) : 0;
  const level = quotaLevel(usage);
  const inEditor = sectionFor(pathname) === 'editor';
  const plan = planLine({ tier, admin: user.role === 'admin', oneTime: usage?.characterScope === 'account', remaining: usage?.charactersRemaining ?? null, paidUntil: usage?.access?.paidUntil ?? null }, t, locale);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { setOpen(false); button.current?.focus(); } };
    document.addEventListener('mousedown', onDown); document.addEventListener('keydown', onKey);
    list.current?.querySelector<HTMLButtonElement>('[role^="menuitem"]')?.focus();
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const move = (event: React.KeyboardEvent) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const nodes = Array.from(list.current?.querySelectorAll<HTMLButtonElement>('[role^="menuitem"]:not(:disabled)') ?? []).filter((node) => node.offsetParent !== null);
    const index = nodes.indexOf(document.activeElement as HTMLButtonElement);
    nodes[(index + (event.key === 'ArrowDown' ? 1 : -1) + nodes.length) % nodes.length]?.focus();
  };

  const go = (href: string) => {
    setOpen(false);
    const [path, hash] = href.split('#');
    if (hash && window.location.pathname === path) { setHash(hash); return; }
    guardedPush(router, href);
  };
  const toggle = () => { setOpen(!open); setLanguageOpen(false); };

  async function switchLanguage(next: Locale) {
    if (next === locale || switching) return;
    const previous = locale; setSwitching(next); setError(''); setLocale(next);
    try { setSettings(await request<UserSettings>('/api/settings', 'PATCH', { ...settings, interfaceLanguage: next }, newKey())); setLanguageOpen(false); }
    catch (caught) { setLocale(previous); if (!guard(caught)) setError(errorText(caught, previous === 'en')); }
    finally { setSwitching(null); }
  }

  return (
    <div ref={root} className="relative">
      <button ref={button} type="button" onClick={toggle} aria-label={t('Menu akun', 'Account menu')} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined}
        className={`flex h-10 items-center gap-1.5 rounded-full border bg-white pl-1 pr-2.5 text-ink-500 shadow-[0_1px_2px_rgb(31_32_29/0.05)] transition-colors hover:border-line-strong hover:text-ink-900 ${open ? 'border-line-strong text-ink-900' : 'border-line'}`}>
        <Avatar name={user.name} image={user.image} size={32} />
        <ChevronDown size={15} strokeWidth={2.2} aria-hidden="true" className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div ref={list} id={id} role="menu" aria-label={t('Menu akun', 'Account menu')} onKeyDown={move}
          className="absolute right-0 top-full z-40 mt-2 w-[min(17rem,calc(100vw-1.5rem))] overflow-hidden rounded-xl border border-line bg-white shadow-[0_12px_32px_-12px_rgb(31_32_29/0.22)] animate-fade-up">
          <div className="border-b border-line px-3 py-2.5">
            <div className="flex items-center gap-2.5">
              <Avatar name={user.name} image={user.image} size={30} />
              <div className="min-w-0"><p className="truncate text-[13px] font-semibold leading-tight text-ink-900">{user.name}</p><p className="truncate text-[11px] leading-tight text-ink-500">{user.email}</p></div>
            </div>
            <p className="mt-2 truncate text-[12px] font-medium text-brand-800">{plan}</p>
            {/* The meter is information, not a menu item; its details live under Pemakaian & paket. */}
            <div className="mt-2">
              <p className="flex items-center justify-between gap-2 text-[11.5px] text-ink-500"><span className="inline-flex items-center gap-1.5"><Gauge size={13} aria-hidden="true" />{t('Karakter AI', 'AI characters')}</span><span className={`font-medium tabular-nums ${level === 'empty' ? 'text-red-700' : level === 'low' ? 'text-amber-700' : ''}`}>{usage ? `${numberFormat(usage.charactersUsed, locale)}/${numberFormat(usage.characterLimit, locale)}` : '—'}</span></p>
              <span className="mt-1 block h-1 overflow-hidden rounded-full bg-line-strong"><span className={`block h-full rounded-full ${level === 'empty' ? 'bg-red-500' : level === 'low' ? 'bg-amber-500' : 'bg-brand-600'}`} style={{ width: `${usedPercent}%` }} /></span>
            </div>
          </div>

          <div className="border-b border-line p-1">
            <Item icon={UserRound} label={t('Profil', 'Profile')} onSelect={() => go('/settings#profil')} />
            <Item icon={KeyRound} label={t('Keamanan', 'Security')} onSelect={() => go('/settings#keamanan')} />
            <Item icon={PenLine} label={t('Preferensi menulis', 'Writing preferences')} onSelect={() => go('/settings#menulis')} />
            <Item icon={Gauge} label={t('Pemakaian & paket', 'Usage & plan')} onSelect={() => go('/settings#pemakaian')} />
            <Item icon={Globe} label={LANGUAGES.find((item) => item.value === locale)?.label ?? 'Bahasa Indonesia'} expanded={languageOpen} onSelect={() => setLanguageOpen(!languageOpen)}
              trailing={<ChevronRight size={14} aria-hidden="true" className={`shrink-0 text-ink-500 transition-transform ${languageOpen ? 'rotate-90' : ''}`} />} />
            {languageOpen && (
              <div role="group" aria-label={t('Bahasa tampilan', 'Display language')} className="mx-1 my-0.5 rounded-lg bg-paper p-0.5">
                {LANGUAGES.map((item) => (
                  <button key={item.value} type="button" role="menuitemradio" aria-checked={locale === item.value} disabled={switching !== null} onClick={() => void switchLanguage(item.value)}
                    className={`flex h-7 w-full items-center gap-2 rounded-md pl-8 pr-2 text-left text-[12.5px] outline-none transition-colors hover:bg-white focus-visible:bg-white disabled:opacity-60 ${locale === item.value ? 'text-brand-800' : 'text-ink-700'}`}>
                    <span className="flex-1">{item.label}</span>
                    {switching === item.value ? <Spinner size={12} /> : locale === item.value && <Check size={13} aria-hidden="true" />}
                  </button>
                ))}
              </div>
            )}
            <Item icon={ShieldCheck} label={t('Privasi & data', 'Privacy & data')} onSelect={() => go('/settings#privasi')} />
            <Item icon={Keyboard} label={t('Pintasan keyboard', 'Keyboard shortcuts')} onSelect={() => { setOpen(false); openShortcuts(); }} />
          </div>

          {/* Phone only: the bottom bar has no Admin, and the editor hides the bottom bar altogether. */}
          {(user.role === 'admin' || inEditor) && (
            <div className="border-b border-line p-1 md:hidden">
              {inEditor && <Item icon={House} label={t('Beranda', 'Home')} onSelect={() => go('/app')} />}
              {user.role === 'admin' && <Item icon={ShieldCheck} label={t('Panel admin', 'Admin panel')} onSelect={() => go('/admin')} />}
            </div>
          )}

          <div className="p-1">
            <Item icon={LogOut} label={t('Keluar', 'Log out')} tone="danger" onSelect={() => { setOpen(false); setConfirmSignOut(true); }} />
          </div>
        </div>
      )}

      {error && <Toast tone="error" onDismiss={() => setError('')} dismissLabel={t('Tutup', 'Dismiss')} title={t('Bahasa gagal diganti', 'Could not change language')}>{error}</Toast>}
      {confirmSignOut && <ConfirmDialog title={t('Keluar dari akun?', 'Log out?')} description={t('Kamu perlu masuk lagi untuk membuka notebook-mu.', 'You will need to sign in again to open your notebooks.')} confirmLabel={t('Keluar', 'Log out')} busy={signingOut} onClose={() => setConfirmSignOut(false)} onConfirm={() => void signOut()} />}
    </div>
  );
}
