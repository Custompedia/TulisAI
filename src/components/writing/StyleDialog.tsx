'use client';
import { useId, useState } from 'react';
import { ChevronDown, Plus, Trash2 } from 'lucide-react';
import { useLocale } from '@/lib/client/locale';
import { ApiError, errorText } from '@/lib/client/api';
import { createStyle, removeStyle, saveStyle } from '@/lib/client/styles-store';
import { customConflict, EXTRA_LIMIT, FOCUS_LIMIT, SAMPLE_LIMIT, type Settings } from '@/lib/writing/settings';
import { STYLE_DESCRIPTION_LIMIT, STYLE_LIMIT, STYLE_NAME_LIMIT, type WritingStyle } from '@/lib/writing/styles';
import { useSessionGuard } from '@/components/app/AppShell';
import { AppearanceFields } from '@/components/app/AppearancePicker';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { FieldLabel, inputClass } from '@/components/ui/Field';
import { ConfirmDialog, Modal } from '@/components/ui/Modal';
import { CustomFields, ModeOptions, ModePicker, pickCustom } from './WritingControls';
import { modeHint, modeLabel, requestSummary } from './modes';
import { StyleMark } from './StyleMark';
import { appendInstruction, countWords, hasAdvancedValues, hasCustomFields, instructionChips, nameTaken, SAMPLE_GOOD_WORDS, SAMPLE_MIN_WORDS, styleDraft, stylePayload, type StyleDraft } from './style-form';

type Props = { styles: WritingStyle[]; style?: WritingStyle | null; preset: Settings; onClose: () => void; onSaved: (style: WritingStyle, created: boolean) => void; onDeleted?: (style: WritingStyle) => void };

