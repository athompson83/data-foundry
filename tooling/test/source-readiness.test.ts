/**
 * The readiness report has to be able to say no.
 *
 * A gate that cannot fail is worse than no gate: it produces the word "pass"
 * and a false sense that something was checked. Two of these gates were written
 * as tautologies on the first pass (`!required || required`, and a `typeof`
 * check on an already-parsed boolean), so every case below drives the gate to
 * FAIL as well as to pass. If one of them silently becomes unfalsifiable again,
 * its failing case here goes green and this file starts lying instead.
 */
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  aggregateRevenueReadiness,
  assess as assessAt,
  canonicalJson,
  createRightsEvidenceSnapshot,
  createLiveDatabaseRightsEvidenceResolver,
  createSnapshotRightsEvidenceResolver,
  evaluateSourceSurfaceReadiness,
  isReservedDomain,
  parseRightsEvidenceSnapshot,
  readVertical as readVerticalAt,
  renderReadinessReport,
  type RightsEvidenceResolver,
  type RightsEvidenceSnapshotSourceInput,
  type VerticalReadiness,
} from '../scripts/source-readiness.js';
import * as readinessModule from '../scripts/source-readiness.js';
import type {
  RightsChannel,
  RightsDecisionCandidate,
  RightsOperation,
} from '@data-foundry/rights-engine';
import { rightsRequirementsForSurface } from '@data-foundry/rights-engine';
import { join } from 'node:path';
import { VERTICALS_DIR } from '../validators/validate-verticals.js';
import { createFixtures } from '../../packages/canonical-store/test/support.js';

const execFileAsync = promisify(execFile);
const TSX_CLI = createRequire(import.meta.url).resolve('tsx/cli');
const READINESS_CLI = fileURLToPath(new URL('../scripts/source-readiness.ts', import.meta.url));
const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));

/**
 * Both entry points require the moment to ask about, so that nothing guesses
 * it. Every case that is not itself about the clock is asked at this one fixed
 * instant — otherwise these assertions would start answering differently on a
 * future Tuesday, when a fixture's `next_review_at` quietly passes.
 */
const NOW = '2026-08-21T00:00:00.000Z';
const assess = (
  slug: string,
  status: string,
  raws: readonly Record<string, unknown>[],
  asOf: string = NOW,
) => assessAt(slug, status, raws, asOf);
const readVertical = (dir: string, slug: string) => readVerticalAt(dir, slug, NOW);

describe('the readiness CLI owns no implicit clock', () => {
  it('refuses to run without an explicit --as-of instant', async () => {
    await expect(
      execFileAsync(process.execPath, [TSX_CLI, READINESS_CLI], {
        cwd: REPO_ROOT,
      }),
    ).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringMatching(/--as-of/),
    });
  });

  it.each([
    '2026-08-28T19:00:00Z',
    '2026-08-28T15:00:00.000-04:00',
    'not-an-instant',
  ])('rejects non-canonical --as-of value %s', async (asOf) => {
    await expect(
      execFileAsync(process.execPath, [TSX_CLI, READINESS_CLI, '--as-of', asOf], {
        cwd: REPO_ROOT,
      }),
    ).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringMatching(/canonical UTC/),
    });
  });
});

const REQUIRED_RIGHTS_SURFACES = [
  'PUBLIC_WEB',
  'SEARCH_INDEX',
  'API_FREE',
  'API_PAID',
  'RAPIDAPI',
  'MCP',
  'BULK_EXPORT',
] as const;

const SOURCE_ID = '11111111-1111-4111-8111-111111111111';
const PUBLISHER_ID = '22222222-2222-4222-8222-222222222222';

function allowCandidate(
  operation: RightsOperation,
  channel: RightsChannel,
  suffix: string,
): RightsDecisionCandidate {
  const cellId = `cell-${suffix}`;
  const decisionId = `decision-${suffix}`;
  const termsCellId = `terms-cell-${suffix}`;
  const termsVersionId = `terms-version-${suffix}`;
  return {
    cell: {
      id: cellId,
      publisherId: null,
      sourceId: SOURCE_ID,
      acquisitionRoute: null,
      accountOrProductPlan: null,
      jurisdiction: null,
      assetClass: 'DATA',
      fieldKey: null,
      fieldGroupId: null,
      outputClass: 'NORMALIZED_FACT',
      operation,
      channel,
    },
    decision: {
      id: decisionId,
      cellId,
      state: 'ALLOW',
      controllingTermsVersionId: termsVersionId,
      evidenceArtifactId: `decision-evidence-${suffix}`,
      clauseRef: `clause-${suffix}`,
      reviewStatus: 'APPROVED',
      reviewerType: 'HUMAN',
      reviewedBy: 'Named reviewer',
      reviewedAt: '2026-08-01T00:00:00.000Z',
      effectiveFrom: '2026-08-01T00:00:00.000Z',
      effectiveUntil: null,
      recheckAt: '2027-08-01T00:00:00.000Z',
    },
    terms: {
      version: {
        id: termsVersionId,
        termsCellId,
        evidenceArtifactId: `terms-evidence-${suffix}`,
        contentSha256: 'a'.repeat(64),
        effectiveFrom: '2026-08-01T00:00:00.000Z',
        effectiveUntil: null,
        recheckAt: '2027-08-01T00:00:00.000Z',
      },
      scope: {
        publisherId: null,
        sourceId: SOURCE_ID,
        acquisitionRoute: null,
        accountOrProductPlan: null,
        jurisdiction: null,
      },
      currentVersionId: termsVersionId,
      activationState: 'ACTIVE',
      activationActorType: 'HUMAN',
      activationOccurredAt: '2026-08-01T00:00:00.000Z',
    },
    conditions: [],
    activation: {
      decisionId,
      cellId,
      sequenceNo: 1,
      actorType: 'HUMAN',
      actor: 'Named reviewer',
      occurredAt: '2026-08-01T00:00:00.000Z',
    },
  };
}

function decisionCondition(
  id: string,
  conditionKey: string,
): RightsDecisionCandidate['conditions'][number] {
  return {
    id,
    decisionId: 'decision-conditioned',
    conditionKey,
    conditionType: 'ATTRIBUTION',
    evaluatorKey: 'attribution_present',
    evaluatorVersion: '1',
    parametersSha256: 'b'.repeat(64),
    parametersCanonical: `{"credit":"${conditionKey}"}`,
    parameters: { credit: conditionKey },
    auditRequired: true,
  };
}

