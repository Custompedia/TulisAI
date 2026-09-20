-- B4: local commercial character wallet.  usage_ledger remains provider and
-- request telemetry; it is not wallet authority for B4-managed operations.

CREATE TABLE character_wallet_account (
	owner_id TEXT PRIMARY KEY NOT NULL,
	free_grant_state TEXT NOT NULL CHECK (free_grant_state IN ('issued', 'reconciled', 'legacy_pending')),
	legacy_reason TEXT,
	created_at INTEGER NOT NULL,
	updated_at INTEGER NOT NULL,
	FOREIGN KEY (owner_id) REFERENCES user(id) ON DELETE CASCADE
);

CREATE TABLE character_grants (
	id TEXT PRIMARY KEY NOT NULL,
	owner_id TEXT NOT NULL,
	kind TEXT NOT NULL CHECK (kind IN ('free', 'included')),
	identity_link_id TEXT,
	entitlement_id TEXT,
	application_app_key TEXT,
	catalog_item_id TEXT,
	plan_code TEXT,
	plan_version TEXT,
	period_start TEXT,
	period_end TEXT,
	period_start_ms INTEGER,
	period_end_ms INTEGER,
	authority_revision INTEGER,
	authority_payload_hash TEXT,
	original_amount INTEGER NOT NULL CHECK (original_amount > 0),
	reserved_amount INTEGER NOT NULL DEFAULT 0 CHECK (reserved_amount >= 0),
	settled_amount INTEGER NOT NULL DEFAULT 0 CHECK (settled_amount >= 0),
	state TEXT NOT NULL CHECK (state IN ('active', 'expired', 'revoked', 'legacy_pending')),
	measurement_version TEXT NOT NULL,
	created_at INTEGER NOT NULL,
	updated_at INTEGER NOT NULL,
	FOREIGN KEY (owner_id) REFERENCES user(id) ON DELETE CASCADE,
	FOREIGN KEY (identity_link_id) REFERENCES external_identity_link(id) ON DELETE RESTRICT,
	CHECK (reserved_amount + settled_amount <= original_amount),
	CHECK ((kind = 'free' AND entitlement_id IS NULL AND original_amount <= 3000) OR
	       (kind = 'included' AND entitlement_id IS NOT NULL AND identity_link_id IS NOT NULL AND period_start IS NOT NULL AND period_end IS NOT NULL
	        AND period_start_ms IS NOT NULL AND period_end_ms IS NOT NULL AND period_end_ms > period_start_ms))
);
--> statement-breakpoint
CREATE UNIQUE INDEX character_grants_one_free_per_owner
	ON character_grants(owner_id) WHERE kind = 'free';
--> statement-breakpoint
CREATE UNIQUE INDEX character_grants_included_period_unique
	ON character_grants(owner_id, entitlement_id, application_app_key, period_start, period_end)
	WHERE kind = 'included';
--> statement-breakpoint
CREATE INDEX character_grants_spend_idx
	ON character_grants(owner_id, kind, state, period_end);

CREATE TABLE character_purchased_lots (
	id TEXT PRIMARY KEY NOT NULL,
	owner_id TEXT NOT NULL,
	identity_link_id TEXT NOT NULL,
	fulfillment_id TEXT NOT NULL,
	customer_binding_hash TEXT NOT NULL,
	application_app_key TEXT NOT NULL,
	catalog_item_id TEXT NOT NULL,
	offer_id TEXT,
	offer_version TEXT,
	original_amount INTEGER NOT NULL CHECK (original_amount > 0),
	reserved_amount INTEGER NOT NULL DEFAULT 0 CHECK (reserved_amount >= 0),
	settled_amount INTEGER NOT NULL DEFAULT 0 CHECK (settled_amount >= 0),
	fulfilled_at TEXT NOT NULL,
	expires_at TEXT NOT NULL,
	fulfilled_at_ms INTEGER NOT NULL,
	expires_at_ms INTEGER NOT NULL,
	verification_revision TEXT NOT NULL,
	verification_payload_hash TEXT NOT NULL,
	state TEXT NOT NULL CHECK (state IN ('active', 'frozen', 'expired', 'reversed', 'reconciliation_required')),
	reversal_state TEXT NOT NULL DEFAULT 'none' CHECK (reversal_state IN ('none', 'reversed', 'partially_refunded', 'reconciliation_required')),
	measurement_version TEXT NOT NULL,
	created_at INTEGER NOT NULL,
	updated_at INTEGER NOT NULL,
	FOREIGN KEY (owner_id) REFERENCES user(id) ON DELETE CASCADE,
	FOREIGN KEY (identity_link_id) REFERENCES external_identity_link(id) ON DELETE RESTRICT,
	UNIQUE (application_app_key, fulfillment_id),
	CHECK (expires_at_ms > fulfilled_at_ms),
	CHECK (reserved_amount + settled_amount <= original_amount)
);
--> statement-breakpoint
CREATE INDEX character_purchased_lots_spend_idx
	ON character_purchased_lots(owner_id, application_app_key, state, expires_at_ms, fulfilled_at_ms, id);

