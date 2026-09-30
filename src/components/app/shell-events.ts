'use client';
import { planNoticeFor, type PlanNotice } from '@/lib/client/quota';

// One set of window events, handled once by the signed-in frame, so any component can open the plans
// dialog, raise a plan toast, or start a new piece of writing without mounting its own copy.
export const OPEN_PLANS_EVENT = 'tulis:open-plans';
export const PLAN_NOTICE_EVENT = 'tulis:plan-notice';
export const OPEN_PALETTE_EVENT = 'tulis:open-palette';
export const OPEN_SHORTCUTS_EVENT = 'tulis:open-shortcuts';
export const NEW_WRITING_EVENT = 'tulis:new-writing';
// Heard by the home composer: focus the text box.
export const COMPOSER_FOCUS_EVENT = 'composer:focus';
// Where "Tulis baru" lands today. UX 1c swaps the handler for the Tulis baru dialog; this link stays the fallback.
export const NEW_WRITING_HREF = '/app#compose';

const fire = (name: string, detail?: unknown) => { if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(name, { detail })); };

export const openPlans = () => fire(OPEN_PLANS_EVENT);
export const openPalette = () => fire(OPEN_PALETTE_EVENT);
export const openShortcuts = () => fire(OPEN_SHORTCUTS_EVENT);
export const requestNewWriting = () => fire(NEW_WRITING_EVENT);

// Raises the plan or rate-limit toast for a failed request. Returns true when the error was one of those,
// so a caller can skip its own generic message.
export function showPlanNotice(error: unknown): boolean {
  const notice = planNoticeFor(error);
  if (!notice) return false;
  fire(PLAN_NOTICE_EVENT, notice);
  return true;
}

export const showLockedFeature = (requiredTier: PlanNotice['requiredTier']) => fire(PLAN_NOTICE_EVENT, { kind: 'plan', code: 'FEATURE_LOCKED', requiredTier } satisfies PlanNotice);
