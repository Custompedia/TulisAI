'use client';
import { useRef, useState } from 'react';
import type { Editor } from '@tiptap/react';
import { useLocale } from '@/lib/client/locale';
import { pageGeometry, TWIPS_PER_INCH, twipsToPx, type PageMargins } from '@/lib/docx/office-defaults';
import { formatTabStops, parseTabStops } from '@/lib/editor/extensions/paragraph-format';
import { lengthToPoints } from './toolbar/formatting';
import { marginUnit, type PageLayout } from './page-layout';

const PX_PER_POINT = 96 / 72;
// Word snaps a dragged marker to an eighth of an inch; anything finer is noise at this size.
const SNAP_POINTS = 9;
type Handle = 'marginLeft' | 'marginRight' | 'firstLine' | 'indentLeft' | 'indentRight';

const snap = (points: number) => Math.round(points / SNAP_POINTS) * SNAP_POINTS;
const pt = (points: number) => `${Math.round(points * 100) / 100}pt`;

type Props = { editor: Editor; layout: PageLayout; zoom: number; language: string; disabled: boolean; onMargins: (margins: PageMargins) => void };

// Word's ruler: the grey ends are the page margins, the markers are the paragraph's own indents, and a click
// in the white band drops a tab stop. Every number is points, which is what the document already stores.
export function PageRuler({ editor, layout, zoom, language, disabled, onMargins }: Props) {
  const { t } = useLocale();
  const root = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ handle: Handle; delta: number } | null>(null);
  const page = pageGeometry(layout.size, layout.orientation);
  const pageWidth = twipsToPx(page.width);
  const marginLeft = twipsToPx(layout.margins.left);
  const marginRight = twipsToPx(layout.margins.right);
  const contentWidth = pageWidth - marginLeft - marginRight;

  const block = editor.state.selection.$from.parent;
  const inText = block.type.name === 'paragraph' || block.type.name === 'heading';
  const stored = {
    indentLeft: inText ? lengthToPoints(block.attrs.indentLeft) ?? 0 : 0,
    indentRight: inText ? lengthToPoints(block.attrs.indentRight) ?? 0 : 0,
    firstLine: inText ? lengthToPoints(block.attrs.indentFirstLine) ?? 0 : 0,
  };
  const stops = inText ? parseTabStops(block.attrs.tabStops) : [];
  const moving = (handle: Handle) => (drag?.handle === handle ? drag.delta : 0);
  const value = {
    marginLeft: layout.margins.left / 20 + moving('marginLeft'),
    marginRight: layout.margins.right / 20 + moving('marginRight'),
    indentLeft: Math.max(0, stored.indentLeft + moving('indentLeft')),
    indentRight: Math.max(0, stored.indentRight + moving('indentRight')),
    firstLine: stored.firstLine + moving('firstLine'),
  };

  function commit(handle: Handle, delta: number) {
    if (!delta) return;
    if (handle === 'marginLeft' || handle === 'marginRight') {
      const side = handle === 'marginLeft' ? 'left' : 'right';
      onMargins({ ...layout.margins, [side]: Math.max(0, Math.round((layout.margins[side] / 20 + delta) * 20)) });
      return;
    }
    const key = handle === 'firstLine' ? 'indentFirstLine' : handle;
    const base = handle === 'firstLine' ? stored.firstLine : handle === 'indentLeft' ? stored.indentLeft : stored.indentRight;
    const next = handle === 'firstLine' ? base + delta : Math.max(0, base + delta);
    editor.chain().focus().setParagraphFormat({ [key]: next === 0 ? null : pt(next) }).run();
  }

  // The marker follows the pointer and only writes to the document on release, so a drag is one undo step.
  const start = (handle: Handle) => (event: React.PointerEvent) => {
    if (disabled) return;
    event.preventDefault();
    const scale = (root.current?.getBoundingClientRect().width ?? pageWidth) / pageWidth;
    const startX = event.clientX;
    const invert = handle === 'marginRight' || handle === 'indentRight';
    let delta = 0;
    const move = (moving: PointerEvent) => {
      const points = ((moving.clientX - startX) / scale) / PX_PER_POINT;
      delta = snap(invert ? -points : points);
      setDrag({ handle, delta });
    };
    const finish = () => { window.removeEventListener('pointermove', move); setDrag(null); commit(handle, delta); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', finish, { once: true });
  };

  const setStops = (next: Array<{ position: number; align: 'left' | 'center' | 'right' | 'decimal' }>) =>
    editor.chain().focus().setParagraphFormat({ tabStops: formatTabStops(next) }).run();

  const addStop = (event: React.MouseEvent<HTMLDivElement>) => {
    if (disabled || !inText || drag) return;
    const box = event.currentTarget.getBoundingClientRect();
    const scale = box.width / contentWidth;
    const points = snap(((event.clientX - box.left) / scale) / PX_PER_POINT);
    if (points <= 0) return;
    setStops([...stops, { position: points, align: 'left' }]);
  };

  const unit = marginUnit(language);
  const step = unit === 'cm' ? TWIPS_PER_INCH / 2.54 : TWIPS_PER_INCH;
  const ticks = Math.floor(page.width / step);

  return (
    <div ref={root} aria-hidden="true" className="ww-ruler" style={{ width: pageWidth, zoom }}>
      <div className="ww-ruler-band" style={{ left: 0, width: value.marginLeft * PX_PER_POINT }} />
      <div className="ww-ruler-band" style={{ right: 0, width: value.marginRight * PX_PER_POINT }} />
      <div className="ww-ruler-track" style={{ left: value.marginLeft * PX_PER_POINT, right: value.marginRight * PX_PER_POINT }} onClick={addStop}>
        {Array.from({ length: ticks + 1 }, (_, index) => {
          const at = index * step;
          const left = twipsToPx(at) - value.marginLeft * PX_PER_POINT;
          if (left < 0 || left > contentWidth) return null;
          return <span key={index} className="ww-ruler-tick" style={{ left }}>{index}</span>;
        })}
        {stops.map((stop) => (
          <button key={`${stop.position}-${stop.align}`} type="button" tabIndex={-1} title={t('Hapus tab stop', 'Remove tab stop')}
            className="ww-ruler-stop" style={{ left: stop.position * PX_PER_POINT }}
            onClick={(event) => { event.stopPropagation(); setStops(stops.filter((other) => other.position !== stop.position)); }} />
        ))}
      </div>
      <div className="ww-ruler-edge ww-ruler-edge-left" style={{ left: value.marginLeft * PX_PER_POINT }} onPointerDown={start('marginLeft')} />
      <div className="ww-ruler-edge ww-ruler-edge-right" style={{ right: value.marginRight * PX_PER_POINT }} onPointerDown={start('marginRight')} />
      {inText && (
        <>
          <span className="ww-ruler-marker ww-ruler-first" style={{ left: (value.marginLeft + value.indentLeft + value.firstLine) * PX_PER_POINT }} onPointerDown={start('firstLine')} />
          <span className="ww-ruler-marker ww-ruler-left" style={{ left: (value.marginLeft + value.indentLeft) * PX_PER_POINT }} onPointerDown={start('indentLeft')} />
          <span className="ww-ruler-marker ww-ruler-right" style={{ left: (pageWidth / PX_PER_POINT - value.marginRight - value.indentRight) * PX_PER_POINT }} onPointerDown={start('indentRight')} />
        </>
      )}
    </div>
  );
}