function conditionSnapshot(
  conditions: RightsDecisionCandidate['conditions'],
): ReturnType<typeof createRightsEvidenceSnapshot> {
  return createRightsEvidenceSnapshot({
    generatedAt: '2026-08-28T13:00:00.000Z',
    asOf: NOW,
    provenance: 'condition-order test',
    sources: [
      {
        verticalSlug: 'hvac',
        sourceKey: 'source-a',
        domain: 'catalog.example-manufacturer.co.uk',
        sourceType: 'MANUFACTURER',
        acquisitionRoute: 'DIRECT_HTTP',
        accountOrProductPlan: null,
        jurisdiction: null,
        context: {
          source: {
            id: SOURCE_ID,
            publisherId: PUBLISHER_ID,
            status: 'ACTIVE',
            rightsClassification: 'GREEN',
            killSwitchEngaged: false,
            prohibited: false,
          },
          snapshot: {
            candidates: [
              {
                ...allowCandidate('DISPLAY_PUBLICLY', 'PUBLIC_WEBSITE', 'conditioned'),
                conditions,
              },
            ],
            denyExceptions: [],
            sourcePublisherIds: new Map([[SOURCE_ID, PUBLISHER_ID]]),
            fieldGroupMembers: new Map(),
          },
        },
      },
    ],
  });
}

function redigestSnapshot(
  snapshot: ReturnType<typeof createRightsEvidenceSnapshot>,
): ReturnType<typeof createRightsEvidenceSnapshot> {
  const payload = Object.fromEntries(
    Object.entries(snapshot).filter(([key]) => key !== 'canonicalDigest'),
  );
  return {
    ...snapshot,
    canonicalDigest: createHash('sha256').update(canonicalJson(payload), 'utf8').digest('hex'),
  };
}

const evaluateWith = (...candidates: RightsDecisionCandidate[]) =>
  evaluateSourceSurfaceReadiness({
    sourceKey: 'source-a',
    acquisitionRoute: 'DIRECT_HTTP',
    accountOrProductPlan: null,
    jurisdiction: null,
    asOf: NOW,
    context: {
      source: {
        id: SOURCE_ID,
        publisherId: PUBLISHER_ID,
        status: 'ACTIVE',
        rightsClassification: 'GREEN',
        killSwitchEngaged: false,
        prohibited: false,
      },
      snapshot: {
        candidates,
        denyExceptions: [],
        sourcePublisherIds: new Map([[SOURCE_ID, PUBLISHER_ID]]),
        fieldGroupMembers: new Map(),
      },
    },
  });

const unknownSourceSurfaces = () =>
  evaluateSourceSurfaceReadiness({
    sourceKey: 'unknown-source',
    acquisitionRoute: 'DIRECT_HTTP',
    accountOrProductPlan: null,
    jurisdiction: null,
    asOf: NOW,
    context: null,
  });

