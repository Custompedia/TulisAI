-- Character quota replaces the request count as the real monthly cap.
-- charge_characters = source characters currently held against the period; zeroed when a run fails or is rejected.
-- Historical rows stay at 0 on purpose: backfilling from source_characters would retroactively exhaust every account.
ALTER TABLE usage_ledger ADD COLUMN charge_characters INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS usage_owner_period_charge_idx ON usage_ledger(owner_id, period_key, charge_characters);
ALTER TABLE user ADD COLUMN ai_character_limit_override INTEGER;
