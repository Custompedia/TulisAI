'use client';
import { useState } from 'react';
import { UserPlus } from 'lucide-react';
import { useLocale } from '@/lib/client/locale';
import { errorText, newKey, request } from '@/lib/client/api';
import { useSessionGuard } from '@/components/app/AppShell';
import { Button } from '@/components/ui/Button';
import { Alert } from '@/components/ui/Alert';
import { FieldLabel, inputClass } from '@/components/ui/Field';
import { HintSelect } from '@/components/ui/HintSelect';
import { Modal } from '@/components/ui/Modal';
import { TIERS, tierLabel, type AdminSummary, type AdminUser, type Role, type Tier } from './admin-shared';

type Form = { name: string; email: string; username: string; password: string; role: Role; tier: Tier; emailVerified: boolean };
const EMPTY: Form = { name: '', email: '', username: '', password: '', role: 'user', tier: 'free', emailVerified: true };

export function CreateUserDialog({ summary, onClose, onCreated }: { summary: AdminSummary | null; onClose: () => void; onCreated: (user: AdminUser) => void }) {
  const { t, locale } = useLocale();
  const guard = useSessionGuard();
  const [form, setForm] = useState<Form>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((current) => ({ ...current, [key]: value }));
  const usernameOk = /^[a-z0-9._]{3,30}$/.test(form.username);
  const valid = form.name.trim().length > 0 && /\S+@\S+\.\S+/.test(form.email) && usernameOk && form.password.length >= 10 && form.password.length <= 128;
  const limits = summary?.tierLimits;

  async function submit() {
    if (!valid) return;
    setBusy(true); setError('');
    try { onCreated(await request<AdminUser>('/api/admin/users', 'POST', { ...form, name: form.name.trim(), email: form.email.trim().toLowerCase(), username: form.username.trim() }, newKey())); }
    catch (caught) { if (!guard(caught)) setError(errorText(caught, locale === 'en')); }
    finally { setBusy(false); }
  }

  return (
    <Modal title={t('Tambah pengguna', 'Add user')} description={t('Akun dibuat langsung tanpa email verifikasi. Bagikan password awal secara aman.', 'The account is created directly, without a verification email. Share the initial password securely.')} onClose={onClose} busy={busy}
      footer={<><Button disabled={busy} onClick={onClose}>{t('Batal', 'Cancel')}</Button><Button variant="primary" icon={UserPlus} loading={busy} disabled={!valid} onClick={() => void submit()}>{t('Buat akun', 'Create account')}</Button></>}>
      <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
        {error && <Alert tone="error" onDismiss={() => setError('')} dismissLabel={t('Tutup', 'Dismiss')}>{error}</Alert>}
        <div className="grid gap-4 sm:grid-cols-2">
          <div><FieldLabel htmlFor="new-name">{t('Nama', 'Name')}</FieldLabel><input id="new-name" className={inputClass} value={form.name} maxLength={100} onChange={(event) => set('name', event.target.value)} autoFocus /></div>
          <div><FieldLabel htmlFor="new-username">Username</FieldLabel><input id="new-username" className={inputClass} value={form.username} maxLength={30} onChange={(event) => set('username', event.target.value.toLowerCase())} aria-invalid={form.username.length > 0 && !usernameOk} /></div>
        </div>
        <div><FieldLabel htmlFor="new-email">Email</FieldLabel><input id="new-email" type="email" className={inputClass} value={form.email} maxLength={200} onChange={(event) => set('email', event.target.value)} /></div>
        <div><FieldLabel htmlFor="new-password" hint={t('10–128 karakter', '10–128 characters')}>{t('Password awal', 'Initial password')}</FieldLabel><input id="new-password" type="text" autoComplete="off" className={`${inputClass} font-mono`} value={form.password} maxLength={128} onChange={(event) => set('password', event.target.value)} /></div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div><FieldLabel htmlFor="new-role">Role</FieldLabel><HintSelect id="new-role" label="Role" value={form.role} onChange={(value) => set('role', value)} options={[{ value: 'user', label: 'User', hint: t('Akses biasa', 'Regular access') }, { value: 'admin', label: 'Admin', hint: t('Panel admin dan AI tanpa batas', 'Admin panel and unlimited AI') }]} /></div>
          <div><FieldLabel htmlFor="new-tier">Tier</FieldLabel><HintSelect id="new-tier" label="Tier" value={form.tier} onChange={(value) => set('tier', value)} options={TIERS.map((tier) => ({ value: tier, label: tierLabel(tier, t), hint: limits ? `${limits[tier]} ${t('permintaan AI / bulan', 'AI requests / month')}` : undefined }))} /></div>
        </div>
        <label className="flex cursor-pointer items-center gap-2.5 text-sm text-ink-800"><input type="checkbox" checked={form.emailVerified} onChange={(event) => set('emailVerified', event.target.checked)} className="h-4 w-4 accent-brand-600" />{t('Tandai email sudah terverifikasi', 'Mark email as verified')}</label>
      </form>
    </Modal>
  );
}
