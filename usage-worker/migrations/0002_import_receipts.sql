-- Receipt bounds for each existing finite daily aggregate, assigned by the
-- collector. These are not raw events, browser timestamps, or session records.
-- Historical counts remain unchanged; receipt times are unknown until the next
-- accepted batch updates that tuple. Do not backfill them from its day key.
ALTER TABLE usage_daily ADD COLUMN first_received_at TEXT;
ALTER TABLE usage_daily ADD COLUMN last_received_at TEXT;
