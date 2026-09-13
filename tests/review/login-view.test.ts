import { createElement, type ComponentProps } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { safeAuthNext } from '@/lib/auth/form';

vi.mock('next/image', () => ({ default: ({ src, alt }: { src: string; alt: string }) => createElement('img', { src, alt }) }));
vi.mock('next/link', () => ({ default: ({ children, ...props }: { children: React.ReactNode; href: string }) => createElement('a', props, children) }));
import { AuthView } from '@/components/auth/AuthView';

function render(overrides: Partial<ComponentProps<typeof AuthView>> = {}) {
  return renderToStaticMarkup(createElement(AuthView, {
    values: { name: '', username: '', email: '', password: '', confirm: '' }, remember: true, busy: null, error: '', fieldErrors: {}, next: null,
    inputRefs: { name: { current: null }, username: { current: null }, email: { current: null }, password: { current: null }, confirm: { current: null } }, onChange: vi.fn(), onRemember: vi.fn(), onSubmit: vi.fn(), onGoogle: vi.fn(), ...overrides,
  }));
}

describe('login presentation', () => {
  it('offers Google and email/password in an accessible standalone card', () => {
    const html = render();
    expect(html).toContain('Continue with Google');
    expect(html.indexOf('</form>')).toBeLessThan(html.indexOf('Continue with Google'));
    expect(html).toContain('type="email"');
    expect(html).toContain('type="password"');
    expect(html).toContain('autoComplete="current-password"');
    expect(html).toContain('aria-label="Show password"');
    expect(html).toContain('Keep me signed in');
    expect(html).toContain('href="/register"');
    expect(html).toContain('href="/"');
    expect(html).not.toContain('role="dialog"');
    expect(html).not.toMatch(/>ID<|>EN<|Forgot password|Username or email/);
  });

  it.each(['form', 'google'] as const)('locks all authentication controls while %s is pending', busy => {
    const html = render({ busy });
    expect(html).toMatch(/<fieldset[^>]*disabled=""/);
    expect(html.match(/<button[^>]*disabled=""/g)).toHaveLength(2);
    expect(html).toContain(busy === 'google' ? 'Connecting to Google…' : 'Signing in…');
  });

  it('connects field errors to inputs and displays recoverable provider errors', () => {
    const html = render({ error: 'Google sign-in is unavailable. Please use email and password.', fieldErrors: { email: 'Enter a valid email address.', password: 'Enter a password.' } });
    expect(html).toContain('aria-describedby="email-error"');
    expect(html).toContain('aria-describedby="password-error"');
    expect(html.match(/aria-invalid="true"/g)).toHaveLength(2);
    expect(html).toContain('role="alert"');
    expect(html).toContain('Google sign-in is unavailable.');
  });

  it('retains the protected destination when switching to registration', () => {
    expect(render({ next: '/documents/123?panel=history' })).toContain('/register?next=%2Fdocuments%2F123%3Fpanel%3Dhistory');
  });
});

describe('registration presentation', () => {
  it('keeps required registration fields and places Google below email signup', () => {
    const html = render({ register: true });
    for (const field of ['name', 'username', 'email', 'password', 'confirm']) expect(html).toContain(`id="auth-${field}"`);
    expect(html).toContain('autoComplete="new-password"');
    expect(html).toContain('Show confirmed password');
    expect(html).toContain('href="/login"');
    expect(html.indexOf('</form>')).toBeLessThan(html.indexOf('Continue with Google'));
    expect(html).not.toContain('Keep me signed in');
  });
});

describe('safe authentication destination', () => {
  it('allows local destinations with queries', () => {
    expect(safeAuthNext('/documents/123?panel=history')).toBe('/documents/123?panel=history');
    expect(safeAuthNext('/app')).toBe('/app');
  });

  it.each([null, '', 'https://example.com', '//example.com', '/\\example.com', '/\n/evil.test', 'javascript:alert(1)'])('rejects unsafe redirect %s', value => {
    expect(safeAuthNext(value)).toBeNull();
  });
});