describe('rights evidence is explicit and fail-closed', () => {
  it('exposes one canonical-engine-backed evaluator for every output mode', () => {
    expect(typeof (readinessModule as Record<string, unknown>)['evaluateSourceSurfaceReadiness'])
      .toBe('function');
  });

  it('does not let a public-web grant imply any neighboring surface', () => {
    const surfaces = evaluateWith(
      allowCandidate('DISPLAY_PUBLICLY', 'PUBLIC_WEBSITE', 'public-web'),
    );
    expect(surfaces.PUBLIC_WEB).toEqual({ status: 'READY', missing: [] });
    for (const neighbor of REQUIRED_RIGHTS_SURFACES.filter(
      (surface) => surface !== 'PUBLIC_WEB',
    )) {
      expect(surfaces[neighbor].status, neighbor).toBe('NOT_READY');
    }
    expect(surfaces.API_PAID.missing.map(({ operation, channel }) => [operation, channel]))
      .toEqual([
        ['SERVE_API_ACCESS', 'DIRECT_CUSTOMER_API'],
        ['SELL_API_ACCESS', 'DIRECT_CUSTOMER_API'],
        ['REDISTRIBUTE_NORMALIZED', 'DIRECT_CUSTOMER_API'],
      ]);
  });

  it('does not let complete direct paid-API rights imply RapidAPI rights', () => {
    const surfaces = evaluateWith(
      allowCandidate('SERVE_API_ACCESS', 'DIRECT_CUSTOMER_API', 'api-service'),
      allowCandidate('SELL_API_ACCESS', 'DIRECT_CUSTOMER_API', 'api-sale'),
      allowCandidate('REDISTRIBUTE_NORMALIZED', 'DIRECT_CUSTOMER_API', 'api-redistribute'),
    );
    expect(surfaces.API_PAID.status).toBe('READY');
    expect(surfaces.RAPIDAPI.status).toBe('NOT_READY');
    expect(surfaces.RAPIDAPI.missing.map(({ operation, channel }) => [operation, channel]))
      .toEqual([
        ['SERVE_API_ACCESS', 'RAPIDAPI_MARKETPLACE'],
        ['SELL_API_ACCESS', 'RAPIDAPI_MARKETPLACE'],
        ['REDISTRIBUTE_NORMALIZED', 'RAPIDAPI_MARKETPLACE'],
        ['SUBLICENSE_ACCESS', 'RAPIDAPI_MARKETPLACE'],
      ]);
  });

  it('does not treat a field-scoped grant as whole-source readiness', () => {
    const fieldScoped = allowCandidate(
      'DISPLAY_PUBLICLY',
      'PUBLIC_WEBSITE',
      'field-only',
    );
    const surfaces = evaluateWith({
      ...fieldScoped,
      cell: { ...fieldScoped.cell, fieldKey: 'seer2' },
    });
    expect(surfaces.PUBLIC_WEB).toMatchObject({
      status: 'NOT_READY',
      missing: [
        {
          operation: 'DISPLAY_PUBLICLY',
          channel: 'PUBLIC_WEBSITE',
          reasonCode: 'NO_GRANT',
        },
      ],
    });
  });

  it('creates and validates a deterministic, versioned, provenance-labelled snapshot digest', () => {
    const createSnapshot = (readinessModule as Record<string, unknown>)[
      'createRightsEvidenceSnapshot'
    ];
    const parseSnapshot = (readinessModule as Record<string, unknown>)[
      'parseRightsEvidenceSnapshot'
    ];
    expect(typeof createSnapshot).toBe('function');
    expect(typeof parseSnapshot).toBe('function');
    if (typeof createSnapshot !== 'function' || typeof parseSnapshot !== 'function') return;

    const input = {
      generatedAt: '2026-08-28T13:00:00.000Z',
      asOf: NOW,
      provenance: 'staging rights database export for owner review',
      sources: [
        {
          verticalSlug: 'hvac',
          sourceKey: 'source-a',
          domain: 'catalog.example-manufacturer.co.uk',
          sourceType: 'MANUFACTURER',
          acquisitionRoute: 'DIRECT_HTTP',
          accountOrProductPlan: null,
          jurisdiction: null,
          context: {
            source: {
              id: SOURCE_ID,
              publisherId: PUBLISHER_ID,
              status: 'ACTIVE',
              rightsClassification: 'GREEN',
              killSwitchEngaged: false,
              prohibited: false,
            },
            snapshot: {
              candidates: [
                allowCandidate('SELL_API_ACCESS', 'DIRECT_CUSTOMER_API', 'api-sale'),
                allowCandidate('SERVE_API_ACCESS', 'DIRECT_CUSTOMER_API', 'api-service'),
              ],
              denyExceptions: [],
              sourcePublisherIds: new Map([[SOURCE_ID, PUBLISHER_ID]]),
              fieldGroupMembers: new Map([
                ['product-fields', ['seer2', 'model_number']],
              ]),
            },
          },
        },
      ],
    };

    const first = (createSnapshot as (value: unknown) => Record<string, unknown>)(input);
    const reversed = (createSnapshot as (value: unknown) => Record<string, unknown>)({
      ...input,
      sources: [
        {
          ...input.sources[0],
          context: {
            ...input.sources[0]!.context,
            snapshot: {
              ...input.sources[0]!.context.snapshot,
              candidates: [...input.sources[0]!.context.snapshot.candidates].reverse(),
              fieldGroupMembers: new Map([
                ['product-fields', ['model_number', 'seer2']],
              ]),
            },
          },
        },
      ],
    });
    expect(first['schemaVersion']).toBe(1);
    expect(first['provenance']).toBe(input.provenance);
    expect(first['canonicalDigest']).toMatch(/^[0-9a-f]{64}$/);
    expect(reversed['canonicalDigest']).toBe(first['canonicalDigest']);

    const parsed = (parseSnapshot as (value: unknown, expectedAsOf: string) => {
      sources: Array<{ context: { snapshot: { fieldGroupMembers: Map<string, string[]> } } }>;
    })(first, NOW);
    expect(parsed.sources[0]?.context.snapshot.fieldGroupMembers).toEqual(
      new Map([['product-fields', ['model_number', 'seer2']]]),
    );
  });

  it('canonicalizes condition order so equivalent snapshots have one digest', () => {
    const conditionA = decisionCondition('condition-A', 'alpha');
    const conditionZ = decisionCondition('condition-z', 'zeta');
    const forward = conditionSnapshot([conditionA, conditionZ]);
    const reversed = conditionSnapshot([conditionZ, conditionA]);

    expect(reversed.canonicalDigest).toBe(forward.canonicalDigest);
    expect(
      reversed.sources[0]?.context.snapshot.candidates[0]?.conditions.map(({ id }) => id),
    ).toEqual(['condition-A', 'condition-z']);
  });

  it('rejects digest-valid snapshots whose conditions are not in canonical order', () => {
    const snapshot = conditionSnapshot([
      decisionCondition('condition-A', 'alpha'),
      decisionCondition('condition-z', 'zeta'),
    ]);
    const unsorted = structuredClone(snapshot);
    unsorted.sources[0]!.context.snapshot.candidates[0]!.conditions.reverse();

    expect(() => parseRightsEvidenceSnapshot(redigestSnapshot(unsorted), NOW)).toThrow(
      /conditions.*canonical code-unit order/i,
    );
  });

  it('rejects digest-valid snapshots with duplicate condition identities', () => {
    const snapshot = conditionSnapshot([
      decisionCondition('condition-A', 'alpha'),
      decisionCondition('condition-z', 'zeta'),
    ]);
    const duplicate = structuredClone(snapshot);
    duplicate.sources[0]!.context.snapshot.candidates[0]!.conditions = [
      duplicate.sources[0]!.context.snapshot.candidates[0]!.conditions[0]!,
      structuredClone(duplicate.sources[0]!.context.snapshot.candidates[0]!.conditions[0]!),
    ];

    expect(() => parseRightsEvidenceSnapshot(redigestSnapshot(duplicate), NOW)).toThrow(
      /conditions.*duplicates/i,
    );
  });

  it('rejects tampering, the wrong as-of instant, and malformed snapshot metadata', () => {
    const createSnapshot = (readinessModule as Record<string, unknown>)[
      'createRightsEvidenceSnapshot'
    ];
    const parseSnapshot = (readinessModule as Record<string, unknown>)[
      'parseRightsEvidenceSnapshot'
    ];
    expect(typeof createSnapshot).toBe('function');
    expect(typeof parseSnapshot).toBe('function');
    if (typeof createSnapshot !== 'function' || typeof parseSnapshot !== 'function') return;

    const valid = (createSnapshot as (value: unknown) => Record<string, unknown>)({
      generatedAt: '2026-08-28T13:00:00.000Z',
      asOf: NOW,
      provenance: 'qualified offline evidence',
      sources: [],
    });
    expect(() =>
      (parseSnapshot as (value: unknown, expectedAsOf: string) => unknown)(
        { ...valid, provenance: 'tampered label' },
        NOW,
      ),
    ).toThrow(/digest/i);
    expect(() =>
      (parseSnapshot as (value: unknown, expectedAsOf: string) => unknown)(
        valid,
        '2026-08-29T00:00:00.000Z',
      ),
    ).toThrow(/as-of/i);
    expect(() =>
      (parseSnapshot as (value: unknown, expectedAsOf: string) => unknown)(
        { ...valid, schemaVersion: 2 },
        NOW,
      ),
    ).toThrow(/schema|snapshot/i);
  });

  it('uses a validated snapshot while leaving absent sources UNKNOWN', async () => {
    const createSnapshot = (readinessModule as Record<string, unknown>)[
      'createRightsEvidenceSnapshot'
    ];
    expect(typeof createSnapshot).toBe('function');
    if (typeof createSnapshot !== 'function') return;
    const snapshot = (createSnapshot as (value: unknown) => unknown)({
      generatedAt: '2026-08-28T13:00:00.000Z',
      asOf: NOW,
      provenance: 'offline test snapshot',
      sources: [
        {
          verticalSlug: 'hvac',
          sourceKey: 'acme-hvac-catalog',
          domain: 'catalog.acme-climate.example.com',
          sourceType: 'MANUFACTURER',
          acquisitionRoute: 'DIRECT_HTTP',
          accountOrProductPlan: null,
          jurisdiction: null,
          context: {
            source: {
              id: SOURCE_ID,
              publisherId: PUBLISHER_ID,
              status: 'ACTIVE',
              rightsClassification: 'GREEN',
              killSwitchEngaged: false,
              prohibited: false,
            },
            snapshot: {
              candidates: [
                allowCandidate('DISPLAY_PUBLICLY', 'PUBLIC_WEBSITE', 'public-web-cli'),
              ],
              denyExceptions: [],
              sourcePublisherIds: new Map([[SOURCE_ID, PUBLISHER_ID]]),
              fieldGroupMembers: new Map(),
            },
          },
        },
      ],
    });
    const directory = await mkdtemp(join(tmpdir(), 'data-foundry-readiness-'));
    const snapshotPath = join(directory, 'rights-snapshot.json');
    await writeFile(snapshotPath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');

    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      [
        TSX_CLI,
        READINESS_CLI,
        '--as-of',
        NOW,
        '--rights-snapshot',
        snapshotPath,
        '--json',
        'hvac',
      ],
      { cwd: REPO_ROOT },
    );
    expect(stderr).toBe('');
    const [report] = JSON.parse(stdout) as Array<{
      rightsEvidence: { kind: string; qualification: string; provenance: string };
      sources: Array<{
        key: string;
        surfaces: Record<string, { status: string }>;
      }>;
    }>;
    expect(report?.rightsEvidence).toMatchObject({
      kind: 'SNAPSHOT',
      qualification: 'SNAPSHOT_BACKED',
      provenance: 'offline test snapshot',
    });
    expect(report?.sources.find(({ key }) => key === 'acme-hvac-catalog')?.surfaces)
      .toMatchObject({
        PUBLIC_WEB: { status: 'READY' },
        API_FREE: { status: 'NOT_READY' },
      });
    expect(
      report?.sources.find(({ key }) => key === 'acme-spec-sheets')
        ?.surfaces['PUBLIC_WEB']?.status,
    )
      .toBe('UNKNOWN');
  });

  it('accepts only a credential environment-variable name for live DB evidence', async () => {
    const missingName = `DF_READINESS_MISSING_${process.pid}`;
    const environment = { ...process.env };
    delete environment[missingName];
    await expect(
      execFileAsync(
        process.execPath,
        [
          TSX_CLI,
          READINESS_CLI,
          '--as-of',
          NOW,
          '--database-env',
          missingName,
          '--json',
          'hvac',
        ],
        { cwd: REPO_ROOT, env: environment },
      ),
    ).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringMatching(new RegExp(missingName)),
    });

    const secretLikeValue = 'postgres://user:do-not-print@example.invalid/database';
    try {
      await execFileAsync(
        process.execPath,
        [
          TSX_CLI,
          READINESS_CLI,
          '--as-of',
          NOW,
          '--database-env',
          secretLikeValue,
          '--json',
          'hvac',
        ],
        { cwd: REPO_ROOT },
      );
      throw new Error('expected a literal database URL to be rejected');
    } catch (error) {
      const result = error as { code?: number; stderr?: string };
      expect(result.code).toBe(1);
      expect(result.stderr).toMatch(/environment.variable name/i);
      expect(result.stderr).not.toContain(secretLikeValue);
    }
  });

  it('loads live evidence by the declared vertical, normalized domain, and source type', async () => {
    const fixtures = await createFixtures({ trigram: false });
    try {
      const [declared] = assess('hvac', 'DRAFT', [
        source({
          key: 'fixture-manufacturer',
          domain: 'CATALOG.ACME-CLIMATE.EXAMPLE.COM.',
          source_type: 'MANUFACTURER',
          acquisition_policy: {
            method: 'DIRECT_HTTP',
            account_or_product_plan: null,
            jurisdiction: null,
            approved: true,
          },
        }),
      ]).sources;
      const resolver = createLiveDatabaseRightsEvidenceResolver(
        fixtures.driver,
        'DF_TEST_DATABASE_URL',
        NOW,
        'data_foundry',
      );
      const context = await resolver.contextFor('hvac', declared!);
      expect(context?.source.id).toBe(fixtures.sources.manufacturer.source.id);
      expect(
        evaluateSourceSurfaceReadiness({
          sourceKey: declared!.key,
          acquisitionRoute: declared!.acquisitionRoute,
          accountOrProductPlan: declared!.accountOrProductPlan,
          jurisdiction: declared!.jurisdiction,
          asOf: NOW,
          context,
        }).PUBLIC_WEB.status,
      ).toBe('NOT_READY');
      expect(resolver.descriptor).toEqual({
        kind: 'LIVE_DATABASE',
        qualification: 'LIVE_AS_OF',
        credentialEnv: 'DF_TEST_DATABASE_URL',
        asOf: NOW,
        schema: 'data_foundry',
      });

      const report = {
        ...assess('hvac', 'DRAFT', [source()]),
        rightsEvidence: resolver.descriptor,
      };
      expect(renderReadinessReport(report)).toContain(
        'LIVE_DATABASE as of 2026-08-21T00:00:00.000Z — schema data_foundry',
      );
      const [jsonReport] = JSON.parse(JSON.stringify([report])) as Array<{
        rightsEvidence: { schema?: string };
      }>;
      expect(jsonReport?.rightsEvidence).toMatchObject({ schema: 'data_foundry' });
    } finally {
      await fixtures.driver.close();
    }
  });

  it('names the selected schema when a live rights lookup cannot acquire it', async () => {
    const [declared] = assess('hvac', 'DRAFT', [source()]).sources;
    const unavailableDriver = {
      query: async () => {
        throw new Error('relation does not exist');
      },
    } as unknown as Parameters<typeof createLiveDatabaseRightsEvidenceResolver>[0];
    const resolver = createLiveDatabaseRightsEvidenceResolver(
      unavailableDriver,
      'DF_TEST_DATABASE_URL',
      NOW,
      'data_foundry',
    );

    await expect(resolver.contextFor('hvac', declared!)).rejects.toThrow(
      /schema data_foundry through credential env DF_TEST_DATABASE_URL/i,
    );
  });

  it('exports the exact context evaluated for each source without a second resolver lookup', async () => {
    const readEvaluation = (readinessModule as Record<string, unknown>)[
      'readVerticalWithRightsEvidence'
    ];
    expect(typeof readEvaluation).toBe('function');
    if (typeof readEvaluation !== 'function') return;

    const evaluatedContext = {
      source: {
        id: SOURCE_ID,
        publisherId: PUBLISHER_ID,
        status: 'ACTIVE',
        rightsClassification: 'GREEN',
        killSwitchEngaged: false,
        prohibited: false,
      },
      snapshot: {
        candidates: [allowCandidate('DISPLAY_PUBLICLY', 'PUBLIC_WEBSITE', 'first-read')],
        denyExceptions: [],
        sourcePublisherIds: new Map([[SOURCE_ID, PUBLISHER_ID]]),
        fieldGroupMembers: new Map(),
      },
    } as const;
    const changedContext = {
      ...evaluatedContext,
      snapshot: { ...evaluatedContext.snapshot, candidates: [] },
    };
    const calls = new Map<string, number>();
    const resolver: RightsEvidenceResolver = {
      descriptor: {
        kind: 'LIVE_DATABASE',
        qualification: 'LIVE_AS_OF',
        credentialEnv: 'DF_TEST_DATABASE_URL',
        asOf: NOW,
        schema: 'data_foundry',
      },
      async contextFor(verticalSlug, declaredSource) {
        const identity = `${verticalSlug}/${declaredSource.key}`;
        const count = (calls.get(identity) ?? 0) + 1;
        calls.set(identity, count);
        return count === 1 ? evaluatedContext : changedContext;
      },
    };

    const evaluation = await (
      readEvaluation as (
        dir: string,
        slug: string,
        asOf: string,
        evidence: RightsEvidenceResolver,
      ) => Promise<{
        report: VerticalReadiness;
        snapshotSources: readonly RightsEvidenceSnapshotSourceInput[];
      }>
    )(join(VERTICALS_DIR, 'hvac'), 'hvac', NOW, resolver);

    expect([...calls.values()]).toEqual([1, 1, 1, 1]);
    const snapshot = createRightsEvidenceSnapshot({
      generatedAt: NOW,
      asOf: NOW,
      provenance: 'same-run parity test',
      sources: evaluation.snapshotSources,
    });
    const replay = createSnapshotRightsEvidenceResolver(
      parseRightsEvidenceSnapshot(snapshot, NOW),
    );
    for (const declaredSource of evaluation.report.sources) {
      const context = await replay.contextFor(evaluation.report.slug, declaredSource);
      expect(context).not.toBeNull();
      expect(
        evaluateSourceSurfaceReadiness({
          sourceKey: declaredSource.key,
          acquisitionRoute: declaredSource.acquisitionRoute,
          accountOrProductPlan: declaredSource.accountOrProductPlan,
          jurisdiction: declaredSource.jurisdiction,
          asOf: NOW,
          context,
        }),
      ).toEqual(declaredSource.surfaces);
    }
    expect([...calls.values()]).toEqual([1, 1, 1, 1]);
  });

  it('includes the owner-deferred ENERGY STAR candidate only when explicitly selected', async () => {
    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      [
        TSX_CLI,
        READINESS_CLI,
        '--as-of',
        NOW,
        '--include-source',
        'energy-star-heat-pumps',
        '--json',
        'hvac',
      ],
      { cwd: REPO_ROOT },
    );
    expect(stderr).toBe('');
    const [report] = JSON.parse(stdout) as Array<{
      ready: boolean;
      sources: Array<{
        key: string;
        lifecycleDecision: string;
        governanceBlockers: string[];
        surfaces: Record<string, { status: string; missing: Array<{ operation: string; channel: string }> }>;
      }>;
    }>;
    const energyStar = report?.sources.find(({ key }) => key === 'energy-star-heat-pumps');
    expect(energyStar).toMatchObject({
      lifecycleDecision: 'DEFERRED',
      governanceBlockers: [
        'PUBLISHER_MAPPING_MISSING',
        'TERMS_EVIDENCE_MISSING',
        'NAMED_REVIEWER_MISSING',
        'RIGHTS_ACTIVATION_MISSING',
        'OWNER_DECISION_DEFERRED',
      ],
    });
    expect(report?.ready).toBe(false);
    expect(Object.values(energyStar?.surfaces ?? {}).map(({ status }) => status))
      .toEqual(REQUIRED_RIGHTS_SURFACES.map(() => 'UNKNOWN'));
    expect(
      energyStar?.surfaces['API_PAID']?.missing.map(({ operation, channel }) => [operation, channel]),
    )
      .toEqual([
        ['SERVE_API_ACCESS', 'DIRECT_CUSTOMER_API'],
        ['SELL_API_ACCESS', 'DIRECT_CUSTOMER_API'],
        ['REDISTRIBUTE_NORMALIZED', 'DIRECT_CUSTOMER_API'],
      ]);
  });

  it('never marks deferred ENERGY STAR ready even if a snapshot contains a matching grant', async () => {
    const snapshot = (readinessModule.createRightsEvidenceSnapshot as (value: unknown) => unknown)({
      generatedAt: '2026-08-28T13:00:00.000Z',
      asOf: NOW,
      provenance: 'adversarial deferred-source regression fixture',
      sources: [
        {
          verticalSlug: 'hvac',
          sourceKey: 'energy-star-heat-pumps',
          domain: 'data.energystar.gov',
          sourceType: 'REGULATORY_FILING',
          acquisitionRoute: 'VENDOR_API',
          accountOrProductPlan: null,
          jurisdiction: null,
          context: {
            source: {
              id: SOURCE_ID,
              publisherId: PUBLISHER_ID,
              status: 'ACTIVE',
              rightsClassification: 'GREEN',
              killSwitchEngaged: false,
              prohibited: false,
            },
            snapshot: {
              candidates: [
                allowCandidate('DISPLAY_PUBLICLY', 'PUBLIC_WEBSITE', 'deferred-public'),
              ],
              denyExceptions: [],
              sourcePublisherIds: new Map([[SOURCE_ID, PUBLISHER_ID]]),
              fieldGroupMembers: new Map(),
            },
          },
        },
      ],
    });
    const directory = await mkdtemp(join(tmpdir(), 'data-foundry-deferred-readiness-'));
    const path = join(directory, 'snapshot.json');
    await writeFile(path, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
    const { stdout } = await execFileAsync(
      process.execPath,
      [
        TSX_CLI,
        READINESS_CLI,
        '--as-of',
        NOW,
        '--rights-snapshot',
        path,
        '--include-source',
        'energy-star-heat-pumps',
        '--json',
        'hvac',
      ],
      { cwd: REPO_ROOT },
    );
    const [report] = JSON.parse(stdout) as Array<{
      ready: boolean;
      sources: Array<{
        key: string;
        surfaces: Record<string, { status: string; blockingReasons?: string[] }>;
      }>;
    }>;
    const energyStar = report?.sources.find(({ key }) => key === 'energy-star-heat-pumps');
    expect(energyStar?.surfaces['PUBLIC_WEB']).toMatchObject({
      status: 'NOT_READY',
      blockingReasons: ['OWNER_DECISION_DEFERRED'],
    });
    expect(report?.ready).toBe(false);
  });

  it('keeps the versioned offline snapshot JSON Schema artifact in sync', async () => {
    const serializeSchema = (readinessModule as Record<string, unknown>)[
      'serializeRightsEvidenceSnapshotJsonSchema'
    ];
    expect(typeof serializeSchema).toBe('function');
    if (typeof serializeSchema !== 'function') return;
    const committed = await readFile(
      join(REPO_ROOT, 'schemas', 'source-readiness-snapshot-v1.schema.json'),
      'utf8',
    );
    expect(committed).toBe((serializeSchema as () => string)());
  });

  it('allows snapshot export only from explicit live-DB evidence with explicit clocks and provenance', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'data-foundry-readiness-export-'));
    const output = join(directory, 'snapshot.json');
    await expect(
      execFileAsync(
        process.execPath,
        [
          TSX_CLI,
          READINESS_CLI,
          '--as-of',
          NOW,
          '--snapshot-out',
          output,
          '--snapshot-provenance',
          'owner-qualified export',
          '--generated-at',
          '2026-08-28T13:00:00.000Z',
          '--json',
          'hvac',
        ],
        { cwd: REPO_ROOT },
      ),
    ).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringMatching(/snapshot export requires --database-env/i),
    });
  });

  it('reports every required surface UNKNOWN when no database or snapshot is supplied', async () => {
    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      [TSX_CLI, READINESS_CLI, '--as-of', NOW, '--json', 'hvac'],
      { cwd: REPO_ROOT },
    );
    expect(stderr).toBe('');
    const reports = JSON.parse(stdout) as Array<Record<string, unknown>>;
    expect(reports).toHaveLength(1);
    expect(reports[0]?.['rightsEvidence']).toEqual({ kind: 'NONE' });
    expect(reports[0]?.['ready']).toBe(false);
    expect(reports[0]?.['revenueReadiness']).toMatchObject({
      status: 'UNKNOWN',
      scope: 'SOURCE_WIDE_DATA_NORMALIZED_FACT',
    });
    expect(reports[0]).not.toHaveProperty('commercialGate');
    expect(reports[0]).not.toHaveProperty('hasRealRightsReviewedSource');
    const sources = reports[0]?.['sources'] as Array<Record<string, unknown>>;
    expect(sources.length).toBeGreaterThan(0);
    for (const source of sources) {
      expect(Object.keys(source['surfaces'] as Record<string, unknown>)).toEqual(
        REQUIRED_RIGHTS_SURFACES,
      );
      for (const surface of Object.values(source['surfaces'] as Record<string, { status: string }>)) {
        expect(surface.status).toBe('UNKNOWN');
      }
    }
  });

  it('aggregates only real enabled publication candidates', () => {
    const aggregate = (readinessModule as Record<string, unknown>)[
      'aggregateRevenueReadiness'
    ];
    expect(typeof aggregate).toBe('function');
    if (typeof aggregate !== 'function') return;

    const requirementPairs = new Map<string, { operation: RightsOperation; channel: RightsChannel }>();
    for (const surface of REQUIRED_RIGHTS_SURFACES) {
      for (const requirement of rightsRequirementsForSurface(surface)) {
        requirementPairs.set(`${requirement.operation}/${requirement.channel}`, requirement);
      }
    }
    const readySurfaces = evaluateWith(
      ...[...requirementPairs.values()].map(({ operation, channel }, index) =>
        allowCandidate(operation, channel, `complete-${index}`),
      ),
    );
    const real = assess('probe', 'DRAFT', [source({ key: 'real', domain: 'real-source.test.co' })])
      .sources[0]!;
    const synthetic = assess('probe', 'DRAFT', [
      source({ key: 'synthetic', domain: 'fixture.example.com' }),
    ]).sources[0]!;
    const inactiveReal = {
      ...real,
      key: 'inactive-real',
      status: 'PAUSED',
      surfaces: unknownSourceSurfaces(),
    };
    const deferredReal = {
      ...real,
      key: 'deferred-real',
      lifecycleDecision: 'DEFERRED' as const,
      governanceBlockers: ['OWNER_DECISION_DEFERRED'],
      surfaces: unknownSourceSurfaces(),
    };
    const run = aggregate as (sources: unknown[]) => { status: string };

    expect(
      run([
        { ...real, surfaces: readySurfaces },
        { ...synthetic, surfaces: unknownSourceSurfaces() },
      ]).status,
      'a reserved-domain fixture is not a revenue contribution',
    ).toBe('READY');
    expect(
      run([{ ...real, surfaces: readySurfaces }, inactiveReal, deferredReal]).status,
      'inactive and explicitly deferred neighbors do not contaminate an active real source',
    ).toBe('READY');
    expect(
      run([{ ...inactiveReal, surfaces: readySurfaces }]).status,
      'an inactive real source cannot make a vertical ready by itself',
    ).toBe('UNKNOWN');
  });
});

