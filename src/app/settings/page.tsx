'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { ArrowUpRight, Gauge, Palette, RotateCw, Save, ShieldCheck, SlidersHorizontal, Trash2, UserRound, type LucideIcon } from 'lucide-react';
import { delMany, keys } from 'idb-keyval';
import { useLocale } from '@/lib/client/locale';
import { numberFormat } from '@/lib/client/format';
import { ApiError, errorText, newKey, request } from '@/lib/client/api';
import { AppShell, useSessionGuard, useShell, type UserSettings } from '@/components/app/AppShell';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Toast } from '@/components/ui/Toast';
import { inputClass, Segmented } from '@/components/ui/Field';
import { ConfirmDialog } from '@/components/ui/Modal';
import { ProfileCard, ProfileError, ProfileSkeleton, type AccountDetails, type Notice } from '@/components/settings/ProfileCard';
import { StylesCard } from '@/components/settings/StylesCard';

const TABS = ['profil', 'skills', 'preferensi', 'pemakaian', 'privasi'] as const;
type Tab = (typeof TABS)[number];
const tabFromHash = (hash: string): Tab => { const value = hash.replace(/^#/, ''); return value === 'bahasa' ? 'preferensi' : (TABS as readonly string[]).includes(value) ? value as Tab : 'profil'; };

export default function SettingsPage() {
  return <AppShell><SettingsView /></AppShell>;
}

function Card({ title, description, children, footer, tone = 'default' }: { title: string; description?: string; children: React.ReactNode; footer?: React.ReactNode; tone?: 'default' | 'danger' }) {
  return (
    <section className={`rounded-2xl border bg-white ${tone === 'danger' ? 'border-red-200' : 'border-line'}`}>
      <header className="px-5 pt-5 sm:px-6"><h2 className={`text-[17px] font-semibold tracking-tight ${tone === 'danger' ? 'text-red-800' : 'text-ink-900'}`}>{title}</h2>{description && <p className="mt-0.5 text-sm text-ink-500">{description}</p>}</header>
      <div className="px-5 pb-5 pt-4 sm:px-6">{children}</div>
      {footer && <footer className="flex flex-wrap items-center justify-end gap-2 rounded-b-2xl border-t border-line bg-paper/60 px-5 py-3 sm:px-6">{footer}</footer>}
    </section>
  );
}

function SettingsView() {
  const { t, locale, setLocale } = useLocale();
  const router = useRouter();
  const guard = useSessionGuard();
  const { user, settings, usage, setSettings, refresh } = useShell();
  const [tab, setTab] = useState<Tab>('profil');
  const [account, setAccount] = useState<AccountDetails | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [form, setForm] = useState<UserSettings>(settings);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);
  const dirty = JSON.stringify(form) !== JSON.stringify(settings);
  const deleteKeyword = account?.username || user.username || user.name;
  const isConfirmValid = Boolean(deleteKeyword && confirmText.trim().replace(/^["']|["']$/g, '').toLowerCase() === deleteKeyword.toLowerCase());
  const en = locale === 'en';

  const loadAccount = useCallback(async () => {
    setLoading(true);
    try { setAccount(await request<AccountDetails>('/api/account')); setLoadError(null); }
    catch (caught) { if (!guard(caught)) setLoadError(caught); }
    finally { setLoading(false); }
  }, [guard]);

  useEffect(() => { void loadAccount(); }, [loadAccount]);

  useEffect(() => {
    const sync = () => setTab(tabFromHash(window.location.hash));
    sync();
    window.addEventListener('hashchange', sync);
    return () => window.removeEventListener('hashchange', sync);
  }, []);

  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get('email') !== 'changed') return;
    const code = url.searchParams.get('error');
    setNotice(code
      ? { tone: 'error', title: t('Email belum berubah', 'Email not changed'), message: errorText(new ApiError(code, 400), en) }
      : { tone: 'success', title: t('Email diperbarui', 'Email updated'), message: t('Email barumu sudah terverifikasi.', 'Your new email is verified.') });
    url.searchParams.delete('email'); url.searchParams.delete('error');
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
  }, [en, t]);

  useEffect(() => {
    if (!loadError) return;
    setNotice({ tone: 'error', title: t('Detail akun gagal dimuat', 'Could not load account details'), message: errorText(loadError, en), retry: () => { setNotice(null); void loadAccount(); } });
  }, [en, loadAccount, loadError, t]);

  const select = (next: Tab) => {
    setTab(next);
    window.history.replaceState(window.history.state, '', `${window.location.pathname}${window.location.search}#${next}`);
  };

  const onUpdated = useCallback(async () => { await Promise.all([loadAccount(), refresh()]); }, [loadAccount, refresh]);

  async function clearLocalDrafts() {
    const owned = (await keys()).filter((key) => String(key).startsWith(`writing-draft:${user.id}:`));
    await delMany(owned);
  }

  async function save() {
    setSaving(true);
    try {
      const saved = await request<UserSettings>('/api/settings', 'PATCH', form, newKey());
      if (!saved.localDrafts) await clearLocalDrafts().catch(() => undefined);
      setSettings(saved); setForm(saved); setLocale(saved.interfaceLanguage);
      setNotice({ tone: 'success', message: saved.interfaceLanguage === 'en' ? 'Settings saved.' : 'Pengaturan tersimpan.' });
    } catch (caught) { if (!guard(caught)) setNotice({ tone: 'error', title: t('Pengaturan belum tersimpan', 'Settings not saved'), message: errorText(caught, en) }); }
    finally { setSaving(false); }
  }

  async function deleteAccount() {
    setDeleting(true);
    try {
      await clearLocalDrafts().catch(() => undefined);
      await request('/api/account', 'DELETE', undefined, newKey());
      router.replace('/'); router.refresh();
    } catch (caught) { if (!guard(caught)) setNotice({ tone: 'error', title: t('Akun belum terhapus', 'Account not deleted'), message: errorText(caught, en) }); setConfirmDelete(false); setDeleting(false); }
  }

  const usedPercent = usage ? Math.min(100, Math.round((usage.charactersUsed / Math.max(1, usage.characterLimit)) * 100)) : 0;
  const nav: Array<{ id: Tab; icon: LucideIcon; label: string }> = [
    { id: 'profil', icon: UserRound, label: t('Profil', 'Profile') },
    { id: 'skills', icon: Palette, label: 'Skills' },
    { id: 'preferensi', icon: SlidersHorizontal, label: t('Preferensi', 'Preferences') },
    { id: 'pemakaian', icon: Gauge, label: t('Pemakaian AI', 'AI usage') },
    { id: 'privasi', icon: ShieldCheck, label: t('Privasi & data', 'Privacy & data') },
  ];
  const profile = account ?? { name: user.name, email: user.email, image: user.image ?? null };

  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-8 sm:py-10">
      <header className="flex items-center gap-4 sm:gap-5">
        <Avatar name={profile.name} image={profile.image} size={80} />
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-medium tracking-[-0.04em] text-ink-950">{profile.name}</h1>
          <p className="truncate text-sm text-ink-500">{profile.email}</p>
        </div>
      </header>

      <div className="mt-6 flex flex-col gap-5 md:mt-8 md:flex-row md:items-start md:gap-10">
        <nav aria-label={t('Bagian pengaturan', 'Settings sections')} className="-mx-4 shrink-0 overflow-x-auto px-4 sm:-mx-8 sm:px-8 md:sticky md:top-20 md:mx-0 md:w-56 md:overflow-visible md:px-0">
          <ul className="flex gap-1 md:flex-col md:gap-1">
            {nav.map(({ id, icon: Icon, label }) => {
              const active = tab === id;
              return (
                <li key={id} className="shrink-0">
                  <a href={`#${id}`} aria-current={active ? 'page' : undefined} onClick={(event) => { event.preventDefault(); select(id); }}
                    className={`flex h-9 items-center gap-2.5 whitespace-nowrap rounded-lg border px-3 text-[13.5px] transition-colors ${active ? 'border-line bg-white font-semibold text-ink-900 shadow-[0_1px_2px_rgb(31_32_29/0.06)]' : 'border-transparent font-medium text-ink-500 hover:bg-white/70 hover:text-ink-900'}`}>
                    <Icon size={16} aria-hidden="true" className={`shrink-0 ${active ? 'text-brand-700' : ''}`} />{label}
                  </a>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="min-w-0 flex-1">
          {tab === 'profil' && (
            <Card title={t('Profil', 'Profile')}>
              {account ? <ProfileCard account={account} onUpdated={onUpdated} notify={setNotice} />
                : loadError && !loading ? <ProfileError message={errorText(loadError, en)} retrying={loading} onRetry={() => void loadAccount()} />
                  : <div role="status" aria-label={t('Memuat detail akun…', 'Loading account details…')}><ProfileSkeleton /></div>}
            </Card>
          )}

          {tab === 'skills' && <StylesCard />}

          {tab === 'preferensi' && (
            <Card title={t('Preferensi', 'Preferences')} description={t('Tampilan aplikasi dan penyimpanan di perangkat ini.', 'App display and storage on this device.')}
              footer={<>
                {dirty && !saving && <p className="mr-auto text-sm text-ink-500">{t('Ada perubahan yang belum disimpan.', 'You have unsaved changes.')}</p>}
                <Button disabled={!dirty || saving} onClick={() => setForm(settings)}>{t('Batalkan', 'Discard')}</Button>
                <Button variant="primary" icon={Save} loading={saving} disabled={!dirty} onClick={() => void save()}>{t('Simpan pengaturan', 'Save settings')}</Button>
              </>}>
              <div className="space-y-5">
                <div>
                  <p className="text-sm font-semibold text-ink-900">{t('Bahasa tampilan', 'Display language')}</p>
                  <p className="mt-0.5 text-[13px] text-ink-500">{t('Bahasa menu dan teks di aplikasi. Bahasa hasil AI tetap dipilih saat menulis.', 'Language for menus and app text. AI output language is still chosen while writing.')}</p>
                  <div className="mt-2.5 max-w-xs"><Segmented label={t('Bahasa tampilan', 'Display language')} value={form.interfaceLanguage} onChange={(value) => setForm({ ...form, interfaceLanguage: value })} options={[{ value: 'id', label: 'Indonesia' }, { value: 'en', label: 'English' }]} /></div>
                </div>
                <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-line bg-paper/50 p-4">
                  <input type="checkbox" checked={form.localDrafts} onChange={(event) => setForm({ ...form, localDrafts: event.target.checked })} className="mt-0.5 h-4 w-4 accent-brand-600" />
                  <span><span className="block text-sm font-semibold text-ink-900">{t('Simpan salinan pemulihan di perangkat ini', 'Keep recovery copies on this device')}</span><span className="block text-[13px] text-ink-500">{t('Melindungi tulisan saat koneksi atau penyimpanan gagal. Mematikannya menghapus salinan lokal.', 'Protects writing when saving fails. Turning it off removes local copies.')}</span></span>
                </label>
              </div>
            </Card>
          )}

          {tab === 'pemakaian' && (
            <Card title={t('Pemakaian AI', 'AI usage')} description={usage ? `${t('Periode', 'Period')} ${usage.period} (UTC)` : undefined}>
              {usage ? (
                <>
                  <div className="flex items-end justify-between"><p className="text-3xl font-bold text-ink-950">{numberFormat(usage.charactersUsed, locale)}<span className="text-base font-medium text-ink-400"> / {usage.unlimited ? '∞' : numberFormat(usage.characterLimit, locale)}</span></p><p className="text-sm text-ink-500">{usage.unlimited ? t('Tanpa batas', 'Unlimited') : `${numberFormat(usage.charactersRemaining, locale)} ${t('karakter tersisa', 'characters remaining')}`}</p></div>
                  {!usage.unlimited && <div className="mt-3 h-2 overflow-hidden rounded-full bg-paper-deep"><div className={`h-full rounded-full ${usedPercent >= 90 ? 'bg-amber-500' : 'bg-brand-600'}`} style={{ width: `${usedPercent}%` }} /></div>}
                  <p className="mt-3 text-[13px] text-ink-500">{t('Termasuk perbaikan otomatis dan percobaan yang gagal. Mengetik, riwayat, dan perbandingan tidak dihitung.', 'Includes automatic repairs and failed attempts. Typing, history, and comparisons are never counted.')}</p>
                </>
              ) : (
                <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-ink-500">{t('Data pemakaian belum tersedia.', 'Usage data is unavailable.')}</p><Button size="sm" icon={RotateCw} onClick={() => void refresh()}>{t('Muat ulang', 'Reload')}</Button></div>
              )}
            </Card>
          )}

          {tab === 'privasi' && (
            <div className="space-y-5">
              <Card title={t('Privasi & data', 'Privacy & data')}>
                <ul className="space-y-2 text-sm text-ink-600">
                  <li>• {t('Dokumen dan versi bersifat privat dan disimpan sampai kamu menghapusnya.', 'Documents and versions are private and kept until you delete them.')}</li>
                  <li>• {t('Pratinjau AI otomatis dibersihkan setelah 24 jam.', 'AI previews are cleared automatically after 24 hours.')}</li>
                  <li>• {t('Isi tulisan tidak dicatat di log atau analitik; penyedia AI diminta tidak menyimpan data.', 'Your text is never written to logs or analytics; the AI provider is asked not to retain data.')}</li>
                </ul>
                <Link href="/notebooks" className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-brand-800 hover:text-ink-900">{t('Kelola & hapus notebook', 'Manage & delete notebooks')}<ArrowUpRight size={15} /></Link>
              </Card>
              <Card tone="danger" title={t('Hapus akun', 'Delete account')} description={t('Menghapus akun, semua dokumen, versi, dan salinan lokal secara permanen.', 'Permanently deletes your account, documents, versions, and local copies.')}>
                <Button variant="danger" icon={Trash2} onClick={() => { setConfirmText(''); setConfirmDelete(true); }}>{t('Hapus akun saya', 'Delete my account')}</Button>
              </Card>
            </div>
          )}
        </div>
      </div>

      {notice && (
        <Toast tone={notice.tone} title={notice.title} duration={notice.tone === 'error' ? undefined : 5000} onDismiss={() => setNotice(null)} dismissLabel={t('Tutup', 'Dismiss')}
          actions={notice.retry ? <Button size="sm" icon={RotateCw} onClick={notice.retry}>{t('Coba lagi', 'Retry')}</Button> : undefined}>{notice.message}</Toast>
      )}
      {confirmDelete && (
        <ConfirmDialog title={t('Hapus akun secara permanen?', 'Permanently delete account?')} tone="danger" busy={deleting} disabled={!isConfirmValid} confirmLabel={t('Hapus permanen', 'Delete permanently')} onClose={() => setConfirmDelete(false)} onConfirm={() => void deleteAccount()}>
          <p>{t('Semua dokumen, versi, dan pratinjau akan hilang dan tidak bisa dipulihkan.', 'All documents, versions, and previews will be lost and cannot be recovered.')}</p>
          <label className="mt-4 block text-[13px] font-semibold text-ink-700">{t(`Ketik "${deleteKeyword}" untuk konfirmasi`, `Type "${deleteKeyword}" to confirm`)}<input className={`${inputClass} mt-1.5`} value={confirmText} onChange={(event) => setConfirmText(event.target.value)} autoComplete="off" /></label>
        </ConfirmDialog>
      )}
    </main>
  );
}
