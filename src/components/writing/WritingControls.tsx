'use client';
import { useEffect, useId, useState } from 'react';
import { Check, ChevronDown, RotateCcw, SlidersHorizontal, X } from 'lucide-react';
import { useLocale } from '@/lib/client/locale';
import { defaults, EXTRA_LIMIT, FOCUS_LIMIT, type Mode, type Settings, type Strength } from '@/lib/writing/settings';
import { Button } from '@/components/ui/Button';
import { FieldLabel, inputClass, Segmented, Select } from '@/components/ui/Field';
import {
  academicOptions, AUDIENCE_PRESETS, audienceOptions, contextOptions, documentTypeOptions, focusOptions, formatOptions, lengthOptions,
  MODES, modeHint, modeIcon, modeLabel, modeToneClass, preservationOptions, requestSummary, strengthOptions,
} from './modes';

export function ModePicker({ value, onChange, includeCustom = false, layout = 'row', disabled }: { value: Mode; onChange: (mode: Mode) => void; includeCustom?: boolean; layout?: 'row' | 'grid'; disabled?: boolean }) {
  const { t } = useLocale();
  const modes: Mode[] = includeCustom ? [...MODES, 'custom'] : MODES;
  return (
    <div role="radiogroup" aria-label={t('Mode penulisan', 'Writing mode')} className={layout === 'grid' ? 'grid grid-cols-2 gap-1.5' : 'flex flex-wrap gap-2'}>
      {modes.map((mode) => {
        const Icon = modeIcon[mode]; const active = mode === value;
        return (
          <button key={mode} type="button" role="radio" aria-checked={active} disabled={disabled} title={modeHint(mode, t)} onClick={() => onChange(mode)}
            className={`group inline-flex items-center gap-2 rounded-lg border text-left font-semibold transition-colors disabled:opacity-50 ${layout === 'grid' ? 'h-10 px-2.5 text-[13px]' : 'h-9 px-3.5 text-[13px]'} ${active ? 'border-brand-400 bg-brand-50 text-brand-800' : 'border-line bg-white text-ink-700 hover:border-line-strong hover:text-ink-900'}`}>
            <Icon size={15} aria-hidden="true" className={active ? modeToneClass(mode).ink : 'text-ink-400 group-hover:text-ink-600'} />
            <span className="truncate">{modeLabel(mode, t)}</span>
          </button>
        );
      })}
    </div>
  );
}

export function ModeOptions({ settings, onChange, disabled }: { settings: Settings; onChange: (settings: Settings) => void; disabled?: boolean }) {
  const { t } = useLocale();
  const id = useId();
  const set = <K extends keyof Settings>(key: K, value: Settings[K]) => onChange({ ...settings, [key]: value });
  const strength = (label: string) => (
    <div><FieldLabel>{label}</FieldLabel><Segmented<Strength> label={label} value={settings.strength as Strength} disabled={disabled} onChange={(value) => set('strength', value)} options={strengthOptions(t)} /></div>
  );
  switch (settings.mode) {
    case 'standard': return strength(t('Kekuatan perubahan', 'Change strength'));
    case 'academic': return <div><FieldLabel htmlFor={`${id}-ac`}>{t('Konteks akademik', 'Academic context')}</FieldLabel><Select id={`${id}-ac`} value={settings.academic} disabled={disabled} onChange={(value) => set('academic', value)} options={academicOptions(t)} /></div>;
    case 'humanize': return (
      <div className="space-y-3">
        <div><FieldLabel>{t('Konteks tulisan', 'Writing context')}</FieldLabel><Segmented label={t('Konteks tulisan', 'Writing context')} value={settings.context} disabled={disabled} onChange={(value) => set('context', value)} options={contextOptions(t)} /></div>
        {strength(t('Kekuatan', 'Strength'))}
        <details className="group rounded-lg border border-line bg-paper/50 px-3 py-2">
          <summary className="flex cursor-pointer list-none items-center justify-between text-[13px] font-semibold text-ink-600">{t('Lanjutan: pertahankan makna', 'Advanced: meaning preservation')}<ChevronDown size={15} className="transition-transform group-open:rotate-180" /></summary>
          <div className="mt-2.5"><Segmented label={t('Pertahankan makna', 'Meaning preservation')} value={settings.preservation} disabled={disabled} onChange={(value) => set('preservation', value)} options={preservationOptions(t)} size="sm" /></div>
        </details>
      </div>
    );
    case 'professional': return <div><FieldLabel htmlFor={`${id}-dt`}>{t('Jenis dokumen', 'Document type')}</FieldLabel><Select id={`${id}-dt`} value={settings.documentType} disabled={disabled} onChange={(value) => set('documentType', value)} options={documentTypeOptions(t)} /></div>;
    case 'creative': return (
      <div className="space-y-3">
        {strength(t('Tingkat kreativitas', 'Creativity'))}
        <div><FieldLabel htmlFor={`${id}-cg`} hint={t('opsional', 'optional')}>{t('Tujuan gaya', 'Style goal')}</FieldLabel><input id={`${id}-cg`} className={inputClass} value={settings.creativeGoal} maxLength={200} disabled={disabled} placeholder={t('Mis. caption Instagram yang hangat', 'E.g. a warm Instagram caption')} onChange={(event) => set('creativeGoal', event.target.value)} /></div>
      </div>
    );
    case 'simplify': return <div><FieldLabel htmlFor={`${id}-rl`} hint={t('opsional', 'optional')}>{t('Tingkat pembaca', 'Reading level')}</FieldLabel><input id={`${id}-rl`} className={inputClass} value={settings.readingLevel} maxLength={100} disabled={disabled} placeholder={t('Mis. siswa SMA', 'E.g. high-school student')} onChange={(event) => set('readingLevel', event.target.value)} /></div>;
    default: return <p className="text-[13px] text-ink-500">{t('Mode ini hanya memakai pengaturan di "Sesuaikan hasil".', 'This mode only uses your "Customize result" settings.')}</p>;
  }
}

