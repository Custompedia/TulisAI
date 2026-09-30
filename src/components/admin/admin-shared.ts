import { TIERS as PLAN_TIERS, type Tier } from '@/lib/plans';

export type Role = 'user' | 'admin';
export type { Tier };
export type T = (id: string, en: string) => string;
export type AdminUser = {
  id: string; name: string; email: string; username: string | null; image: string | null; role: Role; tier: Tier; emailVerified: boolean; createdAt: string; updatedAt: string;
  banned: boolean; banReason: string | null; banExpires: string | null; aiLimitOverride: number | null; aiCharacterLimitOverride: number | null; adminNote: string | null; requestLimit: number; characterLimit: number; charactersUsed: number; characterScope: 'account' | 'period'; unlimited: boolean;
  requestsThisMonth: number; failedThisMonth: number; tokensThisMonth: number; lastActiveAt: string | null; documents: number;
  plan: AdminPlan;
};
export type PaidPlan = Exclude<Tier, 'free'>;
// The running local access period. `tier` above is already the effective tier (this plan, else the legacy column).
export type AdminPlan = { code: PaidPlan | null; source: 'admin' | 'payment' | null; periodEnd: string | null; paidThrough: string | null };
export type AdminSummary = { period: string; users: number; admins: number; banned: number; tiers: Record<Tier, number>; requestsThisMonth: number; charactersThisMonth: number; failedThisMonth: number; tokensThisMonth: number; monthlyLimit: number; freeCharacterAllowance: number; tierLimits: Record<Tier, number>; tierCharacterLimits: Record<Tier, number>; aiEnabled: boolean; model: string };
export type AuditEntry = { id: string; actorId: string; actorName: string | null; targetUserId: string | null; targetName: string | null; action: string; details: Record<string, unknown>; createdAt: string };
export type UsageEntry = { id: string; operation: string; promptId: string | null; status: string; sourceCharacters: number | null; inputTokens: number | null; outputTokens: number | null; latencyMs: number | null; errorCode: string | null; createdAt: string; completedAt: string | null };
export type SessionEntry = { id: string; token: string; createdAt: string; expiresAt: string; ipAddress: string | null; userAgent: string | null };
// Hibah karakter lots, newest first (see server/usage/admin-grants).
export type AdminGrant = { id: string; amount: number; remaining: number; state: string; grantedAt: string; expiresAt: string };
export type UserDetail = { user: AdminUser; sessions: SessionEntry[]; history: AuditEntry[]; grants?: AdminGrant[] };
export type PageInfo = { page: number; pageSize: number; total: number; pages: number };
export type UsersPage = { summary: AdminSummary; items: AdminUser[]; pageInfo: PageInfo };
export type AuditPage = { items: AuditEntry[]; pageInfo: PageInfo };
export type UserSort = 'newest' | 'oldest' | 'name' | 'usage' | 'active';
export type AiMetrics = {
  from: string; to: string; totals: { requests: number; completed: number; failed: number; running: number; users: number; inputTokens: number; outputTokens: number; characters: number; avgLatencyMs: number | null; failRate: number; costUsd: number; costedRequests: number };
  byDay: Array<{ day: string; requests: number; failed: number; tokens: number; users: number }>;
  byPrompt: Array<{ promptId: string; requests: number; failed: number; tokens: number; avgLatencyMs: number | null }>;
  byError: Array<{ errorCode: string; count: number }>;
  topUsers: Array<{ id: string; name: string; email: string; role: Role; tier: Tier; requests: number; failed: number; tokens: number }>;
};
export const ADMIN_ACTIONS = ['user.create', 'user.update', 'user.role', 'user.ban', 'user.unban', 'user.password', 'user.delete', 'session.revoke', 'session.revoke-all', 'plan.admin.activated', 'plan.admin.extended', 'plan.admin.replaced', 'plan.admin.ended', 'wallet.admin.grant',
  'payment.plan.activated', 'payment.plan.renewed', 'payment.topup.credited', 'payment.needs_operator', 'payment.refund.topup_reversed', 'payment.refund.needs_operator', 'payment.mode_mismatch', 'payment.amount_mismatch'] as const;
