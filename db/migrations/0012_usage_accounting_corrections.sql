-- 0012_usage_accounting_corrections.sql
--
-- Four corrections to 0011, which shipped with the defects named in its own
-- comments and left unfixed.
--
-- ## Why this is a new migration rather than an edit to 0011
--
-- README: "Never edit an applied one", and the runner enforces it — a checksum
-- that disagrees with the ledger is a hard error, not a re-apply. 0011 has been
-- applied in CI and in every developer's PGlite. Editing it is only safe under
-- an assumption about which databases exist that cannot be checked from here; a
-- forward migration is correct under all of them. The history showing
-- add-then-correct is not noise, it is what happened.
--
-- Nothing writes `api_usage_events` yet, so the NOT NULL columns below need no
-- backfill. If a row does exist somewhere, `SET NOT NULL` fails loudly rather
-- than inventing an attribution for it, which is the correct direction: a usage
-- row whose vertical nobody knows is not a row to guess about.
--
-- ## 1. The route column was a privacy control that could not hold
--
-- 0011 stored a free-text `route` behind two regexes — no query string, no UUID
-- — and its own comment conceded that "no general CHECK can tell a literal path
-- segment from a parameter". It was right, and the gap is not theoretical:
-- `/v1/entities/by-slug/acme-climate` contains no `?` and no UUID, passes both
-- guards, and records exactly which company a named customer looked up.
--
-- A closed vocabulary is not a guess about the shape of a leak. A value that is
-- not a registered route key has nowhere to go. The application derives the key
-- from the route it MATCHED, never from `request.url`, so there is no path by
-- which a URL becomes a route key even in a caller that wants one.
--
-- ## 2. Usage could not be split by vertical
--
-- The product duplicates across industries by configuration rather than by
-- forking (AGENTS.md rule 4), and usage that cannot be attributed to a vertical
-- cannot answer whether launching the second one paid for itself.
--
-- ## 3. A key's vertical scope was optional, which made it unenforceable
--
-- `vertical_id NULL` meant "every vertical". A NULL satisfies a composite
-- foreign key vacuously, so the attribution constraint would have been
-- unenforceable for precisely the keys with the widest reach. One key names one
-- vertical; two industries is two keys. How much a customer may reach is a plan,
-- and plans are deliberately absent from this schema.
--
-- ## 4. A rate limit sat in a column nothing can enforce
--
-- The database is not on the request path. An edge that consulted this number
-- per request would become the bottleneck the limit exists to prevent. Storing
-- it invited a reader to believe a limit was in force while nothing applied one.
-- Abuse protection belongs at the edge; see docs/adr/0007.