export function StyleDialog({ styles, style = null, preset, onClose, onSaved, onDeleted }: Props) {
  const { t, locale } = useLocale();
  const guard = useSessionGuard();
  const id = useId();
  const [draft, setDraft] = useState<StyleDraft>(() => styleDraft(preset, style));
  // Opens straight away when editing a skill that already carries non-default details.
  const [advanced, setAdvanced] = useState(() => !!style && hasAdvancedValues(styleDraft(preset, style).settings));
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState('');
  const [nameError, setNameError] = useState('');

  const trimmed = draft.name.trim();
  const duplicate = trimmed !== '' && nameTaken(trimmed, styles, style?.id);
  const full = !style && styles.length >= STYLE_LIMIT;
  const summary: Settings = { ...draft.settings, customized: hasCustomFields(draft.settings) };
  const conflict = summary.customized ? customConflict(summary, []) : null;
  const changed = hasAdvancedValues(draft.settings);
  // A conflict always lives in the advanced row, so the row stays open until it is resolved.
  const detailsOpen = advanced || conflict !== null;
  const blocked = !trimmed || duplicate || full || conflict !== null;
  const setSettings = (settings: Settings) => setDraft({ ...draft, settings });
  const nameProblem = nameError || (duplicate ? t('Sudah ada skill dengan nama ini.', 'A skill with this name already exists.') : '');
  const sampleWords = countWords(draft.settings.sample);
  const sampleHint = !draft.settings.sample.trim() ? t(`Sekitar ${SAMPLE_MIN_WORDS}–${SAMPLE_GOOD_WORDS} kata paling efektif.`, `About ${SAMPLE_MIN_WORDS}–${SAMPLE_GOOD_WORDS} words works best.`)
    : sampleWords < SAMPLE_MIN_WORDS ? t(`${sampleWords} kata. Contoh sependek ini belum cukup menunjukkan gaya; tambahkan sampai sekitar ${SAMPLE_MIN_WORDS} kata.`, `${sampleWords} words. A sample this short barely shows a style; add up to about ${SAMPLE_MIN_WORDS} words.`)
    : t(`${sampleWords} kata.`, `${sampleWords} words.`);
  const preview: WritingStyle = { id: style?.id ?? 'preview', name: trimmed, description: draft.description.trim() || null, color: draft.color, icon: draft.icon, settings: summary, createdAt: '', updatedAt: '' };

  async function submit(event?: React.FormEvent) {
    event?.preventDefault();
    if (blocked || busy) return;
    setBusy(true); setError(''); setNameError('');
    try {
      const payload = stylePayload(draft);
      const saved = style ? await saveStyle(style.id, payload) : await createStyle(payload);
      onSaved(saved, !style);
    } catch (caught) {
      if (guard(caught)) return;
      if (caught instanceof ApiError && caught.code === 'STYLE_EXISTS') setNameError(errorText(caught, locale === 'en'));
      else setError(errorText(caught, locale === 'en'));
    } finally { setBusy(false); }
  }

  async function remove() {
    if (!style || busy) return;
    setBusy(true); setError('');
    try { await removeStyle(style.id); setConfirmDelete(false); onDeleted?.(style); }
    catch (caught) { if (!guard(caught)) { setConfirmDelete(false); setError(errorText(caught, locale === 'en')); } }
    finally { setBusy(false); }
  }

  return (
    <Modal size="lg" busy={busy} onClose={() => { if (!busy) onClose(); }}
      title={style ? t('Ubah skill', 'Edit skill') : t('Buat skill', 'Create skill')}
      description={t('Skill menyimpan mode beserta seluruh pengaturannya supaya bisa dipakai lagi kapan saja.', 'A skill stores a mode with all of its settings so you can reuse it any time.')}
      footer={<>
        {style && onDeleted && (
          <button type="button" disabled={busy} onClick={() => setConfirmDelete(true)}
            className="mr-auto inline-flex h-10 items-center gap-2 rounded-lg px-3 text-sm font-semibold text-red-700 transition-colors hover:bg-red-50 disabled:opacity-50">
            <Trash2 size={16} aria-hidden="true" />{t('Hapus skill', 'Delete skill')}
          </button>
        )}
        <Button onClick={onClose} disabled={busy}>{t('Batal', 'Cancel')}</Button>
        <Button variant="primary" type="submit" form={`${id}-form`} loading={busy} disabled={blocked}>{style ? t('Simpan perubahan', 'Save changes') : t('Simpan skill', 'Save skill')}</Button>
      </>}>
      <form id={`${id}-form`} onSubmit={(event) => void submit(event)} className="space-y-5">
        {error && <Alert tone="error" onDismiss={() => setError('')} dismissLabel={t('Tutup', 'Dismiss')}>{error}</Alert>}
        {full && <Alert tone="warning">{t(`Kamu sudah punya ${STYLE_LIMIT} skill. Hapus salah satu dulu sebelum membuat yang baru.`, `You already have ${STYLE_LIMIT} skills. Delete one before creating a new one.`)}</Alert>}

        <div>
          <FieldLabel htmlFor={`${id}-name`} hint={`${draft.name.length}/${STYLE_NAME_LIMIT}`}>{t('Nama skill', 'Skill name')}</FieldLabel>
          <div className="flex items-center gap-2.5">
            <StyleMark style={preview} size={36} />
            <input id={`${id}-name`} className={inputClass} value={draft.name} maxLength={STYLE_NAME_LIMIT} disabled={busy} autoFocus autoComplete="off"
              aria-invalid={!!nameProblem || undefined} aria-describedby={nameProblem ? `${id}-name-error` : `${id}-name-hint`}
              placeholder={t('Mis. Email ke klien', 'E.g. Email to a client')}
              onChange={(event) => { setNameError(''); setDraft({ ...draft, name: event.target.value.slice(0, STYLE_NAME_LIMIT) }); }} />
          </div>
          {nameProblem
            ? <p id={`${id}-name-error`} className="mt-1.5 text-xs font-medium text-red-700">{nameProblem}</p>
            : <p id={`${id}-name-hint`} className="mt-1.5 text-xs text-ink-500">{t('Nama yang kamu kenali saat memilih skill, bukan instruksi untuk AI.', 'A name you will recognise when picking the skill, not an instruction for the AI.')}</p>}
          <div className="mt-3">
            <FieldLabel htmlFor={`${id}-description`} hint={`${draft.description.length}/${STYLE_DESCRIPTION_LIMIT}`}>{t('Kapan dipakai', 'When to use it')}</FieldLabel>
            <input id={`${id}-description`} className={inputClass} value={draft.description} maxLength={STYLE_DESCRIPTION_LIMIT} disabled={busy} autoComplete="off"
              placeholder={t('Mis. bab tinjauan pustaka skripsi', 'E.g. the literature review chapter of a thesis')}
              onChange={(event) => setDraft({ ...draft, description: event.target.value.slice(0, STYLE_DESCRIPTION_LIMIT) })} />
            <p className="mt-1.5 text-xs text-ink-500">{t('Catatan untukmu sendiri: tampil di daftar skill dan tidak pernah dikirim ke AI.', 'A note for yourself: it shows in your skill list and is never sent to the AI.')}</p>
          </div>
          <div className="mt-3 overflow-hidden rounded-xl border border-line">
            <AppearanceFields color={draft.color} icon={draft.icon} mode={draft.settings.mode} gridHeight="max-h-40"
              onSelect={(next) => setDraft({ ...draft, color: next.color, icon: next.icon })}
              trailing={<button type="button" disabled={!draft.color && !draft.icon} onClick={() => setDraft({ ...draft, color: null, icon: null })}
                className="h-8 rounded-md px-2 text-[13px] font-medium text-ink-500 outline-none transition-colors hover:text-red-700 focus-visible:ring-2 focus-visible:ring-brand-400 disabled:opacity-40 disabled:hover:text-ink-500">{t('Hapus', 'Remove')}</button>} />
          </div>
        </div>

        <div>
          <FieldLabel>{t('Mode dasar', 'Base mode')}</FieldLabel>
          <ModePicker layout="grid" value={draft.settings.mode} disabled={busy} onChange={(mode) => setSettings({ ...draft.settings, mode })} />
          <p className="mt-2 text-xs leading-relaxed text-ink-500">{modeHint(draft.settings.mode, t)}</p>
        </div>

        <div>
          <FieldLabel htmlFor={`${id}-extra`} hint={`${draft.settings.extra.length}/${EXTRA_LIMIT}`}>{t('Instruksi untuk AI', 'Instructions for the AI')}</FieldLabel>
          <textarea id={`${id}-extra`} rows={3} maxLength={EXTRA_LIMIT} disabled={busy} value={draft.settings.extra}
            onChange={(event) => setSettings({ ...draft.settings, extra: event.target.value.slice(0, EXTRA_LIMIT) })}
            placeholder={t('Mis. jangan ubah nama produk', 'E.g. don’t change product names')}
            className={`${inputClass} h-auto resize-none py-2 leading-relaxed`} />
          <p className="mt-1.5 text-xs text-ink-500">{t('Angka, sitasi, istilah terkunci, dan fakta sudah otomatis dijaga; tidak perlu ditulis di sini.', 'Numbers, citations, locked terms, and facts are protected automatically; no need to write them here.')}</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {instructionChips(t).map((chip) => {
              const used = draft.settings.extra.toLowerCase().includes(chip.toLowerCase());
              return (
                <button key={chip} type="button" disabled={busy || used} title={used ? t('Sudah ada di instruksi', 'Already in the instructions') : t('Tambahkan ke instruksi', 'Add to the instructions')}
                  onClick={() => setSettings({ ...draft.settings, extra: appendInstruction(draft.settings.extra, chip) })}
                  className="inline-flex h-8 items-center gap-1.5 rounded-full border border-line-strong bg-white px-2.5 text-xs font-medium text-ink-600 transition-colors hover:border-ink-300 hover:text-ink-900 disabled:opacity-45">
                  <Plus size={13} aria-hidden="true" />{chip}
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <FieldLabel htmlFor={`${id}-sample`} hint={`${draft.settings.sample.length}/${SAMPLE_LIMIT}`}>{t('Contoh tulisan', 'Writing sample')}</FieldLabel>
          <textarea id={`${id}-sample`} rows={4} maxLength={SAMPLE_LIMIT} disabled={busy} value={draft.settings.sample}
            onChange={(event) => setSettings({ ...draft.settings, sample: event.target.value.slice(0, SAMPLE_LIMIT) })}
            placeholder={t('Tempel satu atau dua paragraf tulisanmu sendiri…', 'Paste one or two paragraphs of your own writing…')}
            className={`${inputClass} h-auto resize-none py-2 leading-relaxed`} />
          <p className={`mt-1.5 text-xs ${draft.settings.sample.trim() && sampleWords < SAMPLE_MIN_WORDS ? 'font-medium text-amber-700' : 'text-ink-500'}`}>{sampleHint}</p>
          <p className="mt-1.5 text-xs leading-relaxed text-ink-500">{t('Dipakai sebagai contoh gaya saja: AI meniru cara menulisnya, bukan isinya. Dikirim ke AI hanya saat skill ini dipakai, jadi menambah sedikit biaya token.', 'Used as a style example only: the AI imitates how it is written, never its content. It is sent only when this skill is applied, so it adds a little token cost.')}</p>
        </div>

        <div className="rounded-xl border border-line">
          <button type="button" onClick={() => setAdvanced(!detailsOpen)} aria-expanded={detailsOpen} aria-controls={`${id}-advanced`}
            className="flex h-10 w-full items-center gap-2 rounded-xl px-3.5 text-left transition-colors hover:bg-paper">
            <span className="flex-1 text-[13px] font-semibold text-ink-800">{t('Rincian lanjutan', 'Advanced details')}</span>
            {changed && <span className="rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-semibold text-brand-800">{t('Diubah', 'Custom')}</span>}
            <ChevronDown size={15} aria-hidden="true" className={`text-ink-400 transition-transform ${detailsOpen ? 'rotate-180' : ''}`} />
          </button>
          {detailsOpen ? (
            <div id={`${id}-advanced`} className="space-y-4 border-t border-line px-3.5 pb-4 pt-3.5">
              <p className="text-xs leading-relaxed text-ink-500">{t('Pengaturan mode dan bentuk hasil. Biarkan apa adanya jika kamu tidak yakin.', 'Mode settings and output shape. Leave them as they are if you are unsure.')}</p>
              <ModeOptions describe settings={draft.settings} disabled={busy} onChange={setSettings} />
              <div className="grid gap-x-5 gap-y-4 border-t border-line pt-4 md:grid-cols-2">
                <CustomFields describe showExtra={false} disabled={busy} draft={pickCustom(draft.settings)} onChange={(next) => setSettings({ ...draft.settings, ...next })} />
              </div>
              <p className="text-xs text-ink-500">{t(`Penekanan maksimal ${FOCUS_LIMIT} hal; sisanya tetap dijaga apa adanya.`, `Emphasise at most ${FOCUS_LIMIT} things; everything else is left as it is.`)}</p>
              {conflict === 'summary-detail' && (
                <Alert tone="warning">{t('Format "Ringkasan" tidak bisa digabung dengan panjang "Lebih detail". Ubah salah satu di dua kolom di atas.', 'The "Summary" format cannot be combined with the "More detailed" length. Change one of the two fields above.')}</Alert>
              )}
            </div>
          ) : (
            <p className="border-t border-line px-3.5 py-2 text-xs leading-relaxed text-ink-500">{requestSummary(summary, t)}</p>
          )}
        </div>

        <section aria-label={t('Pratinjau skill', 'Skill preview')} className="rounded-xl border border-line bg-paper px-3.5 py-3">
          <div className="flex items-center gap-2.5">
            <StyleMark style={preview} size={28} />
            <p className="min-w-0 flex-1 truncate text-sm font-semibold text-ink-900">{trimmed || t('Skill tanpa nama', 'Unnamed skill')}</p>
            <span className="shrink-0 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-500">{modeLabel(summary.mode, t)}</span>
          </div>
          <p className="mt-2 text-xs leading-relaxed text-ink-600"><span className="font-semibold text-ink-800">{t('Yang diminta ke AI', 'What the AI is asked for')}:</span> {requestSummary(summary, t)}</p>
          {draft.description.trim() && <p className="mt-1.5 truncate text-xs text-ink-500">{draft.description.trim()}</p>}
          {summary.extra.trim() && <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-ink-500">“{summary.extra.trim()}”</p>}
          {summary.sample.trim() && <p className="mt-1.5 text-xs font-medium text-ink-600">{t('Contoh tulisan ikut dikirim sebagai acuan gaya.', 'A writing sample is sent as a style reference.')}</p>}
          {!trimmed && <p className="mt-2 text-xs font-medium text-amber-700">{t('Beri nama skill ini sebelum menyimpan.', 'Give this skill a name before saving.')}</p>}
        </section>
      </form>
      {confirmDelete && style && (
        <ConfirmDialog title={t('Hapus skill ini?', 'Delete this skill?')} tone="danger" busy={busy} confirmLabel={t('Hapus skill', 'Delete skill')} onClose={() => { if (!busy) setConfirmDelete(false); }} onConfirm={() => void remove()}>
          <p>{t('Skill', 'The skill')} <b className="text-ink-900">“{style.name}”</b> {t('akan dihapus. Notebook yang memakainya tetap menyimpan pengaturannya.', 'will be deleted. Notebooks using it keep their current settings.')}</p>
        </ConfirmDialog>
      )}
    </Modal>
  );
}