/** A fully permissive, fully reviewed real source. Each case spoils one field. */
const REAL = {
  key: 'a-real-source',
  domain: 'catalog.example-manufacturer.co.uk',
  status: 'ACTIVE',
  rights_classification: 'GREEN',
  kill_switch_engaged: false,
  image_policy: { images_reusable: false },
  provenance_retention: { retain_artifacts: true },
  acquisition_policy: { approved: true },
  rights_policy: {
    commercial_use_allowed: true,
    redistribution_allowed: true,
    derivative_normalization_allowed: true,
    images_reusable: false,
    personal_data_present: false,
    reviewed_at: '2026-08-01T00:00:00.000Z',
    reviewed_by: 'A. Reviewer',
    next_review_at: '2027-08-01',
    attribution: { required: true, text: 'Data from Example Manufacturer.' },
  },
} as const;

const source = (patch: Record<string, unknown> = {}) => ({ ...REAL, ...patch });
const withRights = (patch: Record<string, unknown>) =>
  source({ rights_policy: { ...REAL.rights_policy, ...patch } });

describe('a reserved domain cannot name a real publisher', () => {
  it('classifies the reserved names as synthetic', () => {
    for (const domain of [
      'example.com',
      'catalog.acme-climate.example.com',
      'ratings-directory.example.org',
      'anything.test',
      'host.invalid',
      'localhost',
      // Fully qualified, with the root label written out. Same DNS name.
      'example.com.',
      'catalog.acme-climate.example.com.',
      // The reserved top-level labels standing alone. `.test` is reserved as a
      // TLD, so the TLD itself is the most reserved name there is — but a rule
      // written as "ends with `.test`" does not match `test`, and the apex form
      // is exactly what a trailing root dot normalizes down to.
      'example',
      'example.',
      'test',
      'test.',
      'invalid',
      'invalid.',
      'localhost.',
    ]) {
      expect(isReservedDomain(domain), domain).toBe(true);
    }
  });

  it('does not mistake an ordinary domain for a reserved one', () => {
    for (const domain of [
      'catalog.example-manufacturer.co.uk',
      'exampleteam.io',
      'notexample.com',
      'certified-ratings.org',
      // The reserved label has to be a whole label, not a string ending.
      'attest.com',
      'contest.example-registry.io',
      'notlocalhost.net',
    ]) {
      expect(isReservedDomain(domain), domain).toBe(false);
    }
  });

  it('treats a missing domain as unknown rather than reserved', () => {
    expect(isReservedDomain('')).toBe(false);
  });
});

