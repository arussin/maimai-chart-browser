-- Aggregate totals only. No raw requests, timestamps, users, sessions or expiry.
CREATE TABLE IF NOT EXISTS usage_daily (
  day TEXT NOT NULL CHECK(length(day)=10),
  version INTEGER NOT NULL CHECK(version>0),
  event TEXT NOT NULL, page TEXT NOT NULL, detail TEXT NOT NULL, failure TEXT NOT NULL,
  count INTEGER NOT NULL CHECK(count>=0),
  PRIMARY KEY(day,version,event,page,detail,failure)
) WITHOUT ROWID;
-- Owner-maintained coverage ledger; absence is unknown, never proof of zero use.
CREATE TABLE IF NOT EXISTS usage_coverage (
  day TEXT NOT NULL, version INTEGER NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('complete','partial','off')),
  PRIMARY KEY(day,version)
) WITHOUT ROWID;
