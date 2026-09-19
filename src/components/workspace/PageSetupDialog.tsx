'use client';
import { useState } from 'react';
import { Columns2, Columns3, RectangleHorizontal, RectangleVertical, Square } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Alert } from '@/components/ui/Alert';
import { FieldLabel, inputClass, Segmented } from '@/components/ui/Field';
import { useLocale } from '@/lib/client/locale';
import { MAX_COLUMNS, pageGeometry, TWIPS_PER_INCH, type Orientation, type PageMargins, type PageSize } from '@/lib/docx/office-defaults';
import { MARGIN_PRESETS, marginUnit, sameMargins, twipsToUnit, unitToTwips, type PageLayout } from './page-layout';

type Props = { layout: PageLayout; language: string; onClose: () => void; onApply: (layout: PageLayout) => void };
const SIDES = ['top', 'bottom', 'left', 'right'] as const;

export function PageSetupDialog({ layout, language, onClose, onApply }: Props) {
  const { t } = useLocale();
  const unit = marginUnit(language);
  const [size, setSize] = useState<PageSize>(layout.size);
  const [orientation, setOrientation] = useState<Orientation>(layout.orientation);
  const [columns, setColumns] = useState(layout.columns);
  const [margins, setMargins] = useState<Record<(typeof SIDES)[number], string>>(
    Object.fromEntries(SIDES.map((side) => [side, String(twipsToUnit(layout.margins[side], unit))])) as Record<(typeof SIDES)[number], string>,
  );

  const parsed: PageMargins | null = (() => {
    const values = SIDES.map((side) => Number(margins[side].replace(',', '.')));
    if (values.some((value) => !Number.isFinite(value) || value < 0)) return null;
    const [top, bottom, left, right] = values.map((value) => unitToTwips(value, unit)) as [number, number, number, number];
    return { top, bottom, left, right };
  })();
  const page = pageGeometry(size, orientation);
  // The same rule the stored value has to satisfy: at least an inch of text has to be left on the sheet.
  const fits = !!parsed && page.width - parsed.left - parsed.right >= TWIPS_PER_INCH && page.height - parsed.top - parsed.bottom >= TWIPS_PER_INCH;
  const preset = SIDES.length && parsed ? (Object.entries(MARGIN_PRESETS).find(([, value]) => sameMargins(value, parsed))?.[0] ?? null) : null;

  const applyPreset = (name: keyof typeof MARGIN_PRESETS) =>
    setMargins(Object.fromEntries(SIDES.map((side) => [side, String(twipsToUnit(MARGIN_PRESETS[name][side], unit))])) as Record<(typeof SIDES)[number], string>);

  return (
    <Modal title={t('Pengaturan halaman', 'Page setup')} description={t('Berlaku untuk pratinjau berhalaman dan berkas DOCX yang diekspor.', 'Applies to the paged preview and to the exported DOCX file.')}
      size="md" onClose={onClose}
      footer={<>
        <Button onClick={onClose}>{t('Batal', 'Cancel')}</Button>
        <Button variant="primary" disabled={!fits} onClick={() => { if (fits && parsed) onApply({ ...layout, size, orientation, columns, margins: parsed }); }}>{t('Terapkan', 'Apply')}</Button>
      </>}>
      <div className="space-y-5">
        <div>
          <FieldLabel>{t('Ukuran kertas', 'Paper size')}</FieldLabel>
          <Segmented<PageSize> label={t('Ukuran kertas', 'Paper size')} value={size} onChange={setSize}
            options={[{ value: 'a4', label: 'A4 (21 × 29,7 cm)' }, { value: 'letter', label: 'Letter (8,5 × 11 in)' }]} />
        </div>
        <div>
          <FieldLabel>{t('Orientasi', 'Orientation')}</FieldLabel>
          <Segmented<Orientation> label={t('Orientasi', 'Orientation')} value={orientation} onChange={setOrientation}
            options={[
              { value: 'portrait', label: t('Tegak', 'Portrait'), icon: RectangleVertical },
              { value: 'landscape', label: t('Mendatar', 'Landscape'), icon: RectangleHorizontal },
            ]} />
        </div>
        <div>
          <FieldLabel hint={t('Ukuran dalam', 'Measured in') + ` ${unit === 'cm' ? 'cm' : 'inci'}`}>{t('Margin', 'Margins')}</FieldLabel>
          <div className="mb-2 flex flex-wrap gap-1.5">
            {(Object.keys(MARGIN_PRESETS) as Array<keyof typeof MARGIN_PRESETS>).map((name) => (
              <button key={name} type="button" onClick={() => applyPreset(name)}
                className={`h-7 rounded-lg border px-2.5 text-xs font-semibold transition-colors ${preset === name ? 'border-brand-300 bg-brand-50 text-brand-800' : 'border-line-strong bg-white text-ink-600 hover:border-ink-300 hover:text-ink-900'}`}>
                {{ normal: t('Normal', 'Normal'), narrow: t('Sempit', 'Narrow'), moderate: t('Sedang', 'Moderate'), wide: t('Lebar', 'Wide') }[name]}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {SIDES.map((side) => (
              <div key={side}>
                <label htmlFor={`margin-${side}`} className="mb-1 block text-xs font-medium text-ink-500">
                  {{ top: t('Atas', 'Top'), bottom: t('Bawah', 'Bottom'), left: t('Kiri', 'Left'), right: t('Kanan', 'Right') }[side]}
                </label>
                <input id={`margin-${side}`} inputMode="decimal" value={margins[side]} className={inputClass}
                  onChange={(event) => setMargins((current) => ({ ...current, [side]: event.target.value.replace(/[^\d.,]/gu, '') }))} />
              </div>
            ))}
          </div>
        </div>
        <div>
          <FieldLabel>{t('Kolom', 'Columns')}</FieldLabel>
          <Segmented<string> label={t('Kolom', 'Columns')} value={String(columns)} onChange={(value) => setColumns(Number(value))}
            options={Array.from({ length: MAX_COLUMNS }, (_, index) => ({
              value: String(index + 1), label: String(index + 1), icon: index === 0 ? Square : index === 1 ? Columns2 : Columns3,
            }))} />
          {columns > 1 && (
            <p className="mt-2 text-xs text-ink-500">
              {t('Teks berkolom ditampilkan sebagai satu halaman panjang di kanvas; pemisahan halaman baru terlihat di Word.',
                'Multi-column text is shown as one long sheet on the canvas; the page breaks appear in Word.')}
            </p>
          )}
        </div>
        {!fits && <Alert tone="error">{t('Margin terlalu besar untuk ukuran kertas ini — sisakan setidaknya 2,54 cm area teks.', 'These margins leave no room on this paper size — leave at least one inch of text area.')}</Alert>}
      </div>
    </Modal>
  );
}
