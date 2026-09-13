'use client';
import { useEffect, useRef } from 'react';
import { X, type LucideIcon } from 'lucide-react';
import { useLocale } from '@/lib/client/locale';

export function Drawer({ title, icon: Icon, description, children, onClose }: { title: string; icon?: LucideIcon; description?: string; children: React.ReactNode; onClose: () => void }) {
  const { t } = useLocale();
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const node = ref.current; if (node && !node.open) node.showModal(); return () => node?.close(); }, []);
  return (
    <dialog ref={ref} aria-labelledby="drawer-title" onCancel={(event) => { event.preventDefault(); onClose(); }} onClick={(event) => { if (event.target === ref.current) onClose(); }}
      className="m-0 ml-auto h-dvh max-h-none w-full max-w-md border-l border-line bg-white p-0 text-ink-900 shadow-2xl animate-slide-in">
      <div className="flex h-full flex-col">
        <header className="flex shrink-0 items-start gap-3 border-b border-line px-5 py-4">
          {Icon && <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-700"><Icon size={18} aria-hidden="true" /></span>}
          <div className="min-w-0 flex-1"><h2 id="drawer-title" className="font-semibold text-ink-950">{title}</h2>{description && <p className="mt-0.5 text-[13px] text-ink-500">{description}</p>}</div>
          <button type="button" onClick={onClose} aria-label={t('Tutup', 'Close')} className="grid h-8 w-8 place-items-center rounded-lg text-ink-400 hover:bg-ink-100 hover:text-ink-900"><X size={18} /></button>
        </header>
        <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">{children}</div>
      </div>
    </dialog>
  );
}
