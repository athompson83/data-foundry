-- Private customer-owned screening snapshots. No source, entitlement or rights grant.
CREATE TABLE IF NOT EXISTS screening_report (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES customer(id),
  tier TEXT NOT NULL CHECK (tier IN ('standard', 'branded')),
  brand TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  result_json TEXT,
  checkout_session_id TEXT UNIQUE,
  checkout_attempt INTEGER NOT NULL DEFAULT 0,
  checkout_started_at TEXT,
  paid_at TEXT,
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS screening_customer_created ON screening_report(customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS screening_expiry ON screening_report(expires_at);
