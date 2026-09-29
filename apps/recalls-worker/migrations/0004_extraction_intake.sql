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
-- model name, model digest and prompt hash together (the same tuple publication matches), so output from one build never shadows another's (publication is limited
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
  -- The collector's output-affecting generation settings, canonical JSON ({"num_ctx":…,"think":…}).
  generation        TEXT NOT NULL,
  -- The inference runtime that served the model, "ollama/<version>", re-read by the collector around every notice.
  runtime           TEXT NOT NULL,
  -- The extraction-behaviour fingerprint (acceptance rules, extractor schema and options) of the collector that
  -- produced the row, as it reported it (df_collector/behaviour.py).
  behaviour_sha256  TEXT NOT NULL,
  -- The same fingerprint for the Worker that accepted the row: EXTRACTION_BEHAVIOUR_SHA256 in src/intake.ts.
  -- Publication requires both to be the benchmarked one.
  rules_sha256      TEXT NOT NULL,
  credential_id     TEXT NOT NULL,
  -- The extraction_submission that wrote the row. A submission that fails is kept as a failed audit record (its
  -- key suffixed '#failed:<lease>', its response {"failed":true,…}), so every row is accounted for by a submission.
  submission_id     INTEGER NOT NULL,
  -- accepted: passed every server check; withdrawn: removed by an operator (reversible audit trail, never deleted).
  status            TEXT NOT NULL CHECK (status IN ('accepted', 'withdrawn')),
  submitted_at      TEXT NOT NULL,
  withdrawn_at      TEXT,
  -- Which withdrawal holds the row: 'version' (the whole extractor version) or 'notice' (this recall only). Each
  -- restore lifts only its own scope, so neither can republish a row the other still withholds.
  withdrawn_scope   TEXT CHECK (withdrawn_scope IN ('version', 'notice')),
  PRIMARY KEY (recall_id, raw_sha256, extractor_version, model, model_digest, prompt_sha256, generation, runtime, behaviour_sha256, rules_sha256, kind, value_key)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS product_recall_extracted_key_lookup_idx ON product_recall_extracted_key (kind, value_key, status);
CREATE INDEX IF NOT EXISTS product_recall_extracted_key_version_idx ON product_recall_extracted_key (extractor_version, status);

-- Every submission, accepted or not, for audit and for the collector's counters. A row is reserved (response NULL)
-- before any candidate is written, so two requests with one key never both write; a different body under a used key
-- is refused. Idempotency keys are scoped to the credential, so a rotated or re-issued credential can resend a payload whose answer was lost: its candidates
-- are then reported as replayed, never duplicated.
CREATE TABLE IF NOT EXISTS extraction_submission (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  credential_id   TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  body_sha256     TEXT NOT NULL,
  -- Refreshed by the owning request as it works (a heartbeat), so only a request that died goes stale.
  received_at     TEXT NOT NULL,
  -- The owning request's random token. A retry that takes over a stale reservation replaces it, after which the
  -- earlier request can write neither candidates nor the response.
  lease           TEXT NOT NULL DEFAULT '',
  items           INTEGER NOT NULL DEFAULT 0,
  accepted        INTEGER NOT NULL DEFAULT 0,
  replayed        INTEGER NOT NULL DEFAULT 0,
  rejected        INTEGER NOT NULL DEFAULT 0,
  -- NULL while the reserving request is still processing.
  response        TEXT,
  UNIQUE (credential_id, idempotency_key)
);

-- Extractor versions an operator has withdrawn as a whole (/admin/extractions/withdraw without recall_id). The
-- withdrawal is durable: later submissions from the version are still checked and kept, but stored withdrawn, so a
-- collector with queued work cannot re-publish it. /admin/extractions/restore lifts it.
CREATE TABLE IF NOT EXISTS extractor_withdrawal (
  extractor_version TEXT PRIMARY KEY,
  withdrawn_at      TEXT NOT NULL
);
