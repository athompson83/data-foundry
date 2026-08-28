/**
 * Export fixtures, layered on the query-layer harness, which is layered on the
 * store harness: a real PGlite database with the real `db/migrations` applied by
 * the real migration runner. Nothing about the query layer is mocked — an
 * export builder whose tests mock the thing it reads from proves only that its
 * own mock is self-consistent.
 *
 * What this file adds on top of `createQueryFixtures`:
 *
 *   - a SOURCE REGISTRY matching the fixture sources by domain, since the
 *     publish gate reads declarations and the database only holds rows;
 *   - an AMBER source, so "publishable with conditions" is exercised rather
 *     than assumed;
 *   - a CSV-hostile value — commas, double quotes and a CRLF inside one field —
 *     because that is where CSV exporters actually break;
 *   - a FORMULA-SHAPED value, aggregator-sourced, on a second entity: the same
 *     category of hazard one layer up, where the danger is not that a reader
 *     misparses the field but that a spreadsheet executes it;
 *   - an `internal_note` property, so "excluded properties stay excluded" has
 *     something real to exclude;
 *   - an opt-in BLOCKED-ONLY pair: two claims whose only evidence is the
 *     UNREVIEWED forum, one on a property an export publishes and one on a
 *     property it does not, so "the rights gate sees unselected claims" and
 *     "the rights gate is still scoped to the exported properties" are both
 *     testable;
 *   - an opt-in CONTAMINATED fact: one value whose evidence chain includes an
 *     UNREVIEWED forum source alongside a manufacturer. Fact selection is happy
 *     with it — it has rights-clear evidence — and shipping it would publish the
 *     forum's URL and its quoted text in `evidence.jsonl`. That is the case the
 *     fail-closed refusal exists for, and it is not hypothetical.
 */
import {
  entityQualityScore,
  factConfidence,
  type FactConfidence,
  type Identifier,
  type IsoDateTime,
} from '@data-foundry/canonical-schema';
import type { FactEvidenceInput } from '@data-foundry/canonical-store';
import type { SourceRegistryEntry } from '@data-foundry/source-registry';
import { compliantEntry } from '../../../packages/source-registry/test/fixtures.js';
import {
  claim,
  addSyntheticEntityEvidence,
  createQueryFixtures,
  seedSyntheticSurfaceRights,
  ts,
  type QueryFixtures,
  type SourceKey,
} from '../../../packages/query-model/test/support.js';
import type { RightsSurface } from '@data-foundry/rights-engine';

export { claim, ts } from '../../../packages/query-model/test/support.js';
export type { QueryFixtures } from '../../../packages/query-model/test/support.js';

/** The instant every fixture export is generated at. Never `Date.now()`. */
export const GENERATED_AT = '2026-08-14T00:00:00.000Z' as IsoDateTime;

/** The property carrying every character that breaks a naive CSV writer. */
export const CSV_HOSTILE_PROPERTY = 'warranty_terms' as Identifier;
export const CSV_HOSTILE_VALUE =
  'Parts, labor "included"\r\n10 years, registered; 5 otherwise — see dealer';

/**
 * A certification reference as an aggregator supplied it — which is to say, as
 * somebody outside this repository wrote it.
 *
 * It is a live formula: opened in Excel, LibreOffice or Sheets, a cell starting
 * with `=` is compiled and run, and `HYPERLINK` puts an attacker's URL under a
 * label of their choosing in a customer's spreadsheet (CWE-1236). Nothing about
 * the value is invalid as far as this pipeline is concerned — it is a string a
 * source published — so the export writer is the last place it can be made
 * inert.
 */
export const FORMULA_PROPERTY = 'ahri_certified_ref' as Identifier;
export const FORMULA_VALUE = '=HYPERLINK("http://evil.example","AHRI-209876543")';

/** Never exported. Present so the exclusion has something to exclude. */
export const INTERNAL_PROPERTY = 'internal_note' as Identifier;
export const INTERNAL_VALUE = 'margin thin; distributor renegotiation pending, do not surface';

/** The property whose evidence chain reaches an UNREVIEWED source. */
export const CONTAMINATED_PROPERTY = 'sound_rating_db' as Identifier;

/**
 * A property whose ONLY claim is backed by the UNREVIEWED forum.
 *
 * No rights-clear source says anything about it, so no candidate survives the
 * selection layer's rights filter, the canonical view carries
 * `fact_id === null`, and a gate built from selected facts alone never sees the
 * forum at all. That is the fail-open `fail-closed.test.ts` pins.
 */
