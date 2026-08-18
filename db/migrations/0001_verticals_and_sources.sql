-- 0001_verticals_and_sources.sql
--
-- Verticals and the source registry.
--
-- Portability rules for every migration in this directory:
--   * Plain Postgres 14+ DDL only. It must apply unchanged to PGlite (local
--     dev/tests) and to hosted Supabase/Postgres. No PGlite-specific SQL.
--   * Status/enum columns are TEXT + CHECK, not CREATE TYPE ... AS ENUM. The Zod
--     schemas in @data-foundry/canonical-schema are the source of truth for the
--     allowed values; a CHECK constraint is trivially widened by a later
--     migration, an enum type is not.
--   * Everything is IF NOT EXISTS so a partially-applied migration can be
--     re-run. The runner's ledger prevents double application; the guards make
--     recovery from an interrupted apply safe.

CREATE TABLE IF NOT EXISTS verticals (
    id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug                   TEXT        NOT NULL,
    name                   TEXT        NOT NULL,
    schema_version         TEXT        NOT NULL,
    status                 TEXT        NOT NULL,
    default_refresh_policy JSONB       NOT NULL,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT verticals_slug_format CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
    CONSTRAINT verticals_status_allowed
        CHECK (status IN ('DRAFT', 'ACTIVE', 'DEPRECATED', 'RETIRED'))
);

CREATE UNIQUE INDEX IF NOT EXISTS verticals_slug_key ON verticals (slug);

COMMENT ON TABLE verticals IS
    'A product/domain (e.g. hvac). Verticals are configuration, never forks of the app.';

CREATE TABLE IF NOT EXISTS sources (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vertical_id             UUID        NOT NULL REFERENCES verticals (id) ON DELETE RESTRICT,
    publisher               TEXT        NOT NULL,
    domain                  TEXT        NOT NULL,
    source_type             TEXT        NOT NULL,
    authority_rank          INTEGER     NOT NULL,
    rights_classification   TEXT        NOT NULL DEFAULT 'UNREVIEWED',
    attribution_requirement JSONB       NOT NULL,
    robots_policy           JSONB       NOT NULL,
    refresh_cadence         TEXT        NOT NULL,
    status                  TEXT        NOT NULL DEFAULT 'PROPOSED',
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT sources_authority_rank_range CHECK (authority_rank BETWEEN 0 AND 100),
    CONSTRAINT sources_rights_classification_allowed
        CHECK (rights_classification IN ('GREEN', 'AMBER', 'RED', 'UNREVIEWED')),
    CONSTRAINT sources_source_type_allowed CHECK (source_type IN (
        'REGULATORY', 'STANDARDS_BODY', 'CERTIFICATION_BODY', 'MANUFACTURER',
        'DISTRIBUTOR', 'TRADE_ASSOCIATION', 'MARKETPLACE', 'AGGREGATOR',
        'COMMUNITY', 'PARTNER_FEED', 'LICENSED_DATASET', 'OPEN_DATASET', 'OTHER'
    )),
    CONSTRAINT sources_refresh_cadence_allowed CHECK (refresh_cadence IN (
        'MANUAL', 'HOURLY', 'DAILY', 'WEEKLY', 'MONTHLY', 'QUARTERLY',
        'ANNUALLY', 'EVENT_DRIVEN'
    )),
    CONSTRAINT sources_status_allowed CHECK (status IN (
        'PROPOSED', 'UNDER_REVIEW', 'APPROVED', 'ACTIVE', 'PAUSED',
        'SUSPENDED', 'RETIRED'
    )),
    -- AGENTS.md rule 1, at the storage layer: a source cannot be ACTIVE without
    -- a rights decision. UNREVIEWED and RED never reach ACTIVE.
    CONSTRAINT sources_active_requires_rights CHECK (
        status <> 'ACTIVE' OR rights_classification IN ('GREEN', 'AMBER')
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS sources_vertical_domain_key
    ON sources (vertical_id, domain, source_type);
CREATE INDEX IF NOT EXISTS sources_vertical_status_idx ON sources (vertical_id, status);
CREATE INDEX IF NOT EXISTS sources_rights_classification_idx ON sources (rights_classification);
CREATE INDEX IF NOT EXISTS sources_domain_idx ON sources (domain);
CREATE INDEX IF NOT EXISTS sources_authority_rank_idx ON sources (vertical_id, authority_rank DESC);

COMMENT ON TABLE sources IS
    'One authoritative or commercial/public information source, with its rights and robots policy.';
COMMENT ON COLUMN sources.authority_rank IS
    'Field-independent trust weight 0-100 used by canonical fact selection. Not a confidence score.';
COMMENT ON COLUMN sources.rights_classification IS
    'GREEN/AMBER/RED/UNREVIEWED. RED and UNREVIEWED must never publish (AGENTS.md rule 1).';
