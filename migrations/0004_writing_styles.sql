CREATE TABLE IF NOT EXISTS writing_styles (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, name TEXT NOT NULL, color TEXT, icon TEXT, settings_json TEXT NOT NULL DEFAULT '{}', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS styles_owner_name_unique ON writing_styles(owner_id, name COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS styles_owner_created_idx ON writing_styles(owner_id, created_at, id);
