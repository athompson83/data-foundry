/**
 * Test harness: a real PGlite database with the real `db/migrations` applied by
 * the real migration runner. Nothing in these tests mocks the store — the whole
 * point of the exercise is that the invariants hold in SQL, not in TypeScript.
 */
import {
  applyMigrations,
  loadMigrations,
  type MigrationDriver,
} from '../../../tooling/scripts/migrate.js';
import {
  createCanonicalStore,
  createPgliteDriver,
  type CanonicalStore,
  type FactEvidenceInput,
  type SqlDriver,
  type SqlParam,
} from '../src/index.js';
import {
  entityQualityScore,
  extractionConfidence,
  factConfidence,
  identityConfidence,
  type Entity,
  type FactConfidence,
  type FactStatus,
  type FactValueType,
  type Identifier,
  type IsoDateTime,
  type RightsClassification,
  type Source,
  type SourceArtifact,
  type SourceRecord,
  type SourceType,
  type Vertical,
} from '@data-foundry/canonical-schema';

export const ts = (iso: string): IsoDateTime => new Date(iso).toISOString() as IsoDateTime;

const hash = (seed: string): string =>
  seed
    .repeat(64)
    .slice(0, 64)
    .split('')
    .map((character) => (/[0-9a-f]/.test(character) ? character : '0'))
    .join('');

const ATTRIBUTION = { required: false, text: null, url: null };
const ROBOTS = {
  respect_robots: true,
  user_agent: 'data-foundry-bot',
  crawl_delay_seconds: 1,
  disallowed_paths: [],
  allowed_paths: [],
  robots_url: null,
  snapshot_hash: null,
  snapshot_at: null,
};

/** A source plus the artifact and record that carry its claims. */
export interface SourceFixture {
  readonly source: Source;
  readonly artifact: SourceArtifact;
  readonly record: SourceRecord;
}

export interface Fixtures {
  readonly driver: SqlDriver;
  readonly store: CanonicalStore;
  readonly vertical: Vertical;
  readonly entity: Entity;
  readonly sources: Readonly<Record<SourceKey, SourceFixture>>;
}

export type SourceKey =
  | 'manufacturer'
  | 'certifier'
  | 'filing'
  | 'aggregator'
  | 'blocked'
  | 'editorial'
  /** A second, independent editorial desk — two desks can disagree. */
  | 'editorial_standards';

interface SourceSpec {
  readonly key: SourceKey;
  readonly publisher: string;
  readonly domain: string;
  readonly source_type: SourceType;
  readonly authority_rank: number;
  readonly rights: RightsClassification;
}

const SOURCE_SPECS: readonly SourceSpec[] = [
  {
    key: 'manufacturer',
    publisher: 'Acme Climate',
    domain: 'catalog.acme-climate.example.com',
    source_type: 'MANUFACTURER',
    authority_rank: 90,
    rights: 'GREEN',
  },
  {
    key: 'certifier',
    publisher: 'Ratings Directory',
    domain: 'ratings-directory.example.org',
    source_type: 'CERTIFICATION_BODY',
    authority_rank: 95,
    rights: 'GREEN',
  },
  {
    key: 'filing',
    publisher: 'Federal Equipment Register',
    domain: 'filings.regulator.example.gov',
    source_type: 'REGULATORY_FILING',
    authority_rank: 80,
    rights: 'GREEN',
  },
  {
    key: 'aggregator',
    publisher: 'SpecAggregator',
    domain: 'aggregator.example',
    source_type: 'AGGREGATOR',
    authority_rank: 40,
    rights: 'GREEN',
  },
  {
    key: 'blocked',
    publisher: 'HVAC Forum',
    domain: 'forum.example',
    source_type: 'COMMUNITY',
    authority_rank: 15,
    rights: 'UNREVIEWED',
  },
  {
    key: 'editorial',
    publisher: 'Data Foundry Editorial',
    domain: 'editorial.internal',
    source_type: 'OTHER',
    authority_rank: 50,
    rights: 'GREEN',
  },
  {
    key: 'editorial_standards',
    publisher: 'Data Foundry Standards Desk',
    domain: 'standards-desk.internal',
    source_type: 'OTHER',
    // Deliberately identical to `editorial`: when two desks both declare an
    // override, nothing about the sources themselves can break the tie.
    authority_rank: 50,
    rights: 'GREEN',
  },
];

/** Apply `db/migrations` with the shipped runner. Same SQL as production. */
export async function migrate(driver: SqlDriver): Promise<void> {
  const adapter: MigrationDriver = {
    label: driver.label,
    exec: (sql: string) => driver.exec(sql),
    query: async <T,>(sql: string, params?: readonly unknown[]): Promise<T[]> =>
      (await driver.query(sql, params as readonly SqlParam[] | undefined)) as T[],
    close: async () => undefined,
  };
  await applyMigrations(adapter, await loadMigrations());
}

export interface FixtureOptions {
  /**
   * Load `pg_trgm`. Set false to exercise the portable no-extension path — a
   * hosted Postgres may not have the extension, and rule 7 must not depend on it.
   */
  readonly trigram?: boolean;
}

