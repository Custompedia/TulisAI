'use client';
import { usePathname } from 'next/navigation';
import { useEffect, useEffectEvent, useState } from 'react';
import { useLocale } from '@/lib/client/locale';
import { planNoticeCopy, type PlanNotice } from '@/lib/client/quota';
import { Button } from '@/components/ui/Button';
import { Toast } from '@/components/ui/Toast';
import { useShell } from './AppShell';
import { PlansDialog } from './PlansDialog';
import { ShortcutsDialog } from './ShortcutsDialog';
import { ImportDocxDialog } from './ImportDocxDialog';
import { NewWritingDialog, type Step } from './NewWritingDialog';
import { NEW_WRITING_EVENT, OPEN_PLANS_EVENT, OPEN_SHORTCUTS_EVENT, PLAN_NOTICE_EVENT, SHELL_NOTICE_EVENT, takeShellNotice, type NewWritingStart, type ShellNotice } from './shell-events';

// The only PlansDialog in the signed-in app, plus the plan and rate-limit toasts. "Lihat paket" in a toast
// opens this dialog, which ends at "Pembayaran belum dibuka" while checkout is closed.
export function PlansHost() {
  const { t } = useLocale();
  const { usage, refreshUsage } = useShell();
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState<PlanNotice | null>(null);
  const onNotice = useEffectEvent((next: PlanNotice) => {
    setNotice(next);
    // A quota or request limit means the meter moved; refresh it so the pill and the rail dot agree.
    if (next.code !== 'FEATURE_LOCKED') void refreshUsage();
  });
  useEffect(() => {
    const onOpen = () => { setNotice(null); setOpen(true); };
    const onPlanNotice = (event: Event) => onNotice((event as CustomEvent<PlanNotice>).detail);
    window.addEventListener(OPEN_PLANS_EVENT, onOpen); window.addEventListener(PLAN_NOTICE_EVENT, onPlanNotice);
    return () => { window.removeEventListener(OPEN_PLANS_EVENT, onOpen); window.removeEventListener(PLAN_NOTICE_EVENT, onPlanNotice); };
  }, []);
  const copy = notice ? planNoticeCopy(notice, t, usage?.characterScope === 'account') : null;
  return (
    <>
      {notice && copy && (
        <Toast tone={notice.kind === 'rate' ? 'info' : 'warning'} title={copy.title} duration={notice.kind === 'rate' ? 6000 : 10000} onDismiss={() => setNotice(null)} dismissLabel={t('Tutup', 'Dismiss')}
          actions={copy.showPlans ? <Button size="sm" onClick={() => { setNotice(null); setOpen(true); }}>{t('Lihat paket', 'See plans')}</Button> : undefined}>
          {copy.message}
        </Toast>
      )}
      {open && <PlansDialog onClose={() => setOpen(false)} />}
    </>
  );
}

export function ShortcutsHost() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener(OPEN_SHORTCUTS_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_SHORTCUTS_EVENT, onOpen);
  }, []);
  return open ? <ShortcutsDialog onClose={() => setOpen(false)} /> : null;
}

// Every "Tulis baru" (rail, bottom bar, Ctrl K, library, Ganti notebook, editor ⋯) opens this one dialog.
// The old links /app#compose and /documents/new open it straight on the Olah teks card.
export function NewWritingHost() {
  const pathname = usePathname();
  const [open, setOpen] = useState<{ step: Step; styleId?: string; key: number } | null>(null);
  const [importing, setImporting] = useState(false);
  const start = useEffectEvent((detail: NewWritingStart | null) => {
    setImporting(false);
    setOpen((current) => ({ step: detail?.step ?? 'pick', styleId: detail?.styleId, key: (current?.key ?? 0) + 1 }));
  });
  const fromHash = useEffectEvent(() => {
    if (window.location.pathname !== '/app' || window.location.hash !== '#compose') return;
    window.history.replaceState(window.history.state, '', '/app');
    start({ step: 'rewrite' });
  });
  useEffect(() => {
    const onStart = (event: Event) => start((event as CustomEvent<NewWritingStart | undefined>).detail ?? null);
    const onHash = () => fromHash();
    window.addEventListener(NEW_WRITING_EVENT, onStart); window.addEventListener('hashchange', onHash);
    return () => { window.removeEventListener(NEW_WRITING_EVENT, onStart); window.removeEventListener('hashchange', onHash); };
  }, []);
  // Landing on a new page (the notebook it just made, or anywhere else) closes the dialog; /app#compose opens it.
  useEffect(() => { setOpen(null); setImporting(false); fromHash(); }, [pathname]);
  return (
    <>
      {open && <NewWritingDialog key={open.key} initialStep={open.step} initialStyleId={open.styleId} onClose={() => setOpen(null)} onImport={() => { setOpen(null); setImporting(true); }} />}
      {importing && <ImportDocxDialog onClose={() => setImporting(false)} />}
    </>
  );
}

// Toasts that must outlive the page that raised them, such as leaving an untouched skeleton notebook.
export function NoticeHost() {
  const { t } = useLocale();
  const [notice, setNotice] = useState<ShellNotice | null>(null);
  useEffect(() => {
    let live = true;
    const waiting = takeShellNotice();
    if (waiting) setNotice(waiting);
    // A host that is about to unmount (the frame swaps when leaving the editor) leaves the notice for the next one.
    const onNotice = (event: Event) => { setNotice((event as CustomEvent<ShellNotice>).detail); setTimeout(() => { if (live) takeShellNotice(); }, 0); };
    window.addEventListener(SHELL_NOTICE_EVENT, onNotice);
    return () => { live = false; window.removeEventListener(SHELL_NOTICE_EVENT, onNotice); };
  }, []);
  return notice ? <Toast tone={notice.tone} duration={5000} onDismiss={() => setNotice(null)} dismissLabel={t('Tutup', 'Dismiss')}>{notice.message}</Toast> : null;
}
