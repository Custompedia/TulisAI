'use client';
import { planNoticeFor, type PlanNotice } from '@/lib/client/quota';

// One set of window events, handled once by the signed-in frame, so any component can open the plans
// dialog, raise a plan toast, or start a new piece of writing without mounting its own copy.
export const OPEN_PLANS_EVENT = 'tulis:open-plans';
export const PLAN_NOTICE_EVENT = 'tulis:plan-notice';
export const OPEN_PALETTE_EVENT = 'tulis:open-palette';
export const OPEN_SHORTCUTS_EVENT = 'tulis:open-shortcuts';
export const NEW_WRITING_EVENT = 'tulis:new-writing';
export const SHELL_NOTICE_EVENT = 'tulis:shell-notice';
// Heard by the home composer: focus the text box.
export const COMPOSER_FOCUS_EVENT = 'composer:focus';
// Heard by every mounted composer: the shared session draft changed elsewhere, read it again.
export const COMPOSER_DRAFT_EVENT = 'composer:draft';
// Heard by the home composer: use this saved skill (a Beranda "Skill saya" chip).
export const COMPOSER_STYLE_EVENT = 'composer:style';
// The link form of "Tulis baru": it opens the dialog on the Olah teks card. Also where /documents/new lands.
export const NEW_WRITING_HREF = '/app#compose';

const fire = (name: string, detail?: unknown) => { if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(name, { detail })); };

export const openPlans = () => fire(OPEN_PLANS_EVENT);
export const openPalette = () => fire(OPEN_PALETTE_EVENT);
export const openShortcuts = () => fire(OPEN_SHORTCUTS_EVENT);
// Where the Tulis baru dialog opens: the card grid, the Olah teks composer, or the skill step (optionally with a skill).
export type NewWritingStart = { step?: 'pick' | 'rewrite' | 'skill'; styleId?: string };
export const requestNewWriting = (start: NewWritingStart = {}) => fire(NEW_WRITING_EVENT, start);
// A toast that outlives the page that raised it, e.g. "Notebook kosong tidak disimpan" after leaving the editor.
export type ShellNotice = { tone: 'success' | 'info' | 'warning' | 'error'; message: string };
// Leaving the editor also swaps the frame, so the host that would show the toast may mount after the event fired;
// the notice is kept for a moment and picked up by the next host that mounts.
let pending: { notice: ShellNotice; at: number } | null = null;
export function showShellNotice(notice: ShellNotice) { pending = { notice, at: Date.now() }; fire(SHELL_NOTICE_EVENT, notice); }
export function takeShellNotice(): ShellNotice | null {
  const value = pending && Date.now() - pending.at < 3000 ? pending.notice : null;
  pending = null;
  return value;
}

// Raises the plan or rate-limit toast for a failed request. Returns true when the error was one of those,
// so a caller can skip its own generic message.
export function showPlanNotice(error: unknown): boolean {
  const notice = planNoticeFor(error);
  if (!notice) return false;
  fire(PLAN_NOTICE_EVENT, notice);
  return true;
}

export const showLockedFeature = (requiredTier: PlanNotice['requiredTier']) => fire(PLAN_NOTICE_EVENT, { kind: 'plan', code: 'FEATURE_LOCKED', requiredTier } satisfies PlanNotice);
