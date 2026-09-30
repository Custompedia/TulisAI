'use client';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useEffectEvent, useState } from 'react';
import { ArrowLeft, Copy, Lock, PencilLine, Plus, RotateCw, Sparkles, Trash2 } from 'lucide-react';
import { useLocale } from '@/lib/client/locale';
import { errorText } from '@/lib/client/api';
import { useBilling } from '@/lib/client/billing-store';
import { removeStyle, useWritingStyles } from '@/lib/client/styles-store';
import { defaults } from '@/lib/writing/settings';
import { STYLE_LIMIT, type WritingStyle } from '@/lib/writing/styles';
import { PageHeader, useEntitlements, useSessionGuard } from '@/components/app/AppShell';
import { useRequiredTierName } from '@/components/app/PaidLock';
import { openPlans } from '@/components/app/shell-events';
import { Alert } from '@/components/ui/Alert';
import { Button, buttonClass } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/Modal';
import { Toast } from '@/components/ui/Toast';
import { modeLabel, modeTone, requestSummary, toneClass } from '@/components/writing/modes';
import { StyleDialog } from '@/components/writing/StyleDialog';
import { StyleMark } from '@/components/writing/StyleMark';
import { copyName, nameTaken, styleDraft, styleTemplates, type StyleDraft } from '@/components/writing/style-form';
import { SKILL_ACTION_EVENT, skillSelection, type SkillAction } from './skill-events';

type T = (id: string, en: string) => string;

// Saved skills start at Plus. Without saved_styles the page is a read-only preview: the templates, the
// skills already saved (still deletable), and a short explanation. No buy button is the main action, and
// while checkout is closed the way forward is plain text.
function LockedNote({ tier }: { tier: string }) {
  const { t } = useLocale();
  const { billing } = useBilling();
  return (
    <Alert tone="info" title={t(`Skill tersimpan tersedia mulai ${tier}`, `Saved skills start at ${tier}`)}>
      <p>{t('Kamu bisa melihat template di sini. Skill yang sudah pernah kamu simpan tetap terlihat dan bisa dihapus.', 'You can look through the templates here. Skills you saved before stay listed and can be deleted.')}</p>
      {billing && !billing.checkoutOpen ? <p className="mt-1.5 font-medium text-ink-700">{t('Pembayaran belum dibuka.', 'Payments are not open yet.')}</p>
        : billing?.checkoutOpen ? <button type="button" onClick={openPlans} className="mt-1.5 text-[13px] font-medium text-ink-600 underline decoration-line-strong underline-offset-2 hover:text-ink-900">{t('Lihat paket', 'See plans')}</button> : null}
    </Alert>
  );
}

function SkillSummary({ style, t }: { style: Pick<WritingStyle, 'settings' | 'description'>; t: T }) {
  return (
    <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
      <div><dt className="text-[12px] text-ink-500">{t('Mode', 'Mode')}</dt><dd className="mt-0.5"><span className={`rounded-md border px-1.5 py-px text-[12px] font-semibold ${toneClass[modeTone[style.settings.mode]].chip}`}>{modeLabel(style.settings.mode, t)}</span></dd></div>
      <div><dt className="text-[12px] text-ink-500">{t('Pengaturan', 'Settings')}</dt><dd className="mt-0.5 text-ink-800">{requestSummary(style.settings, t)}</dd></div>
      {style.description && <div className="sm:col-span-2"><dt className="text-[12px] text-ink-500">{t('Deskripsi', 'Description')}</dt><dd className="mt-0.5 text-ink-800">{style.description}</dd></div>}
      {style.settings.extra.trim() && <div className="sm:col-span-2"><dt className="text-[12px] text-ink-500">{t('Instruksi untuk AI', 'Instructions for the AI')}</dt><dd className="mt-0.5 whitespace-pre-line text-ink-800">{style.settings.extra}</dd></div>}
    </dl>
  );
}

