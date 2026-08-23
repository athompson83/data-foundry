/**
 * The refusal path. The most important thing in this service.
 *
 * The scenario is not hypothetical and it is not "somebody set the wrong flag".
 * A manufacturer publishes a sound rating; a forum thread corroborates it; both
 * get recorded as evidence for the same fact. Fact selection is entirely happy
 * with that — the fact has rights-clear evidence from the manufacturer, so it is
 * eligible and it wins — and the forum is UNREVIEWED, which means nobody has
 * decided whether we may republish anything of theirs.
 *
 * An export that dropped the forum's evidence row and shipped the value would
 * look correct. An export that shipped the evidence row would publish the
 * forum's URL, the retrieval date and the quoted text, which is republication
 * of a source nobody cleared. The only defensible answer is to refuse the whole
 * export and say which source caused it, which is what these tests pin.
 *
 * Note what is NOT being tested: that fact selection excludes RED evidence. It
 * already does, and it is tested where it lives. What is tested here is the gap
 * that leaves — a source that reaches an export through a fact it only
 * partially backs, or through a declaration the database cannot see.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Identifier } from '@data-foundry/canonical-schema';
import type { QueryModel } from '@data-foundry/query-model';
import {
  MAX_EXPORT_ENTITIES,
  ExportRefusedError,
  buildDatasetExport,
  createMemorySink,
} from '../src/index.js';
import {
  BLOCKED_ONLY_EXCLUDED_PROPERTY,
  BLOCKED_ONLY_PROPERTY,
  CONTAMINATED_PROPERTY,
  GENERATED_AT,
  INTERNAL_PROPERTY,
  PUBLIC_PROPERTIES,
  baseOptions,
  createExportFixtures,
  registryEntry,
  type ExportFixtures,
} from './support.js';

let fixtures: ExportFixtures;

beforeAll(async () => {
  fixtures = await createExportFixtures({ contaminate: true, blockedOnlyClaim: true });
}, 120_000);

afterAll(async () => {
  await fixtures?.driver.close();
});

/** Publish everything except the internal note — including the contaminated fact. */
const EVERYTHING = { mode: 'all', exclude: [INTERNAL_PROPERTY] } as const;

/**
 * Everything the forum touches, excluded — including the claim it alone backs.
 * The forum still exists in the database and still has claims about this
 * entity; none of them is on a property this policy publishes.
 */
const NOTHING_THE_FORUM_TOUCHES = {
  mode: 'all',
  exclude: [
    INTERNAL_PROPERTY,
    CONTAMINATED_PROPERTY,
    BLOCKED_ONLY_PROPERTY,
    BLOCKED_ONLY_EXCLUDED_PROPERTY,
  ],
} as const;

async function refuse(
  overrides: Partial<Parameters<typeof buildDatasetExport>[0]> = {},
): Promise<{ error: ExportRefusedError; sink: ReturnType<typeof createMemorySink> }> {
  const sink = createMemorySink('refused');
  let error: unknown;
  try {
    await buildDatasetExport({
      ...baseOptions(fixtures),
      properties: EVERYTHING,
      sink,
      ...overrides,
    });
  } catch (caught) {
    error = caught;
  }
  expect(error, 'the build must refuse').toBeInstanceOf(ExportRefusedError);
  return { error: error as ExportRefusedError, sink };
}

describe('an unpublishable source refuses the whole export', () => {
  it('refuses, and names the offending source', async () => {
    const { error } = await refuse();

    const blocked = error.refusals.find((refusal) => refusal.code === 'SOURCE_RIGHTS_BLOCKED');
    expect(blocked, 'the UNREVIEWED forum must produce a rights refusal').toBeDefined();
    expect(blocked?.subject).toBe('HVAC Forum (forum.example)');
    expect(blocked?.message).toContain('UNREVIEWED');
    expect(blocked?.message).toContain('absence of a decision is not permission');
    expect(error.subjects).toContain('HVAC Forum (forum.example)');
    expect(error.message).toContain('HVAC Forum (forum.example)');
    expect(error.message).toContain('No file was written');
  });

  it('also reports the declaration-level blockers, not just the first problem', async () => {
    const { error } = await refuse();
    const gate = error.refusals.find(
      (refusal) => refusal.code === 'SOURCE_PUBLISH_GATE_BLOCKED',
    );
    expect(gate?.message).toContain('hvac-forum');
    expect(gate?.message).toContain('SOURCE_NOT_ACTIVE');
    expect(gate?.message).toContain('RIGHTS_BLOCKED');
    // One source with two problems must read as one source, not two.
    expect(error.subjects).toEqual(['HVAC Forum (forum.example)']);
  });

  it('writes nothing at all — not even the files that would have been fine', async () => {
    const { sink } = await refuse();
    expect(sink.files.size).toBe(0);
  });

  it('does not refuse the sources that were clean', async () => {
    const { error } = await refuse();
    expect(error.subjects).not.toContain('Acme Climate (catalog.acme-climate.example.com)');
    expect(error.subjects.every((subject) => subject.includes('forum.example'))).toBe(true);
  });

  it('would have published the forum’s URL and quoted text, which is the harm', async () => {
    // The same build with the contaminated property excluded succeeds, so the
    // refusal above is about what would be PUBLISHED, not a blanket ban on a
    // database that happens to contain an unreviewed source.
    const sink = createMemorySink('clean');
    const result = await buildDatasetExport({
      ...baseOptions(fixtures),
      properties: { mode: 'allowlist', include: PUBLIC_PROPERTIES },
      sink,
    });
    expect(result.rows.some((row) => row.property === CONTAMINATED_PROPERTY)).toBe(false);
    expect(result.manifest.sources.map((source) => source.source_key)).not.toContain('hvac-forum');
    expect(sink.files.size).toBe(4);
  });
});

