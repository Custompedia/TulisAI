'use client';
import { useState } from 'react';
import { Copy, MoreHorizontal, PencilLine, Plus, RotateCw, Sparkles, Trash2 } from 'lucide-react';
import { useLocale } from '@/lib/client/locale';
import { errorText } from '@/lib/client/api';
import { removeStyle, useWritingStyles } from '@/lib/client/styles-store';
import { defaults } from '@/lib/writing/settings';
import { STYLE_LIMIT, type WritingStyle } from '@/lib/writing/styles';
import { useSessionGuard } from '@/components/app/AppShell';
import { Alert } from '@/components/ui/Alert';
import { Button, IconButton, pillButton } from '@/components/ui/Button';
import { Menu } from '@/components/ui/Menu';
import { ConfirmDialog } from '@/components/ui/Modal';
import { Toast } from '@/components/ui/Toast';
import { modeLabel, modeTone, requestSummary, toneClass } from '@/components/writing/modes';
import { StyleDialog } from '@/components/writing/StyleDialog';
import { StyleMark } from '@/components/writing/StyleMark';
import { copyName, nameTaken, styleDraft, styleTemplates, type StyleDraft } from '@/components/writing/style-form';

export function StylesCard() {
  const { t, locale } = useLocale();
  const guard = useSessionGuard();
  const { styles, loading, error, reload } = useWritingStyles();
  const [dialog, setDialog] = useState<{ style: WritingStyle | null; initial?: StyleDraft } | null>(null);
  const [confirm, setConfirm] = useState<WritingStyle | null>(null);
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');
  const full = styles.length >= STYLE_LIMIT;
  const en = locale === 'en';

  // Duplicating opens a prefilled form instead of saving straight away, so repeated clicks cannot pile up copies.
  const duplicate = (style: WritingStyle) => {
    if (busy || full) return;
    setDialog({ style: null, initial: { ...styleDraft(style.settings, style), name: copyName(style.name, styles) } });
  };

  const openTemplate = (template: StyleDraft) => {
    if (busy || full) return;
    setDialog({ style: null, initial: { ...template, name: nameTaken(template.name, styles) ? copyName(template.name, styles) : template.name } });
  };

  async function remove() {
    if (!confirm) return;
    setBusy(confirm.id); setNotice('');
    try { await removeStyle(confirm.id); setConfirm(null); }
    catch (caught) { if (!guard(caught)) { setConfirm(null); setNotice(errorText(caught, en)); } }
    finally { setBusy(''); }
  }

  return (
    <section className="rounded-2xl border border-line bg-white">
      <header className="px-5 pt-5 sm:px-6">
        <h2 className="text-[17px] font-semibold tracking-tight text-ink-900">Skills</h2>
        <p className="mt-0.5 text-sm text-ink-500">{t('Skill menyimpan mode beserta pengaturannya agar bisa dipakai lagi di notebook mana pun.', 'A skill stores a mode with its settings so you can reuse it in any notebook.')}</p>
      </header>

      <div className="px-5 pb-5 pt-4 sm:px-6">
        {loading ? (
          <div role="status" aria-label={t('Memuat skill…', 'Loading skills…')} className="space-y-2">
            {[0, 1, 2].map((row) => <div key={row} className="h-14 animate-pulse rounded-xl bg-paper-deep" />)}
          </div>
        ) : error ? (
          <Alert tone="error" actions={<Button size="sm" icon={RotateCw} onClick={reload}>{t('Coba lagi', 'Retry')}</Button>}>{errorText(error, en)}</Alert>
        ) : styles.length === 0 ? (
          <div className="rounded-xl border border-dashed border-line-strong bg-paper/60 px-4 py-6 text-center">
            <p className="text-sm text-ink-600">{t('Belum ada skill tersimpan.', 'No saved skills yet.')}</p>
            <p className="mt-1 text-[13px] text-ink-500">{t('Buat skill untuk pengaturan yang sering kamu pakai, misalnya "Email ke klien".', 'Create a skill for the settings you use often, such as "Email to a client".')}</p>
          </div>
        ) : (
          <ul className="space-y-2">
            {styles.map((style) => {
              const actions = [
                { label: t(`Ubah skill ${style.name}`, `Edit skill ${style.name}`), short: t('Ubah', 'Edit'), icon: PencilLine, danger: false, disabled: false, run: () => setDialog({ style }) },
                { label: t(`Duplikat skill ${style.name}`, `Duplicate skill ${style.name}`), short: t('Duplikat', 'Duplicate'), icon: Copy, danger: false, disabled: full, run: () => duplicate(style) },
                { label: t(`Hapus skill ${style.name}`, `Delete skill ${style.name}`), short: t('Hapus', 'Delete'), icon: Trash2, danger: true, disabled: false, run: () => setConfirm(style) },
              ];
              return (
                <li key={style.id} className="flex items-center gap-3 rounded-xl border border-line px-3 py-2.5">
                  <StyleMark style={style} size={34} />
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-center gap-2">
                      <p className="truncate text-sm font-semibold text-ink-900">{style.name}</p>
                      <span className={`shrink-0 rounded-md border px-1.5 py-px text-[11px] font-semibold ${toneClass[modeTone[style.settings.mode]].chip}`}>{modeLabel(style.settings.mode, t)}</span>
                    </div>
                    <p className="mt-0.5 truncate text-xs text-ink-500">{style.description || style.settings.extra.trim() || requestSummary(style.settings, t)}</p>
                  </div>
                  <div className="hidden shrink-0 items-center sm:flex">
                    {actions.map((action) => (
                      <IconButton key={action.short} icon={action.icon} label={action.label} disabled={busy !== '' || action.disabled} onClick={action.run}
                        className={action.danger ? 'hover:bg-red-50 hover:text-red-700' : ''} />
                    ))}
                  </div>
                  <Menu label={`${t('Opsi untuk', 'Options for')} ${style.name}`} disabled={busy !== ''} className="shrink-0 sm:hidden"
                    triggerClassName="grid h-9 w-9 place-items-center rounded-lg text-ink-500 transition-colors hover:bg-ink-100/70 hover:text-ink-900 disabled:opacity-40"
                    trigger={<MoreHorizontal size={18} aria-hidden="true" />}
                    items={actions.map((action) => ({ label: action.short, icon: action.icon, disabled: action.disabled, tone: action.danger ? 'danger' as const : 'default' as const, onSelect: action.run }))} />
                </li>
              );
            })}
          </ul>
        )}
        {!loading && !error && !full && (
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <p className="text-[13px] text-ink-500">{t('Mulai dari template:', 'Start from a template:')}</p>
            {styleTemplates(t).map((template) => <button key={template.name} type="button" disabled={busy !== ''} onClick={() => openTemplate(template)} className={pillButton}><Sparkles size={13} aria-hidden="true" className="text-brand-700" />{template.name}</button>)}
          </div>
        )}
      </div>

      <footer className="flex flex-wrap items-center justify-end gap-2 rounded-b-2xl border-t border-line bg-paper/60 px-5 py-3 sm:px-6">
        <p className={`mr-auto text-sm ${full ? 'font-medium text-amber-700' : 'text-ink-500'}`}>
          <span className="tabular-nums">{styles.length}/{STYLE_LIMIT}</span> skill
          {full && ` · ${t('Batas tercapai. Hapus satu skill sebelum membuat yang baru.', 'Limit reached. Delete a skill before creating a new one.')}`}
        </p>
        <Button variant="primary" icon={Plus} disabled={loading || full || busy !== ''} onClick={() => setDialog({ style: null })}>{t('Buat skill', 'Create skill')}</Button>
      </footer>

      {dialog && <StyleDialog styles={styles} style={dialog.style} initial={dialog.initial} preset={defaults} onClose={() => setDialog(null)} onSaved={() => setDialog(null)} onDeleted={() => setDialog(null)} />}
      {confirm && (
        <ConfirmDialog title={t('Hapus skill ini?', 'Delete this skill?')} tone="danger" busy={busy === confirm.id} confirmLabel={t('Hapus skill', 'Delete skill')} onClose={() => { if (!busy) setConfirm(null); }} onConfirm={() => void remove()}>
          <p>{t('Skill', 'The skill')} <b className="text-ink-900">“{confirm.name}”</b> {t('akan dihapus. Notebook yang memakainya tetap menyimpan pengaturannya.', 'will be deleted. Notebooks using it keep their current settings.')}</p>
        </ConfirmDialog>
      )}
      {notice && <Toast tone="error" onDismiss={() => setNotice('')} dismissLabel={t('Tutup', 'Dismiss')}>{notice}</Toast>}
    </section>
  );
}
