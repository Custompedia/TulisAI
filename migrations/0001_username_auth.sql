ALTER TABLE user ADD COLUMN username TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS user_username_unique ON user(username);
CREATE TABLE IF NOT EXISTS rate_limit (id TEXT PRIMARY KEY, key TEXT NOT NULL UNIQUE, count INTEGER NOT NULL, last_request INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS rate_limit_last_request_idx ON rate_limit(last_request);
