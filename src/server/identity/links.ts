import type { MklIdentity } from "../auth/mkl-oidc";
import { consentIdentifier, parseConsentState, type ConsentState } from "../auth/mkl-state";
import { auditStatement } from "../audit";
import { RequestError } from "../http";
import { runtime } from "../runtime";

export const MKL_PROVIDER = "mkl";

export type ExternalIdentityLink = {
  id: string; provider: string; issuer: string; subject: string; organizationId: string | null; userId: string; profileEmail: string | null; profileName: string | null;
  linkMethod: string; createdAt: number; updatedAt: number; lastAuthenticatedAt: number | null;
};

export type IdentityOwner = {
  link: ExternalIdentityLink;
  user: { id: string; name: string; email: string; emailVerified: boolean; image: string | null; username: string | null; role: string; tier: string; banned: boolean; banExpires: number | null; createdAt: Date; updatedAt: Date };
};

type LinkRow = { id: string; provider: string; issuer: string; subject: string; organization_id: string | null; user_id: string; profile_email: string | null; profile_name: string | null; link_method: string; created_at: number; updated_at: number; last_authenticated_at: number | null };
type OwnerRow = LinkRow & { user_name: string; user_email: string; email_verified: number; image: string | null; username: string | null; role: string; tier: string; banned: number; ban_expires: number | null; user_created_at: number; user_updated_at: number };
type VerificationRow = { id: string; identifier: string; value: string; expires_at: number };

const toLink = (row: LinkRow): ExternalIdentityLink => ({ id: row.id, provider: row.provider, issuer: row.issuer, subject: row.subject, organizationId: row.organization_id, userId: row.user_id, profileEmail: row.profile_email, profileName: row.profile_name, linkMethod: row.link_method, createdAt: row.created_at, updatedAt: row.updated_at, lastAuthenticatedAt: row.last_authenticated_at });

export async function getMklLinkByUserId(userId: string): Promise<ExternalIdentityLink | null> {
  const row = await runtime().DB.prepare("SELECT * FROM external_identity_link WHERE provider=? AND user_id=? LIMIT 1").bind(MKL_PROVIDER, userId).first<LinkRow>();
  return row ? toLink(row) : null;
}

export async function getIdentityOwner(issuer: string, subject: string): Promise<IdentityOwner | null> {
  const row = await runtime().DB.prepare(`SELECT l.*, u.name AS user_name, u.email AS user_email, u.email_verified, u.image, u.username, u.role, u.tier, u.banned, u.ban_expires, u.created_at AS user_created_at, u.updated_at AS user_updated_at
    FROM external_identity_link l JOIN user u ON u.id=l.user_id WHERE l.issuer=? AND l.subject=? LIMIT 1`).bind(issuer, subject).first<OwnerRow>();
  if (!row) return null;
  return { link: toLink(row), user: { id: row.user_id, name: row.user_name, email: row.user_email, emailVerified: row.email_verified === 1, image: row.image, username: row.username, role: row.role, tier: row.tier, banned: row.banned === 1, banExpires: row.ban_expires, createdAt: new Date(row.user_created_at), updatedAt: new Date(row.user_updated_at) } };
}

export async function emailOwner(email: string): Promise<{ id: string } | null> {
  return await runtime().DB.prepare("SELECT id FROM user WHERE lower(email)=lower(?) LIMIT 1").bind(email).first<{ id: string }>();
}

export function activeBan(user: { banned: boolean; banExpires: number | null }): boolean { return user.banned && (user.banExpires === null || user.banExpires > Date.now()); }

export async function updateAuthenticatedLink(linkId: string, identity: MklIdentity): Promise<void> {
  const now = Date.now();
  await runtime().DB.prepare("UPDATE external_identity_link SET organization_id=?,profile_email=?, profile_name=?, updated_at=?, last_authenticated_at=? WHERE id=?")
    .bind(identity.organizationId, identity.email, identity.name, now, now, linkId).run();
}

export async function provisionMklUser(identity: MklIdentity, name: string, correlationRef: string) {
  if (!identity.email || !identity.emailVerified) throw new RequestError("MKL_PROFILE_INCOMPLETE", "MKL must provide a verified email address.", 422);
  const db = runtime().DB; const now = Date.now(); const userId = crypto.randomUUID(); const linkId = crypto.randomUUID();
  const details = { linkId, issuer: identity.issuer, subject: identity.subject, method: "mkl-sign-in", correlationRef };
  await db.batch([
    db.prepare("INSERT INTO user (id,name,email,email_verified,image,username,role,banned,tier,created_at,updated_at) VALUES (?,?,?,?,NULL,NULL,'user',0,'free',?,?)").bind(userId, name, identity.email, 1, now, now),
    db.prepare("INSERT INTO external_identity_link (id,provider,issuer,subject,organization_id,user_id,profile_email,profile_name,link_method,created_at,updated_at,last_authenticated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)")
      .bind(linkId, MKL_PROVIDER, identity.issuer, identity.subject, identity.organizationId, userId, identity.email, identity.name, "mkl-sign-in", now, now, now),
    auditStatement(db, { actorId: userId, targetUserId: userId, action: "identity.mkl.account-created", details, createdAt: now }),
  ]);
  return { id: userId, name, email: identity.email, emailVerified: true, image: null, username: null, role: "user", tier: "free", banned: false, createdAt: new Date(now), updatedAt: new Date(now) };
}

