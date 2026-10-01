'use client';
import { useSyncExternalStore } from 'react';
import { useLocale } from '@/lib/client/locale';
import { Modal } from '@/components/ui/Modal';

type T = (id: string, en: string) => string;
const subscribe = () => () => {};
const onMac = () => /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

// Only shortcuts that work today. "Mod" is Ctrl, or ⌘ on a Mac.
export function shortcutGroups(t: T): Array<{ title: string; items: Array<{ keys: string[]; label: string }> }> {
  return [
    { title: t('Umum', 'General'), items: [
      { keys: ['Mod', 'K'], label: t('Cari notebook, skill, atau menu', 'Search notebooks, skills, or menus') },
      { keys: ['Esc'], label: t('Tutup dialog atau menu', 'Close a dialog or menu') },
    ] },
    { title: t('Beranda', 'Home'), items: [
      { keys: ['Mod', 'Enter'], label: t('Kirim teks di composer', 'Send the composer text') },
    ] },
    { title: t('Editor', 'Editor'), items: [
      { keys: ['Mod', 'S'], label: t('Simpan sekarang', 'Save now') },
      { keys: ['Mod', 'Z'], label: t('Urungkan', 'Undo') },
      { keys: ['Mod', 'Shift', 'Z'], label: t('Ulangi', 'Redo') },
      { keys: ['Mod', 'B'], label: t('Tebal', 'Bold') },
      { keys: ['Mod', 'I'], label: t('Miring', 'Italic') },
      { keys: ['Mod', 'U'], label: t('Garis bawah', 'Underline') },
      { keys: ['Mod', 'F'], label: t('Cari di dokumen', 'Find in document') },
      { keys: ['Mod', 'H'], label: t('Cari & ganti', 'Find & replace') },
      { keys: ['Mod', '.'], label: t('Mode fokus', 'Focus mode') },
      { keys: ['Mod', '/'], label: t('Perintah AI (Max)', 'AI instruction (Max)') },
    ] },
    { title: t('Kanvas Halaman', 'Page canvas'), items: [
      { keys: ['Mod', 'Enter'], label: t('Pemisah halaman', 'Page break') },
      { keys: ['Mod', '\\'], label: t('Hapus format', 'Clear formatting') },
      { keys: ['Mod', '[ / ]'], label: t('Kurangi / tambah indentasi', 'Decrease / increase indent') },
    ] },
  ];
}

export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  const { t } = useLocale();
  const mac = useSyncExternalStore(subscribe, onMac, () => false);
  const key = (value: string) => (value === 'Mod' ? (mac ? '⌘' : 'Ctrl') : value);
  return (
    <Modal title={t('Pintasan keyboard', 'Keyboard shortcuts')} onClose={onClose} size="md">
      <div className="space-y-5">
        {shortcutGroups(t).map((group) => (
          <section key={group.title}>
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-500">{group.title}</h3>
            <ul className="mt-1.5 divide-y divide-line">
              {group.items.map((item) => (
                <li key={`${group.title}-${item.label}`} className="flex items-center justify-between gap-4 py-2">
                  <span className="text-[13.5px] text-ink-800">{item.label}</span>
                  <span className="flex shrink-0 items-center gap-1">{item.keys.map((value) => <kbd key={value} className="rounded-md border border-line-strong bg-paper px-1.5 py-0.5 font-sans text-[11.5px] font-semibold text-ink-700">{key(value)}</kbd>)}</span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </Modal>
  );
}
