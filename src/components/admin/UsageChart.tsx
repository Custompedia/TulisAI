'use client';
import { useId, useMemo, useState } from 'react';
import { useLocale } from '@/lib/client/locale';
import { numberFormat } from '@/lib/client/format';

export type Bar = { key: string; label: string; value: number; detail: Array<[string, string]> };
type Props = { title: string; bars: Bar[]; highlight?: string; empty: string; unit: string };

const H = 180; const PAD = { top: 14, right: 8, bottom: 26, left: 40 };
function ticks(max: number): number[] {
  if (max <= 0) return [0];
  const raw = max / 4; const power = 10 ** Math.floor(Math.log10(raw)); const step = [1, 2, 5, 10].map((m) => m * power).find((s) => s >= raw) ?? power;
  const out: number[] = []; for (let value = 0; value <= max + step * 0.01; value += step) out.push(value); return out;
}

// Single-series column chart: one hue, thin marks, 2px surface gap, hairline grid, per-bar hover/focus tooltip. The table beside it is the full data view.
export function UsageChart({ title, bars, highlight, empty, unit }: Props) {
  const { locale } = useLocale();
  const id = useId();
  const [hover, setHover] = useState<string | null>(null);
  const max = Math.max(0, ...bars.map((bar) => bar.value));
  const scale = useMemo(() => ticks(max), [max]);
  const top = scale[scale.length - 1] || 1;
  const width = 720; const plotW = width - PAD.left - PAD.right; const plotH = H - PAD.top - PAD.bottom;
  const band = bars.length ? plotW / bars.length : plotW;
  const barW = Math.min(24, Math.max(2, band - 2));
  const y = (value: number) => PAD.top + plotH - (value / top) * plotH;
  const labelEvery = Math.max(1, Math.ceil(bars.length / 12));
  const active = bars.find((bar) => bar.key === hover) ?? null;

  return (
    <section className="rounded-2xl border border-line bg-white" aria-labelledby={`${id}-title`}>
      <div className="flex items-baseline justify-between gap-3 border-b border-line px-4 py-2.5">
        <h3 id={`${id}-title`} className="text-[14px] font-semibold text-ink-900">{title}</h3>
        <span className="text-[12px] text-ink-500" aria-live="polite">{active ? `${active.label} · ${numberFormat(active.value, locale)} ${unit}` : unit}</span>
      </div>
      {bars.length === 0 || max === 0 ? <p className="px-4 py-10 text-center text-[13px] text-ink-500">{empty}</p> : (
        <div className="relative px-2 pb-1 pt-2">
          <svg viewBox={`0 0 ${width} ${H}`} role="img" aria-label={title} className="block w-full" onMouseLeave={() => setHover(null)}>
            {scale.map((value) => <g key={value}><line x1={PAD.left} x2={width - PAD.right} y1={y(value)} y2={y(value)} stroke="var(--color-line)" strokeWidth={1} /><text x={PAD.left - 6} y={y(value) + 3.5} textAnchor="end" fontSize={10} fill="var(--color-ink-500)">{numberFormat(value, locale)}</text></g>)}
            {bars.map((bar, index) => {
              const x = PAD.left + index * band + (band - barW) / 2; const h = Math.max(0, PAD.top + plotH - y(bar.value)); const isMax = bar.key === highlight; const isHover = bar.key === hover;
              const radius = Math.min(4, h / 2);
              const path = h <= 0 ? '' : `M${x},${PAD.top + plotH} v${-(h - radius)} a${radius},${radius} 0 0 1 ${radius},${-radius} h${barW - radius * 2} a${radius},${radius} 0 0 1 ${radius},${radius} v${h - radius} z`;
              return (
                <g key={bar.key}>
                  {path && <path d={path} fill={isMax ? 'var(--color-brand-800)' : 'var(--color-brand-500)'} opacity={hover && !isHover ? 0.55 : 1} />}
                  {isMax && h > 0 && <text x={x + barW / 2} y={y(bar.value) - 4} textAnchor="middle" fontSize={11} fontWeight={600} fill="var(--color-ink-900)">{numberFormat(bar.value, locale)}</text>}
                  {index % labelEvery === 0 && <text x={x + barW / 2} y={H - 8} textAnchor="middle" fontSize={10} fill="var(--color-ink-500)">{bar.label}</text>}
                  <rect x={PAD.left + index * band} y={PAD.top} width={band} height={plotH} fill="transparent" tabIndex={0} aria-label={`${bar.label}: ${numberFormat(bar.value, locale)} ${unit}`} onMouseEnter={() => setHover(bar.key)} onFocus={() => setHover(bar.key)} onBlur={() => setHover(null)} className="outline-none" />
                </g>
              );
            })}
          </svg>
          {active && (
            <div role="tooltip" className="pointer-events-none absolute right-3 top-3 min-w-36 rounded-lg border border-line bg-white px-3 py-2 text-[12px] shadow-[0_8px_24px_-8px_rgb(31_32_29/0.25)]">
              <p className="font-semibold text-ink-900">{active.label}</p>
              {active.detail.map(([label, value]) => <p key={label} className="flex justify-between gap-4 text-ink-600"><span>{label}</span><b className="font-semibold tabular-nums text-ink-900">{value}</b></p>)}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