CREATE TABLE character_reservations (
	id TEXT PRIMARY KEY NOT NULL,
	owner_id TEXT NOT NULL,
	idempotency_key TEXT NOT NULL,
	request_fingerprint TEXT NOT NULL,
	operation TEXT NOT NULL,
	source_characters INTEGER NOT NULL CHECK (source_characters >= 0),
	measurement_version TEXT NOT NULL,
	current_hold INTEGER NOT NULL DEFAULT 0 CHECK (current_hold >= 0),
	settled_amount INTEGER NOT NULL DEFAULT 0 CHECK (settled_amount >= 0),
	state TEXT NOT NULL CHECK (state IN ('allocating', 'reserved', 'extending', 'settling', 'releasing', 'settled', 'released', 'voided')),
	lease_deadline INTEGER NOT NULL,
	fencing_token INTEGER NOT NULL DEFAULT 1,
	mode TEXT NOT NULL CHECK (mode IN ('free', 'paid')),
	application_app_key TEXT,
	entitlement_id TEXT,
	entitlement_period_start TEXT,
	entitlement_period_end TEXT,
	authority_revision INTEGER,
	eligibility_snapshot_json TEXT NOT NULL,
	provider_request_id TEXT,
	result_reference TEXT,
	failure_reason TEXT,
	created_at INTEGER NOT NULL,
	updated_at INTEGER NOT NULL,
	settled_at INTEGER,
	released_at INTEGER,
	FOREIGN KEY (owner_id) REFERENCES user(id) ON DELETE CASCADE,
	UNIQUE (owner_id, idempotency_key),
	CHECK (settled_amount <= current_hold),
	CHECK ((state = 'settled' AND settled_at IS NOT NULL) OR state <> 'settled'),
	CHECK ((state IN ('released', 'voided') AND released_at IS NOT NULL) OR state NOT IN ('released', 'voided'))
);
--> statement-breakpoint
CREATE INDEX character_reservations_reaper_idx
	ON character_reservations(state, lease_deadline, id);

CREATE TABLE character_allocations (
	id TEXT PRIMARY KEY NOT NULL,
	reservation_id TEXT NOT NULL,
	owner_id TEXT NOT NULL,
	source_kind TEXT NOT NULL CHECK (source_kind IN ('free_grant', 'included_grant', 'purchased_lot')),
	source_id TEXT NOT NULL,
	ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
	reserved_amount INTEGER NOT NULL CHECK (reserved_amount > 0),
	settled_amount INTEGER NOT NULL DEFAULT 0 CHECK (settled_amount >= 0),
	released_amount INTEGER NOT NULL DEFAULT 0 CHECK (released_amount >= 0),
	measurement_version TEXT NOT NULL,
	created_at INTEGER NOT NULL,
	updated_at INTEGER NOT NULL,
	FOREIGN KEY (reservation_id) REFERENCES character_reservations(id) ON DELETE RESTRICT,
	FOREIGN KEY (owner_id) REFERENCES user(id) ON DELETE CASCADE,
	UNIQUE (reservation_id, ordinal),
	UNIQUE (reservation_id, source_kind, source_id),
	CHECK (settled_amount + released_amount <= reserved_amount)
);
--> statement-breakpoint
CREATE INDEX character_allocations_source_idx
	ON character_allocations(source_kind, source_id, reservation_id);

