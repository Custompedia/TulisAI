'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { ArrowUpRight, RotateCw, Save, Trash2 } from 'lucide-react';
import { delMany, keys } from 'idb-keyval';
import { useLocale } from '@/lib/client/locale';
import { ApiError, errorText, newKey, request } from '@/lib/client/api';
import { setHash, useHash } from '@/lib/client/hash';
import { settingsRoute, type SettingsTab } from '@/lib/navigation/sections';
import { useSessionGuard, useShell, type UserSettings } from '@/components/app/AppShell';
import { useAccountNav } from '@/components/app/ContextSidebar';
import { Button } from '@/components/ui/Button';
import { Toast } from '@/components/ui/Toast';
import { FieldLabel, inputClass, Segmented } from '@/components/ui/Field';
import { HintSelect } from '@/components/ui/HintSelect';
import { ConfirmDialog } from '@/components/ui/Modal';
import { ProfileCard, ProfileError, ProfileSkeleton, type AccountDetails, type Notice } from '@/components/settings/ProfileCard';
import { UsagePanel } from '@/components/settings/UsagePanel';
import { contextOptions, languageOptions, modeHint, modeLabel } from '@/components/writing/modes';
import { modeFromPrompt } from '@/lib/writing/settings';
import { accountDefaultMode, DEFAULT_MODE_PROMPTS, DISPLAY_PREFERENCE_KEYS, groupChanged, resetGroup, WRITING_PREFERENCE_KEYS } from '@/lib/writing/preferences';
import { asUseCase, USE_CASES, primaryUseHint, primaryUseLabel } from '@/lib/writing/use-cases';