export const BLOCKED_ONLY_PROPERTY = 'forum_only_rumor' as Identifier;
export const BLOCKED_ONLY_VALUE = 'quiet-ish';

/**
 * The same shape, but on a property no export publishes: the forum is the only
 * source, and the property sits outside every export policy under test. It
 * exists so "the gate reads wider" can be told apart from "the gate refuses
 * anything, anywhere, that touches an unreviewed source" — which would be an
 * over-refusal, and would get the control switched off.
 */
export const BLOCKED_ONLY_EXCLUDED_PROPERTY = 'forum_only_gossip' as Identifier;
export const BLOCKED_ONLY_EXCLUDED_VALUE = 'runs hot in August, allegedly';

/** Everything an export of this vertical may publish. */
export const PUBLIC_PROPERTIES: readonly Identifier[] = [
  'ahri_certified_ref',
  'refrigerant',
  'seer2_rating',
  'tonnage',
  CSV_HOSTILE_PROPERTY,
  'warranty_years',
] as Identifier[];

/**
 * Declarations for the fixture sources, keyed to their domains.
 *
 * Built from `compliantEntry` in the source-registry's own fixtures so "what a
 * compliant declaration looks like" has one definition. Each entry overrides
 * only its identity and the fields the test cares about; anything a test wants
 * broken it breaks explicitly, so a failure names its own cause.
 */
interface RegistrySpec {
  readonly key: string;
  readonly domain: string;
  readonly publisher: string;
  readonly source_type: SourceRegistryEntry['source_type'];
  readonly rights: SourceRegistryEntry['rights_classification'];
  readonly authority_rank: number;
  readonly status: SourceRegistryEntry['status'];
}

const REGISTRY_SPECS: readonly RegistrySpec[] = [
  {
    key: 'acme-docs',
    domain: 'catalog.acme-climate.example.com',
    publisher: 'Acme Climate',
    source_type: 'MANUFACTURER',
    rights: 'GREEN',
    authority_rank: 90,
    status: 'ACTIVE',
  },
  {
    key: 'ratings-directory',
    domain: 'ratings-directory.example.org',
    publisher: 'Ratings Directory',
    source_type: 'CERTIFICATION_BODY',
    rights: 'GREEN',
    authority_rank: 95,
    status: 'ACTIVE',
  },
  {
    key: 'spec-aggregator',
    domain: 'aggregator.example',
    publisher: 'SpecAggregator',
    source_type: 'AGGREGATOR',
    // AMBER: publishable, with conditions, and never silently.
    rights: 'AMBER',
    authority_rank: 40,
    status: 'ACTIVE',
  },
  {
    key: 'hvac-forum',
    domain: 'forum.example',
    publisher: 'HVAC Forum',
    source_type: 'COMMUNITY',
    rights: 'UNREVIEWED',
    authority_rank: 15,
    status: 'UNDER_REVIEW',
  },
  {
    key: 'editorial-desk',
    domain: 'editorial.internal',
    publisher: 'Data Foundry Editorial',
    source_type: 'OTHER',
    rights: 'GREEN',
    authority_rank: 50,
    status: 'ACTIVE',
  },
  {
    key: 'standards-desk',
    domain: 'standards-desk.internal',
    publisher: 'Data Foundry Standards Desk',
    source_type: 'OTHER',
    rights: 'GREEN',
    authority_rank: 50,
    status: 'ACTIVE',
  },
];

export function registryEntry(
  key: string,
  overrides: Partial<SourceRegistryEntry> = {},
): SourceRegistryEntry {
  const spec = REGISTRY_SPECS.find((candidate) => candidate.key === key);
  if (spec === undefined) throw new Error(`No registry fixture named "${key}".`);
  const base = compliantEntry();
  return {
    ...base,
    key: spec.key,
    vertical_slug: 'hvac',
    publisher: spec.publisher,
    domain: spec.domain,
    source_type: spec.source_type,
    authority_rank: spec.authority_rank,
    status: spec.status,
    rights_classification: spec.rights,
    attribution_requirement:
      spec.key === 'ratings-directory'
        ? {
            required: true,
            text: 'Certification data courtesy of the Ratings Directory',
            url: 'https://www.ratings-directory.example.org/',
          }
        : { required: false, text: null, url: null },
    rights_policy: {
      ...base.rights_policy,
      publisher_legal_entity: spec.publisher,
      terms_url: `https://${spec.domain}/terms`,
      license_id: spec.key === 'ratings-directory' ? 'CC-BY-4.0' : null,
    },
    license_split: {
      ...base.license_split,
      data_license_id: spec.key === 'ratings-directory' ? 'CC-BY-4.0' : null,
    },
    ...overrides,
  };
}

