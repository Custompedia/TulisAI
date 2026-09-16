'use client';
import { useId, useState } from 'react';
import { Check, ChevronDown, RotateCcw, SlidersHorizontal, X } from 'lucide-react';
import { useLocale } from '@/lib/client/locale';
import { AUDIENCES, defaults, EXTRA_LIMIT, FOCUS_LIMIT, type Mode, type Settings } from '@/lib/writing/settings';
import { Button } from '@/components/ui/Button';
import { FieldLabel, inputClass } from '@/components/ui/Field';
import { HintSelect } from '@/components/ui/HintSelect';
import {
  academicOptions, audienceOptions, contextOptions, creativityOptions, focusOptions, formatOptions, humanizeStrengthOptions, lengthOptions,
  MODES, modeHint, modeIcon, modeLabel, modeToneClass, preservationOptions, recipientOptions, requestSummary, simplifyForOptions, strengthOptions,
} from './modes';

export function ModePicker({ value, onChange, layout = 'row', disabled }: { value: Mode; onChange: (mode: Mode) => void; layout?: 'row' | 'grid'; disabled?: boolean }) {
  const { t } = useLocale();
  return (
    <div role="radiogroup" aria-label={t('Mode penulisan', 'Writing mode')} className={layout === 'grid' ? 'grid grid-cols-2 gap-1.5' : 'flex flex-wrap gap-2'}>
      {MODES.map((mode) => {
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

export function ModeOptions({ settings, onChange, disabled, compact = false }: { settings: Settings; onChange: (settings: Settings) => void; disabled?: boolean; compact?: boolean }) {
  const { t } = useLocale();
  const id = useId();
  const set = <K extends keyof Settings>(key: K, value: Settings[K]) => onChange({ ...settings, [key]: value });
  const field = <V extends string>(key: string, label: string, value: V, options: Array<{ value: V; label: string; hint?: string }>, update: (value: V) => void) => compact ? (
    <div key={key} className="flex items-center gap-3"><label htmlFor={`${id}-${key}`} className="min-w-0 flex-1 truncate text-[13px] text-ink-600">{label}</label><div className="w-[55%] shrink-0"><HintSelect size="sm" align="end" id={`${id}-${key}`} label={label} value={value} options={options} disabled={disabled} onChange={update} /></div></div>
  ) : (
    <div key={key}><FieldLabel htmlFor={`${id}-${key}`}>{label}</FieldLabel><HintSelect id={`${id}-${key}`} label={label} value={value} options={options} disabled={disabled} onChange={update} /></div>
  );
  switch (settings.mode) {
    case 'standard': return field('strength', t('Kekuatan perubahan', 'Change strength'), settings.strength, strengthOptions(t), (value) => set('strength', value));
    case 'academic': return field('academic', t('Konteks akademik', 'Academic context'), settings.academic, academicOptions(t), (value) => set('academic', value));
    case 'humanize': return (
      <div className={compact ? 'space-y-2' : 'space-y-3'}>
        {field('context', t('Register tulisan', 'Writing register'), settings.context, contextOptions(t), (value) => set('context', value))}
        {field('strength', t('Kekuatan', 'Strength'), settings.strength, humanizeStrengthOptions(t), (value) => set('strength', value))}
        {field('preservation', t('Batas perubahan', 'Change limit'), settings.preservation, preservationOptions(t), (value) => set('preservation', value))}
      </div>
    );
    case 'professional': return field('recipient', t('Ditujukan untuk', 'Addressed to'), settings.recipient, recipientOptions(t), (value) => set('recipient', value));
    case 'creative': return field('creativity', t('Tingkat kreativitas', 'Creativity'), settings.strength, creativityOptions(t), (value) => set('strength', value));
    case 'simplify': return field('simplify', t('Untuk siapa', 'Written for'), settings.simplifyFor, simplifyForOptions(t), (value) => set('simplifyFor', value));
  }
}

export type CustomFields = Pick<Settings, 'format' | 'length' | 'audience' | 'focus' | 'extra'>;
export const pickCustom = (settings: Settings): CustomFields => ({ format: settings.format, length: settings.length, audience: settings.audience, focus: settings.focus, extra: settings.extra });

// Format, audience, length, emphasis and (optionally) the note; shared by the panel and the style dialog.
export function CustomFields({ draft, onChange, disabled, embedded = false, showExtra = true }: { draft: CustomFields; onChange: (draft: CustomFields) => void; disabled?: boolean; embedded?: boolean; showExtra?: boolean }) {
  const { t } = useLocale();
  const id = useId();
  return (
    <>
      <div>
        <FieldLabel htmlFor={`${id}-fmt`}>{t('Format', 'Format')}</FieldLabel>
        <HintSelect id={`${id}-fmt`} label={t('Format', 'Format')} value={draft.format} disabled={disabled} onChange={(value) => onChange({ ...draft, format: value })} options={formatOptions(t).map((option) => ({ ...option, disabled: option.value === 'short_summary' && draft.length === 'more_detailed' }))} />
      </div>
      <div>
        <FieldLabel htmlFor={`${id}-aud`}>{t('Pembaca', 'Audience')}</FieldLabel>
        <HintSelect id={`${id}-aud`} label={t('Pembaca', 'Audience')} value={draft.audience} disabled={disabled} onChange={(value) => onChange({ ...draft, audience: value })} options={audienceOptions(t)} />
      </div>
      <div>
        <FieldLabel htmlFor={`${id}-len`}>{t('Panjang', 'Length')}</FieldLabel>
        <HintSelect id={`${id}-len`} label={t('Panjang', 'Length')} value={draft.length} disabled={disabled} onChange={(value) => onChange({ ...draft, length: value })} options={lengthOptions(t).map((option) => ({ ...option, disabled: option.value === 'more_detailed' && draft.format === 'short_summary' }))} />
        {draft.format === 'short_summary' && <p className="mt-1.5 text-xs text-ink-500">{t('"Lebih detail" tidak bisa digabung dengan ringkasan.', '"More detailed" cannot be combined with a summary.')}</p>}
      </div>
      <fieldset>
        <legend className="mb-1.5 text-[13px] font-semibold text-ink-700">{t('Penekanan', 'Emphasis')} <span className="font-normal text-ink-500">({t(`maksimal ${FOCUS_LIMIT}`, `up to ${FOCUS_LIMIT}`)} · {draft.focus.length}/{FOCUS_LIMIT})</span></legend>
        <div className="flex flex-wrap gap-1.5">
          {focusOptions(t).map((option) => {
            const on = draft.focus.includes(option.value); const full = !on && draft.focus.length >= FOCUS_LIMIT;
            return (
              <button key={option.value} type="button" aria-pressed={on} disabled={disabled || full} title={full ? t(`Maksimal ${FOCUS_LIMIT} penekanan`, `Up to ${FOCUS_LIMIT} emphases`) : option.hint} onClick={() => onChange({ ...draft, focus: on ? draft.focus.filter((value) => value !== option.value) : [...draft.focus, option.value].slice(0, FOCUS_LIMIT) })}
                className={`inline-flex h-8 items-center gap-1.5 rounded-full border px-2.5 text-xs font-semibold transition-colors disabled:opacity-45 ${on ? 'border-brand-300 bg-brand-50 text-brand-800' : 'border-line-strong bg-white text-ink-600 hover:border-ink-300'}`}>
                {on && <Check size={13} aria-hidden="true" />}{option.label}
              </button>
            );
          })}
        </div>
      </fieldset>
      {showExtra && (
        <div className={embedded ? 'md:col-span-2' : ''}>
          <FieldLabel htmlFor={`${id}-extra`} hint={`${draft.extra.length}/${EXTRA_LIMIT}`}>{t('Catatan untuk AI', 'Note for the AI')}</FieldLabel>
          <textarea id={`${id}-extra`} rows={2} maxLength={EXTRA_LIMIT} disabled={disabled} value={draft.extra} onChange={(event) => onChange({ ...draft, extra: event.target.value.slice(0, EXTRA_LIMIT) })}
            placeholder={t('Mis. jangan ubah istilah teknis', 'E.g. don’t change technical terms')}
            className={`${inputClass} h-auto resize-none py-2 leading-relaxed`} />
        </div>
      )}
    </>
  );
}

export function CustomizePanel({ settings, onChange, disabled, defaultOpen = false, embedded = false, onClose }: { settings: Settings; onChange: (settings: Settings) => void; disabled?: boolean; defaultOpen?: boolean; embedded?: boolean; onClose?: () => void }) {
  const { t } = useLocale();
  const id = useId();
  const [open, setOpen] = useState(embedded || defaultOpen);
  const [draft, setDraft] = useState<CustomFields>(() => pickCustom(settings));
  const dirty = JSON.stringify(draft) !== JSON.stringify(pickCustom(settings));
  const toggle = () => { if (!open) setDraft(pickCustom(settings)); setOpen(!open); };
  const apply = () => { onChange({ ...settings, ...draft, focus: draft.focus.slice(0, FOCUS_LIMIT), extra: draft.extra.slice(0, EXTRA_LIMIT), audience: AUDIENCES.includes(draft.audience) ? draft.audience : 'general_public', customized: true }); close(); };
  const reset = () => { const base = pickCustom(defaults); setDraft(base); onChange({ ...settings, ...base, customized: false }); };
  function close() { if (embedded) onClose?.(); else setOpen(false); }

  return (
    <div className={embedded ? '' : `rounded-lg border ${open ? 'border-line-strong bg-white' : 'border-line bg-white'}`}>
      {!embedded && <button type="button" onClick={toggle} aria-expanded={open} aria-controls={`${id}-panel`} className="flex h-9 w-full items-center gap-2 rounded-lg px-3 text-left transition-colors hover:bg-paper">
        <SlidersHorizontal size={15} className="text-ink-500" aria-hidden="true" />
        <span className="flex-1 text-[13px] font-medium text-ink-700">{t('Sesuaikan hasil', 'Customize result')}</span>
        {settings.customized && !open && <span className="rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-semibold text-brand-800">{t('Aktif', 'On')}</span>}
        <ChevronDown size={15} className={`text-ink-400 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
      </button>}
      {open && (
        <div id={`${id}-panel`} className={`grid gap-x-5 gap-y-4 ${embedded ? 'md:grid-cols-2' : 'border-t border-line px-3 pb-3.5 pt-3'}`}>
          <CustomFields draft={draft} onChange={setDraft} disabled={disabled} embedded={embedded} />
          <div className={`flex flex-wrap items-center justify-between gap-2 ${embedded ? 'border-t border-line pt-3.5 md:col-span-2' : ''}`}>
            <Button size="sm" variant="ghost" icon={RotateCcw} disabled={disabled} onClick={reset}>{t('Reset', 'Reset')}</Button>
            <div className="flex gap-2">
              <Button size="sm" icon={X} onClick={close}>{t('Tutup', 'Close')}</Button>
              <Button size="sm" variant="primary" icon={Check} disabled={disabled || (!dirty && settings.customized)} onClick={apply}>{t('Terapkan', 'Apply')}</Button>
            </div>
          </div>
        </div>
      )}
      {!embedded && !open && settings.customized && <p className="border-t border-line px-3 py-2 text-xs leading-relaxed text-ink-500">{requestSummary(settings, t)}</p>}
    </div>
  );
}
