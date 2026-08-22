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
import { ExportRefusedError, buildDatasetExport, createMemorySink } from '../src/index.js';
import {
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
  fixtures = await createExportFixtures({ contaminate: true });
}, 120_000);

afterAll(async () => {
  await fixtures?.driver.close();
});

/** Publish everything except the internal note — including the contaminated fact. */
const EVERYTHING = { mode: 'all', exclude: [INTERNAL_PROPERTY] } as const;

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
      (refusal) => refusal.code === 'SOURCE_PUBLISH_GATE_BLOCKED' && refusal.subject?.includes('hvac-forum'),
    );
    expect(gate?.message).toContain('SOURCE_NOT_ACTIVE');
    expect(gate?.message).toContain('RIGHTS_BLOCKED');
  });

  it('writes nothing at all — not even the files that would have been fine', async () => {
    const { sink } = await refuse();
    expect(sink.files.size).toBe(0);
  });

  it('does not refuse the sources that were clean', async () => {
    const { error } = await refuse();
    expect(error.subjects).not.toContain('Carrier (carrier.com)');
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

describe('a source with no declaration is refused rather than assumed fine', () => {
  it('refuses when the registry does not cover a contributing domain', async () => {
    const { error, sink } = await refuse({
      properties: { mode: 'allowlist', include: PUBLIC_PROPERTIES },
      sourceRegistry: fixtures.sourceRegistry.filter((entry) => entry.key !== 'carrier-docs'),
    });
    const missing = error.refusals.find((refusal) => refusal.code === 'SOURCE_NOT_REGISTERED');
    expect(missing?.subject).toBe('Carrier (carrier.com)');
    expect(missing?.message).toContain('absence of a decision is not permission');
    expect(sink.files.size).toBe(0);
  });

  it('refuses when two declarations claim the same domain', async () => {
    const { error } = await refuse({
      properties: { mode: 'allowlist', include: PUBLIC_PROPERTIES },
      sourceRegistry: [
        ...fixtures.sourceRegistry,
        registryEntry('carrier-docs', { key: 'carrier-docs-legacy' }),
      ],
    });
    const ambiguous = error.refusals.find(
      (refusal) => refusal.code === 'SOURCE_REGISTRY_AMBIGUOUS',
    );
    expect(ambiguous?.subject).toBe('Carrier (carrier.com)');
    expect(ambiguous?.message).toContain('carrier-docs, carrier-docs-legacy');
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
        entry.key === 'carrier-docs'
          ? registryEntry('carrier-docs', {
              rights_policy: {
                ...registryEntry('carrier-docs').rights_policy,
                redistribution_allowed: false,
              },
            })
          : entry,
      ),
    });
    const gate = error.refusals.find((refusal) => refusal.code === 'SOURCE_PUBLISH_GATE_BLOCKED');
    expect(gate?.subject).toContain('Carrier (carrier.com)');
    expect(gate?.message).toContain('REDISTRIBUTION_NOT_ALLOWED');
  });

  it('refuses when an operator has thrown the kill switch', async () => {
    const { error } = await refuse({
      properties: publicOnly,
      sourceRegistry: fixtures.sourceRegistry.map((entry) =>
        entry.key === 'ahri-directory'
          ? registryEntry('ahri-directory', { kill_switch_engaged: true })
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
        entry.key === 'carrier-docs'
          ? registryEntry('carrier-docs', {
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
