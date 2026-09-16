'use client';
import { Bot, History, Info, PanelRightClose, PanelRightOpen, X, type LucideIcon } from 'lucide-react';
import { useLocale } from '@/lib/client/locale';
import { IconButton } from '@/components/ui/Button';

export type StudioTab = 'assistant' | 'history' | 'info';

type Props = { tab: StudioTab; onTab: (tab: StudioTab) => void; onClose: () => void; narrow: boolean; children: React.ReactNode };

function useTabs(): Array<{ id: StudioTab; icon: LucideIcon; label: string }> {
  const { t } = useLocale();
  return [{ id: 'assistant', icon: Bot, label: t('Asisten', 'Assistant') }, { id: 'history', icon: History, label: t('Riwayat', 'History') }, { id: 'info', icon: Info, label: 'Info' }];
}

export function StudioPanel({ tab, onTab, onClose, narrow, children }: Props) {
  const { t } = useLocale();
  const tabs = useTabs();
  return (
    <section aria-label="Studio" className="flex h-full min-w-0 flex-col overflow-hidden rounded-2xl border border-line bg-white">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-line pl-4 pr-2">
        <h2 className="flex-1 truncate text-[15px] font-medium text-ink-900">Studio</h2>
        <IconButton size="sm" icon={narrow ? X : PanelRightClose} label={narrow ? t('Tutup Studio', 'Close Studio') : t('Ciutkan Studio', 'Collapse Studio')} onClick={onClose} />
      </header>
      <div className="shrink-0 px-3 pt-3">
        <div role="tablist" aria-label={t('Bagian Studio', 'Studio sections')} className="grid grid-cols-3 gap-1 rounded-xl bg-paper-deep p-1">
          {tabs.map(({ id, icon: Icon, label }) => (
            <button key={id} type="button" role="tab" id={`studio-tab-${id}`} aria-selected={tab === id} aria-controls="studio-tabpanel" onClick={() => onTab(id)}
              className={`inline-flex h-8 min-w-0 items-center justify-center gap-1.5 rounded-lg px-2 text-[13px] font-medium transition-colors ${tab === id ? 'bg-white text-ink-900 shadow-[0_1px_2px_rgb(31_32_29/0.08)]' : 'text-ink-600 hover:text-ink-900'}`}>
              <Icon size={14} aria-hidden="true" className="shrink-0" /><span className="truncate">{label}</span>
            </button>
          ))}
        </div>
      </div>
      <div role="tabpanel" id="studio-tabpanel" aria-labelledby={`studio-tab-${tab}`} className="min-h-0 flex-1">{children}</div>
    </section>
  );
}

export function StudioStrip({ onOpen }: { onOpen: (tab?: StudioTab) => void }) {
  const { t } = useLocale();
  const tabs = useTabs();
  return (
    <aside aria-label="Studio" className="flex h-full flex-col items-center gap-1 overflow-hidden rounded-2xl border border-line bg-white py-2">
      <IconButton size="sm" icon={PanelRightOpen} label={t('Buka Studio', 'Open Studio')} onClick={() => onOpen()} />
      <span aria-hidden="true" className="my-1 h-px w-6 bg-line" />
      {tabs.map(({ id, icon, label }) => <IconButton key={id} size="sm" icon={icon} label={label} onClick={() => onOpen(id)} />)}
    </aside>
  );
}
