'use client';
import { useEffect, useRef, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { Alert } from './Alert';

const VIEWPORT_ID = 'toast-viewport';
const subscribe = () => () => {};

// Anchored under the 56px app header so toasts never cover page content.
const VIEWPORT_CLASS = 'pointer-events-none fixed right-4 top-[4.5rem] z-[70] flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2';

// A modal <dialog> sits in the top layer and makes the rest of the page inert, so a toast raised while one is open
// (a locked card in Tulis baru, a plan notice from its composer) would land underneath it, unseen and unclickable.
// The viewport therefore lives in the topmost open modal while there is one, and in <body> otherwise.
function host(): HTMLElement {
  const modal = [...document.querySelectorAll<HTMLDialogElement>('dialog[open]')].filter((dialog) => { try { return dialog.matches(':modal'); } catch { return true; } });
  // With two modals open (Lihat paket over Tulis baru) the newest holds the focus; DOM order says nothing about it.
  const focused = document.activeElement?.closest('dialog');
  return (focused && modal.includes(focused as HTMLDialogElement) ? focused as HTMLElement : null) ?? modal.at(-1) ?? document.body;
}
function viewport() {
  const target = host();
  let element = document.getElementById(VIEWPORT_ID);
  if (!element) {
    element = document.createElement('div');
    element.id = VIEWPORT_ID;
  }
  if (element.parentElement !== target) target.appendChild(element);
  element.className = VIEWPORT_CLASS;
  return element;
}

type Props = React.ComponentProps<typeof Alert> & { duration?: number };

// Floating notification stacked in the top-right corner.
export function Toast({ duration, onDismiss, className = '', ...props }: Props) {
  const mounted = useSyncExternalStore(subscribe, () => true, () => false);
  const dismiss = useRef(onDismiss);
  useEffect(() => { dismiss.current = onDismiss; }, [onDismiss]);
  useEffect(() => {
    if (!duration) return;
    const timer = setTimeout(() => dismiss.current?.(), duration);
    return () => clearTimeout(timer);
  }, [duration]);
  if (!mounted) return null;
  return createPortal(<Alert {...props} onDismiss={onDismiss} className={`pointer-events-auto animate-fade-up shadow-[0_12px_32px_-12px_rgb(31_32_29/0.35)] ${className}`} />, viewport());
}