export async function pendingConsent(receipt: string): Promise<{ row: VerificationRow; value: ConsentState } | null> {
  const identifier = consentIdentifier(receipt);
  const row = await runtime().DB.prepare("SELECT id,identifier,value,expires_at FROM verification WHERE identifier=? ORDER BY created_at DESC LIMIT 1").bind(identifier).first<VerificationRow>();
  if (!row) return null;
  const value = parseConsentState(row.value);
  return value ? { row, value } : null;
}

export async function confirmMklLink(receipt: string, pending: { row: VerificationRow; value: ConsentState }): Promise<ExternalIdentityLink> {
  const db = runtime().DB; const now = Date.now(); const linkId = crypto.randomUUID(); const auditId = crypto.randomUUID();
  const { row, value } = pending; const identifier = consentIdentifier(receipt);
  const details = JSON.stringify({ linkId, issuer: value.issuer, subject: value.subject, method: "explicit-link", correlationRef: value.correlationRef });
  const results = await db.batch([
    db.prepare(`INSERT INTO external_identity_link (id,provider,issuer,subject,organization_id,user_id,profile_email,profile_name,link_method,created_at,updated_at,last_authenticated_at)
      SELECT ?,?,?,?,?,?,?,?,?, ?,?,NULL FROM verification v JOIN user u ON u.id=?
      WHERE v.id=? AND v.identifier=? AND v.value=? AND v.expires_at>?
        AND (','||COALESCE(u.role,'')||',') NOT LIKE '%,admin,%'
        AND NOT (u.banned=1 AND (u.ban_expires IS NULL OR u.ban_expires>?))
        AND NOT EXISTS (SELECT 1 FROM external_identity_link x WHERE x.issuer=? AND x.subject=?)
        AND NOT EXISTS (SELECT 1 FROM external_identity_link x WHERE x.provider=? AND x.user_id=?)`)
      .bind(linkId, MKL_PROVIDER, value.issuer, value.subject, value.organizationId, value.userId, value.email, value.name, "explicit-link", now, now, value.userId, row.id, identifier, row.value, now, now, value.issuer, value.subject, MKL_PROVIDER, value.userId),
    db.prepare(`INSERT INTO admin_audit_log (id,actor_id,target_user_id,action,details_json,created_at)
      SELECT ?,?,?,?, ?,? FROM verification v JOIN external_identity_link l ON l.id=?
      WHERE v.id=? AND v.identifier=? AND v.value=? AND v.expires_at>?`)
      .bind(auditId, value.userId, value.userId, "identity.mkl.linked", details, now, linkId, row.id, identifier, row.value, now),
    db.prepare("DELETE FROM verification WHERE id=? AND identifier=? AND value=?").bind(row.id, identifier, row.value),
  ]);
  if ((results[0]?.meta.changes ?? 0) === 1) return (await getMklLinkByUserId(value.userId))!;
  const owner = await getIdentityOwner(value.issuer, value.subject);
  if (owner) throw new RequestError("MKL_IDENTITY_LINKED_ELSEWHERE", "This MKL identity is already linked.", 409);
  if (await getMklLinkByUserId(value.userId)) throw new RequestError("MKL_ACCOUNT_ALREADY_LINKED", "This account already has an MKL identity.", 409);
  const role = await db.prepare("SELECT role,banned,ban_expires FROM user WHERE id=?").bind(value.userId).first<{ role: string; banned: number; ban_expires: number | null }>();
  if (!role || (`,` + role.role + `,`).includes(",admin,")) throw new RequestError("MKL_ADMIN_LINK_FORBIDDEN", "Local admin accounts cannot link MKL customer identities.", 403);
  if (role.banned === 1 && (role.ban_expires === null || role.ban_expires > now)) throw new RequestError("ACCOUNT_DISABLED", "This account has been disabled.", 403);
  throw new RequestError("MKL_CONFIRMATION_EXPIRED", "The MKL confirmation expired.", 410);
}

export async function assertMklAccountDeletable(userId: string): Promise<void> {
  if (await getMklLinkByUserId(userId)) throw new RequestError("MKL_LINKED_ACCOUNT_DELETE_FORBIDDEN", "An MKL-linked account cannot be deleted.", 409);
}
