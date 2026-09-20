-- B3: verified MKL entitlement projection and non-commercial capability evidence.
-- No offer, order, payment, character-wallet or production commissioning state is
-- introduced by this migration.
ALTER TABLE external_identity_link ADD COLUMN organization_id TEXT;

CREATE TABLE mkl_entitlement_projection (
	user_id TEXT PRIMARY KEY NOT NULL,
	identity_link_id TEXT NOT NULL UNIQUE,
	issuer TEXT NOT NULL,
	subject TEXT NOT NULL,
	organization_id TEXT NOT NULL,
	application_client_id TEXT NOT NULL,
	application_app_key TEXT NOT NULL,
	catalog_item_id TEXT NOT NULL,
	scope_revision INTEGER NOT NULL CHECK (
		typeof(scope_revision) = 'integer' AND
		scope_revision BETWEEN 0 AND 9007199254740991
	),
	authority_payload_hash TEXT NOT NULL,
	entitlement_id TEXT,
	status TEXT,
	plan_code TEXT,
	plan_version TEXT,
	period_start TEXT,
	period_end TEXT,
	access_deadline TEXT,
	commercial_kind TEXT,
	entitlement_created_at TEXT,
	server_time TEXT NOT NULL,
	verified_at INTEGER NOT NULL,
	fresh_until INTEGER NOT NULL,
	invalidated_at INTEGER,
	invalidation_reason TEXT,
	updated_at INTEGER NOT NULL,
	FOREIGN KEY (user_id) REFERENCES user(id) ON DELETE CASCADE,
	FOREIGN KEY (identity_link_id) REFERENCES external_identity_link(id) ON DELETE CASCADE,
	CONSTRAINT mkl_projection_identity_unique UNIQUE(issuer, subject, organization_id)
);
--> statement-breakpoint
CREATE INDEX mkl_entitlement_projection_freshness_idx
	ON mkl_entitlement_projection(fresh_until, user_id);
--> statement-breakpoint
CREATE TRIGGER mkl_projection_identity_guard_insert
BEFORE INSERT ON mkl_entitlement_projection
WHEN NOT EXISTS (
	SELECT 1 FROM external_identity_link l
	WHERE l.id = NEW.identity_link_id
		AND l.user_id = NEW.user_id
		AND l.issuer = NEW.issuer
		AND l.subject = NEW.subject
		AND l.organization_id = NEW.organization_id
)
BEGIN
	SELECT RAISE(ABORT, 'MKL_PROJECTION_IDENTITY_MISMATCH');
END;
--> statement-breakpoint
CREATE TRIGGER mkl_projection_identity_guard_update
BEFORE UPDATE ON mkl_entitlement_projection
WHEN NOT EXISTS (
	SELECT 1 FROM external_identity_link l
	WHERE l.id = NEW.identity_link_id
		AND l.user_id = NEW.user_id
		AND l.issuer = NEW.issuer
		AND l.subject = NEW.subject
		AND l.organization_id = NEW.organization_id
)
BEGIN
	SELECT RAISE(ABORT, 'MKL_PROJECTION_IDENTITY_MISMATCH');
END;

-- Support/test grants are explicitly separate from commercial authority.  They
-- may unlock product testing only; the resolver never turns them into a plan,
-- top-up eligibility, or wallet value.
CREATE TABLE capability_grants (
	id TEXT PRIMARY KEY NOT NULL,
	user_id TEXT NOT NULL,
	authority TEXT NOT NULL CHECK (authority IN ('support', 'test')),
	capabilities_json TEXT NOT NULL,
	reason TEXT NOT NULL,
	issued_by TEXT NOT NULL,
	expires_at INTEGER NOT NULL,
	revoked_at INTEGER,
	created_at INTEGER NOT NULL,
	FOREIGN KEY (user_id) REFERENCES user(id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX capability_grants_user_active_idx
	ON capability_grants(user_id, expires_at, revoked_at);

-- Server-issued evidence only.  A document receives this row after a
-- successful Pro/Max DOCX import or export; client timestamps and document
-- shape are never consulted for portability.
CREATE TABLE document_portability_evidence (
	document_id TEXT PRIMARY KEY NOT NULL,
	owner_id TEXT NOT NULL,
	kind TEXT NOT NULL CHECK (kind IN ('docx_import', 'docx_export')),
	authority TEXT NOT NULL CHECK (authority IN ('mkl', 'local_admin', 'support', 'test', 'legacy_local')),
	projection_revision INTEGER,
	created_at INTEGER NOT NULL,
	FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE,
	FOREIGN KEY (owner_id) REFERENCES user(id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX document_portability_owner_idx
	ON document_portability_evidence(owner_id, document_id);
--> statement-breakpoint
CREATE TABLE pending_docx_import_evidence (
	id TEXT PRIMARY KEY NOT NULL,
	owner_id TEXT NOT NULL,
	content_hash TEXT NOT NULL,
	authority TEXT NOT NULL CHECK (authority IN ('mkl', 'local_admin', 'support', 'test', 'legacy_local')),
	projection_revision INTEGER,
	expires_at INTEGER NOT NULL,
	created_at INTEGER NOT NULL,
	FOREIGN KEY (owner_id) REFERENCES user(id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX pending_docx_import_owner_idx
	ON pending_docx_import_evidence(owner_id, expires_at);
