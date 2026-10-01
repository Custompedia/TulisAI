'use client';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useEffectEvent, useState } from 'react';
import { useLocale } from '@/lib/client/locale';
import { guardedPush } from '@/lib/client/navigation-guard';
import { planNoticeCopy, type PlanNotice } from '@/lib/client/quota';
import { Button } from '@/components/ui/Button';
import { Toast } from '@/components/ui/Toast';
import { useShell } from './AppShell';
import { PlansDialog } from './PlansDialog';
import { ShortcutsDialog } from './ShortcutsDialog';
import { COMPOSER_FOCUS_EVENT, NEW_WRITING_EVENT, NEW_WRITING_HREF, OPEN_PLANS_EVENT, OPEN_SHORTCUTS_EVENT, PLAN_NOTICE_EVENT } from './shell-events';

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

// "Tulis baru" from the rail, the bottom bar, and Ctrl K all land here. Today it keeps the old behaviour:
// Beranda's composer, focused. UX 1c replaces the body of `start` with the Tulis baru dialog.
export function NewWritingHost() {
  const router = useRouter();
  const pathname = usePathname();
  const start = useEffectEvent(() => {
    if (pathname === '/app') {
      window.history.replaceState(window.history.state, '', NEW_WRITING_HREF);
      window.dispatchEvent(new Event(COMPOSER_FOCUS_EVENT));
      return;
    }
    guardedPush(router, NEW_WRITING_HREF);
  });
  useEffect(() => {
    const onStart = () => start();
    window.addEventListener(NEW_WRITING_EVENT, onStart);
    return () => window.removeEventListener(NEW_WRITING_EVENT, onStart);
  }, []);
  return null;
}