// Akun & Paket. The sub-pages live in the hash and are listed in the context sidebar (a chip strip on phones).
// Old links keep working: #bahasa opens Tampilan & perangkat, and #skills moved to /skills.
export default function SettingsPage() {
  return <SettingsView />;
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
  const { user, settings, setSettings, refresh } = useShell();
  const hash = useHash();
  const route = settingsRoute(hash);
  const tab: SettingsTab = 'tab' in route ? route.tab : 'profil';
  const redirect = 'redirect' in route ? route.redirect : null;
  const [account, setAccount] = useState<AccountDetails | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [form, setForm] = useState<UserSettings>(() => ({ ...settings, defaultMode: accountDefaultMode(settings.defaultMode) }));
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);
  // Each card saves the whole preferences row but only reports and discards its own fields.
  const baseline: UserSettings = { ...settings, defaultMode: accountDefaultMode(settings.defaultMode) };
  const writingDirty = groupChanged(form, baseline, WRITING_PREFERENCE_KEYS);
  const displayDirty = groupChanged(form, settings, DISPLAY_PREFERENCE_KEYS);
  const deleteKeyword = account?.username || user.username || user.name;
  const isConfirmValid = Boolean(deleteKeyword && confirmText.trim().replace(/^["']|["']$/g, '').toLowerCase() === deleteKeyword.toLowerCase());
  const en = locale === 'en';
  const nav = useAccountNav();
  const current = nav.find((item) => item.id === tab) ?? nav[0];

  // /settings#skills was the old home of Skills.
  useEffect(() => { if (redirect) router.replace(redirect); }, [redirect, router]);

  const loadAccount = useCallback(async () => {
    setLoading(true);
    try { setAccount(await request<AccountDetails>('/api/account')); setLoadError(null); }
    catch (caught) { if (!guard(caught)) setLoadError(caught); }
    finally { setLoading(false); }
  }, [guard]);

  useEffect(() => { void loadAccount(); }, [loadAccount]);

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

  const onUpdated = useCallback(async () => { await Promise.all([loadAccount(), refresh()]); }, [loadAccount, refresh]);

  async function clearLocalDrafts() {
    const owned = (await keys()).filter((key) => String(key).startsWith(`writing-draft:${user.id}:`));
    await delMany(owned);
  }

  async function save() {
    setSaving(true);
    try {
      const saved = await request<UserSettings>('/api/settings', 'PATCH', { ...form, defaultMode: accountDefaultMode(form.defaultMode) }, newKey());
      if (!saved.localDrafts) await clearLocalDrafts().catch(() => undefined);
      setSettings(saved); setForm({ ...saved, defaultMode: accountDefaultMode(saved.defaultMode) }); setLocale(saved.interfaceLanguage);
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

  const accountCard = (part: 'profile' | 'security') => (account ? <ProfileCard account={account} onUpdated={onUpdated} notify={setNotice} part={part} />
    : loadError && !loading ? <ProfileError message={errorText(loadError, en)} retrying={loading} onRetry={() => void loadAccount()} />
      : <div role="status" aria-label={t('Memuat detail akun…', 'Loading account details…')}><ProfileSkeleton /></div>);

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-8 sm:py-8">
      <h1 className="text-2xl font-medium tracking-[-0.04em] text-ink-950 sm:text-[28px]">{current.label}</h1>
      {/* Phones have no context sidebar, so the sub-pages stay a scrollable chip strip. */}
      <nav aria-label={t('Bagian Akun & Paket', 'Account & Plan sections')} className="-mx-4 mt-4 overflow-x-auto px-4 md:hidden">
        <ul className="flex gap-1">
          {nav.map(({ id, icon: Icon, label }) => {
            const active = tab === id;
            return (
              <li key={id} className="shrink-0">
                <a href={`#${id}`} aria-current={active ? 'page' : undefined} onClick={(event) => { event.preventDefault(); setHash(id); }}
                  className={`flex h-9 items-center gap-2 whitespace-nowrap rounded-full border px-3 text-[13px] transition-colors ${active ? 'border-line bg-white font-semibold text-ink-900 shadow-[0_1px_2px_rgb(31_32_29/0.06)]' : 'border-transparent font-medium text-ink-500 hover:bg-white/70 hover:text-ink-900'}`}>
                  <Icon size={15} aria-hidden="true" className={`shrink-0 ${active ? 'text-brand-700' : ''}`} />{label}
                </a>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="mt-5 min-w-0">
        {tab === 'profil' && <Card title={t('Data akun', 'Account details')}>{accountCard('profile')}</Card>}

        {tab === 'keamanan' && <Card title={t('Cara masuk', 'Signing in')} description={t('Kata sandi dan sesi di perangkat ini.', 'Your password and the session on this device.')}>{accountCard('security')}</Card>}

        {tab === 'menulis' && (
          <Card title={t('Preferensi menulis', 'Writing preferences')} description={t('Bawaan untuk notebook dan teks baru. Tiap notebook tetap bisa diatur sendiri di panel Asisten.', 'Defaults for new notebooks and text. Each notebook can still be set on its own in the Assistant panel.')}
            footer={<>
              {writingDirty && !saving && <p className="mr-auto text-sm text-ink-500">{t('Ada perubahan yang belum disimpan.', 'You have unsaved changes.')}</p>}
              <Button disabled={!writingDirty || saving} onClick={() => setForm(resetGroup(form, baseline, WRITING_PREFERENCE_KEYS))}>{t('Batalkan', 'Discard')}</Button>
              <Button variant="primary" icon={Save} loading={saving} disabled={!writingDirty} onClick={() => void save()}>{t('Simpan pengaturan', 'Save settings')}</Button>
            </>}>
            <div className="space-y-5">
              <div>
                <p className="text-sm font-semibold text-ink-900">{t('Bahasa tulisan', 'Writing language')}</p>
                <p className="mt-0.5 text-[13px] text-ink-500">{t('Bahasa hasil AI. Auto mendeteksinya dari teks.', 'The language of AI results. Auto detects it from the text.')}</p>
                <div className="mt-2.5 max-w-sm"><Segmented label={t('Bahasa tulisan', 'Writing language')} value={form.writingLanguage} onChange={(value) => setForm({ ...form, writingLanguage: value })} options={languageOptions(t).map(({ value, label }) => ({ value, label }))} /></div>
              </div>
              <div className="max-w-sm">
                <FieldLabel htmlFor="settings-default-mode">{t('Mode awal', 'Starting mode')}</FieldLabel>
                <HintSelect id="settings-default-mode" label={t('Mode awal', 'Starting mode')} value={form.defaultMode} onChange={(value) => setForm({ ...form, defaultMode: value })}
                  options={DEFAULT_MODE_PROMPTS.map((prompt) => { const mode = modeFromPrompt(prompt) ?? 'humanize'; return { value: prompt, label: modeLabel(mode, t), hint: modeHint(mode, t) }; })} />
                <p className="mt-1.5 text-[13px] text-ink-500">{t('Mode yang terpilih saat membuka Beranda dan notebook baru.', 'The mode selected when you open Home and new notebooks.')}</p>
              </div>
              <div>
                <p className="text-sm font-semibold text-ink-900">{t('Konteks Humanize', 'Humanize context')}</p>
                <p className="mt-0.5 text-[13px] text-ink-500">{t('Register bawaan saat memakai mode Humanize.', 'The default register for the Humanize mode.')}</p>
                <div className="mt-2.5 max-w-sm"><Segmented label={t('Konteks Humanize', 'Humanize context')} value={form.humanizerContext} onChange={(value) => setForm({ ...form, humanizerContext: value })} options={contextOptions(t).map(({ value, label }) => ({ value: value as UserSettings['humanizerContext'], label }))} /></div>
              </div>
              <div>
                <p className="text-sm font-semibold text-ink-900">{t('Penggunaan utama', 'Main use')}</p>
                <p className="mt-0.5 text-[13px] text-ink-500">{t('Jenis tulisan yang paling sering kamu olah.', 'The kind of writing you work on most.')}</p>
                <div className="mt-2.5 max-w-sm"><HintSelect label={t('Penggunaan utama', 'Main use')} value={asUseCase(form.primaryUseCase)} onChange={(value) => setForm({ ...form, primaryUseCase: value })} options={USE_CASES.map((value) => ({ value, label: primaryUseLabel(value, t), hint: primaryUseHint(value, t) }))} /></div>
              </div>
            </div>
          </Card>
        )}

        {tab === 'preferensi' && (
          <Card title={t('Tampilan & perangkat', 'Display & device')} description={t('Tampilan aplikasi dan penyimpanan di perangkat ini.', 'App display and storage on this device.')}
            footer={<>
              {displayDirty && !saving && <p className="mr-auto text-sm text-ink-500">{t('Ada perubahan yang belum disimpan.', 'You have unsaved changes.')}</p>}
              <Button disabled={!displayDirty || saving} onClick={() => setForm(resetGroup(form, settings, DISPLAY_PREFERENCE_KEYS))}>{t('Batalkan', 'Discard')}</Button>
              <Button variant="primary" icon={Save} loading={saving} disabled={!displayDirty} onClick={() => void save()}>{t('Simpan pengaturan', 'Save settings')}</Button>
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

        {tab === 'pemakaian' && <UsagePanel />}

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
            <Card tone="danger" title={t('Hapus akun', 'Delete account')} description={account?.mkl.linked ? t('Akun yang terhubung ke MKL tidak dapat dihapus sampai alur pemulihan dan unlink aman tersedia.', 'An MKL-linked account cannot be deleted until the safe recovery and unlink flow is available.') : t('Menghapus akun, semua dokumen, versi, dan salinan lokal secara permanen.', 'Permanently deletes your account, documents, versions, and local copies.')}>
              {!account?.mkl.linked && <Button variant="danger" icon={Trash2} onClick={() => { setConfirmText(''); setConfirmDelete(true); }}>{t('Hapus akun saya', 'Delete my account')}</Button>}
            </Card>
          </div>
        )}
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
