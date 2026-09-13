'use client';
import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { useLocale } from '@/lib/client/locale';
import { Button } from './Button';

type ModalProps = { title: string; description?: string; children?: React.ReactNode; footer?: React.ReactNode; onClose: () => void; busy?: boolean; size?: 'sm' | 'md' | 'lg' | 'xl'; dismissible?: boolean };

export function Modal({ title, description, children, footer, onClose, busy = false, size = 'md', dismissible = true }: ModalProps) {
  const canClose = dismissible && !busy;
  const { t } = useLocale();
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const node = ref.current; if (node && !node.open) node.showModal(); return () => node?.close(); }, []);
  const width = { sm: 'max-w-md', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-5xl' }[size];
  return (
    <dialog
      ref={ref}
      aria-labelledby="modal-title"
      onCancel={(event) => { event.preventDefault(); if (canClose) onClose(); }}
      onClick={(event) => { if (event.target === ref.current && canClose) onClose(); }}
      className={`m-auto w-[calc(100%-2rem)] ${width} rounded-2xl border border-line bg-white p-0 text-ink-900 shadow-2xl`}
    >
      <div className="flex max-h-[85vh] flex-col">
        <header className="flex items-start gap-4 border-b border-line px-6 py-5">
          <div className="min-w-0 flex-1">
            <h2 id="modal-title" className="text-lg font-semibold tracking-tight">{title}</h2>
            {description && <p className="mt-1 text-sm text-ink-500">{description}</p>}
          </div>
          {dismissible && <button type="button" onClick={onClose} disabled={busy} aria-label={t('Tutup', 'Close')} className="-mr-2 grid h-8 w-8 place-items-center rounded-lg text-ink-400 hover:bg-ink-100 hover:text-ink-900 disabled:opacity-40"><X size={18} /></button>}
        </header>
        {children && <div className="scrollbar-thin overflow-y-auto px-6 py-5 text-sm leading-relaxed text-ink-700">{children}</div>}
        {footer && <footer className="flex flex-wrap justify-end gap-2 border-t border-line bg-paper/60 px-6 py-4">{footer}</footer>}
      </div>
    </dialog>
  );
}

export function ConfirmDialog({ title, description, children, confirmLabel, cancelLabel, tone = 'primary', busy = false, disabled = false, onConfirm, onClose }: { title: string; description?: string; children?: React.ReactNode; confirmLabel: string; cancelLabel?: string; tone?: 'primary' | 'danger'; busy?: boolean; disabled?: boolean; onConfirm: () => void; onClose: () => void }) {
  const { t } = useLocale();
  return (
    <Modal title={title} description={description} busy={busy} onClose={onClose} size="sm"
      footer={<>
        <Button onClick={onClose} disabled={busy}>{cancelLabel ?? t('Batal', 'Cancel')}</Button>
        <Button variant={tone === 'danger' ? 'danger' : 'primary'} loading={busy} disabled={disabled} onClick={onConfirm}>{confirmLabel}</Button>
      </>}
    >{children}</Modal>
  );
}