-- Allocation triggers are the concurrency boundary.  D1 serializes each batch;
-- every allocation proves source ownership, eligibility, measurement and
-- available quantity again inside that batch before moving source counters.
CREATE TRIGGER character_allocation_guard_insert
BEFORE INSERT ON character_allocations
WHEN NOT (
	(NEW.source_kind = 'free_grant' AND EXISTS (
		SELECT 1 FROM character_grants g JOIN character_reservations r ON r.id = NEW.reservation_id
		WHERE g.id = NEW.source_id AND g.owner_id = NEW.owner_id AND r.owner_id = NEW.owner_id
			AND r.state IN ('allocating','extending') AND r.mode = 'free' AND g.kind = 'free' AND g.state = 'active'
			AND EXISTS (SELECT 1 FROM json_each(r.eligibility_snapshot_json) s WHERE json_extract(s.value,'$.kind')='free_grant' AND json_extract(s.value,'$.id')=g.id)
			AND g.measurement_version = NEW.measurement_version
			AND g.original_amount - g.reserved_amount - g.settled_amount >= NEW.reserved_amount
	)) OR
	(NEW.source_kind = 'included_grant' AND EXISTS (
		SELECT 1 FROM character_grants g JOIN character_reservations r ON r.id = NEW.reservation_id
		WHERE g.id = NEW.source_id AND g.owner_id = NEW.owner_id AND r.owner_id = NEW.owner_id
			AND r.state IN ('allocating','extending') AND r.mode = 'paid' AND g.kind = 'included' AND g.state IN ('active','expired')
			AND g.entitlement_id = r.entitlement_id AND g.period_start = r.entitlement_period_start
			AND g.period_end = r.entitlement_period_end AND g.application_app_key = r.application_app_key AND g.measurement_version = NEW.measurement_version
			AND EXISTS (SELECT 1 FROM json_each(r.eligibility_snapshot_json) s WHERE json_extract(s.value,'$.kind')='included_grant' AND json_extract(s.value,'$.id')=g.id)
			AND g.period_end_ms > r.created_at
			AND g.original_amount - g.reserved_amount - g.settled_amount >= NEW.reserved_amount
	)) OR
	(NEW.source_kind = 'purchased_lot' AND EXISTS (
		SELECT 1 FROM character_purchased_lots l JOIN character_reservations r ON r.id = NEW.reservation_id
		WHERE l.id = NEW.source_id AND l.owner_id = NEW.owner_id AND r.owner_id = NEW.owner_id
			AND r.state IN ('allocating','extending') AND r.mode = 'paid' AND l.state IN ('active','frozen','expired') AND l.reversal_state = 'none'
			AND l.measurement_version = NEW.measurement_version AND l.expires_at_ms > r.created_at
			AND l.fulfilled_at_ms <= r.created_at AND l.application_app_key = r.application_app_key
			AND EXISTS (SELECT 1 FROM json_each(r.eligibility_snapshot_json) s WHERE json_extract(s.value,'$.kind')='purchased_lot' AND json_extract(s.value,'$.id')=l.id)
			AND l.original_amount - l.reserved_amount - l.settled_amount >= NEW.reserved_amount
	))
)
BEGIN
	SELECT RAISE(ABORT, 'WALLET_ALLOCATION_NOT_SPENDABLE');
END;
--> statement-breakpoint
CREATE TRIGGER character_allocation_apply_insert
AFTER INSERT ON character_allocations
BEGIN
	UPDATE character_grants SET reserved_amount = reserved_amount + NEW.reserved_amount, updated_at = NEW.updated_at
		WHERE id = NEW.source_id AND NEW.source_kind IN ('free_grant', 'included_grant');
	UPDATE character_purchased_lots SET reserved_amount = reserved_amount + NEW.reserved_amount, updated_at = NEW.updated_at
		WHERE id = NEW.source_id AND NEW.source_kind = 'purchased_lot';
END;
--> statement-breakpoint
CREATE TRIGGER character_allocation_guard_update
BEFORE UPDATE OF reserved_amount, settled_amount, released_amount ON character_allocations
WHEN NEW.reserved_amount < OLD.reserved_amount OR NEW.settled_amount < OLD.settled_amount OR
	NEW.released_amount < OLD.released_amount OR NEW.settled_amount + NEW.released_amount > NEW.reserved_amount
