export type Role = 'user' | 'admin';
export type Tier = 'free' | 'plus' | 'pro' | 'team';
export type T = (id: string, en: string) => string;
export type AdminUser = {
  id: string; name: string; email: string; username: string | null; image: string | null; role: Role; tier: Tier; emailVerified: boolean; createdAt: string; updatedAt: string;
  banned: boolean; banReason: string | null; banExpires: string | null; aiLimitOverride: number | null; adminNote: string | null; requestLimit: number; unlimited: boolean;
  requestsThisMonth: number; failedThisMonth: number; tokensThisMonth: number; lastActiveAt: string | null; documents: number;
};
export type AdminSummary = { period: string; users: number; admins: number; banned: number; tiers: Record<Tier, number>; requestsThisMonth: number; failedThisMonth: number; tokensThisMonth: number; monthlyLimit: number; tierLimits: Record<Tier, number>; aiEnabled: boolean; model: string };
export type AuditEntry = { id: string; actorId: string; actorName: string | null; targetUserId: string | null; targetName: string | null; action: string; details: Record<string, unknown>; createdAt: string };
export type UsageEntry = { id: string; operation: string; promptId: string | null; status: string; sourceCharacters: number | null; inputTokens: number | null; outputTokens: number | null; latencyMs: number | null; errorCode: string | null; createdAt: string; completedAt: string | null };
export type SessionEntry = { id: string; token: string; createdAt: string; expiresAt: string; ipAddress: string | null; userAgent: string | null };
export type UserDetail = { user: AdminUser; sessions: SessionEntry[]; history: AuditEntry[] };
export type PageInfo = { page: number; pageSize: number; total: number; pages: number };
export type UsersPage = { summary: AdminSummary; items: AdminUser[]; pageInfo: PageInfo };
export type AuditPage = { items: AuditEntry[]; pageInfo: PageInfo };
export type UserSort = 'newest' | 'oldest' | 'name' | 'usage' | 'active';
export type AiMetrics = {
  from: string; to: string; totals: { requests: number; completed: number; failed: number; running: number; users: number; inputTokens: number; outputTokens: number; characters: number; avgLatencyMs: number | null; failRate: number };
  byDay: Array<{ day: string; requests: number; failed: number; tokens: number; users: number }>;
  byPrompt: Array<{ promptId: string; requests: number; failed: number; tokens: number; avgLatencyMs: number | null }>;
  byError: Array<{ errorCode: string; count: number }>;
  topUsers: Array<{ id: string; name: string; email: string; role: Role; tier: Tier; requests: number; failed: number; tokens: number }>;
};
export const ADMIN_ACTIONS = ['user.create', 'user.update', 'user.role', 'user.ban', 'user.unban', 'user.password', 'user.delete', 'session.revoke', 'session.revoke-all'] as const;
export const sortLabel = (sort: UserSort, t: T) => ({ newest: t('Terbaru bergabung', 'Newest'), oldest: t('Terlama bergabung', 'Oldest'), name: t('Nama A–Z', 'Name A–Z'), usage: t('AI terbanyak bulan ini', 'Most AI this month'), active: t('Terakhir aktif', 'Recently active') })[sort];
export const promptLabel = (promptId: string) => ({ P01_STANDARD_REWRITE: 'Parafrase', P02_ACADEMIC: 'Akademik', P03_HUMANIZER: 'Humanize', P04_PROFESSIONAL: 'Profesional', P05_CREATIVE: 'Kreatif', P06_SIMPLIFY: 'Sederhanakan', P07_INLINE_ALTERNATIVES: 'Alternatif inline', P08_CUSTOM_TRANSFORM: 'Sesuaikan', P09_QUALITY_EVALUATION: 'Analisis kualitas', P10_REPAIR: 'Perbaikan', generate: 'Rewrite', repair: 'Perbaikan', analyze: 'Analisis' } as Record<string, string>)[promptId] ?? promptId;

export const TIERS: Tier[] = ['free', 'plus', 'pro', 'team'];
export const tierLabel = (tier: Tier, t: T) => ({ free: t('Gratis', 'Free'), plus: 'Plus', pro: 'Pro', team: t('Tim', 'Team') })[tier];
export const roleLabel = (role: Role) => (role === 'admin' ? 'Admin' : 'User');
export const actionLabel = (action: string, t: T) => ({
  'user.create': t('Membuat akun', 'Created account'), 'user.update': t('Mengubah data', 'Updated details'), 'user.role': t('Mengubah role', 'Changed role'), 'user.ban': t('Menonaktifkan akun', 'Disabled account'),
  'user.unban': t('Mengaktifkan akun', 'Enabled account'), 'user.password': t('Mengganti password', 'Set a new password'), 'user.delete': t('Menghapus akun', 'Deleted account'),
  'session.revoke': t('Mencabut satu sesi', 'Revoked a session'), 'session.revoke-all': t('Mencabut semua sesi', 'Revoked all sessions'),
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
    default: return '';
  }
};
export const shortId = (id: string) => (id.length > 10 ? `${id.slice(0, 6)}…${id.slice(-3)}` : id);
