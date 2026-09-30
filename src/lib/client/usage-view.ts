import type { Feature } from '@/lib/plans';

type T = (id: string, en: string) => string;

export type WalletView = {
  mode: 'free' | 'paid' | 'unavailable';
  free: { original: number; remaining: number } | null;
  included: { original: number; remaining: number; periodEnd: string } | null;
  purchased: { available: number; frozen: number; expired: number };
};

export type BalanceRow = { id: 'free' | 'plan' | 'topup' | 'frozen' | 'expired'; label: string; value: number; of?: number; hint: string; spendable: boolean };

// Where the character balance comes from, straight from GET /api/usage's wallet. Frozen and expired top-ups
// are listed so a balance that "disappeared" explains itself, but only spendable rows add up to what is left.
export function balanceRows(wallet: WalletView | null | undefined, t: T): BalanceRow[] {
  if (!wallet || wallet.mode === 'unavailable') return [];
  if (wallet.mode === 'free') {
    return wallet.free ? [{ id: 'free', label: t('Jatah Gratis', 'Free allowance'), value: wallet.free.remaining, of: wallet.free.original, hint: t('Sekali pakai, tidak diisi ulang', 'One-time, never refilled'), spendable: true }] : [];
  }
  const rows: BalanceRow[] = [];
  if (wallet.included) rows.push({ id: 'plan', label: t('Dari paket', 'From your plan'), value: wallet.included.remaining, of: wallet.included.original, hint: t('Diisi ulang tiap periode paket', 'Refills every plan period'), spendable: true });
  rows.push({ id: 'topup', label: t('Top-up tersedia', 'Top-up available'), value: wallet.purchased.available, hint: t('Dipakai setelah jatah paket habis', 'Used after the plan allowance'), spendable: true });
  if (wallet.purchased.frozen > 0) rows.push({ id: 'frozen', label: t('Top-up dibekukan', 'Top-up frozen'), value: wallet.purchased.frozen, hint: t('Aktif lagi saat paket berbayar berjalan', 'Usable again while a paid plan runs'), spendable: false });
  if (wallet.purchased.expired > 0) rows.push({ id: 'expired', label: t('Top-up kedaluwarsa', 'Top-up expired'), value: wallet.purchased.expired, hint: t('Lewat masa berlaku 12 bulan', 'Past its 12-month validity'), spendable: false });
  return rows;
}

export function orderStatus(status: string, t: T): { label: string; tone: 'ok' | 'wait' | 'bad' | 'muted' } {
  switch (status) {
    case 'paid': return { label: t('Lunas', 'Paid'), tone: 'ok' };
    case 'pending': return { label: t('Menunggu pembayaran', 'Awaiting payment'), tone: 'wait' };
    case 'refunded': return { label: t('Dikembalikan', 'Refunded'), tone: 'muted' };
    case 'expired': return { label: t('Kedaluwarsa', 'Expired'), tone: 'muted' };
    case 'cancelled': return { label: t('Dibatalkan', 'Cancelled'), tone: 'muted' };
    default: return { label: t('Gagal', 'Failed'), tone: 'bad' };
  }
}

export function featureLabel(feature: Feature, t: T): string {
  switch (feature) {
    case 'saved_styles': return t('Skill tersimpan', 'Saved skills');
    case 'purchase_topup': return t('Beli tambahan karakter', 'Buy character top-ups');
    case 'advanced_notebook': return t('Kanvas halaman', 'Page canvas');
    case 'docx_import': return t('Impor DOCX', 'DOCX import');
    case 'docx_export': return t('Ekspor DOCX', 'DOCX export');
    case 'freeform_prompt': return t('Perintah AI', 'AI instructions');
    case 'persistent_personalization': return t('Catatan untuk AI tersimpan', 'Note for the AI kept');
    case 'style_reference': return t('Contoh tulisan di skill', 'Writing samples in skills');
    case 'draft_from_brief': return t('Draf dari brief (AI)', 'Draft from brief (AI)');
  }
}
