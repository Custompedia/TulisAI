-- UX 2: "Kanvas bawaan" in Preferensi menulis. New notebooks open on this
-- canvas: 'text' (Teks) or 'page' (Halaman, Pro and up, enforced by the
-- settings route and again by notebook create). Additive only: one column
-- whose default is today's behaviour, so every existing row reads 'text'.
-- Rollback: the reverted code never reads the column.
ALTER TABLE user_preferences ADD COLUMN default_canvas TEXT NOT NULL DEFAULT 'text';