describe('a claim backed ONLY by a blocked source', () => {
  /**
   * The case the gate was written for, and the one it used to miss.
   *
   * `forum_only_rumor` is claimed by the UNREVIEWED forum and by nobody else.
   * The selection layer's rights filter removes the only candidate, so the
   * property's canonical view carries `fact_id === null` and the forum appears
   * in no selected fact's evidence chain. A gate whose input was built from
   * selected facts therefore never saw the forum, `auditContributingSources`
   * was never asked about it, and the export COMPLETED — writing four files for
   * a dataset whose property set draws on a source nobody has cleared.
   *
   * Nothing of the forum's reached those files, which is why this was quiet:
   * the harm is not a leaked URL, it is that rule 1 was being enforced only as
   * a side effect of fact selection, and fact selection can only see
   * `sources.rights_classification`. Every declaration-level blocker this
   * service exists to catch — kill switch, lapsed rights review, terms that
   * forbid redistribution — is invisible to the database and so could never be
   * caught that way.
   */
  it('refuses the export, naming the source, with nothing written', async () => {
    const { error, sink } = await refuse({ properties: EVERYTHING });

    const blocked = error.refusals.find(
      (refusal) =>
        refusal.code === 'SOURCE_RIGHTS_BLOCKED' &&
        refusal.subject === 'HVAC Forum (forum.example)',
    );
    expect(blocked, 'the forum-only claim must reach the rights gate').toBeDefined();
    expect(blocked?.message).toContain('UNREVIEWED');
    expect(blocked?.message).toContain('whether or not fact selection picked them');
    expect(error.message).toContain('No file was written');
    expect(sink.files.size, 'a refused export writes nothing at all').toBe(0);
  });

  it('refuses even when the blocked claim is the ONLY thing the forum touches', async () => {
    // Without the contaminated property there is no selected fact anywhere in
    // the export whose evidence chain reaches the forum. If the refusal below
    // still fires, it fired on the unselected claim and nothing else.
    const { error, sink } = await refuse({
      properties: { mode: 'all', exclude: [INTERNAL_PROPERTY, CONTAMINATED_PROPERTY] },
    });
    expect(error.subjects).toEqual(['HVAC Forum (forum.example)']);
    expect(sink.files.size).toBe(0);
  });

  it('does NOT refuse when the blocked source only backs properties the export excludes', async () => {
    // The other half of the fix. A gate that refused on any unreviewed source
    // in the database would refuse every export this vertical will ever build,
    // and would be switched off within a week. Scoping is by exported PROPERTY.
    const sink = createMemorySink('scoped');
    const result = await buildDatasetExport({
      ...baseOptions(fixtures),
      properties: NOTHING_THE_FORUM_TOUCHES,
      sink,
    });

    expect(result.manifest.sources.map((source) => source.source_key)).not.toContain('hvac-forum');
    expect(result.rows.some((row) => row.property === BLOCKED_ONLY_PROPERTY)).toBe(false);
    expect(result.rows.some((row) => row.property === BLOCKED_ONLY_EXCLUDED_PROPERTY)).toBe(false);
    expect(sink.files.size).toBe(4);
  });

  it('leaves the manifest counting what was published, not what was audited', async () => {
    // The widened gate audits the editorial desk's PROPOSED rival refrigerant
    // claim, which loses selection and publishes nothing. It must not appear in
    // the manifest: that document tells a recipient whose terms govern the
    // bytes they hold, and every source it lists carries facts in the file.
    const sink = createMemorySink('counts');
    const result = await buildDatasetExport({
      ...baseOptions(fixtures),
      properties: NOTHING_THE_FORUM_TOUCHES,
      sink,
    });

    expect(result.manifest.sources.map((source) => source.source_key)).not.toContain(
      'editorial-desk',
    );
    expect(result.manifest.record_counts['sources']).toBe(result.manifest.sources.length);
    for (const source of result.manifest.sources) {
      expect(source.fact_count).toBeGreaterThan(0);
      expect(source.evidence_count).toBeGreaterThan(0);
    }
  });
});

