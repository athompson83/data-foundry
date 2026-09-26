-- Recall Intelligence dataset (ADR-0015), Cloudflare D1.
--
-- `raw` is the verbatim openFDA enforcement record (evidence, rule 10). Every
-- other column, and every `recall_key` row, is derived from it by the parser
-- version recorded beside it and can be regenerated from `raw` alone.

CREATE TABLE IF NOT EXISTS recall (
  recall_number       TEXT PRIMARY KEY,
  category            TEXT NOT NULL CHECK (category IN ('food', 'drug', 'device')),
  event_id            TEXT,
  classification      TEXT CHECK (classification IN ('I', 'II', 'III')),
  status              TEXT,
  voluntary           INTEGER,
  firm_name           TEXT,
  firm_city           TEXT,
  firm_state          TEXT,
  firm_postal_code    TEXT,
  firm_country        TEXT,
  initiated_on        TEXT,
  classified_on       TEXT,
  reported_on         TEXT,
  terminated_on       TEXT,
  product_description TEXT,
  reason_for_recall   TEXT,
  nationwide_us       INTEGER NOT NULL,
  international       INTEGER NOT NULL,
  quantity_total      REAL,
  quantity_unit       TEXT,
  structured          TEXT NOT NULL,
  raw                 TEXT NOT NULL,
  raw_sha256          TEXT NOT NULL,
  parser_version      TEXT NOT NULL,
  source_url          TEXT NOT NULL,
  first_seen_at       TEXT NOT NULL,
  last_seen_at        TEXT NOT NULL,
  changed_at          TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS recall_reported_idx ON recall (reported_on DESC, recall_number);
CREATE INDEX IF NOT EXISTS recall_category_reported_idx ON recall (category, reported_on DESC);
CREATE INDEX IF NOT EXISTS recall_event_idx ON recall (event_id);
CREATE INDEX IF NOT EXISTS recall_firm_idx ON recall (firm_name COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS recall_changed_idx ON recall (changed_at DESC);

-- Exact-identifier and facet index. kind is one of: gtin, ndc, lot, serial,
-- model, state, country, reason_class, allergen, pathogen, expiration.
CREATE TABLE IF NOT EXISTS recall_key (
  kind          TEXT NOT NULL,
  value         TEXT NOT NULL,
  recall_number TEXT NOT NULL,
  PRIMARY KEY (kind, value, recall_number)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS recall_key_recall_idx ON recall_key (recall_number);

CREATE VIRTUAL TABLE IF NOT EXISTS recall_fts USING fts5 (
  recall_number UNINDEXED,
  firm_name,
  product_description,
  reason_for_recall,
  tokenize = 'porter unicode61'
);

CREATE TABLE IF NOT EXISTS sync_run (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  category      TEXT NOT NULL,
  window_from   TEXT NOT NULL,
  window_to     TEXT NOT NULL,
  started_at    TEXT NOT NULL,
  finished_at   TEXT,
  fetched       INTEGER NOT NULL DEFAULT 0,
  inserted      INTEGER NOT NULL DEFAULT 0,
  changed       INTEGER NOT NULL DEFAULT 0,
  artifact_keys TEXT NOT NULL DEFAULT '[]',
  status        TEXT NOT NULL DEFAULT 'RUNNING' CHECK (status IN ('RUNNING', 'SUCCEEDED', 'FAILED')),
  error         TEXT
);
CREATE INDEX IF NOT EXISTS sync_run_started_idx ON sync_run (started_at DESC);

-- Rolling full-refresh cursor, one row per category.
CREATE TABLE IF NOT EXISTS sync_cursor (
  category   TEXT PRIMARY KEY,
  next_from  TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Customers and keys. Keys are stored only as SHA-256 hashes.
CREATE TABLE IF NOT EXISTS customer (
  id                     TEXT PRIMARY KEY,
  email                  TEXT,
  stripe_customer_id     TEXT UNIQUE,
  stripe_subscription_id TEXT UNIQUE,
  plan                   TEXT NOT NULL CHECK (plan IN ('evaluate', 'developer', 'growth', 'scale')),
  status                 TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'past_due', 'suspended', 'canceled')),
  created_at             TEXT NOT NULL,
  updated_at             TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS api_key (
  id                  TEXT PRIMARY KEY,
  customer_id         TEXT NOT NULL REFERENCES customer (id),
  key_hash            TEXT NOT NULL UNIQUE,
  key_prefix          TEXT NOT NULL,
  checkout_session_id TEXT UNIQUE,
  created_at          TEXT NOT NULL,
  revoked_at          TEXT
);
CREATE INDEX IF NOT EXISTS api_key_customer_idx ON api_key (customer_id);

-- Hard-stop monthly allowance: one counter per customer per UTC month.
CREATE TABLE IF NOT EXISTS usage_month (
  customer_id TEXT NOT NULL REFERENCES customer (id),
  month       TEXT NOT NULL,
  requests    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (customer_id, month)
);

-- Stripe webhook idempotency.
CREATE TABLE IF NOT EXISTS stripe_event (
  id          TEXT PRIMARY KEY,
  type        TEXT NOT NULL,
  received_at TEXT NOT NULL
);