type CustomFields = Pick<Settings, 'format' | 'length' | 'audience' | 'focus' | 'extra'>;
const pickCustom = (settings: Settings): CustomFields => ({ format: settings.format, length: settings.length, audience: settings.audience, focus: settings.focus, extra: settings.extra });

export function CustomizePanel({ settings, onChange, disabled, defaultOpen = false, embedded = false, onClose }: { settings: Settings; onChange: (settings: Settings) => void; disabled?: boolean; defaultOpen?: boolean; embedded?: boolean; onClose?: () => void }) {
  const { t } = useLocale();
  const id = useId();
  const [open, setOpen] = useState(embedded || defaultOpen || settings.mode === 'custom');
  const [draft, setDraft] = useState<CustomFields>(() => pickCustom(settings));
  useEffect(() => { if (settings.mode === 'custom') { setDraft(pickCustom(settings)); setOpen(true); } }, [settings.mode]); // eslint-disable-line react-hooks/exhaustive-deps
  const dirty = JSON.stringify(draft) !== JSON.stringify(pickCustom(settings));
  const audienceChoice = AUDIENCE_PRESETS.includes(draft.audience) ? draft.audience : 'other';
  const toggle = () => { if (!open) setDraft(pickCustom(settings)); setOpen(!open); };
  const apply = () => { onChange({ ...settings, ...draft, focus: draft.focus.slice(0, FOCUS_LIMIT), extra: draft.extra.slice(0, EXTRA_LIMIT), audience: draft.audience.trim() || 'general_public', customized: true }); close(); };
  const reset = () => { const base = pickCustom(defaults); setDraft(base); onChange({ ...settings, ...base, customized: false }); };
  const active = settings.customized || settings.mode === 'custom';
  function close() { if (embedded) onClose?.(); else setOpen(false); }

  return (
    <div className={embedded ? '' : `rounded-xl border ${open ? 'border-line-strong bg-white' : 'border-line bg-white/60'}`}>
      {!embedded && <button type="button" onClick={toggle} aria-expanded={open} aria-controls={`${id}-panel`} className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left">
        <SlidersHorizontal size={16} className="text-brand-700" aria-hidden="true" />
        <span className="flex-1 text-[13px] font-semibold text-ink-800">{t('Sesuaikan hasil', 'Customize result')}</span>
        {active && !open && <span className="rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-semibold text-brand-800">{t('Aktif', 'On')}</span>}
        <ChevronDown size={16} className={`text-ink-400 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
      </button>}
      {open && (
        <div id={`${id}-panel`} className={`grid gap-x-5 gap-y-4 ${embedded ? 'md:grid-cols-2' : 'border-t border-line px-3.5 pb-4 pt-3.5'}`}>
            <div>
              <FieldLabel htmlFor={`${id}-fmt`}>{t('Format', 'Format')}</FieldLabel>
              <Select id={`${id}-fmt`} value={draft.format} disabled={disabled} onChange={(value) => setDraft({ ...draft, format: value })} options={formatOptions(t).map((option) => ({ ...option, disabled: option.value === 'short_summary' && draft.length === 'more_detailed' }))} />
            </div>
            <div>
              <FieldLabel htmlFor={`${id}-aud`}>{t('Pembaca', 'Audience')}</FieldLabel>
              <Select id={`${id}-aud`} value={audienceChoice} disabled={disabled} onChange={(value) => setDraft({ ...draft, audience: value === 'other' ? '' : value })} options={audienceOptions(t)} />
              {audienceChoice === 'other' && <input aria-label={t('Pembaca lainnya', 'Other audience')} className={`${inputClass} mt-2`} maxLength={80} value={draft.audience} placeholder={t('Mis. investor', 'E.g. investors')} onChange={(event) => setDraft({ ...draft, audience: event.target.value })} />}
            </div>
          <div>
            <FieldLabel>{t('Panjang', 'Length')}</FieldLabel>
            <Segmented label={t('Panjang', 'Length')} value={draft.length} disabled={disabled} onChange={(value) => setDraft({ ...draft, length: value === 'more_detailed' && draft.format === 'short_summary' ? 'same' : value })} options={lengthOptions(t)} />
            {draft.format === 'short_summary' && <p className="mt-1.5 text-xs text-ink-400">{t('"Lebih detail" tidak bisa digabung dengan ringkasan.', '"More detailed" cannot be combined with a summary.')}</p>}
          </div>
          <fieldset>
            <legend className="mb-1.5 text-[13px] font-semibold text-ink-700">{t('Fokus', 'Focus')} <span className="font-normal text-ink-400">({t(`opsional, maks. ${FOCUS_LIMIT}`, `optional, max ${FOCUS_LIMIT}`)} · {draft.focus.length}/{FOCUS_LIMIT})</span></legend>
            <div className="flex flex-wrap gap-1.5">
              {focusOptions(t).map((option) => {
                const on = draft.focus.includes(option.value); const full = !on && draft.focus.length >= FOCUS_LIMIT;
                return (
                  <button key={option.value} type="button" aria-pressed={on} disabled={disabled || full} title={full ? t(`Maksimal ${FOCUS_LIMIT} fokus`, `Up to ${FOCUS_LIMIT} focus areas`) : undefined} onClick={() => setDraft({ ...draft, focus: on ? draft.focus.filter((value) => value !== option.value) : [...draft.focus, option.value].slice(0, FOCUS_LIMIT) })}
                    className={`inline-flex h-8 items-center gap-1.5 rounded-full border px-2.5 text-xs font-semibold transition-colors disabled:opacity-45 ${on ? 'border-brand-300 bg-brand-50 text-brand-800' : 'border-line-strong bg-white text-ink-600 hover:border-ink-300'}`}>
                    {on && <Check size={13} aria-hidden="true" />}{option.label}
                  </button>
                );
              })}
            </div>
          </fieldset>
          <div className={embedded ? 'md:col-span-2' : ''}>
            <FieldLabel htmlFor={`${id}-extra`} hint={`${draft.extra.length}/${EXTRA_LIMIT}`}>{t('Permintaan tambahan', 'Additional request')}</FieldLabel>
            <textarea id={`${id}-extra`} rows={2} maxLength={EXTRA_LIMIT} disabled={disabled} value={draft.extra} onChange={(event) => setDraft({ ...draft, extra: event.target.value.slice(0, EXTRA_LIMIT) })}
              placeholder={t('Mis. "Jangan ubah nama variabel" atau "Fokus pada kesimpulan"', 'E.g. "Keep variable names" or "Focus on the conclusion"')}
              className={`${inputClass} h-auto resize-none py-2 leading-relaxed`} />
          </div>
          <div className={`flex flex-wrap items-center justify-between gap-2 ${embedded ? 'border-t border-line pt-3.5 md:col-span-2' : ''}`}>
            <Button size="sm" variant="ghost" icon={RotateCcw} disabled={disabled} onClick={reset}>{t('Reset', 'Reset')}</Button>
            <div className="flex gap-2">
              <Button size="sm" icon={X} onClick={close}>{t('Tutup', 'Close')}</Button>
              <Button size="sm" variant="primary" icon={Check} disabled={disabled || (!dirty && settings.customized)} onClick={apply}>{t('Terapkan', 'Apply')}</Button>
            </div>
          </div>
        </div>
      )}
      {!embedded && !open && active && <p className="border-t border-line px-3.5 py-2 text-xs leading-relaxed text-ink-500">{requestSummary(settings, t)}</p>}
    </div>
  );
}