describe('legacy declaration inventory remains fail-only metadata', () => {
  it('passes when a real, fully reviewed, fully permissive source is declared', () => {
    const report = assess('probe', 'ACTIVE', [source()]);
    expect(Object.values(report.legacyCommercialInventory).every(Boolean)).toBe(true);
    expect(report.blockers).toEqual([]);
    expect(report.realSourceCount).toBe(1);
  });

  it('fails when an enabled source was never rights-reviewed', () => {
    // The read boundary refuses UNREVIEWED data, so this source publishes
    // nothing today. It is still a blocker for selling a dataset: an enabled
    // source nobody has looked at is exactly what condition 1 of DATA_RIGHTS.md
    // forbids, and the gate must be able to see it.
    const report = assess('probe', 'DRAFT', [source({ rights_classification: 'UNREVIEWED' })]);
    expect(report.legacyCommercialInventory.noUnreviewedSources).toBe(false);
  });

  it('does not count a disabled unreviewed source against the gate', () => {
    const report = assess('probe', 'DRAFT', [
      source({ rights_classification: 'UNREVIEWED', status: 'PAUSED' }),
    ]);
    expect(report.legacyCommercialInventory.noUnreviewedSources).toBe(true);
  });

  it('accepts AMBER, which publishes on conditions rather than not at all', () => {
    const report = assess('probe', 'DRAFT', [source({ rights_classification: 'AMBER' })]);
    expect(report.legacyCommercialInventory.noUnreviewedSources).toBe(true);
  });

  it('fails when a publishing source forbids commercial use', () => {
    const report = assess('probe', 'DRAFT', [withRights({ commercial_use_allowed: false })]);
    expect(report.legacyCommercialInventory.everyPublishingSourcePermitsCommercialUse).toBe(false);
  });

  it('fails when a publishing source forbids derivative normalization', () => {
    // The permission the whole platform depends on: normalizing and deriving is
    // what the factory does to every byte it acquires. A source that forbids it
    // can be read and cited but cannot be processed, and that has to be visible
    // rather than merely printed alongside the passing gates.
    const report = assess('probe', 'DRAFT', [
      withRights({ derivative_normalization_allowed: false }),
    ]);
    expect(report.legacyCommercialInventory.everyPublishingSourcePermitsDerivativeNormalization).toBe(false);
    expect(Object.values(report.legacyCommercialInventory).every(Boolean)).toBe(false);
  });

  it('fails when a publishing source forbids redistribution', () => {
    const report = assess('probe', 'DRAFT', [withRights({ redistribution_allowed: false })]);
    expect(report.legacyCommercialInventory.everyPublishingSourcePermitsRedistribution).toBe(false);
  });

  it('fails when attribution is required but no text was recorded', () => {
    const report = assess('probe', 'DRAFT', [
      withRights({ attribution: { required: true, text: null } }),
    ]);
    expect(report.legacyCommercialInventory.attributionObligationsRecorded).toBe(false);
  });

  it('passes attribution when none is required', () => {
    const report = assess('probe', 'DRAFT', [
      withRights({ attribution: { required: false, text: null } }),
    ]);
    expect(report.legacyCommercialInventory.attributionObligationsRecorded).toBe(true);
  });

  it('fails when images are claimed reusable with no image policy governing them', () => {
    const raw = withRights({ images_reusable: true }) as Record<string, unknown>;
    delete raw['image_policy'];
    const report = assess('probe', 'DRAFT', [raw]);
    expect(report.legacyCommercialInventory.imageRightsSettledSeparately).toBe(false);
  });

  it('does not require an image policy from a source that publishes no images', () => {
    const raw = source() as Record<string, unknown>;
    delete raw['image_policy'];
    expect(assess('probe', 'DRAFT', [raw]).legacyCommercialInventory.imageRightsSettledSeparately)
      .toBe(true);
  });
});

