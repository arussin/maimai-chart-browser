-- Additive and independent of the pending connector receipt migration (0002).
-- No change to historical action rows, coverage, retention or access.
CREATE TABLE IF NOT EXISTS usage_diagnostics_daily (
  day TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version = 2),
  instrumentation TEXT NOT NULL CHECK (instrumentation = 'diagnostics-1'),
  operation TEXT NOT NULL,
  stage TEXT NOT NULL,
  reason TEXT NOT NULL,
  outcome TEXT NOT NULL,
  source TEXT NOT NULL,
  mode TEXT NOT NULL,
  duration TEXT NOT NULL,
  count INTEGER NOT NULL CHECK (count >= 0),
  first_received_at TEXT NOT NULL,
  last_received_at TEXT NOT NULL,
  PRIMARY KEY(day,version,instrumentation,operation,stage,reason,outcome,source,mode,duration)
);