export const sortLabel = (sort: UserSort, t: T) => ({ newest: t('Terbaru bergabung', 'Newest'), oldest: t('Terlama bergabung', 'Oldest'), name: t('Nama A–Z', 'Name A–Z'), usage: t('Permintaan AI terbanyak bulan ini', 'Most AI requests this month'), active: t('Terakhir aktif', 'Recently active') })[sort];
export const promptLabel = (promptId: string) => ({ P01_STANDARD_REWRITE: 'Parafrase', P02_ACADEMIC: 'Akademik', P03_HUMANIZER: 'Humanize', P04_PROFESSIONAL: 'Profesional', P05_CREATIVE: 'Kreatif', P06_SIMPLIFY: 'Sederhanakan', P07_INLINE_ALTERNATIVES: 'Alternatif inline', P08_CUSTOM_TRANSFORM: 'Sesuaikan', P09_QUALITY_EVALUATION: 'Analisis kualitas', P10_REPAIR: 'Perbaikan', generate: 'Rewrite', repair: 'Perbaikan', analyze: 'Analisis' } as Record<string, string>)[promptId] ?? promptId;

export const TIERS: readonly Tier[] = PLAN_TIERS;
export const tierLabel = (tier: Tier, t: T) => ({ free: t('Gratis', 'Free'), plus: 'Plus', pro: 'Pro', max: 'Max' })[tier];
export const roleLabel = (role: Role) => (role === 'admin' ? 'Admin' : 'User');
export const actionLabel = (action: string, t: T) => ({
  'user.create': t('Membuat akun', 'Created account'), 'user.update': t('Mengubah data', 'Updated details'), 'user.role': t('Mengubah role', 'Changed role'), 'user.ban': t('Menonaktifkan akun', 'Disabled account'),
  'user.unban': t('Mengaktifkan akun', 'Enabled account'), 'user.password': t('Mengganti password', 'Set a new password'), 'user.delete': t('Menghapus akun', 'Deleted account'),
  'session.revoke': t('Mencabut satu sesi', 'Revoked a session'), 'session.revoke-all': t('Mencabut semua sesi', 'Revoked all sessions'),
  'plan.admin.activated': t('Mengaktifkan paket', 'Activated a plan'), 'plan.admin.extended': t('Memperpanjang paket', 'Extended the plan'),
  'plan.admin.replaced': t('Mengganti paket', 'Replaced the plan'), 'plan.admin.ended': t('Mengakhiri paket', 'Ended the plan'),
  'wallet.admin.grant': t('Menghibahkan karakter', 'Granted characters'),
  'payment.plan.activated': t('Membayar paket', 'Paid for a plan'), 'payment.plan.renewed': t('Memperpanjang paket (bayar)', 'Renewed a plan (paid)'),
  'payment.topup.credited': t('Membeli tambahan karakter', 'Bought a top-up'), 'payment.needs_operator': t('Pembayaran perlu tindakan', 'Payment needs action'),
  'payment.refund.topup_reversed': t('Refund tambahan karakter', 'Top-up refunded'), 'payment.refund.needs_operator': t('Refund paket perlu tindakan', 'Plan refund needs action'),
  'payment.mode_mismatch': t('Mode pembayaran tidak cocok', 'Payment mode mismatch'), 'payment.amount_mismatch': t('Jumlah pembayaran tidak cocok', 'Payment amount mismatch'),
}[action] ?? action);
export const statusLabel = (status: string, t: T) => ({ completed: t('Selesai', 'Completed'), failed: t('Gagal', 'Failed'), reserved: t('Berjalan', 'Running') }[status] ?? status);
export const operationLabel = (operation: string, t: T) => ({ generate: t('Rewrite', 'Rewrite'), repair: t('Perbaikan', 'Repair'), analyze: t('Analisis', 'Analysis') }[operation] ?? operation);
export const detailSummary = (entry: AuditEntry, t: T): string => {
  const d = entry.details;
  switch (entry.action) {
    case 'user.role': return `${roleLabel(d.from as Role)} → ${roleLabel(d.to as Role)}`;
    case 'user.ban': return `${String(d.reason ?? '')}${d.expiresInDays ? ` · ${d.expiresInDays} ${t('hari', 'days')}` : ` · ${t('permanen', 'permanent')}`}`;
    case 'user.create': return `${String(d.email ?? '')} · ${roleLabel((d.role as Role) ?? 'user')} · ${String(d.tier ?? 'free')}`;
    case 'user.update': { const changes = (d.changes ?? {}) as Record<string, unknown>; return Object.entries(changes).map(([key, value]) => `${key}: ${value === null ? '—' : String(value)}`).join(', '); }
    case 'user.delete': return String(d.email ?? '');
    case 'plan.admin.activated': case 'plan.admin.extended': case 'plan.admin.replaced': {
      const plan = tierLabel(d.plan as Tier, t); const until = typeof d.periodEnd === 'string' ? d.periodEnd.slice(0, 10) : '';
      return `${plan}${until ? ` · ${t('sampai', 'until')} ${until}` : ''}${d.note ? ` · ${String(d.note)}` : ''}`;
    }
    case 'plan.admin.ended': return String(d.reason ?? '');
    case 'wallet.admin.grant': {
      const amount = typeof d.amount === 'number' ? new Intl.NumberFormat('id-ID').format(d.amount) : '?';
      const until = typeof d.expiresAt === 'string' ? d.expiresAt.slice(0, 10) : '';
      return `${amount} ${t('karakter', 'characters')}${until ? ` · ${t('sampai', 'until')} ${until}` : ''}${d.note ? ` · ${String(d.note)}` : ''}`;
    }
    default: return '';
  }
};
// A grant lot follows the top-up states: frozen while no paid plan runs, then active, expired or reversed.
export const grantStateLabel = (state: string, t: T) => ({ active: t('Bisa dipakai', 'Spendable'), frozen: t('Beku (tanpa paket berbayar)', 'Frozen (no paid plan)'), expired: t('Kedaluwarsa', 'Expired'), reversed: t('Dibatalkan', 'Reversed') }[state] ?? state);
export const shortId = (id: string) => (id.length > 10 ? `${id.slice(0, 6)}…${id.slice(-3)}` : id);