describe('real-source blockers', () => {
  it('names the synthetic-only state, which is where the project actually is', () => {
    const report = assess('probe', 'DRAFT', [
      source({ domain: 'catalog.acme.example.com' }),
    ]);
    expect(report.realSourceCount).toBe(0);
    expect(report.syntheticSourceCount).toBe(1);
    expect(report.blockers.join(' ')).toMatch(/every source is synthetic/);
  });

  it('refuses to call a real source reviewed when its acquisition is unapproved', () => {
    const report = assess('probe', 'DRAFT', [source({ acquisition_policy: { approved: false } })]);
    expect(report.legacyHasRealRightsReviewedSource).toBe(false);
    expect(report.blockers.join(' ')).toMatch(/no real source has a current, named rights review/);
  });

  it('blocks a publishing source that does not retain its raw artifacts', () => {
    const report = assess('probe', 'DRAFT', [
      source({ provenance_retention: { retain_artifacts: false } }),
    ]);
    expect(report.blockers.join(' ')).toMatch(/retaining its raw artifacts/);
  });

  it('blocks a source declaring personal data until someone decides how to handle it', () => {
    const report = assess('probe', 'DRAFT', [withRights({ personal_data_present: true })]);
    expect(report.blockers.join(' ')).toMatch(/personal data/);
  });

  it('calls out a vertical that left DRAFT with blockers outstanding', () => {
    const report = assess('probe', 'ACTIVE', [source({ domain: 'x.example.com' })]);
    expect(report.blockers.join(' ')).toMatch(/status: ACTIVE while the conditions above are unmet/);
  });

  it('a kill-switched source is not treated as publishing', () => {
    const report = assess('probe', 'DRAFT', [
      { ...withRights({ commercial_use_allowed: false }), kill_switch_engaged: true },
    ]);
    expect(report.legacyCommercialInventory.everyPublishingSourcePermitsCommercialUse).toBe(true);
  });
});