/** Declarations for every fixture source. */
export function exportRegistry(): SourceRegistryEntry[] {
  return REGISTRY_SPECS.map((spec) => registryEntry(spec.key));
}

export interface ExportFixtureOptions {
  /**
   * Add `sound_rating_db`, whose evidence chain includes the UNREVIEWED forum
   * source alongside the manufacturer.
   */
  readonly contaminate?: boolean;
  /**
   * Add `forum_only_rumor` and `forum_only_gossip`: two claims whose ONLY
   * evidence is the UNREVIEWED forum. Neither is ever selected, so neither
   * value is ever published — which is exactly why a gate reading only selected
   * facts stayed silent about them.
   */
  readonly blockedOnlyClaim?: boolean;
  /**
   * Explicit synthetic matrix grants. Defaults to the surface this service
   * actually publishes; neighboring-surface tests override it to prove that
   * web/API/MCP permission never implies a bulk-export grant.
   */
  readonly surfaceRights?: readonly RightsSurface[];
}

export interface ExportFixtures extends QueryFixtures {
  /**
   * Source DECLARATIONS. Named `sourceRegistry` rather than `registry` because
   * `QueryFixtures.registry` is already the field-metadata registry, and two
   * different registries under one name is how a test ends up asserting about
   * the wrong one.
   */
  readonly sourceRegistry: SourceRegistryEntry[];
}

/** Append one fact backed by evidence from several sources at once. */
async function claimFromMany(
  fixtures: QueryFixtures,
  sourceKeys: readonly SourceKey[],
  options: {
    readonly property: Identifier;
    readonly value: string | number;
    readonly value_type: 'string' | 'number';
    readonly unit?: string | null;
  },
): Promise<void> {
  const at = ts('2026-02-01T00:00:00Z');
  const evidence = sourceKeys.map<FactEvidenceInput>((key) => {
    const fixture = fixtures.sources[key];
    return {
      artifact_id: fixture.artifact.id,
      source_record_id: fixture.record.id,
      source_value: String(options.value),
      locator_type: 'CSS_SELECTOR',
      locator_value: `table.specs [data-field="${options.property}"]`,
      observed_at: at,
    };
  });
  const [first, ...rest] = evidence;
  if (first === undefined) throw new Error('claimFromMany needs at least one source.');

  await fixtures.store.appendFactWithEvidence(
    {
      entity_id: fixtures.equipment.id,
      property: options.property,
      normalized_value: options.value,
      value_type: options.value_type,
      unit: options.unit ?? null,
      valid_from: at,
      confidence: factConfidence(0.9) as FactConfidence,
      recorded_at: at,
      status: 'ACTIVE',
    },
    [first, ...rest],
  );
}

