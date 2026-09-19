'use client';
import { useState } from 'react';
import { AlignCenter, AlignLeft, AlignRight, Hash } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { FieldLabel, inputClass, Segmented } from '@/components/ui/Field';
import { useLocale } from '@/lib/client/locale';
import { asRunningText, MAX_RUNNING_CHARS, PAGE_TOKEN, PAGES_TOKEN, renderRunning, type RunningAlign, type RunningText } from '@/lib/docx/running';
import type { PageLayout } from './page-layout';

type Props = { layout: PageLayout; onClose: () => void; onApply: (layout: PageLayout) => void };
type Draft = { text: string; align: RunningAlign };

const ALIGN_ICONS = { left: AlignLeft, center: AlignCenter, right: AlignRight } as const;

function RunningField({ id, label, draft, onChange }: { id: string; label: string; draft: Draft; onChange: (draft: Draft) => void }) {
  const { t } = useLocale();
  const token = (value: string) => onChange({ ...draft, text: `${draft.text}${value}`.slice(0, MAX_RUNNING_CHARS) });
  return (
    <div>
      <FieldLabel htmlFor={id} hint={`${draft.text.length}/${MAX_RUNNING_CHARS}`}>{label}</FieldLabel>
      <input id={id} value={draft.text} maxLength={MAX_RUNNING_CHARS} className={inputClass}
        placeholder={t('Kosongkan untuk tidak menampilkan apa pun', 'Leave empty to show nothing')}
        onChange={(event) => onChange({ ...draft, text: event.target.value })} />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Segmented<RunningAlign> size="sm" fit label={t('Perataan', 'Alignment')} value={draft.align} onChange={(align) => onChange({ ...draft, align })}
          options={(['left', 'center', 'right'] as const).map((align) => ({ value: align, label: { left: t('Kiri', 'Left'), center: t('Tengah', 'Centre'), right: t('Kanan', 'Right') }[align], icon: ALIGN_ICONS[align] }))} />
        <span className="flex gap-1.5">
          <button type="button" onClick={() => token(PAGE_TOKEN)} className="inline-flex h-7 items-center gap-1 rounded-lg border border-line-strong bg-white px-2 text-xs font-semibold text-ink-600 hover:border-ink-300 hover:text-ink-900">
            <Hash size={12} aria-hidden="true" />{t('Nomor halaman', 'Page number')}
          </button>
          <button type="button" onClick={() => token(PAGES_TOKEN)} className="inline-flex h-7 items-center rounded-lg border border-line-strong bg-white px-2 text-xs font-semibold text-ink-600 hover:border-ink-300 hover:text-ink-900">
            {t('Total halaman', 'Total pages')}
          </button>
        </span>
      </div>
      {draft.text.trim() && (
        <p className="mt-2 truncate rounded-lg bg-paper px-2.5 py-1.5 text-xs text-ink-500">
          {t('Halaman 2 dari 5:', 'On page 2 of 5:')} <span className="text-ink-800">{renderRunning(draft.text, 2, 5)}</span>
        </p>
      )}
    </div>
  );
}

export function HeaderFooterDialog({ layout, onClose, onApply }: Props) {
  const { t } = useLocale();
  const [header, setHeader] = useState<Draft>({ text: layout.header?.text ?? '', align: layout.header?.align ?? 'left' });
  const [footer, setFooter] = useState<Draft>({ text: layout.footer?.text ?? '', align: layout.footer?.align ?? 'center' });
  const apply = () => onApply({
    ...layout,
    header: asRunningText(header.text, header.align) as RunningText | null,
    footer: asRunningText(footer.text, footer.align) as RunningText | null,
  });
  return (
    <Modal title={t('Header & footer', 'Header & footer')} description={t('Satu baris teks yang diulang di setiap halaman, lengkap dengan nomor halaman.', 'One line of text repeated on every page, page numbers included.')}
      size="md" onClose={onClose}
      footer={<><Button onClick={onClose}>{t('Batal', 'Cancel')}</Button><Button variant="primary" onClick={apply}>{t('Terapkan', 'Apply')}</Button></>}>
      <div className="space-y-6">
        <RunningField id="running-header" label={t('Header', 'Header')} draft={header} onChange={setHeader} />
        <RunningField id="running-footer" label={t('Footer', 'Footer')} draft={footer} onChange={setFooter} />
      </div>
    </Modal>
  );
}