describe('the shipped vertical, read from its real declarations', () => {
  it('reports hvac as not ready, because every one of its sources is synthetic', async () => {
    const report = await readVertical(join(VERTICALS_DIR, 'hvac'), 'hvac');
    expect(report.status).toBe('DRAFT');
    expect(report.realSourceCount).toBe(0);
    expect(report.syntheticSourceCount).toBe(4);
    expect(report.legacyHasRealRightsReviewedSource).toBe(false);
    expect(report.blockers.length).toBeGreaterThan(0);
  });

  it('still shows its rights machinery passing, which is the thing that IS proven', async () => {
    const report = await readVertical(join(VERTICALS_DIR, 'hvac'), 'hvac');
    expect(Object.values(report.legacyCommercialInventory).every(Boolean)).toBe(true);
  });
});

/**
 * Three ways the verdict could say READY while the report below it said no.
 *
 * A readiness report exists to be believed at a glance. The headline is the
 * only line most people read, so a headline that disagrees with the detail
 * under it is worse than no headline — it converts a careful report into a
 * confident wrong answer.
 */
describe('the verdict cannot contradict the report underneath it', () => {
  it('is not READY while a commercial condition is failing', () => {
    const report = assess('probe', 'DRAFT', [
      withRights({ derivative_normalization_allowed: false }),
    ]);
    expect(Object.values(report.legacyCommercialInventory).every(Boolean)).toBe(false);
    // The headline is computed from `blockers`, so a failing gate has to reach
    // it or the two halves of the report disagree.
    expect(report.blockers.length).toBeGreaterThan(0);
    expect(report.blockers.join(' ')).toMatch(/derivative|commercial|publication/i);
  });

  it('is not READY on a lone reviewed RED source, which may never publish', () => {
    // RED is reviewed, so it satisfies "someone looked at it". It is also
    // excluded from the publishing set, so every commercial condition passes
    // with nothing to check. Vacuous truth is the most dangerous kind of green.
    const report = assess('probe', 'DRAFT', [source({ rights_classification: 'RED' })]);
    expect(report.blockers.length).toBeGreaterThan(0);
    expect(report.blockers.join(' ')).toMatch(/publish/i);
  });

  it('is still READY when a real source genuinely may publish', () => {
    expect(assess('probe', 'ACTIVE', [source()]).blockers).toEqual([]);
  });

  it('renders NOT_READY overall when seven-surface rights pass but a hard stop fails', () => {
    const renderReport = (readinessModule as Record<string, unknown>)[
      'renderReadinessReport'
    ];
    expect(typeof renderReport).toBe('function');
    if (typeof renderReport !== 'function') return;

    const baseline = assess('probe', 'ACTIVE', [
      source({ provenance_retention: { retain_artifacts: false } }),
    ]);
    const ready = { status: 'READY' as const, missing: [] };
    const readySurfaces = {
      PUBLIC_WEB: ready,
      SEARCH_INDEX: ready,
      API_FREE: ready,
      API_PAID: ready,
      RAPIDAPI: ready,
      MCP: ready,
      BULK_EXPORT: ready,
    } satisfies VerticalReadiness['sources'][number]['surfaces'];
    const sources = baseline.sources.map((declaredSource) => ({
      ...declaredSource,
      surfaces: readySurfaces,
    }));
    const revenueReadiness = aggregateRevenueReadiness(sources);
    expect(revenueReadiness.status).toBe('READY');
    expect(baseline.blockers).not.toEqual([]);

    const headline = (
      renderReport as (report: VerticalReadiness) => string
    )({
      ...baseline,
      sources,
      revenueReadiness,
      ready: false,
    }).split('\n')[0];
    expect(headline).toBe(
      'probe — NOT_READY overall (seven-surface revenue readiness: READY; vertical status: ACTIVE)',
    );
  });
});

