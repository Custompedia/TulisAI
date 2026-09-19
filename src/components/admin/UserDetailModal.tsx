'use client';
import { useCallback, useEffect, useState } from 'react';
import { Ban, CircleCheck, KeyRound, LogOut, RotateCw, Save, ShieldCheck, Trash2, TriangleAlert } from 'lucide-react';
import { useLocale } from '@/lib/client/locale';
import { errorText, newKey, request } from '@/lib/client/api';
import { dateTime, numberFormat, relativeTime } from '@/lib/client/format';
import { useSessionGuard, useShell } from '@/components/app/AppShell';
import { Avatar } from '@/components/ui/Avatar';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { FieldLabel, inputClass } from '@/components/ui/Field';
import { HintSelect } from '@/components/ui/HintSelect';
import { ConfirmDialog, Modal } from '@/components/ui/Modal';
import { Spinner } from '@/components/ui/Spinner';
import { actionLabel, detailSummary, operationLabel, shortId, statusLabel, TIERS, tierLabel, type AdminSummary, type AdminUser, type Role, type SessionEntry, type Tier, type UsageEntry, type UserDetail } from './admin-shared';

type Tab = 'overview' | 'settings' | 'log' | 'sessions' | 'account';
type Props = { userId: string; summary: AdminSummary | null; onClose: () => void; onChange: (user: AdminUser) => void; onDeleted: (id: string) => void; notify: (notice: { tone: 'success' | 'error'; message: string }) => void };
type Form = { name: string; emailVerified: boolean; role: Role; tier: Tier; aiLimitOverride: string; aiCharacterLimitOverride: string; adminNote: string };
type Confirm = { kind: 'role'; role: Role } | { kind: 'ban' } | { kind: 'unban' } | { kind: 'password' } | { kind: 'revoke-all' } | { kind: 'delete' };

const formOf = (user: AdminUser): Form => ({ name: user.name, emailVerified: user.emailVerified, role: user.role, tier: user.tier, aiLimitOverride: user.aiLimitOverride === null ? '' : String(user.aiLimitOverride), aiCharacterLimitOverride: user.aiCharacterLimitOverride === null ? '' : String(user.aiCharacterLimitOverride), adminNote: user.adminNote ?? '' });

