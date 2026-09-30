-- Direct Midtrans Snap payments, after Mari Rekap. TulisAI is the merchant of
-- record now that MKL no longer sells for it. The order id is the Midtrans
-- order_id, so a notification names exactly one row. Price and quantity are
-- frozen on the order at checkout; the grant happens once, gated by a
-- fulfillment token written in the same batch as the grant.
CREATE TABLE payment_orders (
	id TEXT PRIMARY KEY NOT NULL,
	user_id TEXT NOT NULL,
	kind TEXT NOT NULL CHECK (kind IN ('plan', 'topup')),
	plan_code TEXT CHECK (plan_code IS NULL OR plan_code IN ('plus', 'pro', 'max')),
	pack_code TEXT CHECK (pack_code IS NULL OR pack_code IN ('small', 'medium', 'large')),
	characters INTEGER NOT NULL CHECK (characters > 0),
	amount_idr INTEGER NOT NULL CHECK (amount_idr > 0),
	provider_mode TEXT NOT NULL CHECK (provider_mode IN ('sandbox', 'production')),
	status TEXT NOT NULL CHECK (status IN ('pending', 'paid', 'failed', 'expired', 'cancelled', 'refunded')),
	snap_token TEXT,
	redirect_url TEXT,
	transaction_id TEXT,
	payment_type TEXT,
	provider_status TEXT,
	created_at INTEGER NOT NULL,
	updated_at INTEGER NOT NULL,
	expires_at INTEGER NOT NULL,
	paid_at INTEGER,
	fulfilled_at INTEGER,
	fulfillment_token TEXT,
	fulfillment_outcome TEXT CHECK (fulfillment_outcome IS NULL OR fulfillment_outcome IN ('granted', 'needs_operator')),
	access_period_id TEXT,
	lot_id TEXT,
	refund_handled_at INTEGER,
	FOREIGN KEY (user_id) REFERENCES user(id) ON DELETE CASCADE,
	CHECK ((kind = 'plan') = (plan_code IS NOT NULL)),
	CHECK ((kind = 'topup') = (pack_code IS NOT NULL)),
	CHECK ((fulfilled_at IS NULL) = (fulfillment_token IS NULL)),
	CHECK (status <> 'paid' OR paid_at IS NOT NULL)
);
--> statement-breakpoint
CREATE INDEX payment_orders_user_idx ON payment_orders(user_id, created_at DESC, id DESC);
--> statement-breakpoint
CREATE INDEX payment_orders_user_status_idx ON payment_orders(user_id, status, kind);
--> statement-breakpoint
CREATE INDEX payment_orders_paid_idx ON payment_orders(paid_at) WHERE paid_at IS NOT NULL;
--> statement-breakpoint
-- Price, quantity, mode and the fulfillment result never change once written.
CREATE TRIGGER payment_orders_frozen
BEFORE UPDATE ON payment_orders
WHEN NEW.user_id IS NOT OLD.user_id OR NEW.kind IS NOT OLD.kind OR NEW.plan_code IS NOT OLD.plan_code
	OR NEW.pack_code IS NOT OLD.pack_code OR NEW.characters IS NOT OLD.characters OR NEW.amount_idr IS NOT OLD.amount_idr
	OR NEW.provider_mode IS NOT OLD.provider_mode
	OR (OLD.fulfilled_at IS NOT NULL AND (NEW.fulfilled_at IS NOT OLD.fulfilled_at OR NEW.fulfillment_token IS NOT OLD.fulfillment_token))
	OR (OLD.access_period_id IS NOT NULL AND NEW.access_period_id IS NOT OLD.access_period_id)
	OR (OLD.lot_id IS NOT NULL AND NEW.lot_id IS NOT OLD.lot_id)
BEGIN
	SELECT RAISE(ABORT, 'PAYMENT_ORDER_FROZEN');
END;