export function SkillsView() {
  const { t, locale } = useLocale();
  const router = useRouter();
  const params = useSearchParams();
  const guard = useSessionGuard();
  const { styles, loading, error, reload } = useWritingStyles();
  const [dialog, setDialog] = useState<{ style: WritingStyle | null; initial?: StyleDraft } | null>(null);
  const [confirm, setConfirm] = useState<WritingStyle | null>(null);
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState<{ tone: 'success' | 'error'; message: string } | null>(null);
  const { has } = useEntitlements();
  const locked = !has('saved_styles');
  const requiredTier = useRequiredTierName('saved_styles');
  const full = styles.length >= STYLE_LIMIT;
  const templates = styleTemplates(t);
  const selection = skillSelection(params);
  const selected = selection?.kind === 'skill' ? styles.find((style) => style.id === selection.id) ?? null : null;
  const template = selection?.kind === 'template' ? templates[selection.index] ?? null : null;
  const en = locale === 'en';

  const create = useCallback(() => { if (!locked && !full && !busy) setDialog({ style: null }); }, [busy, full, locked]);
  // Duplicating opens a prefilled form instead of saving straight away, so repeated clicks cannot pile up copies.
  const duplicate = (style: WritingStyle) => { if (!locked && !full && !busy) setDialog({ style: null, initial: { ...styleDraft(style.settings, style), name: copyName(style.name, styles) } }); };
  const startFromTemplate = (draft: StyleDraft) => { if (!locked && !full && !busy) setDialog({ style: null, initial: { ...draft, name: nameTaken(draft.name, styles) ? copyName(draft.name, styles) : draft.name } }); };

  const onAction = useEffectEvent((action: SkillAction) => {
    if (action.kind === 'create') return create();
    if (action.kind === 'template') { const draft = templates[action.index]; if (draft) startFromTemplate(draft); return; }
    const style = styles.find((item) => item.id === action.id); if (!style) return;
    if (action.kind === 'edit' && !locked) setDialog({ style });
    if (action.kind === 'duplicate') duplicate(style);
    if (action.kind === 'delete') setConfirm(style);
  });
  useEffect(() => {
    const listener = (event: Event) => onAction((event as CustomEvent<SkillAction>).detail);
    window.addEventListener(SKILL_ACTION_EVENT, listener);
    return () => window.removeEventListener(SKILL_ACTION_EVENT, listener);
  }, []);

  // /skills?new=1 (from Ctrl K) opens the create form once the list is known.
  const openFromLink = useEffectEvent(() => {
    if (params.get('new') !== '1' || loading) return;
    router.replace('/skills');
    create();
  });
  useEffect(() => { openFromLink(); }, [loading, params]);

  async function remove() {
    if (!confirm) return;
    const target = confirm;
    setBusy(target.id); setNotice(null);
    try {
      await removeStyle(target.id); setConfirm(null);
      if (selected?.id === target.id) router.replace('/skills');
      setNotice({ tone: 'success', message: t(`Skill “${target.name}” dihapus.`, `Skill “${target.name}” deleted.`) });
    } catch (caught) { if (!guard(caught)) { setConfirm(null); setNotice({ tone: 'error', message: errorText(caught, en) }); } }
    finally { setBusy(''); }
  }

  const back = <Link href="/skills" className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-ink-600 hover:text-ink-900"><ArrowLeft size={15} aria-hidden="true" />{t('Semua skill', 'All skills')}</Link>;
  const createButton = !locked && <Button variant="primary" icon={Plus} disabled={loading || full || busy !== ''} onClick={create} title={full ? t('Batas 10 skill tercapai. Hapus satu dulu.', 'The 10-skill limit is reached. Delete one first.') : undefined}>{t('Buat skill', 'Create skill')}</Button>;

  return (
    <main className="mx-auto w-full max-w-5xl px-4 pb-12 pt-8 sm:px-6">
      <PageHeader title="Skill" description={t('Gaya tulisan tersimpan yang bisa dipakai di notebook mana pun.', 'Saved writing styles you can use in any notebook.')} actions={createButton || undefined} />

      {locked && <div className="mt-5"><LockedNote tier={requiredTier} /></div>}

      <div className="mt-5">
        {selection && (selected || template) && <div className="mb-4">{back}</div>}
        {selected ? (
          <section className="rounded-2xl border border-line bg-white p-5 sm:p-6" aria-labelledby="skill-title">
            <div className="flex items-start gap-3">
              <StyleMark style={selected} size={44} />
              <div className="min-w-0 flex-1"><h2 id="skill-title" className="truncate text-lg font-semibold text-ink-950">{selected.name}</h2><p className="text-[13px] text-ink-500">{t('Skill tersimpan', 'Saved skill')}</p></div>
            </div>
            <SkillSummary style={selected} t={t} />
            <div className="mt-5 flex flex-wrap gap-2 border-t border-line pt-4">
              <Button icon={locked ? Lock : PencilLine} disabled={locked || busy !== ''} onClick={() => setDialog({ style: selected })}>{t('Ubah', 'Edit')}</Button>
              <Button icon={Copy} disabled={locked || full || busy !== ''} onClick={() => duplicate(selected)}>{t('Duplikat', 'Duplicate')}</Button>
              <Button icon={Trash2} className="text-red-700 hover:bg-red-50" disabled={busy !== ''} onClick={() => setConfirm(selected)}>{t('Hapus', 'Delete')}</Button>
            </div>
          </section>
        ) : template ? (
          <section className="rounded-2xl border border-line bg-white p-5 sm:p-6" aria-labelledby="template-title">
            <div className="flex items-start gap-3">
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-700"><Sparkles size={20} aria-hidden="true" /></span>
              <div className="min-w-0 flex-1"><h2 id="template-title" className="truncate text-lg font-semibold text-ink-950">{template.name}</h2><p className="text-[13px] text-ink-500">{t('Template skill', 'Skill template')}</p></div>
            </div>
            <SkillSummary style={{ settings: template.settings, description: template.description }} t={t} />
            {/* Below Max the server drops Sesuaikan and the instructions, so the template would save as its mode only. */}
            {template.settings.customized && !has('persistent_personalization') && <p className="mt-4 rounded-lg bg-paper px-3 py-2 text-[12.5px] text-ink-600">{t('Format dan instruksi template ini hanya tersimpan di paket Max. Di paket lain yang tersimpan adalah mode dan opsinya.', 'This template’s format and instructions are only kept on Max. On other plans the mode and its options are saved.')}</p>}
            {!locked && (
              <div className="mt-5 flex flex-wrap gap-2 border-t border-line pt-4">
                <Button variant="primary" icon={Plus} disabled={full || busy !== ''} onClick={() => startFromTemplate(template)}>{t('Pakai template ini', 'Use this template')}</Button>
              </div>
            )}
          </section>
        ) : loading ? (
          <div role="status" aria-label={t('Memuat skill…', 'Loading skills…')} className="space-y-2">{[0, 1, 2].map((row) => <div key={row} className="h-16 animate-pulse rounded-xl bg-paper-deep" />)}</div>
        ) : error ? (
          <Alert tone="error" actions={<Button size="sm" icon={RotateCw} onClick={reload}>{t('Coba lagi', 'Retry')}</Button>}>{errorText(error, en)}</Alert>
        ) : selection ? (
          <div className="rounded-2xl border border-line bg-white px-5 py-4 text-sm text-ink-600">
            {t('Skill ini sudah tidak ada.', 'This skill no longer exists.')} <Link href="/skills" className={buttonClass('ghost', 'sm', 'ml-1')}>{t('Semua skill', 'All skills')}</Link>
          </div>
        ) : (
          <>
            {styles.length === 0 ? (
              !locked && (
                <div className="rounded-2xl border border-dashed border-line-strong bg-white px-6 py-8 text-center">
                  <p className="font-semibold text-ink-900">{t('Belum ada skill tersimpan', 'No saved skills yet')}</p>
                  <p className="mt-1 text-sm text-ink-500">{t('Buat skill untuk pengaturan yang sering kamu pakai, misalnya "Email ke klien".', 'Create a skill for the settings you use often, such as "Email to a client".')}</p>
                </div>
              )
            ) : (
              <ul className="grid gap-3 sm:grid-cols-2">
                {styles.map((style) => (
                  <li key={style.id}>
                    <Link href={`/skills?skill=${encodeURIComponent(style.id)}`} className="flex items-center gap-3 rounded-xl border border-line bg-white px-3.5 py-3 transition-colors hover:border-line-strong">
                      <StyleMark style={style} size={36} />
                      <span className="min-w-0 flex-1">
                        <span className="flex min-w-0 items-center gap-2"><span className="truncate text-sm font-semibold text-ink-900">{style.name}</span><span className={`shrink-0 rounded-md border px-1.5 py-px text-[11px] font-semibold ${toneClass[modeTone[style.settings.mode]].chip}`}>{modeLabel(style.settings.mode, t)}</span></span>
                        <span className="mt-0.5 block truncate text-xs text-ink-500">{style.description || style.settings.extra.trim() || requestSummary(style.settings, t)}</span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            <p className={`mt-3 text-[13px] ${full && !locked ? 'font-medium text-amber-700' : 'text-ink-500'}`}>
              <span className="tabular-nums">{styles.length}/{STYLE_LIMIT}</span> skill{full && !locked && ` · ${t('Batas tercapai. Hapus satu skill sebelum membuat yang baru.', 'Limit reached. Delete a skill before creating a new one.')}`}
            </p>
            <h2 className="mt-8 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-500">{t('Template skill', 'Skill templates')}</h2>
            <ul className="mt-2 grid gap-3 sm:grid-cols-2">
              {templates.map((draft, index) => (
                <li key={draft.name}>
                  <Link href={`/skills?template=${index}`} className="flex items-center gap-3 rounded-xl border border-line bg-white px-3.5 py-3 transition-colors hover:border-line-strong">
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-700"><Sparkles size={16} aria-hidden="true" /></span>
                    <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold text-ink-900">{draft.name}</span><span className="mt-0.5 block truncate text-xs text-ink-500">{draft.description}</span></span>
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      {dialog && <StyleDialog styles={styles} style={dialog.style} initial={dialog.initial} preset={defaults} onClose={() => setDialog(null)}
        onSaved={(saved, created) => { setDialog(null); setNotice({ tone: 'success', message: created ? t(`Skill “${saved.name}” tersimpan.`, `Skill “${saved.name}” saved.`) : t(`Skill “${saved.name}” diperbarui.`, `Skill “${saved.name}” updated.`) }); if (created) router.push(`/skills?skill=${encodeURIComponent(saved.id)}`); }}
        onDeleted={(removed) => { setDialog(null); if (selected?.id === removed.id) router.replace('/skills'); }} />}
      {confirm && (
        <ConfirmDialog title={t('Hapus skill ini?', 'Delete this skill?')} tone="danger" busy={busy === confirm.id} confirmLabel={t('Hapus skill', 'Delete skill')} onClose={() => { if (!busy) setConfirm(null); }} onConfirm={() => void remove()}>
          <p>{t('Skill', 'The skill')} <b className="text-ink-900">“{confirm.name}”</b> {t('akan dihapus. Notebook yang memakainya tetap menyimpan pengaturannya.', 'will be deleted. Notebooks using it keep their current settings.')}</p>
        </ConfirmDialog>
      )}
      {notice && <Toast tone={notice.tone} duration={notice.tone === 'success' ? 4000 : undefined} onDismiss={() => setNotice(null)} dismissLabel={t('Tutup', 'Dismiss')}>{notice.message}</Toast>}
    </main>
  );
}
