-- Buying through Lynk (owner 2026-11-13: Tulis Lab is sold in the custompedia store, lynk.id/custompedia).
-- Lynk posts each successful payment to the store's one webhook, which Ruang KOL owns; Ruang KOL forwards the
-- payments that are not its own here unchanged, and the Lynk signature is checked again (docs/lynk-payments.md).
--
-- lynk_payments keeps every payment once, by Lynk's refId, so a payment sent again never grants twice. A payment
-- whose email has no verified Tulis Lab account waits ('waiting_account') until the buyer claims it from the emailed
-- link, signs in with a verified email that matches, or an admin attaches it to an account.
--
-- A granted payment becomes a payment_orders row (id 'LY-<refId>'), so the grant, Admin -> Pembayaran and the
-- revenue report work exactly as they do for Midtrans. Two columns are added for that: the provider, and the number
-- of monthly periods a plan order buys (12 for a yearly product).
ALTER TABLE payment_orders ADD COLUMN provider TEXT NOT NULL DEFAULT 'midtrans' CHECK (provider IN ('midtrans', 'lynk'));
--> statement-breakpoint
ALTER TABLE payment_orders ADD COLUMN months INTEGER NOT NULL DEFAULT 1 CHECK (months BETWEEN 1 AND 12);
--> statement-breakpoint
-- The frozen facts now include the provider and the months (the trigger of 0015 plus those two).
DROP TRIGGER payment_orders_frozen;
--> statement-breakpoint
CREATE TRIGGER payment_orders_frozen
BEFORE UPDATE ON payment_orders
WHEN NEW.user_id IS NOT OLD.user_id OR NEW.kind IS NOT OLD.kind OR NEW.plan_code IS NOT OLD.plan_code
	OR NEW.pack_code IS NOT OLD.pack_code OR NEW.characters IS NOT OLD.characters OR NEW.amount_idr IS NOT OLD.amount_idr
	OR NEW.provider_mode IS NOT OLD.provider_mode OR NEW.provider IS NOT OLD.provider OR NEW.months IS NOT OLD.months
	OR (OLD.fulfilled_at IS NOT NULL AND (NEW.fulfilled_at IS NOT OLD.fulfilled_at OR NEW.fulfillment_token IS NOT OLD.fulfillment_token))
	OR (OLD.access_period_id IS NOT NULL AND NEW.access_period_id IS NOT OLD.access_period_id)
	OR (OLD.lot_id IS NOT NULL AND NEW.lot_id IS NOT OLD.lot_id)
BEGIN
	SELECT RAISE(ABORT, 'PAYMENT_ORDER_FROZEN');
END;
--> statement-breakpoint
CREATE TABLE lynk_payments (
	ref_id TEXT PRIMARY KEY NOT NULL,
	message_id TEXT NOT NULL DEFAULT '',
	received_at INTEGER NOT NULL,
	updated_at INTEGER NOT NULL,
	email TEXT NOT NULL DEFAULT '',
	customer_name TEXT NOT NULL DEFAULT '',
	amount_idr INTEGER,
	-- The Tulis Lab product (src/lib/lynk-products.ts); '' when nothing in the order is ours.
	product TEXT NOT NULL DEFAULT '',
	status TEXT NOT NULL CHECK (status IN ('processing', 'granted', 'needs_operator', 'waiting_account', 'ignored', 'failed')),
	user_id TEXT,
	order_id TEXT,
	-- How the payment reached its account: 'email' (verified email at payment time), 'link' (the emailed claim link),
	-- 'sign_in' (a later sign-in with the verified email) or 'admin'.
	claimed_by TEXT CHECK (claimed_by IS NULL OR claimed_by IN ('email', 'link', 'sign_in', 'admin')),
	detail_json TEXT NOT NULL DEFAULT '{}',
	FOREIGN KEY (user_id) REFERENCES user(id) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE INDEX lynk_payments_waiting_idx ON lynk_payments(status, email);
--> statement-breakpoint
CREATE INDEX lynk_payments_received_idx ON lynk_payments(received_at DESC);
