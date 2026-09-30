'use client';
import { Bot, Eye, History, PanelRightClose, PanelRightOpen, X, type LucideIcon } from 'lucide-react';
import { useLocale } from '@/lib/client/locale';
import { IconButton } from '@/components/ui/Button';

// Asisten | Riwayat | Tinjau. "Tinjau", not "Periksa": the toolbar already says "periksa ejaan" and "Daftar periksa".
export type StudioTab = 'assistant' | 'history' | 'review';

type Props = { tab: StudioTab; onTab: (tab: StudioTab) => void; onClose: () => void; narrow: boolean; children: React.ReactNode };

export function useStudioTabs(): Array<{ id: StudioTab; icon: LucideIcon; label: string }> {
  const { t } = useLocale();
  return [{ id: 'assistant', icon: Bot, label: t('Asisten', 'Assistant') }, { id: 'history', icon: History, label: t('Riwayat', 'History') }, { id: 'review', icon: Eye, label: t('Tinjau', 'Review') }];
}

export function StudioPanel({ tab, onTab, onClose, narrow, children }: Props) {
  const { t } = useLocale();
  const tabs = useStudioTabs();
  return (
    <section aria-label={t('Panel kanan', 'Side panel')} className="flex h-full min-w-0 flex-col overflow-hidden rounded-2xl border border-line bg-white">
      <header className="flex h-12 shrink-0 items-center gap-1 border-b border-line pl-1.5 pr-1.5">
        <div role="tablist" aria-label={t('Bagian panel', 'Panel sections')} className="flex h-full min-w-0 flex-1 items-stretch gap-0.5">
          {tabs.map(({ id, icon: Icon, label }) => (
            <button key={id} type="button" role="tab" id={`studio-tab-${id}`} aria-selected={tab === id} aria-controls="studio-tabpanel" onClick={() => onTab(id)}
              className={`relative inline-flex min-w-0 shrink-0 items-center gap-1 px-2 text-[13px] font-medium outline-none transition-colors focus-visible:text-ink-900 ${tab === id ? 'text-ink-900 after:absolute after:inset-x-2 after:-bottom-px after:h-0.5 after:rounded-full after:bg-brand-700' : 'text-ink-500 hover:text-ink-900'}`}>
              <Icon size={14} aria-hidden="true" className="shrink-0" /><span className="truncate">{label}</span>
            </button>
          ))}
        </div>
        <IconButton size="sm" icon={narrow ? X : PanelRightClose} label={narrow ? t('Tutup panel', 'Close panel') : t('Ciutkan panel', 'Collapse panel')} onClick={onClose} />
      </header>
      <div role="tabpanel" id="studio-tabpanel" aria-labelledby={`studio-tab-${tab}`} className="min-h-0 flex-1">{children}</div>
    </section>
  );
}

export function StudioStrip({ onOpen }: { onOpen: (tab?: StudioTab) => void }) {
  const { t } = useLocale();
  const tabs = useStudioTabs();
  return (
    <aside aria-label={t('Panel kanan', 'Side panel')} className="flex h-full flex-col items-center gap-1 overflow-hidden rounded-2xl border border-line bg-white py-2">
      <IconButton size="sm" icon={PanelRightOpen} label={t('Buka panel', 'Open panel')} onClick={() => onOpen()} />
      <span aria-hidden="true" className="my-1 h-px w-6 bg-line" />
      {tabs.map(({ id, icon, label }) => <IconButton key={id} size="sm" icon={icon} label={label} onClick={() => onOpen(id)} />)}
    </aside>
  );
}