BEGIN
	SELECT RAISE(ABORT, 'WALLET_ALLOCATION_INVALID_TRANSITION');
END;
--> statement-breakpoint
CREATE TRIGGER character_allocation_terminal_guard_update
BEFORE UPDATE OF settled_amount, released_amount ON character_allocations
WHEN (NEW.settled_amount <> OLD.settled_amount OR NEW.released_amount <> OLD.released_amount)
	AND NOT EXISTS (
		SELECT 1 FROM character_reservations r WHERE r.id = NEW.reservation_id
			AND ((r.state = 'settling' AND NEW.settled_amount >= OLD.settled_amount)
				OR (r.state = 'releasing' AND NEW.settled_amount = OLD.settled_amount))
	)
BEGIN
	SELECT RAISE(ABORT, 'WALLET_RESERVATION_NOT_FENCED');
END;
--> statement-breakpoint
CREATE TRIGGER character_allocation_growth_guard_update
BEFORE UPDATE OF reserved_amount ON character_allocations
WHEN NEW.reserved_amount > OLD.reserved_amount AND (
	NOT EXISTS (SELECT 1 FROM character_reservations r WHERE r.id = NEW.reservation_id AND r.state = 'extending') OR
	(NEW.source_kind IN ('free_grant', 'included_grant') AND NOT EXISTS (
		SELECT 1 FROM character_grants g JOIN character_reservations r ON r.id=NEW.reservation_id
		WHERE g.id = NEW.source_id AND g.owner_id = NEW.owner_id
			AND ((g.kind='free' AND g.state='active') OR (g.kind='included' AND g.state IN ('active','expired')
				AND g.entitlement_id=r.entitlement_id AND g.period_start=r.entitlement_period_start AND g.period_end=r.entitlement_period_end
				AND g.application_app_key=r.application_app_key AND g.period_end_ms>r.created_at))
			AND EXISTS (SELECT 1 FROM json_each(r.eligibility_snapshot_json) s WHERE json_extract(s.value,'$.kind')=NEW.source_kind AND json_extract(s.value,'$.id')=g.id)
			AND g.original_amount - g.reserved_amount - g.settled_amount >= NEW.reserved_amount - OLD.reserved_amount
	)) OR
	(NEW.source_kind = 'purchased_lot' AND NOT EXISTS (
		SELECT 1 FROM character_purchased_lots l JOIN character_reservations r ON r.id = NEW.reservation_id
		WHERE l.id = NEW.source_id AND l.owner_id = NEW.owner_id AND l.state IN ('active','frozen','expired') AND l.reversal_state = 'none'
			AND l.expires_at_ms > r.created_at AND l.fulfilled_at_ms <= r.created_at AND l.application_app_key=r.application_app_key
			AND EXISTS (SELECT 1 FROM json_each(r.eligibility_snapshot_json) s WHERE json_extract(s.value,'$.kind')='purchased_lot' AND json_extract(s.value,'$.id')=l.id)
			AND l.original_amount - l.reserved_amount - l.settled_amount >= NEW.reserved_amount - OLD.reserved_amount
	))
)
BEGIN
	SELECT RAISE(ABORT, 'WALLET_ALLOCATION_NOT_SPENDABLE');
END;
--> statement-breakpoint
CREATE TRIGGER character_allocation_apply_update
AFTER UPDATE OF reserved_amount, settled_amount, released_amount ON character_allocations
BEGIN
	UPDATE character_grants SET
		reserved_amount = reserved_amount + ((NEW.reserved_amount - NEW.settled_amount - NEW.released_amount) - (OLD.reserved_amount - OLD.settled_amount - OLD.released_amount)),
		settled_amount = settled_amount + (NEW.settled_amount - OLD.settled_amount), updated_at = NEW.updated_at
		WHERE id = NEW.source_id AND NEW.source_kind IN ('free_grant', 'included_grant');
	UPDATE character_purchased_lots SET
		reserved_amount = reserved_amount + ((NEW.reserved_amount - NEW.settled_amount - NEW.released_amount) - (OLD.reserved_amount - OLD.settled_amount - OLD.released_amount)),
		settled_amount = settled_amount + (NEW.settled_amount - OLD.settled_amount), updated_at = NEW.updated_at
		WHERE id = NEW.source_id AND NEW.source_kind = 'purchased_lot';
