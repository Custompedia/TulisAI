-- B5 local commerce intent/recovery state. MKL remains the system of record
-- for offers, orders, payments, fulfillment, expiry, and corrections.
CREATE TABLE mkl_purchase_intents (
	id TEXT PRIMARY KEY NOT NULL,
	owner_id TEXT NOT NULL,
	identity_link_id TEXT NOT NULL,
	organization_id TEXT NOT NULL,
	purchase_kind TEXT NOT NULL CHECK (purchase_kind IN ('access', 'consumable')),
	plan_code TEXT NOT NULL,
	plan_version TEXT NOT NULL,
	offer_id TEXT NOT NULL,
	offer_contract_json TEXT NOT NULL,
	offer_contract_hash TEXT NOT NULL,
	client_request_key_hash TEXT NOT NULL,
	request_fingerprint TEXT NOT NULL,
	mkl_idempotency_key TEXT NOT NULL UNIQUE,
	buyer_phone TEXT NOT NULL,
	return_uri TEXT NOT NULL,
	mkl_order_id TEXT UNIQUE,
	mkl_order_number TEXT,
	checkout_url TEXT,
	order_status TEXT,
	status TEXT NOT NULL CHECK (status IN (
		'created', 'checkout_pending', 'pending_payment',
		'paid_awaiting_authority', 'reconciling', 'reconciled',
		'terminal', 'reconciliation_required'
	)),
	fulfillment_id TEXT UNIQUE,
	lot_id TEXT,
	purchase_revision INTEGER NOT NULL DEFAULT 0 CHECK (purchase_revision >= 0),
	purchase_payload_hash TEXT,
	authorization_attempts INTEGER NOT NULL DEFAULT 0 CHECK (authorization_attempts >= 0),
	recovery_attempts INTEGER NOT NULL DEFAULT 0 CHECK (recovery_attempts >= 0),
	last_error_code TEXT,
	terminal_reason TEXT,
	created_at INTEGER NOT NULL,
	updated_at INTEGER NOT NULL,
	order_bound_at INTEGER,
	reconciled_at INTEGER,
	terminal_at INTEGER,
	FOREIGN KEY (owner_id) REFERENCES user(id) ON DELETE CASCADE,
	FOREIGN KEY (identity_link_id) REFERENCES external_identity_link(id) ON DELETE RESTRICT,
	FOREIGN KEY (lot_id) REFERENCES character_purchased_lots(id) ON DELETE RESTRICT,
	UNIQUE (owner_id, client_request_key_hash),
	CHECK ((mkl_order_id IS NULL AND mkl_order_number IS NULL AND checkout_url IS NULL AND order_bound_at IS NULL)
		OR (mkl_order_id IS NOT NULL AND mkl_order_number IS NOT NULL AND checkout_url IS NOT NULL AND order_bound_at IS NOT NULL)),
	CHECK ((purchase_revision = 0 AND purchase_payload_hash IS NULL)
		OR (purchase_revision > 0 AND purchase_payload_hash IS NOT NULL)),
	CHECK ((fulfillment_id IS NULL AND lot_id IS NULL) OR (fulfillment_id IS NOT NULL AND lot_id IS NOT NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX mkl_purchase_one_open_access
	ON mkl_purchase_intents(owner_id)
	WHERE purchase_kind = 'access' AND status IN (
		'created','checkout_pending','pending_payment','paid_awaiting_authority','reconciling','reconciliation_required'
	);
--> statement-breakpoint
CREATE UNIQUE INDEX mkl_purchase_one_open_consumable
	ON mkl_purchase_intents(owner_id)
	WHERE purchase_kind = 'consumable' AND status IN (
		'created','checkout_pending','pending_payment','paid_awaiting_authority'
	);
--> statement-breakpoint
CREATE INDEX mkl_purchase_owner_created_idx
	ON mkl_purchase_intents(owner_id, created_at DESC, id);
--> statement-breakpoint
CREATE INDEX mkl_purchase_recovery_idx
	ON mkl_purchase_intents(status, updated_at, id);
--> statement-breakpoint
CREATE TRIGGER mkl_purchase_order_binding_immutable
BEFORE UPDATE ON mkl_purchase_intents
WHEN OLD.mkl_order_id IS NOT NULL AND (
	NEW.mkl_order_id IS NOT OLD.mkl_order_id OR
	NEW.mkl_order_number IS NOT OLD.mkl_order_number OR
	NEW.checkout_url IS NOT OLD.checkout_url OR
	NEW.order_bound_at IS NOT OLD.order_bound_at
)
BEGIN
	SELECT RAISE(ABORT, 'MKL_PURCHASE_ORDER_BINDING_IMMUTABLE');
END;
--> statement-breakpoint
CREATE TRIGGER mkl_purchase_identity_immutable
BEFORE UPDATE ON mkl_purchase_intents
WHEN NEW.owner_id IS NOT OLD.owner_id OR
	NEW.identity_link_id IS NOT OLD.identity_link_id OR
	NEW.organization_id IS NOT OLD.organization_id OR
	NEW.purchase_kind IS NOT OLD.purchase_kind OR
	NEW.plan_code IS NOT OLD.plan_code OR
	NEW.plan_version IS NOT OLD.plan_version OR
	NEW.offer_id IS NOT OLD.offer_id OR
	NEW.offer_contract_json IS NOT OLD.offer_contract_json OR
	NEW.offer_contract_hash IS NOT OLD.offer_contract_hash OR
	NEW.client_request_key_hash IS NOT OLD.client_request_key_hash OR
	NEW.request_fingerprint IS NOT OLD.request_fingerprint OR
	NEW.mkl_idempotency_key IS NOT OLD.mkl_idempotency_key OR
	NEW.buyer_phone IS NOT OLD.buyer_phone OR
	NEW.return_uri IS NOT OLD.return_uri
BEGIN
	SELECT RAISE(ABORT, 'MKL_PURCHASE_INTENT_IMMUTABLE');
END;
--> statement-breakpoint
CREATE TRIGGER mkl_purchase_fulfillment_immutable
BEFORE UPDATE OF fulfillment_id, lot_id ON mkl_purchase_intents
WHEN OLD.fulfillment_id IS NOT NULL AND (
	NEW.fulfillment_id IS NOT OLD.fulfillment_id OR NEW.lot_id IS NOT OLD.lot_id
)
BEGIN
	SELECT RAISE(ABORT, 'MKL_PURCHASE_FULFILLMENT_IMMUTABLE');
END;
--> statement-breakpoint
CREATE TRIGGER mkl_purchase_revision_monotonic
BEFORE UPDATE OF purchase_revision, purchase_payload_hash ON mkl_purchase_intents
WHEN NEW.purchase_revision < OLD.purchase_revision OR
	(NEW.purchase_revision = OLD.purchase_revision AND OLD.purchase_revision > 0
		AND NEW.purchase_payload_hash IS NOT OLD.purchase_payload_hash)
BEGIN
	SELECT RAISE(ABORT, 'MKL_PURCHASE_REVISION_CONFLICT');
END;