// The product bills characters, so the table shows characters used against the balance, not a request count.
// 'account' scope is Free's one-time allowance; every other account refills per period. Admins are charged too.
export const characterUsage = (user: Pick<AdminUser, 'charactersUsed' | 'characterLimit' | 'characterScope'>, t: T) => ({
  used: user.charactersUsed, limit: user.characterLimit,
  scope: user.characterScope === 'account' ? t('sekali pakai', 'one-time') : t('bulan ini', 'this month'),
  share: user.characterLimit > 0 ? Math.min(1, user.charactersUsed / user.characterLimit) : 0,
});

// Walks every page of a paged list, so an export covers all matching rows and not just the page on screen.
export async function collectAllPages<I>(load: (page: number) => Promise<{ items: I[]; pageInfo: PageInfo }>): Promise<I[]> {
  const first = await load(1);
  const items = [...first.items];
  for (let page = 2; page <= first.pageInfo.pages; page++) items.push(...(await load(page)).items);
  return items;
}

const csvCell = (value: unknown) => { const text = value === null || value === undefined ? '' : String(value); return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text; };
export const USER_CSV_HEADER = ['id', 'name', 'email', 'username', 'role', 'tier', 'status', 'email_verified', 'characters_used', 'character_limit', 'character_scope', 'requests_this_month', 'failed_this_month', 'tokens_this_month', 'documents', 'last_active_at', 'created_at'];
export function usersCsv(items: AdminUser[]): string {
  const rows = items.map((u) => [u.id, u.name, u.email, u.username, u.role, u.tier, u.banned ? 'disabled' : 'active', u.emailVerified, u.charactersUsed, u.characterLimit, u.characterScope, u.requestsThisMonth, u.failedThisMonth, u.tokensThisMonth, u.documents, u.lastActiveAt, u.createdAt]);
  return [USER_CSV_HEADER, ...rows].map((row) => row.map(csvCell).join(',')).join('\n');
}