END;
--> statement-breakpoint
CREATE TRIGGER character_allocations_no_delete
BEFORE DELETE ON character_allocations BEGIN
	SELECT RAISE(ABORT, 'WALLET_ALLOCATIONS_APPEND_ONLY');
END;

CREATE TABLE character_wallet_events (
	id TEXT PRIMARY KEY NOT NULL,
	owner_id TEXT NOT NULL,
	event_type TEXT NOT NULL,
	reservation_id TEXT,
	grant_id TEXT,
	lot_id TEXT,
	quantity INTEGER,
	causal_reference TEXT,
	metadata_json TEXT NOT NULL DEFAULT '{}',
	created_at INTEGER NOT NULL,
	FOREIGN KEY (owner_id) REFERENCES user(id) ON DELETE CASCADE,
	FOREIGN KEY (reservation_id) REFERENCES character_reservations(id) ON DELETE RESTRICT,
	FOREIGN KEY (grant_id) REFERENCES character_grants(id) ON DELETE RESTRICT,
	FOREIGN KEY (lot_id) REFERENCES character_purchased_lots(id) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE INDEX character_wallet_events_owner_idx
	ON character_wallet_events(owner_id, created_at, id);

CREATE TABLE character_lot_corrections (
	id TEXT PRIMARY KEY NOT NULL,
	lot_id TEXT NOT NULL,
	owner_id TEXT NOT NULL,
	correction_id TEXT NOT NULL,
	correction_revision INTEGER NOT NULL CHECK (correction_revision >= 0),
	kind TEXT NOT NULL CHECK (kind IN ('reversal', 'refund')),
	verification_payload_hash TEXT NOT NULL,
	reason_code TEXT NOT NULL,
	created_at INTEGER NOT NULL,
	FOREIGN KEY (lot_id) REFERENCES character_purchased_lots(id) ON DELETE RESTRICT,
	FOREIGN KEY (owner_id) REFERENCES user(id) ON DELETE CASCADE,
	UNIQUE (lot_id, correction_id)
);
--> statement-breakpoint
CREATE UNIQUE INDEX character_lot_corrections_revision_unique
	ON character_lot_corrections(lot_id, correction_revision);

-- Safe legacy cutover: only an existing local Free account with no character
-- override and no usage evidence is demonstrably untouched.  Any account with
-- historical rows, a paid/legacy tier, or an override is held for explicit
-- reconciliation rather than receiving invented value.
INSERT INTO character_wallet_account (owner_id, free_grant_state, legacy_reason, created_at, updated_at)
SELECT u.id,
	CASE WHEN u.tier = 'free' AND u.ai_character_limit_override IS NULL
		AND NOT EXISTS (SELECT 1 FROM usage_ledger ul WHERE ul.owner_id = u.id)
	THEN 'reconciled' ELSE 'legacy_pending' END,
	CASE WHEN u.tier = 'free' AND u.ai_character_limit_override IS NULL
		AND NOT EXISTS (SELECT 1 FROM usage_ledger ul WHERE ul.owner_id = u.id)
	THEN 'no historical usage rows or override'
	ELSE 'pre-B4 provenance requires reconciliation' END,
	strftime('%s','now') * 1000, strftime('%s','now') * 1000
FROM user u;

INSERT INTO character_grants (
	id, owner_id, kind, original_amount, reserved_amount, settled_amount,
	state, measurement_version, created_at, updated_at
)
SELECT 'legacy-free:' || owner_id, owner_id, 'free', 3000, 0, 0,
	'active', 'unicode_code_points_v1', created_at, updated_at
FROM character_wallet_account WHERE free_grant_state = 'reconciled';

CREATE TRIGGER character_wallet_events_append_only_update
BEFORE UPDATE ON character_wallet_events BEGIN
	SELECT RAISE(ABORT, 'WALLET_EVENTS_APPEND_ONLY');
END;
--> statement-breakpoint
CREATE TRIGGER character_wallet_events_append_only_delete
BEFORE DELETE ON character_wallet_events BEGIN
	SELECT RAISE(ABORT, 'WALLET_EVENTS_APPEND_ONLY');
END;
