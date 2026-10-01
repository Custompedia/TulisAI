-- DOCX import/export evidence was created when paid access came from MKL, so
-- its authority CHECK only knew the MKL-era values. Local plans (migration
-- 0014) give paid accounts the authority 'payment' or 'admin_grant', and the
-- evidence insert failed for them: DOCX import returned 500 and DOCX export
-- could not record evidence. Rebuild both tables with the full authority list.
-- No table references these two, so a hold-table rebuild is enough.
PRAGMA defer_foreign_keys = true;
--> statement-breakpoint
CREATE TABLE document_portability_evidence_hold AS SELECT * FROM document_portability_evidence;
--> statement-breakpoint
DROP TABLE document_portability_evidence;
--> statement-breakpoint
CREATE TABLE document_portability_evidence (
	document_id TEXT PRIMARY KEY NOT NULL,
	owner_id TEXT NOT NULL,
	kind TEXT NOT NULL CHECK (kind IN ('docx_import', 'docx_export')),
	authority TEXT NOT NULL CHECK (authority IN ('mkl', 'local_admin', 'support', 'test', 'legacy_local', 'payment', 'admin_grant')),
	projection_revision INTEGER,
	created_at INTEGER NOT NULL,
	FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE,
	FOREIGN KEY (owner_id) REFERENCES user(id) ON DELETE CASCADE
);
--> statement-breakpoint
INSERT INTO document_portability_evidence (document_id, owner_id, kind, authority, projection_revision, created_at)
	SELECT document_id, owner_id, kind, authority, projection_revision, created_at FROM document_portability_evidence_hold;
--> statement-breakpoint
DROP TABLE document_portability_evidence_hold;
--> statement-breakpoint
CREATE INDEX document_portability_owner_idx
	ON document_portability_evidence(owner_id, document_id);
--> statement-breakpoint
CREATE TABLE pending_docx_import_evidence_hold AS SELECT * FROM pending_docx_import_evidence;
--> statement-breakpoint
DROP TABLE pending_docx_import_evidence;
--> statement-breakpoint
CREATE TABLE pending_docx_import_evidence (
	id TEXT PRIMARY KEY NOT NULL,
	owner_id TEXT NOT NULL,
	content_hash TEXT NOT NULL,
	authority TEXT NOT NULL CHECK (authority IN ('mkl', 'local_admin', 'support', 'test', 'legacy_local', 'payment', 'admin_grant')),
	projection_revision INTEGER,
	expires_at INTEGER NOT NULL,
	created_at INTEGER NOT NULL,
	FOREIGN KEY (owner_id) REFERENCES user(id) ON DELETE CASCADE
);
--> statement-breakpoint
INSERT INTO pending_docx_import_evidence (id, owner_id, content_hash, authority, projection_revision, expires_at, created_at)
	SELECT id, owner_id, content_hash, authority, projection_revision, expires_at, created_at FROM pending_docx_import_evidence_hold;
--> statement-breakpoint
DROP TABLE pending_docx_import_evidence_hold;
--> statement-breakpoint
CREATE INDEX pending_docx_import_owner_idx
	ON pending_docx_import_evidence(owner_id, expires_at);
