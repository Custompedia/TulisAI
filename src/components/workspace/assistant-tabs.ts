import { defaults, type Settings } from '@/lib/writing/settings';
import { applyStyle, type WritingStyle } from '@/lib/writing/styles';

export type AssistantTab = 'mode' | 'skills';
// What each tab last held, so switching restores its own configuration instead of inheriting the other one's.
export type TabMemory = { mode: Settings | null; styleId: string | null };

export const tabForSettings = (settings: Settings): AssistantTab => (settings.styleId ? 'skills' : 'mode');

export const rememberSettings = (tab: AssistantTab, settings: Settings, memory: TabMemory): TabMemory => ({
  mode: tab === 'mode' && !settings.styleId ? settings : memory.mode,
  styleId: settings.styleId ?? memory.styleId,
});

// The effective settings a tab should run with; the writing language always follows the notebook.
export function tabSettings(tab: AssistantTab, current: Settings, memory: TabMemory, styles: WritingStyle[], manualBase: Settings = defaults): Settings {
  // A writing sample belongs to a skill, so a plain mode run never carries one it did not set itself, and an empty memory falls back to the manual baseline rather than to the skill-shaped settings.
  if (tab === 'mode') { const base = memory.mode ?? manualBase; return { ...base, language: current.language, styleId: null, sample: memory.mode?.sample ?? '' }; }
  const style = styles.find((item) => item.id === (current.styleId ?? memory.styleId));
  return style ? applyStyle(current, style) : { ...current, styleId: null };
}
