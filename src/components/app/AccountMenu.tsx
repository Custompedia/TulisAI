'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useRef, useState } from 'react';
import { Check, ChevronRight, FolderOpen, Gauge, Globe, LogOut, ShieldCheck, UserRound, type LucideIcon } from 'lucide-react';
import { useLocale, type Locale } from '@/lib/client/locale';
import { errorText, newKey, request } from '@/lib/client/api';
import { ConfirmDialog } from '@/components/ui/Modal';
import { Spinner } from '@/components/ui/Spinner';
import { Toast } from '@/components/ui/Toast';
import { Avatar } from '@/components/ui/Avatar';
import { useSessionGuard, useShell, useSignOut, type UserSettings } from './AppShell';

const LANGUAGES: Array<{ value: Locale; label: string }> = [{ value: 'id', label: 'Bahasa Indonesia' }, { value: 'en', label: 'English' }];
const ITEM = 'flex min-h-11 w-full items-center gap-3 px-4 text-left text-[14px] font-medium text-ink-800 outline-none transition-colors hover:bg-paper-deep focus-visible:bg-paper-deep disabled:opacity-50';

function Item({ icon: Icon, label, onSelect, trailing, expanded, tone }: { icon: LucideIcon; label: string; onSelect: () => void; trailing?: React.ReactNode; expanded?: boolean; tone?: 'danger' }) {
  return (
    <button type="button" role="menuitem" aria-expanded={expanded} onClick={onSelect} className={`${ITEM} ${tone === 'danger' ? 'text-red-700 hover:bg-red-50 focus-visible:bg-red-50' : ''}`}>
      <Icon size={18} strokeWidth={1.9} aria-hidden="true" className="shrink-0" />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {trailing}
    </button>
  );
}

export function AccountMenu() {
  const { t, locale, setLocale } = useLocale();
  const router = useRouter();
  const guard = useSessionGuard();
  const { user, usage, settings, setSettings } = useShell();
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
  const usedPercent = usage ? Math.min(100, Math.round((usage.requestsUsed / Math.max(1, usage.requestLimit)) * 100)) : 0;
  const low = usage !== null && usage.requestsRemaining <= Math.max(1, Math.round(usage.requestLimit * 0.1));

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
    const nodes = Array.from(list.current?.querySelectorAll<HTMLButtonElement>('[role^="menuitem"]:not(:disabled)') ?? []);
    const index = nodes.indexOf(document.activeElement as HTMLButtonElement);
    nodes[(index + (event.key === 'ArrowDown' ? 1 : -1) + nodes.length) % nodes.length]?.focus();
  };

  const go = (href: string) => {
    setOpen(false);
    const [path, hash] = href.split('#');
    if (hash && window.location.pathname === path) { window.location.hash = hash; return; }
    router.push(href);
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
        className={`grid h-9 w-9 place-items-center rounded-full ring-offset-2 transition-shadow hover:ring-2 hover:ring-brand-200 ${open ? 'ring-2 ring-brand-300' : ''}`}>
        <Avatar name={user.name} image={user.image} size={36} />
      </button>

      {open && (
        <div ref={list} id={id} role="menu" aria-label={t('Menu akun', 'Account menu')} onKeyDown={move}
          className="absolute right-0 top-full z-40 mt-2 w-[min(20rem,calc(100vw-1.5rem))] overflow-hidden rounded-2xl border border-line bg-white py-1.5 shadow-[0_16px_40px_-12px_rgb(31_32_29/0.25)] animate-fade-up">
          <div className="flex items-center gap-3 border-b border-line px-4 pb-3 pt-2">
            <Avatar name={user.name} image={user.image} size={40} />
            <div className="min-w-0"><p className="truncate text-sm font-semibold text-ink-900">{user.name}</p><p className="truncate text-xs text-ink-500">{user.email}</p></div>
          </div>

          <div className="border-b border-line py-1.5">
            <Item icon={UserRound} label={t('Detail akun', 'Account details')} onSelect={() => go('/settings#profil')} />
            <Item icon={FolderOpen} label={t('Proyek saya', 'My projects')} onSelect={() => go('/projects')} />
            <Item icon={Globe} label={LANGUAGES.find((item) => item.value === locale)?.label ?? 'Bahasa Indonesia'} expanded={languageOpen} onSelect={() => setLanguageOpen(!languageOpen)}
              trailing={<ChevronRight size={17} aria-hidden="true" className={`shrink-0 text-ink-500 transition-transform ${languageOpen ? 'rotate-90' : ''}`} />} />
            {languageOpen && (
              <div role="group" aria-label={t('Bahasa tampilan', 'Display language')} className="mx-3 mb-1 rounded-xl bg-paper p-1">
                {LANGUAGES.map((item) => (
                  <button key={item.value} type="button" role="menuitemradio" aria-checked={locale === item.value} disabled={switching !== null} onClick={() => void switchLanguage(item.value)}
                    className={`flex h-9 w-full items-center gap-2 rounded-lg px-3 text-left text-[13px] font-medium outline-none transition-colors hover:bg-white focus-visible:bg-white disabled:opacity-60 ${locale === item.value ? 'text-brand-800' : 'text-ink-700'}`}>
                    <span className="flex-1">{item.label}</span>
                    {switching === item.value ? <Spinner size={14} /> : locale === item.value && <Check size={16} aria-hidden="true" />}
                  </button>
                ))}
              </div>
            )}
            <button type="button" role="menuitem" onClick={() => go('/settings#pemakaian')} className={`${ITEM} py-2`}>
              <Gauge size={18} strokeWidth={1.9} aria-hidden="true" className="shrink-0" />
              <span className="min-w-0 flex-1">
                <span className="flex items-center justify-between gap-2"><span>{t('Pemakaian AI', 'AI usage')}</span><span className={`text-xs font-semibold ${low ? 'text-amber-700' : 'text-ink-500'}`}>{usage ? `${usage.requestsUsed}/${usage.requestLimit}` : '—'}</span></span>
                <span className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-paper-deep"><span className={`block h-full rounded-full ${low ? 'bg-amber-500' : 'bg-brand-600'}`} style={{ width: `${usedPercent}%` }} /></span>
              </span>
            </button>
          </div>

          <div className="border-b border-line py-1.5">
            <Item icon={ShieldCheck} label={t('Privasi & data', 'Privacy & data')} onSelect={() => go('/settings#privasi')} />
          </div>

          <div className="pt-1.5">
            <Item icon={LogOut} label={t('Keluar', 'Log out')} tone="danger" onSelect={() => { setOpen(false); setConfirmSignOut(true); }} />
          </div>
        </div>
      )}

      {error && <Toast tone="error" onDismiss={() => setError('')} dismissLabel={t('Tutup', 'Dismiss')} title={t('Bahasa gagal diganti', 'Could not change language')}>{error}</Toast>}
      {confirmSignOut && <ConfirmDialog title={t('Keluar dari akun?', 'Log out?')} description={t('Kamu perlu masuk lagi untuk membuka proyekmu.', 'You will need to sign in again to open your projects.')} confirmLabel={t('Keluar', 'Log out')} busy={signingOut} onClose={() => setConfirmSignOut(false)} onConfirm={() => void signOut()} />}
    </div>
  );
}