export async function createFixtures(options: FixtureOptions = {}): Promise<Fixtures> {
  const driver = await createPgliteDriver({ trigram: options.trigram ?? true });
  await migrate(driver);
  const store = createCanonicalStore(driver);

  const vertical = await store.upsertVertical({
    slug: 'hvac',
    name: 'HVAC',
    schema_version: '1.0.0',
    status: 'ACTIVE',
    default_refresh_policy: { cadence: 'WEEKLY', max_staleness_hours: 168, priority: 50 },
  });

  const sources = {} as Record<SourceKey, SourceFixture>;
  for (const spec of SOURCE_SPECS) {
    const source = await store.upsertSource({
      vertical_id: vertical.id,
      publisher: spec.publisher,
      domain: spec.domain,
      source_type: spec.source_type,
      authority_rank: spec.authority_rank,
      rights_classification: spec.rights,
      attribution_requirement: ATTRIBUTION,
      robots_policy: ROBOTS,
      refresh_cadence: 'WEEKLY',
      // rule 1 at the storage layer: UNREVIEWED can never be ACTIVE.
      status: spec.rights === 'GREEN' ? 'ACTIVE' : 'UNDER_REVIEW',
      kill_switch_engaged: false,
    });
    const artifact = await store.recordSourceArtifact({
      source_id: source.id,
      url: `https://${spec.domain}/products/24anb7`,
      retrieved_at: ts('2026-01-05T00:00:00Z'),
      content_hash: hash(spec.key.slice(0, 1)),
      mime_type: 'text/html',
      r2_uri: `r2://raw/hvac/${spec.key}/24anb7.html`,
      http_status: 200,
      extractor_version: 'html-1.0.0',
      policy_snapshot_id: null,
      byte_size: 4096,
      acquisition_provider: 'http',
      acquisition_route: 'DIRECT_HTTP',
      account_or_product_plan: null,
      acquisition_jurisdiction: null,
    });
    const record = await store.recordSourceRecord({
      source_id: source.id,
      artifact_id: artifact.id,
      source_record_key: `${spec.key}-24ANB7`,
      source_stream: 'fixture_records',
      entity_type: 'equipment',
      raw_payload: { model: '24ANB7' },
      normalized_payload: null,
      extraction_confidence: extractionConfidence(0.95),
      extractor_version: 'html-1.0.0',
    });
    sources[spec.key] = { source, artifact, record };
  }

  const entity = await store.upsertEntity({
    vertical_id: vertical.id,
    entity_type: 'equipment',
    canonical_name: 'Carrier Infinity 24ANB7',
    canonical_slug: 'carrier-infinity-24anb7',
    status: 'ACTIVE',
    quality_score: entityQualityScore(0.7),
    first_seen_at: ts('2026-01-01T00:00:00Z'),
    last_verified_at: null,
  });

  await store.addAlias({
    entity_id: entity.id,
    alias_type: 'model_number',
    alias_value: '24ANB7',
    normalized_value: '24anb7',
    source_id: sources.manufacturer.source.id,
    identity_confidence: identityConfidence(0.99),
    valid_from: ts('2026-01-01T00:00:00Z'),
    valid_to: null,
  });

  return { driver, store, vertical, entity, sources };
}

export interface ClaimOptions {
  readonly property: Identifier;
  readonly value: string | number | boolean | null;
  readonly value_type?: FactValueType;
  readonly unit?: string | null;
  readonly valid_from?: string;
  readonly recorded_at?: string;
  readonly observed_at?: string;
  readonly status?: Extract<FactStatus, 'PROPOSED' | 'ACTIVE'>;
  readonly confidence?: number;
  readonly source_value?: string;
  readonly entity_id?: Entity['id'];
}

/** Record one claim about one property, backed by one source's evidence. */
export function claim(
  fixtures: Fixtures,
  sourceKey: SourceKey,
  options: ClaimOptions,
): ReturnType<CanonicalStore['appendFactWithEvidence']> {
  const fixture = fixtures.sources[sourceKey];
  const at = options.valid_from ?? '2026-02-01T00:00:00Z';
  const evidence: FactEvidenceInput = {
    artifact_id: fixture.artifact.id,
    source_record_id: fixture.record.id,
    source_value: options.source_value ?? String(options.value),
    locator_type: 'CSS_SELECTOR',
    locator_value: `table.specs [data-field="${options.property}"]`,
    observed_at: ts(options.observed_at ?? at),
  };
  return fixtures.store.appendFactWithEvidence(
    {
      entity_id: options.entity_id ?? fixtures.entity.id,
      property: options.property,
      normalized_value: options.value,
      value_type: options.value_type ?? (typeof options.value === 'number' ? 'number' : 'string'),
      unit: options.unit ?? null,
      valid_from: ts(at),
      confidence: factConfidence(options.confidence ?? 0.9) as FactConfidence,
      recorded_at: ts(options.recorded_at ?? at),
      status: options.status ?? 'ACTIVE',
    },
    [evidence],
  );
}

export async function countRows(driver: SqlDriver, table: string): Promise<number> {
  const rows = await driver.query<{ count: string }>(`SELECT count(*)::text AS count FROM ${table}`);
  return Number(rows[0]?.count ?? '0');
}