-- ---------------------------------------------------------------------------
-- The route vocabulary.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS api_route_keys (
    key         TEXT PRIMARY KEY,
    description TEXT NOT NULL,

    -- Secondary to the foreign key, and not redundant with it: the FK stops a
    -- usage row naming an unregistered route, and this stops the vocabulary
    -- ITSELF from being widened into the free-text column it replaced. No
    -- slash, no brace, no query string, nothing an identifier fits inside.
    CONSTRAINT api_route_keys_shape CHECK (key ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$'),
    CONSTRAINT api_route_keys_bounded CHECK (char_length(key) BETWEEN 3 AND 64)
);

COMMENT ON TABLE api_route_keys IS
    'Closed vocabulary of meterable routes. Rows are added by migration, never by the application.';

-- The vocabulary is owned by the application: `apps/api/src/routes.ts` declares
-- a `routeKey` on every route and a test asserts these two lists are equal in
-- both directions, so adding a route without registering it fails CI rather
-- than failing in production at the moment somebody's request is metered.
INSERT INTO api_route_keys (key, description) VALUES
    ('service',               'GET / — the service document'),
    ('contract',              'GET /v1 — the contract document'),
    ('health',                'GET /v1/health'),
    ('entities.by_slug',      'Entity lookup by slug'),
    ('entities.detail',       'Entity detail by id'),
    ('entities.facts',        'Facts for an entity'),
    ('entities.relationships','Relationships for an entity'),
    ('search',                'Entity search'),
    ('compare',               'Entity comparison'),
    ('unmatched',             'A request that matched no route, including an unsupported version')
ON CONFLICT (key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- api_keys: scope becomes total, the unenforceable limit goes.
-- ---------------------------------------------------------------------------

ALTER TABLE api_keys DROP CONSTRAINT IF EXISTS api_keys_rate_limit_positive;
ALTER TABLE api_keys DROP COLUMN IF EXISTS rate_limit_per_minute;

-- No backfill, and that is a decision rather than an omission.
--
-- 0011 permitted a NULL scope, so this statement fails with SQLSTATE 23502 on
-- any database holding a key that has one. That is the intended behaviour: the
-- vertical a key was meant to read is not derivable from anything stored, and
-- the alternatives are all worse — inventing an attribution silently
-- misroutes accounting, and deleting the key is refused anyway by the
-- ON DELETE RESTRICT its usage rows hold. Revoking it does not help either;
-- a revoked key still needs a non-NULL scope to satisfy NOT NULL.
--
-- So the migration stops and an operator decides, per key. Nothing writes
-- api_keys today and no deployment exists, so the expected count is zero.
DO $$
DECLARE
    unscoped_key_count BIGINT;
BEGIN
    SELECT count(*) INTO unscoped_key_count
      FROM api_keys
     WHERE vertical_id IS NULL;

    IF unscoped_key_count > 0 THEN
        RAISE EXCEPTION USING
            ERRCODE = '23502',
            MESSAGE = format(
                '0012 precondition failed: api_keys.vertical_id contains %s NULL row(s); assign every key to its intended vertical before retrying',
                unscoped_key_count
            ),
            HINT = 'Do not guess or bulk-backfill key scope. Review each existing key with its owner.';
    END IF;
END $$;

ALTER TABLE api_keys ALTER COLUMN vertical_id SET NOT NULL;

-- Redundant against the primary key alone, and the redundancy is the point: a
-- composite foreign key can only target a uniquely-constrained column pair, and
-- `api_usage_events` needs this one to pin a usage row to the vertical the key
-- that made the request can actually read.
DO $$
BEGIN
    ALTER TABLE api_keys ADD CONSTRAINT api_keys_id_vertical_uniq UNIQUE (id, vertical_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

COMMENT ON COLUMN api_keys.vertical_id IS
    'The single vertical this key may read. Two industries is two keys; breadth of access is a plan, not a key attribute.';

-- ---------------------------------------------------------------------------
-- api_usage_events: an opaque route, and a vertical that must match the key.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
    legacy_usage_count BIGINT;
BEGIN
    SELECT count(*) INTO legacy_usage_count FROM api_usage_events;

    IF legacy_usage_count > 0 THEN
        RAISE EXCEPTION USING
            ERRCODE = '23502',
            MESSAGE = format(
                '0012 precondition failed: api_usage_events contains %s existing row(s); route_key and vertical_id cannot be inferred safely',
                legacy_usage_count
            ),
            HINT = 'Reconcile each legacy event with the matched route vocabulary and key vertical before retrying.';
    END IF;
END $$;

ALTER TABLE api_usage_events ADD COLUMN IF NOT EXISTS route_key TEXT;
ALTER TABLE api_usage_events ADD COLUMN IF NOT EXISTS vertical_id UUID;

-- No backfill: nothing writes this table yet. These fail loudly on a row that
-- somehow exists, rather than inventing an attribution for it.
ALTER TABLE api_usage_events ALTER COLUMN route_key SET NOT NULL;
ALTER TABLE api_usage_events ALTER COLUMN vertical_id SET NOT NULL;

DO $$
BEGIN
    ALTER TABLE api_usage_events ADD CONSTRAINT api_usage_events_route_registered
        FOREIGN KEY (route_key) REFERENCES api_route_keys (key) ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- The vertical twin of `api_usage_events_key_belongs_to_tenant`. Both single
-- references resolve on their own — the vertical exists, the key exists — and
-- only comparing them catches a row that attributes one vertical's traffic to
-- another. Total rather than partial, because `api_keys.vertical_id` is now
-- NOT NULL: there is no NULL side to satisfy it vacuously.
DO $$
BEGIN
    ALTER TABLE api_usage_events ADD CONSTRAINT api_usage_events_vertical_matches_key
        FOREIGN KEY (api_key_id, vertical_id) REFERENCES api_keys (id, vertical_id)
        ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Dropping the column takes its two CHECK constraints with it. They are not
-- replaced by a stricter regex; they are replaced by the foreign key above,
-- which does not have to predict what a leak looks like.
ALTER TABLE api_usage_events DROP COLUMN IF EXISTS route;

COMMENT ON COLUMN api_usage_events.route_key IS
    'A registered route key. Derived from the MATCHED route, never from request.url.';

-- Per-vertical revenue attribution is a first-class read, not a filter applied
-- after the fact, so it gets its own index rather than borrowing the tenant one.
CREATE INDEX IF NOT EXISTS api_usage_events_vertical_window
    ON api_usage_events (vertical_id, occurred_at);
