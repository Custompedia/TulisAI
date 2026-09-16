import { notebookTone } from '@/lib/notebook/appearance';
import { NotebookIcon } from '@/components/app/NotebookIcon';
import { toneClass } from './modes';
import type { WritingStyle } from '@/lib/writing/styles';

export const styleTone = (style: WritingStyle) => toneClass[notebookTone(style.color, style.settings.mode)];

// Round icon chip in the style's colour; shared by the studio, settings, composer and selection menu.
export function StyleMark({ style, size = 24 }: { style: WritingStyle; size?: number }) {
  const tone = styleTone(style);
  return (
    <span style={{ width: size, height: size }} className={`grid shrink-0 place-items-center rounded-full ${tone.fill} ${tone.ink}`}>
      <NotebookIcon icon={style.icon} mode={style.settings.mode} size={Math.round(size * 0.58)} />
    </span>
  );
}
