'use client';
import { useEffect, useRef, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { Alert } from './Alert';

const VIEWPORT_ID = 'toast-viewport';
const subscribe = () => () => {};

function viewport() {
  let element = document.getElementById(VIEWPORT_ID);
  if (!element) {
    element = document.createElement('div');
    element.id = VIEWPORT_ID;
    element.className = 'pointer-events-none fixed bottom-20 right-4 z-[70] flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2 md:bottom-4 md:left-24 md:right-auto';
    document.body.appendChild(element);
  }
  return element;
}

type Props = React.ComponentProps<typeof Alert> & { duration?: number };

// Floating notification stacked in the bottom-right corner.
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