export async function createExportFixtures(
  options: ExportFixtureOptions = {},
): Promise<ExportFixtures> {
  const base = await createQueryFixtures();

  // An entity whose DISPLAY NAME and SLUG sort differently: '2' (U+0032) leads
  // every letter, so the database's `ORDER BY canonical_name` browse puts this
  // first while the export's declared `(entity_slug, entity_id)` key puts it
  // last. Entirely ordinary data — a product whose marketing name opens with a
  // model number — and the reason the ordering assertions in
  // `determinism.test.ts` are load-bearing rather than coincidentally true.
  const coil = await base.store.upsertEntity({
    vertical_id: base.vertical.id,
    entity_type: 'equipment',
    canonical_name: '24ANB7 Replacement Coil',
    canonical_slug: 'replacement-coil-24anb7',
    status: 'ACTIVE',
    quality_score: entityQualityScore(0.55),
    first_seen_at: ts('2026-01-01T00:00:00Z'),
    last_verified_at: null,
  });
  await claim(base, 'manufacturer', {
    property: 'tonnage' as Identifier,
    value: 3,
    value_type: 'number',
    unit: 'ton',
    entity_id: coil.id,
  });

  // The aggregator is AMBER in its declaration; the database row has to agree,
  // or the builder refuses the export for a mismatch — which is itself one of
  // the behaviours under test elsewhere.
  await base.store.upsertSource({
    vertical_id: base.vertical.id,
    publisher: 'SpecAggregator',
    domain: 'aggregator.example',
    source_type: 'AGGREGATOR',
    authority_rank: 40,
    rights_classification: 'AMBER',
    attribution_requirement: { required: false, text: null, url: null },
    robots_policy: base.sources.aggregator.source.robots_policy,
    refresh_cadence: 'WEEKLY',
    status: 'ACTIVE',
  });

  // The certification body publishes under terms that require a credit line.
  await base.store.upsertSource({
    vertical_id: base.vertical.id,
    publisher: 'Ratings Directory',
    domain: 'ratings-directory.example.org',
    source_type: 'CERTIFICATION_BODY',
    authority_rank: 95,
    rights_classification: 'GREEN',
    attribution_requirement: {
      required: true,
      text: 'Certification data courtesy of the Ratings Directory',
      url: 'https://www.ratings-directory.example.org/',
    },
    robots_policy: base.sources.certifier.source.robots_policy,
    refresh_cadence: 'WEEKLY',
    status: 'ACTIVE',
  });

  await claim(base, 'certifier', {
    property: 'ahri_certified_ref' as Identifier,
    value: 'AHRI-209876543',
  });
  // On the coil, where the aggregator is the only source and its value is
  // therefore the published one. The equipment's own reference stays clean, so
  // "the escape fired" and "the escape fired on everything" are distinguishable.
  await claim(base, 'aggregator', {
    property: FORMULA_PROPERTY,
    value: FORMULA_VALUE,
    entity_id: coil.id,
  });
  await claim(base, 'aggregator', {
    property: 'warranty_years' as Identifier,
    value: 10,
    value_type: 'number',
  });
  await claim(base, 'manufacturer', {
    property: CSV_HOSTILE_PROPERTY,
    value: CSV_HOSTILE_VALUE,
  });
  await claim(base, 'editorial', {
    property: INTERNAL_PROPERTY,
    value: INTERNAL_VALUE,
  });
  // A rival refrigerant from the editorial desk, PROPOSED so it does not
  // supersede the manufacturer's standing version and both stay in the contest.
  // Without a declared override the manufacturer wins on authority (ADR-0002
  // rung 1); with one, the desk's value publishes and says it was corrected.
  await claim(base, 'editorial', {
    property: 'refrigerant' as Identifier,
    value: 'R-32',
    status: 'PROPOSED',
  });

  if (options.contaminate === true) {
    await claimFromMany(base, ['manufacturer', 'blocked'], {
      property: CONTAMINATED_PROPERTY,
      value: 72,
      value_type: 'number',
      unit: 'dB',
    });
  }

  if (options.blockedOnlyClaim === true) {
    // Nothing else claims either property, so the rights filter leaves no
    // eligible candidate and both canonical views carry `fact_id === null`.
    await claim(base, 'blocked', {
      property: BLOCKED_ONLY_PROPERTY,
      value: BLOCKED_ONLY_VALUE,
      entity_id: base.entity.id,
    });
    await claim(base, 'blocked', {
      property: BLOCKED_ONLY_EXCLUDED_PROPERTY,
      value: BLOCKED_ONLY_EXCLUDED_VALUE,
      entity_id: base.entity.id,
    });
  }

  // Surface permission is explicit test data, never a production backfill.
  // Every entity also needs exact existence provenance: a fact grant cannot
  // manufacture permission to publish the entity that contains it.
  await seedSyntheticSurfaceRights(base, options.surfaceRights ?? ['BULK_EXPORT']);
  for (const entity of [base.entity, base.heatPump, base.motor, base.rival, coil]) {
    await addSyntheticEntityEvidence(base, entity, 'manufacturer');
  }

  return { ...base, sourceRegistry: exportRegistry() };
}

/** The options every happy-path build shares. */
export function baseOptions(fixtures: ExportFixtures) {
  return {
    queryModel: fixtures.qm,
    vertical: {
      id: fixtures.vertical.id,
      slug: fixtures.vertical.slug,
      schema_version: fixtures.vertical.schema_version,
    },
    version: '2026-08-14.1',
    generatedAt: GENERATED_AT,
    sourceRegistry: fixtures.sourceRegistry,
    properties: { mode: 'allowlist', include: PUBLIC_PROPERTIES } as const,
  };
}
