'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ArrowUpRight, Gauge, LogOut, Save, ShieldCheck, SlidersHorizontal, Trash2, UserRound } from 'lucide-react';
import { delMany, keys } from 'idb-keyval';
import { useLocale } from '@/lib/client/locale';
import { errorText, newKey, request } from '@/lib/client/api';
import { AppShell, PageHeader, useSessionGuard, useShell, useSignOut, type UserSettings } from '@/components/app/AppShell';
import { Button } from '@/components/ui/Button';
import { FieldLabel, inputClass, Segmented, Select } from '@/components/ui/Field';
import { ConfirmDialog } from '@/components/ui/Modal';
import { contextOptions, MODES, modeLabel } from '@/components/writing/modes';
import { promptFor } from '@/lib/writing/settings';

export default function SettingsPage() {
  return <AppShell><SettingsView /></AppShell>;
}

function Section({ icon: Icon, title, description, children, tone = 'default' }: { icon: typeof UserRound; title: string; description?: string; children: React.ReactNode; tone?: 'default' | 'danger' }) {
  return (
    <section className={`rounded-2xl border bg-white ${tone === 'danger' ? 'border-red-200' : 'border-line'}`}>
      <header className="flex items-start gap-3 border-b border-line px-5 py-4 sm:px-6">
        <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${tone === 'danger' ? 'bg-red-50 text-red-600' : 'bg-brand-50 text-brand-700'}`}><Icon size={18} aria-hidden="true" /></span>
        <div><h2 className="font-semibold text-ink-900">{title}</h2>{description && <p className="mt-0.5 text-sm text-ink-500">{description}</p>}</div>
      </header>
      <div className="px-5 py-5 sm:px-6">{children}</div>
    </section>
  );
}

function SettingsView() {
  const { t, locale, setLocale } = useLocale();
  const router = useRouter();
  const guard = useSessionGuard();
  const { user, settings, usage, setSettings } = useShell();
  const { signOut, busy: signingOut } = useSignOut();
  const [form, setForm] = useState<UserSettings>(settings);
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [error, setError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);
  const dirty = JSON.stringify(form) !== JSON.stringify(settings);
  const keyword = t('HAPUS', 'DELETE');

  const change = <K extends keyof UserSettings>(key: K, value: UserSettings[K]) => { setForm({ ...form, [key]: value }); setStatus('idle'); };

  async function clearLocalDrafts() {
    const owned = (await keys()).filter((key) => String(key).startsWith(`writing-draft:${user.id}:`));
    await delMany(owned);
  }

  async function save() {
    setStatus('saving'); setError('');
    try {
      const saved = await request<UserSettings>('/api/settings', 'PATCH', form, newKey());
      if (!saved.localDrafts) await clearLocalDrafts().catch(() => undefined);
      setSettings(saved); setForm(saved); setLocale(saved.interfaceLanguage); setStatus('saved');
    } catch (caught) { if (!guard(caught)) setError(errorText(caught, locale === 'en')); setStatus('idle'); }
  }

  async function deleteAccount() {
    setDeleting(true);
    try {
      await clearLocalDrafts().catch(() => undefined);
      await request('/api/account', 'DELETE', undefined, newKey());
      router.replace('/'); router.refresh();
    } catch (caught) { if (!guard(caught)) setError(errorText(caught, locale === 'en')); setConfirmDelete(false); setDeleting(false); }
  }

  const initials = user.name.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase();
  const usedPercent = usage ? Math.min(100, Math.round((usage.requestsUsed / Math.max(1, usage.requestLimit)) * 100)) : 0;

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6 sm:py-12">
      <PageHeader title={t('Pengaturan', 'Settings')} description={t('Atur preferensi, pantau pemakaian, dan kelola data akunmu.', 'Manage preferences, usage, and your account data.')} />
      <div className="mt-7 space-y-5">
        <Section icon={UserRound} title={t('Profil', 'Profile')}>
          <div className="flex flex-wrap items-center gap-4">
            <span className="grid h-12 w-12 place-items-center rounded-full bg-ink-950 text-sm font-bold text-white">{initials}</span>
            <div className="min-w-0 flex-1"><p className="font-semibold text-ink-900">{user.name}</p><p className="truncate text-sm text-ink-500">{user.email}</p></div>
            <Button icon={LogOut} loading={signingOut} onClick={() => void signOut()}>{t('Keluar', 'Sign out')}</Button>
          </div>
        </Section>

        <Section icon={SlidersHorizontal} title={t('Preferensi menulis', 'Writing preferences')} description={t('Dipakai untuk tulisan baru. Dokumen lama tidak ikut berubah.', 'Used for new documents. Existing documents are not changed.')}>
          <div className="grid gap-5 sm:grid-cols-2">
            <div><FieldLabel>{t('Bahasa antarmuka', 'Interface language')}</FieldLabel><Segmented label={t('Bahasa antarmuka', 'Interface language')} value={form.interfaceLanguage} onChange={(value) => change('interfaceLanguage', value)} options={[{ value: 'id', label: 'Indonesia' }, { value: 'en', label: 'English' }]} /></div>
            <div><FieldLabel>{t('Bahasa tulisan default', 'Default writing language')}</FieldLabel><Segmented label={t('Bahasa tulisan default', 'Default writing language')} value={form.writingLanguage} onChange={(value) => change('writingLanguage', value)} options={[{ value: 'auto', label: 'Auto' }, { value: 'id', label: 'Indonesia' }, { value: 'en', label: 'English' }]} /></div>
            <div><FieldLabel htmlFor="default-mode">{t('Mode default', 'Default mode')}</FieldLabel><Select id="default-mode" value={form.defaultMode} onChange={(value) => change('defaultMode', value)} options={MODES.map((mode) => ({ value: promptFor[mode], label: modeLabel(mode, t) }))} /></div>
            <div><FieldLabel htmlFor="use-case">{t('Kebutuhan utama', 'Primary use')}</FieldLabel><Select id="use-case" value={form.primaryUseCase} onChange={(value) => change('primaryUseCase', value as UserSettings['primaryUseCase'])} options={contextOptions(t)} /></div>
            <div className="sm:col-span-2"><FieldLabel>{t('Konteks Humanize default', 'Default Humanize context')}</FieldLabel><Segmented label={t('Konteks Humanize default', 'Default Humanize context')} value={form.humanizerContext} onChange={(value) => change('humanizerContext', value)} options={contextOptions(t) as Array<{ value: UserSettings['humanizerContext']; label: string }>} /></div>
          </div>
        </Section>

        <Section icon={ShieldCheck} title={t('Privasi & data', 'Privacy & data')}>
          <ul className="space-y-2 text-sm text-ink-600">
            <li>• {t('Dokumen dan versi bersifat privat dan disimpan sampai kamu menghapusnya.', 'Documents and versions are private and kept until you delete them.')}</li>
            <li>• {t('Pratinjau AI otomatis dibersihkan setelah 24 jam.', 'AI previews are cleared automatically after 24 hours.')}</li>
            <li>• {t('Isi tulisan tidak dicatat di log atau analitik; penyedia AI diminta tidak menyimpan data.', 'Your text is never written to logs or analytics; the AI provider is asked not to retain data.')}</li>
          </ul>
          <label className="mt-5 flex cursor-pointer items-start gap-3 rounded-xl border border-line bg-paper/50 p-4">
            <input type="checkbox" checked={form.localDrafts} onChange={(event) => change('localDrafts', event.target.checked)} className="mt-0.5 h-4 w-4 accent-brand-600" />
            <span><span className="block text-sm font-semibold text-ink-900">{t('Simpan salinan pemulihan di perangkat ini', 'Keep recovery copies on this device')}</span><span className="block text-[13px] text-ink-500">{t('Melindungi tulisan saat koneksi atau penyimpanan gagal. Mematikannya menghapus salinan lokal.', 'Protects writing when saving fails. Turning it off removes local copies.')}</span></span>
          </label>
          <Link href="/documents" className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-brand-700 hover:text-brand-800">{t('Kelola & hapus dokumen', 'Manage & delete documents')}<ArrowUpRight size={15} /></Link>
        </Section>

        <div className="sticky bottom-4 z-10 flex flex-wrap items-center justify-end gap-3 rounded-2xl border border-line bg-white/95 px-5 py-3 shadow-lg backdrop-blur">
          {error && <p role="alert" className="mr-auto text-sm text-red-700">{error}</p>}
          {status === 'saved' && !dirty && <p role="status" className="mr-auto text-sm font-medium text-emerald-700">{t('Pengaturan tersimpan.', 'Settings saved.')}</p>}
          {dirty && status !== 'saving' && <p className="mr-auto text-sm text-ink-500">{t('Ada perubahan yang belum disimpan.', 'You have unsaved changes.')}</p>}
          <Button disabled={!dirty || status === 'saving'} onClick={() => { setForm(settings); setStatus('idle'); }}>{t('Batalkan', 'Discard')}</Button>
          <Button variant="primary" icon={Save} loading={status === 'saving'} disabled={!dirty} onClick={() => void save()}>{t('Simpan pengaturan', 'Save settings')}</Button>
        </div>

        <Section icon={Gauge} title={t('Pemakaian AI', 'AI usage')} description={usage ? `${t('Periode', 'Period')} ${usage.period} (UTC)` : undefined}>
          {usage ? (
            <>
              <div className="flex items-end justify-between"><p className="text-3xl font-bold text-ink-950">{usage.requestsUsed}<span className="text-base font-medium text-ink-400"> / {usage.requestLimit}</span></p><p className="text-sm text-ink-500">{usage.requestsRemaining} {t('tersisa', 'remaining')}</p></div>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-paper-deep"><div className={`h-full rounded-full ${usedPercent >= 90 ? 'bg-amber-500' : 'bg-brand-600'}`} style={{ width: `${usedPercent}%` }} /></div>
              <p className="mt-3 text-[13px] text-ink-500">{t('Termasuk perbaikan otomatis dan percobaan yang gagal. Mengetik, riwayat, dan perbandingan tidak dihitung.', 'Includes automatic repairs and failed attempts. Typing, history, and comparisons are never counted.')}</p>
            </>
          ) : <p className="text-sm text-ink-500">{t('Data pemakaian belum tersedia.', 'Usage data is unavailable.')}</p>}
        </Section>

        <Section icon={Trash2} tone="danger" title={t('Hapus akun', 'Delete account')} description={t('Menghapus akun, semua dokumen, versi, dan salinan lokal secara permanen.', 'Permanently deletes your account, documents, versions, and local copies.')}>
          <Button variant="danger" icon={Trash2} onClick={() => { setConfirmText(''); setConfirmDelete(true); }}>{t('Hapus akun saya', 'Delete my account')}</Button>
        </Section>
      </div>

      {confirmDelete && (
        <ConfirmDialog title={t('Hapus akun secara permanen?', 'Permanently delete account?')} tone="danger" busy={deleting} disabled={confirmText.trim().toUpperCase() !== keyword} confirmLabel={t('Hapus permanen', 'Delete permanently')} onClose={() => setConfirmDelete(false)} onConfirm={() => void deleteAccount()}>
          <p>{t('Semua dokumen, versi, dan pratinjau akan hilang dan tidak bisa dipulihkan.', 'All documents, versions, and previews will be lost and cannot be recovered.')}</p>
          <label className="mt-4 block text-[13px] font-semibold text-ink-700">{t(`Ketik ${keyword} untuk konfirmasi`, `Type ${keyword} to confirm`)}<input className={`${inputClass} mt-1.5`} value={confirmText} onChange={(event) => setConfirmText(event.target.value)} autoComplete="off" /></label>
        </ConfirmDialog>
      )}
    </main>
  );
}
