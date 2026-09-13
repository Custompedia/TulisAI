'use client';
import { ChevronDown, ChevronUp, History, PenLine, Save } from 'lucide-react';
import { useLocale } from '@/lib/client/locale';
import { dateTime } from '@/lib/client/format';
import { Button } from '@/components/ui/Button';
import { kindIcon, kindTone, versionLabel } from './versions';
import type { Version } from './types';

type Props = { versions: Version[]; open: boolean; onToggle: () => void; onPick: (version: Version) => void; onHistory: () => void; onSave: () => void; disabled: boolean; dirty: boolean };

export function VersionTimeline({ versions, open, onToggle, onPick, onHistory, onSave, disabled, dirty }: Props) {
  const { t, locale } = useLocale();
  const ordered = [...versions].reverse();
  return (
    <section aria-label={t('Linimasa versi', 'Version timeline')} className="shrink-0 border-t border-line bg-white">
      <div className="flex h-11 items-center gap-2 px-3 sm:px-4">
        <button type="button" onClick={onToggle} aria-expanded={open} className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-[13px] font-semibold text-ink-700 hover:bg-ink-100/70">
          <History size={15} aria-hidden="true" />{t('Linimasa versi', 'Version timeline')}<span className="text-xs font-medium text-ink-400">{versions.length}</span>
          {open ? <ChevronDown size={15} /> : <ChevronUp size={15} />}
        </button>
        <div className="ml-auto flex gap-1">
          <Button size="sm" variant="ghost" icon={History} onClick={onHistory}>{t('Riwayat Versi', 'Version History')}</Button>
          <Button size="sm" icon={Save} disabled={disabled} onClick={onSave}>{t('Simpan Versi', 'Save Version')}</Button>
        </div>
      </div>
      {open && (
        <ol className="scrollbar-thin flex items-center gap-1.5 overflow-x-auto px-4 pb-3">
          {ordered.map((version, index) => {
            const Icon = kindIcon[version.kind];
            return (
              <li key={version.id} className="flex shrink-0 items-center gap-1.5">
                {index > 0 && <span aria-hidden="true" className="h-px w-4 bg-line-strong" />}
                <button type="button" onClick={() => onPick(version)} title={`${versionLabel(version, t)} · ${dateTime(version.createdAt, locale)} — ${t('bandingkan dengan tulisan saat ini', 'compare with current')}`}
                  className={`inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-semibold transition-shadow hover:shadow-sm ${kindTone[version.kind]}`}>
                  <Icon size={13} aria-hidden="true" /><span className="max-w-40 truncate">{versionLabel(version, t)}</span>
                </button>
              </li>
            );
          })}
          <li className="flex shrink-0 items-center gap-1.5">
            <span aria-hidden="true" className="h-px w-4 bg-line-strong" />
            <span aria-current="true" className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-ink-950 px-2.5 text-xs font-semibold text-white"><PenLine size={13} aria-hidden="true" />{t('Sekarang', 'Current')}{dirty && <span className="h-1.5 w-1.5 rounded-full bg-amber-400" aria-label={t('ada perubahan belum tersimpan', 'unsaved changes')} />}</span>
          </li>
        </ol>
      )}
    </section>
  );
}