describe('a source with no declaration is refused rather than assumed fine', () => {
  it('refuses when the registry does not cover a contributing domain', async () => {
    const { error, sink } = await refuse({
      properties: { mode: 'allowlist', include: PUBLIC_PROPERTIES },
      sourceRegistry: fixtures.sourceRegistry.filter((entry) => entry.key !== 'acme-docs'),
    });
    const missing = error.refusals.find((refusal) => refusal.code === 'SOURCE_NOT_REGISTERED');
    expect(missing?.subject).toBe('Acme Climate (catalog.acme-climate.example.com)');
    expect(missing?.message).toContain('absence of a decision is not permission');
    expect(sink.files.size).toBe(0);
  });

  it('refuses when two declarations claim the same domain', async () => {
    const { error } = await refuse({
      properties: { mode: 'allowlist', include: PUBLIC_PROPERTIES },
      sourceRegistry: [
        ...fixtures.sourceRegistry,
        registryEntry('acme-docs', { key: 'acme-docs-legacy' }),
      ],
    });
    const ambiguous = error.refusals.find(
      (refusal) => refusal.code === 'SOURCE_REGISTRY_AMBIGUOUS',
    );
    expect(ambiguous?.subject).toBe('Acme Climate (catalog.acme-climate.example.com)');
    expect(ambiguous?.message).toContain('acme-docs, acme-docs-legacy');
  });

  it('refuses when the database row and the declaration disagree about rights', async () => {
    const { error } = await refuse({
      properties: { mode: 'allowlist', include: PUBLIC_PROPERTIES },
      sourceRegistry: fixtures.sourceRegistry.map((entry) =>
        entry.key === 'spec-aggregator'
          ? registryEntry('spec-aggregator', { rights_classification: 'GREEN' })
          : entry,
      ),
    });
    const mismatch = error.refusals.find(
      (refusal) => refusal.code === 'RIGHTS_CLASSIFICATION_MISMATCH',
    );
    expect(mismatch?.subject).toBe('SpecAggregator (aggregator.example)');
    expect(mismatch?.message).toContain('stored source row is AMBER');
    expect(mismatch?.message).toContain('declares GREEN');
  });
});

describe('declaration-only blockers the database cannot see', () => {
  const publicOnly = { mode: 'allowlist', include: PUBLIC_PROPERTIES } as const;

  it('refuses a GREEN, ACTIVE source whose terms forbid redistribution', async () => {
    const { error } = await refuse({
      properties: publicOnly,
      sourceRegistry: fixtures.sourceRegistry.map((entry) =>
        entry.key === 'acme-docs'
          ? registryEntry('acme-docs', {
              rights_policy: {
                ...registryEntry('acme-docs').rights_policy,
                redistribution_allowed: false,
              },
            })
          : entry,
      ),
    });
    const gate = error.refusals.find((refusal) => refusal.code === 'SOURCE_PUBLISH_GATE_BLOCKED');
    expect(gate?.subject).toBe('Acme Climate (catalog.acme-climate.example.com)');
    expect(gate?.message).toContain('acme-docs');
    expect(gate?.message).toContain('REDISTRIBUTION_NOT_ALLOWED');
  });

  it('refuses when an operator has thrown the kill switch', async () => {
    const { error } = await refuse({
      properties: publicOnly,
      sourceRegistry: fixtures.sourceRegistry.map((entry) =>
        entry.key === 'ratings-directory'
          ? registryEntry('ratings-directory', { kill_switch_engaged: true })
          : entry,
      ),
    });
    expect(
      error.refusals.some((refusal) => refusal.message.includes('KILL_SWITCH_ENGAGED')),
    ).toBe(true);
  });

  it('refuses when a source’s rights review has lapsed by the generation date', async () => {
    const { error } = await refuse({
      properties: publicOnly,
      generatedAt: '2028-01-01T00:00:00.000Z' as typeof GENERATED_AT,
      selection: { at: GENERATED_AT },
    });
    expect(
      error.refusals.some((refusal) =>
        refusal.message.includes('RIGHTS_REVIEW_MISSING_OR_LAPSED'),
      ),
    ).toBe(true);
  });

  it('refuses when artifact retention is off, because the values become unexplainable', async () => {
    const { error } = await refuse({
      properties: publicOnly,
      sourceRegistry: fixtures.sourceRegistry.map((entry) =>
        entry.key === 'acme-docs'
          ? registryEntry('acme-docs', {
              provenance_retention: { retain_artifacts: false, retention_days: null, legal_hold: false },
            })
          : entry,
      ),
    });
    expect(
      error.refusals.some((refusal) =>
        refusal.message.includes('PROVENANCE_RETENTION_NOT_CONFIGURED'),
      ),
    ).toBe(true);
  });
});

