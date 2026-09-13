'use client';
import { Columns2, Copy, History, PencilLine, RotateCcw } from 'lucide-react';
import { useLocale } from '@/lib/client/locale';
import { dateTime, relativeTime } from '@/lib/client/format';
import { modeFromPrompt } from '@/lib/writing/settings';
import { Drawer } from '@/components/ui/Drawer';
import { Button } from '@/components/ui/Button';
import { ModeBadge } from '@/components/app/DocumentCard';
import { kindIcon, kindLabel, kindTone, versionLabel } from './versions';
import type { Version } from './types';

type Props = { versions: Version[]; hasMore: boolean; loadingMore: boolean; busy: boolean; onLoadMore: () => void; onClose: () => void; onCompare: (version: Version) => void; onRestore: (version: Version) => void; onRename: (version: Version) => void; onDuplicate: (version: Version) => void };

export function HistoryDrawer({ versions, hasMore, loadingMore, busy, onLoadMore, onClose, onCompare, onRestore, onRename, onDuplicate }: Props) {
  const { t, locale } = useLocale();
  return (
    <Drawer title={t('Riwayat Versi', 'Version History')} icon={History} description={t('Setiap hasil AI dan versi yang kamu simpan. Memulihkan selalu membuat versi baru.', 'Every applied AI result and saved version. Restoring always creates a new version.')} onClose={onClose}>
      <ol className="divide-y divide-line">
        {versions.map((version) => {
          const Icon = kindIcon[version.kind];
          return (
            <li key={version.id} className="px-5 py-4">
              <div className="flex items-start gap-3">
                <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg border ${kindTone[version.kind]}`}><Icon size={15} aria-hidden="true" /></span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-ink-900">{versionLabel(version, t)}</p>
                  <p className="mt-0.5 text-xs text-ink-500" title={dateTime(version.createdAt, locale)}>{kindLabel(version.kind, t)} · {relativeTime(version.createdAt, locale)}</p>
                  {(version.promptId || version.scopeType) && (
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      <ModeBadge mode={modeFromPrompt(version.promptId)} />
                      {version.scopeType && <span className="rounded-md bg-paper-deep px-2 py-0.5 text-[11px] font-semibold text-ink-600">{version.scopeType === 'selection' ? t('Sebagian teks', 'Partial text') : t('Seluruh dokumen', 'Entire document')}</span>}
                    </div>
                  )}
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5 pl-11">
                <Button size="sm" icon={Columns2} disabled={busy} onClick={() => onCompare(version)}>{t('Bandingkan', 'Compare')}</Button>
                <Button size="sm" icon={RotateCcw} disabled={busy} onClick={() => onRestore(version)}>{t('Pulihkan', 'Restore')}</Button>
                {version.kind !== 'original' && <Button size="sm" variant="ghost" icon={PencilLine} disabled={busy} onClick={() => onRename(version)}>{t('Ubah nama', 'Rename')}</Button>}
                <Button size="sm" variant="ghost" icon={Copy} disabled={busy} onClick={() => onDuplicate(version)}>{t('Duplikat', 'Duplicate')}</Button>
              </div>
            </li>
          );
        })}
      </ol>
      {hasMore && <div className="px-5 pb-6 pt-2"><Button className="w-full" loading={loadingMore} onClick={onLoadMore}>{t('Muat versi sebelumnya', 'Load earlier versions')}</Button></div>}
    </Drawer>
  );
}
