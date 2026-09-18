'use client';
import { useState } from 'react';
import type { Editor } from '@tiptap/react';
import { Link2 } from 'lucide-react';
import { useLocale } from '@/lib/client/locale';
import { Button } from '@/components/ui/Button';
import { inputClass } from '@/components/ui/Field';
import { normalizeLink } from './formatting';
import { CONTROL, Popover } from './Popover';

function LinkForm({ editor, close }: { editor: Editor; close: () => void }) {
  const { t } = useLocale();
  const linked = editor.isActive('link');
  const needsText = !linked && editor.state.selection.empty;
  const [href, setHref] = useState(() => (editor.getAttributes('link').href as string | undefined) ?? '');
  const [text, setText] = useState('');
  const [error, setError] = useState('');

  function apply(event: React.FormEvent) {
    event.preventDefault();
    const url = normalizeLink(href);
    if (!url) { setError(t('Masukkan alamat http:// atau https:// yang valid.', 'Enter a valid http:// or https:// address.')); return; }
    const chain = editor.chain().focus();
    if (linked) chain.extendMarkRange('link').setLink({ href: url }).run();
    else if (needsText) chain.insertContent({ type: 'text', text: text.trim() || url, marks: [{ type: 'link', attrs: { href: url } }] }).unsetMark('link').run();
    else chain.setLink({ href: url }).run();
    close();
  }
  function remove() { editor.chain().focus().extendMarkRange('link').unsetLink().run(); close(); }

  return (
    <form onSubmit={apply} noValidate className="w-72 space-y-2 p-2">
      {needsText && (
        <label className="block text-xs font-semibold text-ink-600">{t('Teks', 'Text')}
          <input value={text} onChange={(event) => setText(event.target.value)} className={`${inputClass} mt-1 h-9`} placeholder={t('Teks yang ditampilkan', 'Text to display')} />
        </label>
      )}
      <label className="block text-xs font-semibold text-ink-600">{t('Tautan', 'Link')}
        <input autoFocus value={href} onChange={(event) => { setHref(event.target.value); setError(''); }} inputMode="url" placeholder="https://"
          aria-invalid={!!error} aria-describedby={error ? 'ww-link-error' : undefined}
          className={`${inputClass} mt-1 h-9 ${error ? 'border-red-400 focus:border-red-500 focus:ring-red-100' : ''}`} />
      </label>
      {error && <p id="ww-link-error" role="alert" className="text-xs text-red-700">{error}</p>}
      <div className="flex justify-end gap-2 pt-1">
        {linked && <Button size="sm" variant="ghost" onClick={remove}>{t('Hapus tautan', 'Remove link')}</Button>}
        <Button size="sm" variant="primary" type="submit" disabled={!href.trim()}>{t('Terapkan', 'Apply')}</Button>
      </div>
    </form>
  );
}

export function LinkPopover({ editor, disabled }: { editor: Editor; disabled: boolean }) {
  const { t } = useLocale();
  const linked = editor.isActive('link');
  return (
    <Popover label={linked ? t('Edit tautan', 'Edit link') : t('Sisipkan tautan', 'Insert link')} role="dialog" disabled={disabled} active={linked} focusFirst={false} triggerClassName={CONTROL}
      trigger={<Link2 size={15} aria-hidden="true" />}>
      {(close) => <LinkForm editor={editor} close={close} />}
    </Popover>
  );
}
