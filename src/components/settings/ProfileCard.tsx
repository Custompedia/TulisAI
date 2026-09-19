'use client';
import { useEffect, useState } from 'react';
import { CircleAlert, CircleCheck, KeyRound, Link2, Lock, LogOut, Mail, Pencil, RotateCw, type LucideIcon } from 'lucide-react';
import { useLocale } from '@/lib/client/locale';
import { authRequest, errorText, newKey, request } from '@/lib/client/api';
import { useSessionGuard, useSignOut } from '@/components/app/AppShell';
import { Button, IconButton } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/Modal';
import { GoogleIcon } from '@/components/ui/GoogleIcon';
import { ChangePasswordDialog, EmailDialog, NameDialog, SetPasswordDialog, UsernameDialog, type Submit } from './AccountDialogs';

export type AccountDetails = { id: string; name: string; email: string; username: string | null; emailVerified: boolean; image: string | null; createdAt: string; hasPassword: boolean; providers: string[]; mkl: { linked: false } | { linked: true; profileEmail: string | null; profileName: string | null; linkedAt: string } };
export type Notice = { tone: 'success' | 'error' | 'info'; title?: string; message: string; retry?: () => void };

type Dialog = 'name' | 'username' | 'email' | 'password' | 'set-password' | 'reset' | 'sign-out';

export function memberSince(createdAt: string, locale: 'id' | 'en') {
  const date = new Date(createdAt);
  return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat(locale === 'en' ? 'en-US' : 'id-ID', { month: 'short', year: 'numeric' }).format(date);
}

export function canOfferMklLink(account: Pick<AccountDetails, 'mkl'>, role: string | null | undefined) {
  return role !== 'admin' && !account.mkl.linked;
}

function Row({ label, children, action }: { label: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 py-3.5 first:pt-0">
      <div className="min-w-0 flex-1"><p className="text-[13px] text-ink-500">{label}</p><div className="mt-0.5 break-words text-[15px] font-medium text-ink-900">{children}</div></div>
      {action}
    </div>
  );
}

function LinkAction({ icon: Icon, children, onClick, tone }: { icon: LucideIcon; children: React.ReactNode; onClick: () => void; tone?: 'danger' }) {
  return (
    <button type="button" onClick={onClick} className={`inline-flex min-h-9 items-center gap-2 rounded-md text-left text-sm font-semibold underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-brand-200 ${tone === 'danger' ? 'text-red-700' : 'text-brand-700 hover:text-brand-900'}`}>
      <Icon size={16} aria-hidden="true" className="shrink-0" />{children}
    </button>
  );
}

export function ProfileSkeleton() {
  return (
    <div aria-hidden="true" className="grid animate-pulse gap-6 lg:grid-cols-[minmax(0,1fr)_16rem]">
      <div className="space-y-5">{[40, 28, 56, 36].map((width) => <div key={width}><div className="h-3 w-16 rounded bg-paper-deep" /><div className="mt-2 h-4 rounded bg-paper-deep" style={{ width: `${width}%` }} /></div>)}</div>
      <div className="space-y-4 lg:border-l lg:border-line lg:pl-8"><div className="h-4 w-14 rounded bg-paper-deep" /><div className="h-4 w-36 rounded bg-paper-deep" /><div className="h-4 w-44 rounded bg-paper-deep" /></div>
    </div>
  );
}

