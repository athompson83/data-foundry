-- North American consumer-product recalls: CPSC (US) and Health Canada (CA)
-- notices, one row per agency notice. `structured` is derived from the
-- verbatim source record held in R2 at raw_ref (SHA-256 raw_sha256) by the
-- parser version beside it; every other column and every key/citation row is
-- regenerated from it.

CREATE TABLE IF NOT EXISTS product_recall (
  id               TEXT PRIMARY KEY,
  agency           TEXT NOT NULL CHECK (agency IN ('CPSC', 'HC')),
  source_id        TEXT NOT NULL,
  title            TEXT NOT NULL,
  url              TEXT NOT NULL,
  -- Canonical lower-case URL, the target of declared citations from other agencies.
  url_key          TEXT NOT NULL,
  published_on     TEXT,
  updated_on       TEXT,
  -- Newest-first order: the publication date, else the last-updated date.
  sort_date        TEXT NOT NULL,
  archived         INTEGER,
  product_category TEXT,
  title_firm       TEXT,
  units_us         INTEGER,
  units_canada     INTEGER,
  -- Whether the notice has enough source text for a public, indexable page (AGENTS.md rule 8).
  indexable        INTEGER NOT NULL,
  structured       TEXT NOT NULL,
  raw_ref          TEXT NOT NULL,
  raw_sha256       TEXT NOT NULL,
  parser_version   TEXT NOT NULL,
  first_seen_at    TEXT NOT NULL,
  last_seen_at     TEXT NOT NULL,
  changed_at       TEXT NOT NULL,
  UNIQUE (agency, source_id)
);
CREATE INDEX IF NOT EXISTS product_recall_sort_idx ON product_recall (sort_date DESC, id);
CREATE INDEX IF NOT EXISTS product_recall_agency_sort_idx ON product_recall (agency, sort_date DESC, id);
CREATE INDEX IF NOT EXISTS product_recall_url_idx ON product_recall (url_key);
CREATE INDEX IF NOT EXISTS product_recall_firm_idx ON product_recall (title_firm COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS product_recall_changed_idx ON product_recall (changed_at DESC);

-- Exact-identifier and facet index. kind is one of: gtin, model, hazard, remedy, facet, category, country.
CREATE TABLE IF NOT EXISTS product_recall_key (
  kind      TEXT NOT NULL,
  value     TEXT NOT NULL,
  recall_id TEXT NOT NULL,
  PRIMARY KEY (kind, value, recall_id)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS product_recall_key_recall_idx ON product_recall_key (recall_id);

-- Declared citations: a notice that names another agency's notice by URL.
-- Links are resolved at read time against product_recall.url_key, so a
-- citation links as soon as either notice arrives, in any order.
CREATE TABLE IF NOT EXISTS product_recall_citation (
  recall_id TEXT NOT NULL,
  agency    TEXT NOT NULL,
  url_key   TEXT NOT NULL,
  PRIMARY KEY (recall_id, url_key)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS product_recall_citation_url_idx ON product_recall_citation (url_key);

CREATE VIRTUAL TABLE IF NOT EXISTS product_recall_fts USING fts5 (
  recall_id UNINDEXED,
  title,
  firms,
  products,
  description,
  tokenize = 'porter unicode61'
);
