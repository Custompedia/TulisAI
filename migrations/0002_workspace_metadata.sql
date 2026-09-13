ALTER TABLE user_preferences ADD COLUMN primary_use_case TEXT NOT NULL DEFAULT 'general';
ALTER TABLE user_preferences ADD COLUMN humanizer_context TEXT NOT NULL DEFAULT 'general';
ALTER TABLE user_preferences ADD COLUMN onboarded_at INTEGER;
UPDATE user_preferences SET onboarded_at = updated_at WHERE onboarded_at IS NULL;
ALTER TABLE document_versions ADD COLUMN prompt_id TEXT;
ALTER TABLE document_versions ADD COLUMN scope_type TEXT;