describe('a rights review has to be current and attributable', () => {
  it('rejects a review with no named reviewer', () => {
    const report = assess('probe', 'DRAFT', [withRights({ reviewed_by: null })]);
    expect(report.legacyHasRealRightsReviewedSource).toBe(false);
  });

  it('rejects a review whose next_review_at has already passed', () => {
    const report = assess(
      'probe',
      'DRAFT',
      [withRights({ reviewed_by: 'A. Reviewer', next_review_at: '2020-01-01' })],
      '2026-08-21T00:00:00.000Z',
    );
    expect(report.legacyHasRealRightsReviewedSource).toBe(false);
    expect(report.blockers.join(' ')).toMatch(/rights review/i);
  });

  it('accepts a named review that has not lapsed', () => {
    const report = assess(
      'probe',
      'DRAFT',
      [withRights({ reviewed_by: 'A. Reviewer', next_review_at: '2027-08-01' })],
      '2026-08-21T00:00:00.000Z',
    );
    expect(report.legacyHasRealRightsReviewedSource).toBe(true);
  });

  it('accepts a named review with no expiry set', () => {
    const report = assess('probe', 'DRAFT', [
      withRights({ reviewed_by: 'A. Reviewer', next_review_at: null }),
    ]);
    expect(report.legacyHasRealRightsReviewedSource).toBe(true);
  });
});

/**
 * A domain is the identity this report is built on: it decides real vs
 * synthetic, and distinct domains are what "independent publishers" counts. A
 * value that is missing, or spelled two ways, corrupts both answers at once.
 */
describe('the domain a source is identified by is normalized first', () => {
  it('orders source output by code unit rather than input, filesystem, or locale order', () => {
    const report = assess('probe', 'DRAFT', [
      { ...source(), key: 'z-source' },
      { ...source(), key: 'A-source' },
      { ...source(), key: 'a-source' },
    ]);
    expect(report.sources.map(({ key }) => key)).toEqual(['A-source', 'a-source', 'z-source']);
  });

  it('does not count a source with no domain as a real publisher', () => {
    // `isReservedDomain('')` is false — correctly, an absent domain is unknown
    // rather than reserved — so "not reserved therefore real" turned a missing
    // field into evidence that a real publisher exists.
    const raw = source() as Record<string, unknown>;
    delete raw['domain'];
    const report = assess('probe', 'DRAFT', [raw]);
    expect(report.realSourceCount).toBe(0);
    expect(report.sources[0]!.real).toBe(false);
  });

  it('does not count a blank domain as a real publisher', () => {
    expect(assess('probe', 'DRAFT', [source({ domain: '   ' })]).realSourceCount).toBe(0);
  });

  it('counts two spellings of one publisher once', () => {
    const report = assess('probe', 'DRAFT', [
      { ...source({ domain: 'acme-climate.com' }), key: 'a' },
      { ...source({ domain: 'ACME-CLIMATE.COM.' }), key: 'b' },
    ]);
    expect(report.realSourceCount).toBe(2);
    expect(
      report.realPublisherCount,
      'case and a trailing root label do not make two organisations',
    ).toBe(1);
  });

  it('still counts genuinely different publishers separately', () => {
    const report = assess('probe', 'DRAFT', [
      { ...source({ domain: 'acme-climate.com' }), key: 'a' },
      { ...source({ domain: 'borealis-hvac.com' }), key: 'b' },
    ]);
    expect(report.realPublisherCount).toBe(2);
  });
});

/**
 * Two ways the fix for vacuous green was itself vacuous.
 */
describe('the no-publishable-source blocker counts only real sources', () => {
  it('fires when the only real source is RED and a synthetic one is publishable', () => {
    // `live` counted synthetic sources, so a publishable fixture satisfied the
    // check on behalf of a real source that may never publish. The fixtures
    // standing in for the thing being measured is the whole failure this tool
    // exists to name.
    const report = assess('probe', 'DRAFT', [
      { ...source({ rights_classification: 'RED' }), key: 'real-red' },
      { ...source({ domain: 'catalog.acme.example.com' }), key: 'synthetic-green' },
    ]);
    expect(report.realSourceCount).toBe(1);
    expect(report.blockers.join(' ')).toMatch(/no real source is cleared to publish/i);
  });

  it('does not fire when a real source genuinely may publish', () => {
    const report = assess('probe', 'ACTIVE', [
      { ...source(), key: 'real-green' },
      { ...source({ domain: 'catalog.acme.example.com' }), key: 'synthetic-green' },
    ]);
    expect(report.blockers).toEqual([]);
  });
});

describe('review expiry is measured against the run, not against a date in the source', () => {
  it('expires a review that lapsed before the moment being asked about', () => {
    const lapsed = [withRights({ next_review_at: '2026-09-01' })];
    // Current at the start of August...
    expect(assess('probe', 'DRAFT', lapsed, '2026-08-01T00:00:00.000Z').legacyHasRealRightsReviewedSource)
      .toBe(true);
    // ...and lapsed by December. A fixed default would answer the same for both.
    expect(assess('probe', 'DRAFT', lapsed, '2026-12-01T00:00:00.000Z').legacyHasRealRightsReviewedSource)
      .toBe(false);
  });

  it('has no default clock baked into the module', async () => {
    // A hardcoded `asOf` looks right on the day it is written and is wrong
    // forever after, silently. The signature must require one.
    const src = await import('node:fs/promises').then((fs) =>
      fs.readFile(new URL('../scripts/source-readiness.ts', import.meta.url), 'utf8'),
    );
    expect(src).not.toMatch(/asOf\s*=\s*['"]20\d\d-/);
  });
});