describe('the caller cannot switch rule 1 off', () => {
  it('refuses a selection policy that stops requiring publishable rights', async () => {
    const { error, sink } = await refuse({
      properties: { mode: 'allowlist', include: PUBLIC_PROPERTIES },
      selection: { requirePublishableRights: false },
    });
    const disabled = error.refusals.find(
      (refusal) => refusal.code === 'SELECTION_POLICY_DISABLES_RIGHTS_GATE',
    );
    expect(disabled).toBeDefined();
    expect(disabled?.message).toContain('internal analysis');
    expect(sink.files.size).toBe(0);
  });
});

/**
 * The bound is on the export, not on each of its parts.
 *
 * `MAX_EXPORT_ENTITIES` exists because every gate in this service runs before
 * the first byte is written, which means the whole export is held in memory
 * while it is gated. That is a statement about the export, so a cap applied once
 * per entity type is not the cap: an export naming three types could hold three
 * times what the builder claims it can hold, and the number in the message would
 * be a number nobody had checked.
 *
 * The scope size is stubbed rather than inserted. Only `search().total` is
 * replaced — every entity, fact, lineage and byte still comes from the real
 * query layer over the real database — because inserting thirty thousand rows to
 * test arithmetic would test PGlite's insert path instead.
 */
describe('the in-memory bound covers the whole export', () => {
  const EQUIPMENT = 'equipment' as Identifier;
  const PART = 'part' as Identifier;

  /** The real query model, reporting a larger scope than the fixtures hold. */
  const reportingScope = (totals: Readonly<Record<string, number>>): QueryModel => ({
    ...fixtures.qm,
    search: async (query) => {
      const page = await fixtures.qm.search(query);
      const total = totals[String(query.entity_type ?? '')];
      return total === undefined ? page : { ...page, total };
    },
  });

  const build = async (
    totals: Readonly<Record<string, number>>,
    entityTypes: readonly Identifier[],
  ): Promise<{ error: unknown; sink: ReturnType<typeof createMemorySink> }> => {
    const sink = createMemorySink('bounded');
    let error: unknown;
    try {
      await buildDatasetExport({
        ...baseOptions(fixtures),
        // The forum's claims are excluded so a build that fits the bound can
        // actually succeed here: this file's fixtures are contaminated on
        // purpose, and rule 1 would otherwise refuse before the bound is
        // reached, which would make every assertion below say nothing.
        properties: NOTHING_THE_FORUM_TOUCHES,
        queryModel: reportingScope(totals),
        entityTypes: [...entityTypes],
        sink,
      });
    } catch (caught) {
      error = caught;
    }
    return { error, sink };
  };

  it('refuses when the types are each within the cap but together exceed it', async () => {
    const { error, sink } = await build(
      { [EQUIPMENT]: MAX_EXPORT_ENTITIES - 4_000, [PART]: 4_001 },
      [EQUIPMENT, PART],
    );
    expect(error).toBeInstanceOf(RangeError);
    expect((error as Error).message).toContain(String(MAX_EXPORT_ENTITIES + 1));
    expect((error as Error).message).toContain(String(MAX_EXPORT_ENTITIES));
    expect(sink.files.size).toBe(0);
  });

  it('builds at exactly the cap, so the boundary is a decision and not an accident', async () => {
    const { error, sink } = await build(
      { [EQUIPMENT]: MAX_EXPORT_ENTITIES - 4_000, [PART]: 4_000 },
      [EQUIPMENT, PART],
    );
    expect(error).toBeUndefined();
    expect(sink.files.size).toBeGreaterThan(0);
  });

  it('still refuses a single type that exceeds the cap on its own', async () => {
    const { error, sink } = await build({ [EQUIPMENT]: MAX_EXPORT_ENTITIES + 1 }, [EQUIPMENT]);
    expect(error).toBeInstanceOf(RangeError);
    expect(sink.files.size).toBe(0);
  });

  it('does not count a type the caller named twice as two scopes', async () => {
    // The id-keyed merge already publishes such an entity once. The bound has
    // to agree with it, or naming a type twice refuses an export that fits.
    const { error, sink } = await build({ [EQUIPMENT]: MAX_EXPORT_ENTITIES }, [
      EQUIPMENT,
      EQUIPMENT,
    ]);
    expect(error).toBeUndefined();
    expect(sink.files.size).toBeGreaterThan(0);
  });
});