export function ProfileCard({ account, role, onUpdated, notify }: { account: AccountDetails; role: string | null | undefined; onUpdated: () => Promise<void>; notify: (notice: Notice) => void }) {
  const { t, locale } = useLocale();
  const guard = useSessionGuard();
  const { signOut, busy: signingOut } = useSignOut();
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [busy, setBusy] = useState(false);
  const [mklPending, setMklPending] = useState<{ profile: { name: string | null; email: string | null; issuer: string }; expiresAt: string } | null>(null);
  const [mklBusy, setMklBusy] = useState(false);
  const google = account.providers.includes('google');

  useEffect(() => {
    if (new URL(window.location.href).searchParams.get('mkl') !== 'confirm') return;
    request<{ profile: { name: string | null; email: string | null; issuer: string }; expiresAt: string }>('/api/account/mkl/link/confirm')
      .then(setMklPending).catch((caught) => { if (!guard(caught)) notify({ tone: 'error', title: t('Konfirmasi MKL tidak tersedia', 'MKL confirmation unavailable'), message: errorText(caught, locale === 'en') }); });
  }, [guard, locale, notify, t]);

  const startMklLink = async () => {
    setMklBusy(true);
    try {
      const result = await authRequest<{ url: string }>('/mkl/link/start', { returnTo: '/settings#profil' });
      window.location.assign(result.url);
    } catch (caught) { if (!guard(caught)) notify({ tone: 'error', title: t('MKL belum terhubung', 'MKL not linked'), message: errorText(caught, locale === 'en') }); setMklBusy(false); }
  };

  const confirmMkl = async () => {
    setMklBusy(true);
    try {
      await request('/api/account/mkl/link/confirm', 'POST', undefined, newKey());
      const url = new URL(window.location.href); url.searchParams.delete('mkl'); window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}#profil`);
      setMklPending(null); notify({ tone: 'success', message: t('Akun MKL berhasil ditautkan.', 'MKL account linked.') }); await onUpdated();
    } catch (caught) { if (!guard(caught)) notify({ tone: 'error', title: t('MKL belum terhubung', 'MKL not linked'), message: errorText(caught, locale === 'en') }); setMklPending(null); }
    finally { setMklBusy(false); }
  };

  const submit: Submit = async (action, success) => {
    setBusy(true);
    try {
      await action();
      setDialog(null); notify({ tone: 'success', message: success });
      await onUpdated().catch(() => undefined);
      return true;
    } catch (caught) {
      if (!guard(caught)) notify({ tone: 'error', title: t('Belum berhasil', 'Not completed'), message: errorText(caught, locale === 'en') });
      return false;
    } finally { setBusy(false); }
  };
  const close = () => { if (!busy) setDialog(null); };
  const edit = (target: Dialog, label: string) => <IconButton icon={Pencil} size="sm" label={label} onClick={() => setDialog(target)} />;

  return (
    <>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_16rem] lg:gap-8">
        <div className="min-w-0">
          <div className="divide-y divide-line">
            <Row label={t('Nama', 'Name')} action={edit('name', t('Ubah nama', 'Change name'))}>{account.name}</Row>
            <Row label="Username" action={edit('username', t('Ubah username', 'Change username'))}>{account.username ? `@${account.username}` : <span className="font-normal text-ink-400">{t('Belum diatur', 'Not set')}</span>}</Row>
            <Row label="Email" action={account.hasPassword ? edit('email', t('Ubah email', 'Change email')) : undefined}>
              <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="min-w-0 break-all">{account.email}</span>
                {account.emailVerified
                  ? <span className="inline-flex items-center gap-1 rounded-md bg-brand-50 px-1.5 py-0.5 text-xs font-semibold text-brand-800"><CircleCheck size={13} aria-hidden="true" />{t('Terverifikasi', 'Verified')}</span>
                  : <span className="inline-flex items-center gap-1 rounded-md bg-amber-50 px-1.5 py-0.5 text-xs font-semibold text-amber-800"><CircleAlert size={13} aria-hidden="true" />{t('Belum diverifikasi', 'Not verified')}</span>}
              </span>
              {google && <span className="mt-1.5 flex items-center gap-2 text-[13px] font-normal text-ink-600"><span className="grid h-4 w-4 place-items-center [&_svg]:h-4 [&_svg]:w-4"><GoogleIcon /></span>{t('Terhubung dengan Google', 'Linked with Google')}</span>}
            </Row>
            <Row label="MKL">
              {account.mkl.linked ? <span className="flex items-start gap-2"><CircleCheck size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-brand-700" /><span>{t('Terhubung', 'Linked')}<span className="block text-[13px] font-normal text-ink-500">{account.mkl.profileName || account.mkl.profileEmail || t('Identitas MKL terverifikasi', 'Verified MKL identity')}</span></span></span>
                : <span className="font-normal text-ink-500">{t('Belum terhubung', 'Not linked')}</span>}
            </Row>
          </div>
          <div className="mt-2 border-t border-line pt-3.5">
            <Row label={t('Paket', 'Plan')}>
              {t('Gratis', 'Free')}
              <span className="block text-[13px] font-normal text-ink-500">{t(`Pengguna sejak ${memberSince(account.createdAt, locale)}`, `User since ${memberSince(account.createdAt, locale)}`)}</span>
            </Row>
          </div>
        </div>

        <div className="flex flex-col border-t border-line pt-5 lg:border-l lg:border-t-0 lg:pl-8 lg:pt-0">
          <h3 className="text-[13px] text-ink-500">{t('Akun', 'Account')}</h3>
          <div className="mt-2 flex flex-col items-start gap-1">
            {canOfferMklLink(account, role) && <LinkAction icon={Link2} onClick={() => void startMklLink()}>{mklBusy ? t('Menghubungkan MKL…', 'Connecting MKL…') : t('Hubungkan akun MKL', 'Link MKL account')}</LinkAction>}
            {account.hasPassword ? (
              <>
                <LinkAction icon={Lock} onClick={() => setDialog('password')}>{t('Ganti password', 'Change password')}</LinkAction>
                <LinkAction icon={Mail} onClick={() => setDialog('reset')}>{t('Kirim link reset password', 'Send password reset link')}</LinkAction>
              </>
            ) : (
              <>
                <p className="mb-1 text-[13px] leading-relaxed text-ink-500">{t('Kamu masuk lewat Google. Tambahkan password agar bisa masuk dengan email juga.', 'You sign in with Google. Add a password to also sign in with email.')}</p>
                <LinkAction icon={KeyRound} onClick={() => setDialog('set-password')}>{t('Tambah password', 'Add password')}</LinkAction>
              </>
            )}
          </div>
          <div className="mt-4 border-t border-line pt-3 lg:mt-auto">
            <LinkAction icon={LogOut} tone="danger" onClick={() => setDialog('sign-out')}>{t('Keluar', 'Log out')}</LinkAction>
          </div>
        </div>
      </div>

      {dialog === 'name' && <NameDialog current={account.name} busy={busy} submit={submit} onClose={close} />}
      {dialog === 'username' && <UsernameDialog current={account.username} busy={busy} submit={submit} onClose={close} />}
      {dialog === 'email' && <EmailDialog current={account.email} busy={busy} submit={submit} onClose={close} />}
      {dialog === 'password' && <ChangePasswordDialog busy={busy} submit={submit} onClose={close} />}
      {dialog === 'set-password' && <SetPasswordDialog busy={busy} submit={submit} onClose={close} />}
      {dialog === 'reset' && <ConfirmDialog title={t(`Kirim link ke ${account.email}?`, `Send link to ${account.email}?`)} description={t('Link untuk membuat password baru berlaku 1 jam.', 'The link to create a new password is valid for 1 hour.')} confirmLabel={t('Kirim link', 'Send link')} busy={busy} onClose={close}
        onConfirm={() => void submit(() => authRequest('/request-password-reset', { email: account.email, redirectTo: '/reset-password' }), t(`Link reset password dikirim ke ${account.email}.`, `A password reset link was sent to ${account.email}.`))} />}
      {dialog === 'sign-out' && <ConfirmDialog title={t('Keluar dari akun?', 'Log out?')} description={t('Ini hanya mengakhiri sesi TulisAI. Sesi MKL dan link akun tetap ada.', 'This ends only your TulisAI session. Your MKL session and account link remain.')} confirmLabel={t('Keluar', 'Log out')} busy={signingOut} onClose={() => setDialog(null)} onConfirm={() => void signOut()} />}
      {mklPending && <ConfirmDialog title={t('Hubungkan akun MKL?', 'Link this MKL account?')} description={t('Email hanya ditampilkan sebagai profil. Identitas akun ditentukan oleh penerbit dan subjek MKL, bukan kecocokan email.', 'Email is shown only as profile information. Account identity is determined by the MKL issuer and subject, never by matching email.')} confirmLabel={t('Hubungkan MKL', 'Link MKL')} busy={mklBusy} onClose={() => setMklPending(null)} onConfirm={() => void confirmMkl()}>
        <dl className="space-y-2 rounded-lg border border-line bg-paper/60 p-3 text-sm"><div><dt className="text-xs text-ink-500">{t('Nama MKL', 'MKL name')}</dt><dd className="font-medium text-ink-900">{mklPending.profile.name || '—'}</dd></div><div><dt className="text-xs text-ink-500">Email</dt><dd className="break-all font-medium text-ink-900">{mklPending.profile.email || '—'}</dd></div></dl>
      </ConfirmDialog>}
    </>
  );
}

export function ProfileError({ message, onRetry, retrying }: { message: string; onRetry: () => void; retrying: boolean }) {
  const { t } = useLocale();
  return (
    <div className="flex flex-col items-start gap-3 py-2">
      <p className="flex items-center gap-2 text-sm text-ink-700"><CircleAlert size={17} aria-hidden="true" className="shrink-0 text-red-600" />{message}</p>
      <Button size="sm" icon={RotateCw} loading={retrying} onClick={onRetry}>{t('Coba lagi', 'Retry')}</Button>
    </div>
  );
}
