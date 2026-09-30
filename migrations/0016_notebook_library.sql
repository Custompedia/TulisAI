-- UX 2: the notebook library moves to the server. GET /api/documents filters
-- by title, last mode and kind of writing, sorts, and counts; notebooks can be
-- pinned (Sematkan) and moved to a 30-day trash (Sampah) instead of being
-- deleted outright. Additive only: two nullable columns (NULL = not pinned,
-- not in the trash, which is every existing row) and three indexes. No row is
-- rewritten. Rollback: the app ignores both columns once the code is reverted;
-- the indexes can be dropped at any time.
ALTER TABLE documents ADD COLUMN pinned_at INTEGER;
--> statement-breakpoint
ALTER TABLE documents ADD COLUMN deleted_at INTEGER;
--> statement-breakpoint
-- The kind of writing lives in preferences_json (docType); the list and the
-- sidebar counts filter and group on exactly this expression.
CREATE INDEX documents_owner_doc_type_idx ON documents(owner_id, json_extract(preferences_json, '$.docType'));
--> statement-breakpoint
CREATE INDEX documents_owner_pinned_idx ON documents(owner_id, pinned_at) WHERE pinned_at IS NOT NULL;
--> statement-breakpoint
-- The hourly purge looks up trash older than 30 days across all owners.
CREATE INDEX documents_trash_idx ON documents(deleted_at) WHERE deleted_at IS NOT NULL;
