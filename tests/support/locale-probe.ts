/**
 * Runs the real entity resolver over two competing spellings of one identifier
 * and prints what it published, as JSON, on the last line of stdout.
 *
 * It exists to be executed twice from `resolution-determinism.test.ts` under
 * two deliberately opposing collation modes. POSIX locale environment
 * variables do not select Node's default ICU locale on Windows, so relying on
 * `LC_ALL` made the original proof vacuous there. Patching `localeCompare` for
 * this exact pair keeps the test portable and mutation-sensitive: restoring the
 * old production call makes the two real resolver runs disagree.
 *
 * Nothing here is a stand-in for production code. It is the real migrations,
 * the real store, the real vertical configuration and the real `EntityResolver`.
 */
import { join } from 'node:path';
import { createCanonicalStore } from '../../packages/canonical-store/src/index.js';
import {
  EntityResolver,
  loadVerticalConfig,
} from '../../services/ingest-worker/src/index.js';
import { migratedDriver, REPO_ROOT } from './harness.js';

const VERTICAL = '11111111-1111-4111-8111-111111111111';
const SOURCE_A = '22222222-2222-4222-8222-222222222222';
const SOURCE_B = '33333333-3333-4333-8333-333333333333';
const ARTIFACT = '44444444-4444-4444-8444-444444444444';
const RECORD_A = '55555555-5555-4555-8555-555555555555';
const RECORD_B = '66666666-6666-4666-8666-666666666666';
const TS = '2026-08-14T00:00:00.000Z';

/** Two spellings of one model number. Neither is the normalized form. */
const SPELLINGS = ['abc-9001', 'ABC-9001'] as const;

type CollationMode = 'lower-first' | 'upper-first';

function readCollationMode(): CollationMode {
  const mode = process.argv[2];
  if (mode === 'lower-first' || mode === 'upper-first') return mode;
  throw new Error('locale-probe requires lower-first or upper-first');
}

/**
 * Make the obsolete implementation observably wrong without depending on the
 * host operating system's locale configuration. The child process is thrown
 * away after this probe, so no other test inherits the patched method.
 */
function installAdversarialCollator(mode: CollationMode): void {
  const nativeLocaleCompare = String.prototype.localeCompare;
  Object.defineProperty(String.prototype, 'localeCompare', {
    configurable: true,
    writable: true,
    value(this: string, compareString: string, ...rest: unknown[]): number {
      const left = String(this);
      const right = String(compareString);
      const pair = new Set([left, right]);
      if (pair.size === 2 && SPELLINGS.every((spelling) => pair.has(spelling))) {
        const lowerIsFirst = mode === 'lower-first';
        return (left === SPELLINGS[0]) === lowerIsFirst ? -1 : 1;
      }
      return Reflect.apply(nativeLocaleCompare, left, [right, ...rest]) as number;
    },
  });
}

const ATTRIBUTION = JSON.stringify({ required: false, text: null, url: null });
const ROBOTS = JSON.stringify({
  respect_robots: true,
  user_agent: 'data-foundry-bot',
  crawl_delay_seconds: 1,
  disallowed_paths: [],
  allowed_paths: [],
  robots_url: null,
  snapshot_hash: null,
  snapshot_at: null,
});

async function main(): Promise<void> {
  const collationMode = readCollationMode();
  installAdversarialCollator(collationMode);
  const driver = await migratedDriver();
  const store = createCanonicalStore(driver);
  const config = await loadVerticalConfig('hvac', {
    verticalsDir: join(REPO_ROOT, 'verticals'),
  });

  await driver.query(
    `INSERT INTO verticals (id, slug, name, schema_version, status, default_refresh_policy)
     VALUES ($1, 'hvac', 'HVAC', '1.0.0', 'ACTIVE', $2::jsonb)`,
    [VERTICAL, JSON.stringify({ cadence: 'WEEKLY', max_staleness_hours: 168, priority: 50 })],
  );

  // Equal authority on both sides, so the display preference has to fall
  // through to the final tiebreak rather than being settled by rank.
  for (const [id, domain] of [
    [SOURCE_A, 'a.example'],
    [SOURCE_B, 'b.example'],
  ] as const) {
    await driver.query(
      `INSERT INTO sources (id, vertical_id, publisher, domain, source_type, authority_rank,
                            rights_classification, attribution_requirement, robots_policy,
                            refresh_cadence, status)
       VALUES ($1, $2, 'Probe', $3, 'MANUFACTURER', 50, 'GREEN', $4::jsonb, $5::jsonb,
               'WEEKLY', 'ACTIVE')`,
      [id, VERTICAL, domain, ATTRIBUTION, ROBOTS],
    );
  }

  await driver.query(
    `INSERT INTO source_artifacts (id, source_id, url, retrieved_at, content_hash, mime_type,
                                   r2_uri, http_status, extractor_version, acquisition_provider,
                                   acquisition_route)
     VALUES ($1, $2, 'https://a.example/spec', $3, $4, 'text/html',
             'r2://raw/probe.html', 200, 'html-1.0.0', 'fixture', 'DIRECT_HTTP')`,
    [ARTIFACT, SOURCE_A, TS, 'a'.repeat(64)],
  );

  for (const [id, source, key] of [
    [RECORD_A, SOURCE_A, 'probe-a'],
    [RECORD_B, SOURCE_B, 'probe-b'],
  ] as const) {
    await driver.query(
      `INSERT INTO source_records (id, source_id, artifact_id, source_record_key, source_stream, entity_type,
                                   raw_payload, extraction_confidence, extractor_version)
       VALUES ($1, $2, $3, $4, 'products', 'equipment_model', '{}'::jsonb, 0.9, 'probe')`,
      [id, source, ARTIFACT, key],
    );
  }

  const resolver = new EntityResolver({
    store,
    config,
    verticalId: VERTICAL as never,
    now: TS as never,
    authorityBySourceId: new Map([
      [SOURCE_A, 50],
      [SOURCE_B, 50],
    ]),
  });

  const normalized = resolver.normalizer.normalize('model_number', SPELLINGS[0]);
  let entityId = '';
  for (const [index, spelling] of SPELLINGS.entries()) {
    const resolved = await resolver.resolveRecord({
      entityType: 'equipment_model' as never,
      aliases: [
        {
          aliasType: 'model_number' as never,
          aliasValue: spelling,
          normalizedValue: normalized,
          strong: true,
          locatorType: 'JSON_POINTER' as never,
          locatorValue: '/model_number',
        },
      ],
      manufacturer: null,
      sourceId: (index === 0 ? SOURCE_A : SOURCE_B) as never,
      sourceRecordId: (index === 0 ? RECORD_A : RECORD_B) as never,
    });
    entityId = resolved.entity.id;
  }

  const [entity] = await driver.query<{ canonical_name: string; canonical_slug: string }>(
    `SELECT canonical_name, canonical_slug FROM entities WHERE id = $1`,
    [entityId],
  );
  const [alias] = await driver.query<{ alias_value: string }>(
    `SELECT alias_value FROM entity_aliases
      WHERE entity_id = $1 AND alias_type = 'model_number'`,
    [entityId],
  );

  await driver.close();
  process.stdout.write(
    `\n${JSON.stringify({
      collation_mode: collationMode,
      normalized,
      canonical_name: entity?.canonical_name ?? null,
      canonical_slug: entity?.canonical_slug ?? null,
      alias_value: alias?.alias_value ?? null,
    })}\n`,
  );
}

await main();
