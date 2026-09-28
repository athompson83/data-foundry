-- Governed intake for facts proposed by an untrusted extractor (the local
-- collector's language model, apps/local-collector). Nothing here changes an
-- existing table: agency facts stay in product_recall and its key index, and
-- proposed facts live beside them until they pass the server's checks and a
-- publication gate.

-- Ingestion-scoped credentials. Only the SHA-256 of a token is stored. A token
-- can submit candidates for the sources it lists and nothing else: it cannot
-- read the API, change a notice, or publish. Minted and revoked through
-- /admin/ingest-credentials (ADMIN_TOKEN).
CREATE TABLE IF NOT EXISTS ingest_credential (
  id           TEXT PRIMARY KEY,
  token_sha256 TEXT NOT NULL UNIQUE,
  label        TEXT NOT NULL,
  -- JSON array of source keys this credential may submit for, e.g. ["cpsc-recalls"].
  sources      TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  revoked_at   TEXT
);

-- One accepted candidate per (notice, source bytes, extractor build, identifier key). The build is the version,
-- model digest and prompt hash together, so output from one build never shadows another's (publication is limited
-- to benchmarked builds, PUBLISHABLE_EXTRACTORS in src/intake.ts).
-- raw_sha256 pins the exact stored source record it was checked against; when
-- the sync stores new bytes for the notice the candidate is no longer current
-- and is not served until it is resubmitted against them.
CREATE TABLE IF NOT EXISTS product_recall_extracted_key (
  recall_id         TEXT NOT NULL,
  raw_sha256        TEXT NOT NULL,
  extractor_version TEXT NOT NULL,
  kind              TEXT NOT NULL CHECK (kind IN ('model')),
  value_key         TEXT NOT NULL,
  printed           TEXT NOT NULL,
  label             TEXT NOT NULL,
  -- The source field and UTF-16 offsets where the server found `printed`.
  source_field      TEXT NOT NULL,
  span_start        INTEGER NOT NULL,
  span_end          INTEGER NOT NULL,
  model             TEXT NOT NULL,
  model_digest      TEXT NOT NULL,
  prompt_sha256     TEXT NOT NULL,
  credential_id     TEXT NOT NULL,
  -- accepted: passed every server check; withdrawn: removed by an operator (reversible audit trail, never deleted).
  status            TEXT NOT NULL CHECK (status IN ('accepted', 'withdrawn')),
  submitted_at      TEXT NOT NULL,
  withdrawn_at      TEXT,
  PRIMARY KEY (recall_id, raw_sha256, extractor_version, model_digest, prompt_sha256, kind, value_key)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS product_recall_extracted_key_lookup_idx ON product_recall_extracted_key (kind, value_key, status);
CREATE INDEX IF NOT EXISTS product_recall_extracted_key_version_idx ON product_recall_extracted_key (extractor_version, status);

-- Every submission, accepted or not, for audit and for the collector's counters.
CREATE TABLE IF NOT EXISTS extraction_submission (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  credential_id   TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  received_at     TEXT NOT NULL,
  items           INTEGER NOT NULL,
  accepted        INTEGER NOT NULL,
  replayed        INTEGER NOT NULL,
  rejected        INTEGER NOT NULL,
  response        TEXT NOT NULL
);