export function StatusBadge({ user, t }: { user: AdminUser; t: (id: string, en: string) => string }) {
  return user.banned
    ? <span className="inline-flex items-center gap-1 rounded-md bg-red-50 px-2 py-0.5 text-[11px] font-semibold text-red-700 ring-1 ring-red-100"><Ban size={11} aria-hidden="true" />{t('Nonaktif', 'Disabled')}</span>
    : <span className="inline-flex items-center gap-1 rounded-md bg-brand-50 px-2 py-0.5 text-[11px] font-semibold text-brand-800 ring-1 ring-brand-100"><CircleCheck size={11} aria-hidden="true" />{t('Aktif', 'Active')}</span>;
}
export function RoleBadge({ role }: { role: Role }) {
  return role === 'admin'
    ? <span className="inline-flex items-center gap-1 rounded-md bg-ink-900 px-2 py-0.5 text-[11px] font-semibold text-white"><ShieldCheck size={11} aria-hidden="true" />Admin</span>
    : <span className="inline-flex items-center rounded-md bg-paper-deep px-2 py-0.5 text-[11px] font-semibold text-ink-600">User</span>;
}
export function TierBadge({ tier, t }: { tier: Tier; t: (id: string, en: string) => string }) {
  const tone = { free: 'bg-paper-deep text-ink-600', plus: 'bg-mode-blue-light text-mode-blue-ink', pro: 'bg-mode-gold-light text-mode-gold-ink', max: 'bg-mode-slate-light text-mode-slate-ink' }[tier];
  return <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-semibold ${tone}`}>{tierLabel(tier, t)}</span>;
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="min-w-0"><p className="text-[12px] text-ink-500">{label}</p><div className="mt-0.5 break-words text-[14px] font-medium text-ink-900">{children}</div></div>;
}
function Section({ title, description, children, tone = 'default' }: { title: string; description?: string; children: React.ReactNode; tone?: 'default' | 'danger' }) {
  return (
    <section className={`rounded-xl border p-4 ${tone === 'danger' ? 'border-red-200 bg-red-50/40' : 'border-line bg-paper/40'}`}>
      <h4 className={`text-[14px] font-semibold ${tone === 'danger' ? 'text-red-800' : 'text-ink-900'}`}>{title}</h4>
      {description && <p className="mt-0.5 text-[12.5px] text-ink-500">{description}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}

export function UserDetailModal({ userId, summary, onClose, onChange, onDeleted, notify }: Props) {
  const { t, locale } = useLocale();
  const en = locale === 'en';
  const guard = useSessionGuard();
  const { user: me } = useShell();
  const [tab, setTab] = useState<Tab>('overview');
  const [detail, setDetail] = useState<UserDetail | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [busy, setBusy] = useState<'' | 'save' | 'action' | 'delete'>('');
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [banReason, setBanReason] = useState('');
  const [banDays, setBanDays] = useState<'0' | '7' | '30' | '90'>('0');
  const [password, setPassword] = useState('');
  const [deleteText, setDeleteText] = useState('');
  const [log, setLog] = useState<{ items: UsageEntry[]; nextCursor: string | null } | null>(null);
  const [logBusy, setLogBusy] = useState(false);
  const [formError, setFormError] = useState('');
  const self = userId === me.id;
  const user = detail?.user ?? null;

  const load = useCallback(async () => {
    setLoadError(null);
    try { const next = await request<UserDetail>(`/api/admin/users/${userId}`); setDetail(next); setForm((current) => current ?? formOf(next.user)); }
    catch (caught) { if (!guard(caught)) setLoadError(caught); }
  }, [guard, userId]);
  useEffect(() => { void load(); }, [load]);

  const loadLog = useCallback(async (cursor?: string) => {
    setLogBusy(true);
    try { const next = await request<{ items: UsageEntry[]; nextCursor: string | null }>(`/api/admin/users/${userId}/log${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`); setLog((current) => cursor && current ? { ...next, items: [...current.items, ...next.items] } : next); }
    catch (caught) { if (!guard(caught)) notify({ tone: 'error', message: errorText(caught, en) }); }
    finally { setLogBusy(false); }
  }, [en, guard, notify, userId]);
  useEffect(() => { if (tab === 'log' && log === null) void loadLog(); }, [tab, log, loadLog]);

  const applyUser = (next: AdminUser) => { setDetail((current) => (current ? { ...current, user: next } : current)); setForm(formOf(next)); onChange(next); };

  // roleDone: the role change already ran through its own confirm, so this pass only saves the rest.
  async function save(roleDone = false) {
    if (!form || !user) return;
    const override = form.aiLimitOverride.trim() === '' ? null : Number(form.aiLimitOverride);
    const characterOverride = form.aiCharacterLimitOverride.trim() === '' ? null : Number(form.aiCharacterLimitOverride);
    if (override !== null && (!Number.isInteger(override) || override < 1)) { setFormError(t('Batas khusus harus bilangan bulat positif.', 'The custom limit must be a positive whole number.')); return; }
    if (!roleDone && form.role !== user.role) { setConfirm({ kind: 'role', role: form.role }); return; }
    const patch: Record<string, unknown> = {};
    if (form.name.trim() !== user.name) patch.name = form.name.trim();
    if (form.emailVerified !== user.emailVerified) patch.emailVerified = form.emailVerified;
    if (form.tier !== user.tier) patch.tier = form.tier;
    if (override !== user.aiLimitOverride) patch.aiLimitOverride = override;
    if (characterOverride !== user.aiCharacterLimitOverride) patch.aiCharacterLimitOverride = characterOverride;
    if ((form.adminNote.trim() || null) !== (user.adminNote ?? null)) patch.adminNote = form.adminNote.trim() || null;
    if (!Object.keys(patch).length) return;
    setBusy('save'); setFormError('');
    try { applyUser(await request<AdminUser>(`/api/admin/users/${userId}`, 'PATCH', patch, newKey())); notify({ tone: 'success', message: t('Perubahan tersimpan.', 'Changes saved.') }); await load(); }
    catch (caught) { if (!guard(caught)) setFormError(errorText(caught, en)); }
    finally { setBusy(''); }
  }

  async function act(body: Record<string, unknown>, success: string) {
    setBusy('action');
    try { applyUser(await request<AdminUser>(`/api/admin/users/${userId}/actions`, 'POST', body, newKey())); notify({ tone: 'success', message: success }); setConfirm(null); await load(); return true; }
    catch (caught) { if (!guard(caught)) notify({ tone: 'error', message: errorText(caught, en) }); return false; }
    finally { setBusy(''); }
  }

  async function runConfirm() {
    if (!confirm || !user) return;
    if (confirm.kind === 'role') { const ok = await act({ action: 'set-role', role: confirm.role }, confirm.role === 'admin' ? t(`${user.name} sekarang admin.`, `${user.name} is now an admin.`) : t(`Role admin ${user.name} dicabut.`, `${user.name} is no longer an admin.`)); if (ok) { await save(true); } return; }
    if (confirm.kind === 'ban') { const ok = await act({ action: 'ban', reason: banReason.trim(), expiresInDays: banDays === '0' ? null : Number(banDays) }, t('Akun dinonaktifkan dan semua sesinya dicabut.', 'Account disabled and all its sessions revoked.')); if (ok) { setBanReason(''); setBanDays('0'); } return; }
    if (confirm.kind === 'unban') { await act({ action: 'unban' }, t('Akun diaktifkan kembali.', 'Account enabled again.')); return; }
    if (confirm.kind === 'password') { const ok = await act({ action: 'set-password', newPassword: password }, t('Password diganti dan semua sesi dicabut.', 'Password set and all sessions revoked.')); if (ok) setPassword(''); return; }
    if (confirm.kind === 'revoke-all') { await act({ action: 'revoke-sessions' }, t('Semua sesi dicabut.', 'All sessions revoked.')); return; }
    if (confirm.kind === 'delete') {
      setBusy('delete');
      try { await request(`/api/admin/users/${userId}`, 'DELETE', undefined, newKey()); notify({ tone: 'success', message: t(`Akun ${user.email} dihapus.`, `Account ${user.email} deleted.`) }); onDeleted(userId); onClose(); }
      catch (caught) { if (!guard(caught)) notify({ tone: 'error', message: errorText(caught, en) }); setConfirm(null); }
      finally { setBusy(''); }
    }
  }

  async function revokeSession(session: SessionEntry) {
    await act({ action: 'revoke-sessions', sessionToken: session.token }, t('Sesi dicabut.', 'Session revoked.'));
  }

  const tabs: Array<{ id: Tab; label: string }> = [
    { id: 'overview', label: t('Ringkasan', 'Overview') }, { id: 'settings', label: t('Pengaturan', 'Settings') }, { id: 'log', label: t('Log AI', 'AI log') }, { id: 'sessions', label: t('Sesi', 'Sessions') }, { id: 'account', label: t('Akun', 'Account') },
  ];
  const limitText = (value: AdminUser) => (value.unlimited ? '∞' : numberFormat(value.requestLimit, locale));
  const dirty = !!user && !!form && JSON.stringify(form) !== JSON.stringify(formOf(user));
  const confirmTitle: Record<Confirm['kind'], string> = { role: t('Ubah role?', 'Change role?'), ban: t('Nonaktifkan akun?', 'Disable account?'), unban: t('Aktifkan akun?', 'Enable account?'), password: t('Ganti password?', 'Set new password?'), 'revoke-all': t('Cabut semua sesi?', 'Revoke all sessions?'), delete: t('Hapus akun secara permanen?', 'Permanently delete account?') };

  return (
    <Modal title={user ? user.name : t('Detail pengguna', 'User details')} description={user ? `${user.email}${user.username ? ` · @${user.username}` : ''}` : undefined} size="2xl" onClose={onClose} busy={busy !== ''}
      footer={tab === 'settings' && user ? <><span className="mr-auto text-xs text-ink-500">{dirty ? t('Ada perubahan yang belum disimpan.', 'You have unsaved changes.') : t('Semua tersimpan.', 'Everything is saved.')}</span><Button disabled={!dirty || busy !== ''} onClick={() => setForm(formOf(user))}>{t('Batalkan', 'Discard')}</Button><Button variant="primary" icon={Save} loading={busy === 'save'} disabled={!dirty} onClick={() => void save()}>{t('Simpan perubahan', 'Save changes')}</Button></> : undefined}>
      {!user ? (
        loadError ? <Alert tone="error" actions={<Button size="sm" icon={RotateCw} onClick={() => void load()}>{t('Coba lagi', 'Retry')}</Button>}>{errorText(loadError, en)}</Alert>
          : <div role="status" className="flex min-h-[68dvh] items-center justify-center gap-2 text-sm text-ink-500"><Spinner size={16} />{t('Memuat detail…', 'Loading details…')}</div>
      ) : (
        <div className="min-h-[68dvh] space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <Avatar name={user.name} image={user.image} size={44} />
            <div className="flex flex-wrap items-center gap-1.5"><RoleBadge role={user.role} /><TierBadge tier={user.tier} t={t} /><StatusBadge user={user} t={t} />{!user.emailVerified && <span className="inline-flex items-center rounded-md bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800 ring-1 ring-amber-100">{t('Email belum verifikasi', 'Email unverified')}</span>}{self && <span className="text-[11px] font-medium text-ink-500">({t('akun kamu', 'your account')})</span>}</div>
          </div>
          {user.banned && <Alert tone="warning" title={t('Akun nonaktif', 'Account disabled')}>{user.banReason || t('Tanpa alasan tercatat.', 'No reason recorded.')} {user.banExpires ? t(`Aktif kembali otomatis ${dateTime(user.banExpires, locale)}.`, `Re-enables automatically on ${dateTime(user.banExpires, locale)}.`) : t('Permanen sampai diaktifkan admin.', 'Permanent until an admin enables it.')}</Alert>}

          <div role="tablist" aria-label={t('Bagian detail', 'Detail sections')} className="flex gap-1 overflow-x-auto border-b border-line">
            {tabs.map((item) => <button key={item.id} type="button" role="tab" aria-selected={tab === item.id} onClick={() => setTab(item.id)} className={`relative shrink-0 px-3 py-2 text-[13px] font-medium transition-colors ${tab === item.id ? 'text-ink-900 after:absolute after:inset-x-2 after:-bottom-px after:h-0.5 after:rounded-full after:bg-brand-700' : 'text-ink-500 hover:text-ink-900'}`}>{item.label}</button>)}
          </div>

          {tab === 'overview' && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3 lg:grid-cols-4">
                <Fact label="ID"><span className="font-mono text-[12px]" title={user.id}>{shortId(user.id)}</span></Fact>
                <Fact label={t('Bergabung', 'Joined')}>{dateTime(user.createdAt, locale)}</Fact>
                <Fact label={t('Terakhir aktif', 'Last active')}>{user.lastActiveAt ? relativeTime(user.lastActiveAt, locale) : '—'}</Fact>
                <Fact label="Notebook">{numberFormat(user.documents, locale)}</Fact>
                <Fact label={user.characterScope === 'account' ? t('Karakter AI (jatah sekali pakai)', 'AI characters (one-time allowance)') : t('Karakter AI bulan ini', 'AI characters this month')}>{numberFormat(user.charactersUsed, locale)} / {user.unlimited ? '∞' : numberFormat(user.characterLimit, locale)}</Fact>
                <Fact label={t('Permintaan bulan ini', 'Requests this month')}>{numberFormat(user.requestsThisMonth, locale)} / {limitText(user)}</Fact>
                <Fact label={t('Gagal bulan ini', 'Failed this month')}>{numberFormat(user.failedThisMonth, locale)}</Fact>
                <Fact label={t('Token bulan ini', 'Tokens this month')}>{numberFormat(user.tokensThisMonth, locale)}</Fact>
                <Fact label={t('Batas efektif', 'Effective limit')}>{user.unlimited ? t('Tanpa batas (admin)', 'Unlimited (admin)') : user.aiLimitOverride ? t(`${numberFormat(user.aiLimitOverride, locale)} (khusus)`, `${numberFormat(user.aiLimitOverride, locale)} (custom)`) : t(`${numberFormat(user.requestLimit, locale)} (tier ${tierLabel(user.tier, t)})`, `${numberFormat(user.requestLimit, locale)} (${tierLabel(user.tier, t)} tier)`)}</Fact>
              </div>
              {user.adminNote && <Section title={t('Catatan admin', 'Admin note')}><p className="whitespace-pre-wrap text-[13px] text-ink-700">{user.adminNote}</p></Section>}
              <Section title={t('Riwayat tindakan admin', 'Admin action history')} description={t('Tindakan admin terhadap akun ini.', 'Admin actions taken on this account.')}>
                {detail!.history.length === 0 ? <p className="text-[13px] text-ink-500">{t('Belum ada tindakan.', 'No actions yet.')}</p> : (
                  <ul className="divide-y divide-line">{detail!.history.map((entry) => <li key={entry.id} className="flex flex-wrap items-baseline gap-x-2 py-2 text-[13px]"><span className="font-medium text-ink-900">{actionLabel(entry.action, t)}</span><span className="text-ink-500">{detailSummary(entry, t)}</span><span className="ml-auto text-[12px] text-ink-400" title={dateTime(entry.createdAt, locale)}>{entry.actorName ?? shortId(entry.actorId)} · {relativeTime(entry.createdAt, locale)}</span></li>)}</ul>
                )}
              </Section>
            </div>
          )}

          {tab === 'settings' && form && (
            <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); void save(); }}>
              {formError && <Alert tone="error" onDismiss={() => setFormError('')} dismissLabel={t('Tutup', 'Dismiss')}>{formError}</Alert>}
              <div className="grid gap-4 sm:grid-cols-2">
                <div><FieldLabel htmlFor="u-name">{t('Nama', 'Name')}</FieldLabel><input id="u-name" className={inputClass} value={form.name} maxLength={100} onChange={(event) => setForm({ ...form, name: event.target.value })} /></div>
                <div><FieldLabel htmlFor="u-role" hint={self ? t('role sendiri terkunci', 'own role is locked') : undefined}>Role</FieldLabel><HintSelect id="u-role" label="Role" value={form.role} disabled={self} onChange={(value) => setForm({ ...form, role: value })} options={[{ value: 'user', label: 'User', hint: t('Akses biasa, ikut batas tier', 'Regular access, tier limits apply') }, { value: 'admin', label: 'Admin', hint: t('Panel admin dan AI tanpa batas', 'Admin panel and unlimited AI') }]} /></div>
                <div><FieldLabel htmlFor="u-tier">Tier</FieldLabel><HintSelect id="u-tier" label="Tier" value={form.tier} onChange={(value) => setForm({ ...form, tier: value })} options={TIERS.map((tier) => ({ value: tier, label: tierLabel(tier, t), hint: summary ? `${numberFormat(summary.tierLimits[tier], locale)} ${t('permintaan AI / bulan', 'AI requests / month')}` : undefined }))} /></div>
                <div><FieldLabel htmlFor="u-chars" hint={t('kosong = ikut tier', 'empty = follow tier')}>{t('Kuota karakter khusus / bulan', 'Custom character quota / month')}</FieldLabel><input id="u-chars" type="number" min={1} step={1000} inputMode="numeric" className={inputClass} value={form.aiCharacterLimitOverride} placeholder={summary ? String(summary.tierCharacterLimits[form.tier]) : ''} onChange={(event) => setForm({ ...form, aiCharacterLimitOverride: event.target.value })} /></div>
                <div><FieldLabel htmlFor="u-limit" hint={t('kosong = ikut tier', 'empty = follow tier')}>{t('Batas permintaan khusus / bulan', 'Custom request limit / month')}</FieldLabel><input id="u-limit" type="number" min={1} step={1} inputMode="numeric" className={inputClass} value={form.aiLimitOverride} placeholder={summary ? String(summary.tierLimits[form.tier]) : ''} onChange={(event) => setForm({ ...form, aiLimitOverride: event.target.value })} /></div>
              </div>
              <label className="flex cursor-pointer items-center gap-2.5 text-sm text-ink-800"><input type="checkbox" checked={form.emailVerified} onChange={(event) => setForm({ ...form, emailVerified: event.target.checked })} className="h-4 w-4 accent-brand-600" />{t('Email sudah terverifikasi', 'Email is verified')}</label>
              <div><FieldLabel htmlFor="u-note" hint={t('hanya terlihat oleh admin', 'visible to admins only')}>{t('Catatan admin', 'Admin note')}</FieldLabel><textarea id="u-note" rows={3} maxLength={500} className={`${inputClass} h-auto py-2`} value={form.adminNote} onChange={(event) => setForm({ ...form, adminNote: event.target.value })} /></div>
            </form>
          )}

          {tab === 'log' && (
            <div>
              {log === null ? <div role="status" className="flex items-center gap-2 py-6 text-sm text-ink-500"><Spinner size={16} />{t('Memuat log…', 'Loading log…')}</div>
                : log.items.length === 0 ? <p className="py-6 text-center text-sm text-ink-500">{t('Belum ada permintaan AI dari akun ini.', 'No AI requests from this account yet.')}</p>
                  : (
                    <div className="overflow-x-auto rounded-xl border border-line">
                      <table className="w-full min-w-[640px] text-[13px]">
                        <thead className="bg-paper/60 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-500"><tr><th className="px-3 py-2 text-left">{t('Waktu', 'Time')}</th><th className="px-3 py-2 text-left">{t('Operasi', 'Operation')}</th><th className="px-3 py-2 text-left">Prompt</th><th className="px-3 py-2 text-left">Status</th><th className="px-3 py-2 text-right">{t('Karakter', 'Chars')}</th><th className="px-3 py-2 text-right">Token</th><th className="px-3 py-2 text-right">{t('Latensi', 'Latency')}</th></tr></thead>
                        <tbody className="divide-y divide-line">
                          {log.items.map((entry) => (
                            <tr key={entry.id}>
                              <td className="px-3 py-2 text-ink-700" title={dateTime(entry.createdAt, locale)}>{relativeTime(entry.createdAt, locale)}</td>
                              <td className="px-3 py-2 text-ink-900">{operationLabel(entry.operation, t)}</td>
                              <td className="px-3 py-2 font-mono text-[12px] text-ink-600">{entry.promptId ?? '—'}</td>
                              <td className="px-3 py-2"><span className={`inline-flex rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${entry.status === 'failed' ? 'bg-red-50 text-red-700' : entry.status === 'reserved' ? 'bg-amber-50 text-amber-800' : 'bg-brand-50 text-brand-800'}`}>{statusLabel(entry.status, t)}</span>{entry.errorCode && <span className="ml-1.5 font-mono text-[11px] text-red-700">{entry.errorCode}</span>}</td>
                              <td className="px-3 py-2 text-right tabular-nums text-ink-700">{entry.sourceCharacters === null ? '—' : numberFormat(entry.sourceCharacters, locale)}</td>
                              <td className="px-3 py-2 text-right tabular-nums text-ink-700">{entry.inputTokens === null && entry.outputTokens === null ? '—' : numberFormat((entry.inputTokens ?? 0) + (entry.outputTokens ?? 0), locale)}</td>
                              <td className="px-3 py-2 text-right tabular-nums text-ink-700">{entry.latencyMs === null ? '—' : `${numberFormat(entry.latencyMs, locale)} ms`}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
              {log?.nextCursor && <div className="mt-3 text-center"><Button size="sm" loading={logBusy} onClick={() => void loadLog(log.nextCursor!)}>{t('Muat lebih banyak', 'Load more')}</Button></div>}
            </div>
          )}

          {tab === 'sessions' && (
            <div className="space-y-3">
              {detail!.sessions.length === 0 ? <p className="py-6 text-center text-sm text-ink-500">{t('Tidak ada sesi aktif.', 'No active sessions.')}</p> : (
                <ul className="divide-y divide-line rounded-xl border border-line">
                  {detail!.sessions.map((session) => (
                    <li key={session.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5 text-[13px]">
                      <div className="min-w-0 flex-1"><p className="truncate font-medium text-ink-900">{session.userAgent || t('Perangkat tidak dikenal', 'Unknown device')}</p><p className="text-[12px] text-ink-500">{session.ipAddress ?? '—'} · {t('mulai', 'started')} {relativeTime(session.createdAt, locale)} · {t('berakhir', 'expires')} {dateTime(session.expiresAt, locale)}</p></div>
                      <Button size="sm" icon={LogOut} disabled={busy !== ''} onClick={() => void revokeSession(session)}>{t('Cabut', 'Revoke')}</Button>
                    </li>
                  ))}
                </ul>
              )}
              {detail!.sessions.length > 0 && <Button size="sm" variant="secondary" icon={LogOut} disabled={busy !== ''} onClick={() => setConfirm({ kind: 'revoke-all' })}>{t('Cabut semua sesi', 'Revoke all sessions')}</Button>}
            </div>
          )}

          {tab === 'account' && (
            <div className="space-y-4">
              {user.banned ? (
                <Section title={t('Aktifkan kembali', 'Enable again')} description={t('Pengguna bisa masuk lagi dan memakai AI sesuai tier-nya.', 'The user can sign in again and use AI according to their tier.')}>
                  <Button variant="primary" icon={CircleCheck} disabled={busy !== ''} onClick={() => setConfirm({ kind: 'unban' })}>{t('Aktifkan akun', 'Enable account')}</Button>
                </Section>
              ) : (
                <Section title={t('Nonaktifkan akun', 'Disable account')} description={t('Pengguna langsung keluar dari semua perangkat dan tidak bisa masuk. Data tetap tersimpan.', 'The user is signed out everywhere and cannot sign in. Data is kept.')}>
                  <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_160px]">
                    <div><FieldLabel htmlFor="ban-reason">{t('Alasan (wajib)', 'Reason (required)')}</FieldLabel><input id="ban-reason" className={inputClass} maxLength={300} value={banReason} onChange={(event) => setBanReason(event.target.value)} placeholder={t('Mis. pelanggaran ketentuan', 'E.g. terms violation')} /></div>
                    <div><FieldLabel htmlFor="ban-days">{t('Durasi', 'Duration')}</FieldLabel><HintSelect id="ban-days" label={t('Durasi', 'Duration')} value={banDays} onChange={setBanDays} options={[{ value: '0', label: t('Permanen', 'Permanent') }, { value: '7', label: t('7 hari', '7 days') }, { value: '30', label: t('30 hari', '30 days') }, { value: '90', label: t('90 hari', '90 days') }]} /></div>
                  </div>
                  <Button className="mt-3" variant="danger" icon={Ban} disabled={self || busy !== '' || !banReason.trim()} title={self ? t('Akun sendiri tidak bisa dinonaktifkan.', 'You cannot disable your own account.') : undefined} onClick={() => setConfirm({ kind: 'ban' })}>{t('Nonaktifkan akun', 'Disable account')}</Button>
                </Section>
              )}
              <Section title={t('Ganti password', 'Set new password')} description={t('Semua sesi pengguna dicabut setelah password diganti.', 'All of the user’s sessions are revoked after the password changes.')}>
                <div className="flex flex-wrap items-end gap-3">
                  <div className="min-w-0 flex-1"><FieldLabel htmlFor="new-pass" hint={t('10–128 karakter', '10–128 characters')}>{t('Password baru', 'New password')}</FieldLabel><input id="new-pass" type="text" autoComplete="off" className={`${inputClass} font-mono`} maxLength={128} value={password} onChange={(event) => setPassword(event.target.value)} /></div>
                  <Button icon={KeyRound} disabled={busy !== '' || password.length < 10} onClick={() => setConfirm({ kind: 'password' })}>{t('Ganti password', 'Set password')}</Button>
                </div>
              </Section>
              <Section tone="danger" title={t('Hapus akun', 'Delete account')} description={t('Menghapus akun, semua notebook, versi, dan catatan pemakaian secara permanen.', 'Permanently deletes the account, every notebook, version, and usage record.')}>
                <Button variant="danger" icon={Trash2} disabled={self || user.role === 'admin' || busy !== ''} title={self ? t('Akun sendiri tidak bisa dihapus dari sini.', 'You cannot delete your own account here.') : user.role === 'admin' ? t('Cabut role admin dulu.', 'Remove the admin role first.') : undefined} onClick={() => { setDeleteText(''); setConfirm({ kind: 'delete' }); }}>{t('Hapus akun ini', 'Delete this account')}</Button>
              </Section>
            </div>
          )}
        </div>
      )}

      {confirm && user && (
        <ConfirmDialog title={confirmTitle[confirm.kind]} tone={confirm.kind === 'delete' || confirm.kind === 'ban' ? 'danger' : 'primary'} busy={busy !== ''} disabled={confirm.kind === 'delete' && deleteText.trim().toLowerCase() !== user.email.toLowerCase()}
          confirmLabel={{ role: t('Ya, ubah role', 'Yes, change role'), ban: t('Ya, nonaktifkan', 'Yes, disable'), unban: t('Ya, aktifkan', 'Yes, enable'), password: t('Ya, ganti', 'Yes, set it'), 'revoke-all': t('Ya, cabut semua', 'Yes, revoke all'), delete: t('Hapus permanen', 'Delete permanently') }[confirm.kind]} onClose={() => setConfirm(null)} onConfirm={() => void runConfirm()}>
          {confirm.kind === 'role' && <p><b className="text-ink-900">{user.name}</b> {confirm.role === 'admin' ? t('akan bisa membuka panel ini, mengubah pengguna lain, dan memakai AI tanpa batas bulanan.', 'will be able to open this panel, manage other users, and use AI without the monthly limit.') : t('akan kehilangan akses panel admin dan kembali ke batas AI tier-nya.', 'will lose admin panel access and return to their tier’s AI limit.')}</p>}
          {confirm.kind === 'ban' && <p className="flex gap-2"><TriangleAlert size={16} className="mt-0.5 shrink-0 text-red-600" aria-hidden="true" /><span><b className="text-ink-900">{user.name}</b> {t('akan langsung keluar dari semua perangkat dan tidak bisa masuk', 'will be signed out everywhere and unable to sign in')} {banDays === '0' ? t('sampai diaktifkan lagi.', 'until enabled again.') : t(`selama ${banDays} hari.`, `for ${banDays} days.`)} {t('Alasan:', 'Reason:')} <i>{banReason.trim()}</i></span></p>}
          {confirm.kind === 'unban' && <p>{t('Ban dicabut dan pengguna bisa masuk kembali.', 'The ban is lifted and the user can sign in again.')}</p>}
          {confirm.kind === 'password' && <p>{t('Password akan diganti dan semua sesi aktif pengguna dicabut. Sampaikan password baru secara aman.', 'The password will be replaced and all active sessions revoked. Share the new password securely.')}</p>}
          {confirm.kind === 'revoke-all' && <p>{t('Pengguna akan keluar dari semua perangkat dan harus masuk ulang.', 'The user will be signed out of every device and must sign in again.')}</p>}
          {confirm.kind === 'delete' && <>
            <p>{t('Semua notebook, versi, dan catatan pemakaian akan hilang dan tidak bisa dipulihkan.', 'Every notebook, version, and usage record will be lost and cannot be recovered.')}</p>
            <label className="mt-4 block text-[13px] font-semibold text-ink-700">{t(`Ketik "${user.email}" untuk konfirmasi`, `Type "${user.email}" to confirm`)}<input className={`${inputClass} mt-1.5`} value={deleteText} onChange={(event) => setDeleteText(event.target.value)} autoComplete="off" /></label>
          </>}
        </ConfirmDialog>
      )}
    </Modal>
  );
}
