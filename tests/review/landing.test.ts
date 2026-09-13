import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { SAMPLES } from '@/components/landing/examples';
import { MODES } from '@/components/writing/modes';

import { LocaleScope } from '@/lib/client/locale';
vi.mock('next/image', () => ({ default: ({ src, alt, width, height }: { src: string; alt: string; width: number; height: number }) => createElement('img', { src, alt, width, height }) }));
vi.mock('next/link', () => ({ default: ({ children, ...props }: { children: React.ReactNode; href: string }) => createElement('a', props, children) }));
import { Landing } from '@/components/landing/Landing';

describe('landing product contract', () => {
  it.each(['id', 'en'] as const)('preserves protected content in every %s demonstration', locale => {
    const sample = SAMPLES[locale];
    for (const mode of MODES) {
      const result = sample.outputs[mode];
      expect(result.after).not.toBe(sample.source);
      for (const term of sample.locked) expect(result.after).toContain(term);
      expect(result.changes.length).toBeGreaterThan(0);
    }
  });

  it.each(['id', 'en'] as const)('keeps the landing English with %s app preferences', locale => {
    const html = renderToStaticMarkup(createElement(LocaleScope, { locale }, createElement(Landing)));
    const ids = new Set(Array.from(html.matchAll(/\bid="([^"]+)"/g), match => match[1]));
    const anchors = Array.from(html.matchAll(/href="#([^"]+)"/g), match => match[1]);
    expect(anchors.length).toBeGreaterThan(0);
    for (const anchor of anchors) expect(ids.has(anchor)).toBe(true);
    expect(html).toContain('href="/register"');
    expect(html).toContain('href="/login"');
    expect(html).toContain('aria-controls="landing-menu"');
    expect(html).toContain('aria-controls="landing-preview"');
    expect(html).toContain('aria-live="polite"');
    expect(html.match(/<summary>/g)).toHaveLength(7);
    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(html).toContain('Your writing, clearer.');
    expect(html).toContain('lang="en"');
    expect(html).toContain(SAMPLES.en.source.split(' ').slice(0, 5).join(' ').replaceAll("'", '&#x27;'));
    expect(html).not.toMatch(/>ID<|>EN<|Interface language|ID or EN/);
    expect(html).not.toContain('Tulisanmu, lebih jelas.');
    expect(html).not.toContain('Mulai Menulis');
    expect(html).not.toMatch(/href="#"|<form\b|<textarea\b/);
  });
});
