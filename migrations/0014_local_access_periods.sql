-- Local paid-access authority. MKL retired its identity and commerce services
-- on 2026-09-28, so TulisAI records paid access itself: one row per access
-- period, granted by an admin now and by a verified direct payment later.
-- A period never overlaps another active period of the same owner; renewals
-- are queued to start where the previous period ends (enforced in code).
CREATE TABLE access_periods (
	id TEXT PRIMARY KEY NOT NULL,
	owner_id TEXT NOT NULL,
	plan_code TEXT NOT NULL CHECK (plan_code IN ('plus', 'pro', 'max')),
	source TEXT NOT NULL CHECK (source IN ('admin', 'payment')),
	payment_order_id TEXT UNIQUE,
	granted_by TEXT,
	note TEXT,
	period_start TEXT NOT NULL,
	period_end TEXT NOT NULL,
	period_start_ms INTEGER NOT NULL,
	period_end_ms INTEGER NOT NULL,
	status TEXT NOT NULL CHECK (status IN ('active', 'ended')),
	ended_at INTEGER,
	ended_by TEXT,
	end_reason TEXT,
	created_at INTEGER NOT NULL,
	updated_at INTEGER NOT NULL,
	FOREIGN KEY (owner_id) REFERENCES user(id) ON DELETE CASCADE,
	FOREIGN KEY (granted_by) REFERENCES user(id) ON DELETE SET NULL,
	FOREIGN KEY (ended_by) REFERENCES user(id) ON DELETE SET NULL,
	CHECK (period_end_ms > period_start_ms),
	CHECK ((source = 'payment') = (payment_order_id IS NOT NULL)),
	CHECK ((status = 'ended') = (ended_at IS NOT NULL))
);
--> statement-breakpoint
CREATE INDEX access_periods_owner_idx ON access_periods(owner_id, status, period_end_ms, period_start_ms);
--> statement-breakpoint
CREATE TRIGGER access_periods_facts_immutable
BEFORE UPDATE ON access_periods
WHEN NEW.owner_id IS NOT OLD.owner_id OR NEW.plan_code IS NOT OLD.plan_code OR NEW.source IS NOT OLD.source
	OR NEW.payment_order_id IS NOT OLD.payment_order_id OR NEW.period_start_ms IS NOT OLD.period_start_ms
	OR NEW.period_end_ms IS NOT OLD.period_end_ms OR (OLD.status = 'ended' AND NEW.status <> 'ended')
BEGIN
	SELECT RAISE(ABORT, 'ACCESS_PERIOD_IMMUTABLE');
END;

-- B4 required an MKL identity link on included grants and purchased lots.
-- Local periods and direct purchases have no such link (and admins can never
-- hold one), so the link becomes optional. SQLite cannot relax a NOT NULL or
-- CHECK in place, so both tables are rebuilt with identical columns and rows.
PRAGMA defer_foreign_keys = true;
--> statement-breakpoint
-- Copy the rows aside, drop and recreate under the same name, then copy back.
-- Re-inserting into the recreated parent is what clears the deferred FK
-- counter for wallet events and lot corrections; no rename is involved, so the
-- allocation triggers that name these tables keep working unchanged.
CREATE TABLE character_grants_hold AS SELECT * FROM character_grants;
--> statement-breakpoint
DROP TABLE character_grants;
--> statement-breakpoint
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
	       (kind = 'included' AND entitlement_id IS NOT NULL AND application_app_key IS NOT NULL AND period_start IS NOT NULL AND period_end IS NOT NULL
	        AND period_start_ms IS NOT NULL AND period_end_ms IS NOT NULL AND period_end_ms > period_start_ms))
);
--> statement-breakpoint
INSERT INTO character_grants (id, owner_id, kind, identity_link_id, entitlement_id, application_app_key, catalog_item_id,
	plan_code, plan_version, period_start, period_end, period_start_ms, period_end_ms, authority_revision, authority_payload_hash,
	original_amount, reserved_amount, settled_amount, state, measurement_version, created_at, updated_at)
	SELECT id, owner_id, kind, identity_link_id, entitlement_id, application_app_key, catalog_item_id,
	plan_code, plan_version, period_start, period_end, period_start_ms, period_end_ms, authority_revision, authority_payload_hash,
	original_amount, reserved_amount, settled_amount, state, measurement_version, created_at, updated_at FROM character_grants_hold;
--> statement-breakpoint
DROP TABLE character_grants_hold;
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
--> statement-breakpoint
CREATE TABLE character_purchased_lots_hold AS SELECT * FROM character_purchased_lots;
--> statement-breakpoint
DROP TABLE character_purchased_lots;
--> statement-breakpoint
CREATE TABLE character_purchased_lots (
	id TEXT PRIMARY KEY NOT NULL,
	owner_id TEXT NOT NULL,
	identity_link_id TEXT,
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
INSERT INTO character_purchased_lots (id, owner_id, identity_link_id, fulfillment_id, customer_binding_hash, application_app_key,
	catalog_item_id, offer_id, offer_version, original_amount, reserved_amount, settled_amount, fulfilled_at, expires_at, fulfilled_at_ms,
	expires_at_ms, verification_revision, verification_payload_hash, state, reversal_state, measurement_version, created_at, updated_at)
	SELECT id, owner_id, identity_link_id, fulfillment_id, customer_binding_hash, application_app_key,
	catalog_item_id, offer_id, offer_version, original_amount, reserved_amount, settled_amount, fulfilled_at, expires_at, fulfilled_at_ms,
	expires_at_ms, verification_revision, verification_payload_hash, state, reversal_state, measurement_version, created_at, updated_at FROM character_purchased_lots_hold;
--> statement-breakpoint
DROP TABLE character_purchased_lots_hold;
--> statement-breakpoint
CREATE INDEX character_purchased_lots_spend_idx
	ON character_purchased_lots(owner_id, application_app_key, state, expires_at_ms, fulfilled_at_ms, id);
