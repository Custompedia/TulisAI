'use client';

// The Skill sidebar and the /skills page share one set of dialogs, owned by the page. The sidebar row
// menus (Ubah, Duplikat, Hapus) and "+" ask for them through this event.
export const SKILL_ACTION_EVENT = 'tulis:skill-action';
export type SkillAction = { kind: 'create' } | { kind: 'edit' | 'duplicate' | 'delete'; id: string } | { kind: 'template'; index: number };

export const requestSkillAction = (action: SkillAction) => window.dispatchEvent(new CustomEvent<SkillAction>(SKILL_ACTION_EVENT, { detail: action }));

// /skills?skill=<id> shows that skill; /skills?template=<n> shows a template. Pure for tests.
export type SkillSelection = { kind: 'skill'; id: string } | { kind: 'template'; index: number } | null;
export function skillSelection(params: { get: (key: string) => string | null }): SkillSelection {
  const id = params.get('skill');
  if (id) return { kind: 'skill', id };
  const template = params.get('template');
  if (template !== null && /^\d{1,2}$/.test(template)) return { kind: 'template', index: Number(template) };
  return null;
}
