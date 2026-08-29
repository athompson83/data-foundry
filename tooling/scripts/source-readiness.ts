/**
 * Phase 2 real-source readiness report.
 *
 * The HVAC vertical proves the factory runs. It does not prove the factory
 * works on data anyone actually publishes, because every one of its sources is
 * synthetic — fictional publishers on RFC 2606 reserved domains, authored by us.
 * A rights gate that passes on our own fixtures tells us the gate executes; it
 * says nothing about whether a real publisher's terms permit what we intend.
 *
 * That distinction is easy to lose. A green `verticals:validate` and a green
 * test suite both report success, and neither is a statement about real data.
 * This report exists so the difference is visible on demand rather than
 * remembered, and so "are we ready to publish commercially?" has a mechanical
 * answer instead of an optimistic one.
 *
 * It reads the same declarations the platform reads and asks the canonical
 * rights engine each exact surface bundle. Database access is optional and
 * explicit; otherwise a validated offline snapshot may qualify results. With
 * neither, all surface results are UNKNOWN.
 *
 *   pnpm sources:readiness -- --as-of 2026-08-28T12:00:00.000Z
 *   pnpm sources:readiness -- --as-of ... --database-env DATA_FOUNDRY_DATABASE_URL hvac
 *   pnpm sources:readiness -- --as-of ... --rights-snapshot rights-snapshot.json --json hvac
 *
 * Exit code is 0 whether or not a valid report is ready. Missing clocks,
 * malformed/tampered snapshots, unsafe credential arguments, and database
 * failures are input/evidence errors and exit non-zero.
 */
import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import { rightsReviewIsCurrent } from '@data-foundry/source-registry';
import {
  createPostgresDriver,
  loadStoredRightsContext,
  type SqlDriver,
} from '@data-foundry/canonical-store';
import {
  authorizeSurface,
  RIGHTS_ACQUISITION_ROUTES,
  RightsDecisionCandidateSchema,
  RightsDenyExceptionSchema,
  RightsSnapshotSchema,
  RightsSourceGuardSchema,
  rightsRequirementsForSurface,
  type RightsAcquisitionRoute,
  type RightsChannel,
  type RightsOperation,
  type RightsSnapshot,
  type RightsSourceGuard,
  type RightsSurface,
} from '@data-foundry/rights-engine';
import { VERTICALS_DIR } from '../validators/validate-verticals.js';
import { isMain } from '../lib/cli-entry.js';

/**
 * Names reserved by RFC 2606 and RFC 6761 for documentation and testing. A
 * source on one of these cannot be a real publisher: they are reserved
 * precisely so that they never resolve to anyone.
 */

/** Reserved top-level labels. Everything beneath them is reserved too. */
const RESERVED_TLDS = ['example', 'test', 'invalid', 'localhost'] as const;

/** Reserved second-level names, which sit under ordinary top-level domains. */
const RESERVED_NAMES = ['example.com', 'example.org', 'example.net'] as const;

/** Revenue/publication surfaces that must be decided independently. */
export const READINESS_SURFACES = [
  'PUBLIC_WEB',
  'SEARCH_INDEX',
  'API_FREE',
  'API_PAID',
  'RAPIDAPI',
  'MCP',
  'BULK_EXPORT',
] as const satisfies readonly RightsSurface[];

export interface MissingSurfaceRequirement {
  readonly id: string;
  readonly operation: RightsOperation;
  readonly channel: RightsChannel;
  readonly reasonCode: string;
}

export interface SurfaceReadiness {
  readonly status: 'READY' | 'NOT_READY' | 'UNKNOWN';
  readonly missing: readonly MissingSurfaceRequirement[];
  readonly blockingReasons?: readonly string[];
}

export type SourceSurfaceReadiness = Readonly<Record<(typeof READINESS_SURFACES)[number], SurfaceReadiness>>;

function unknownSurfaceReadiness(): SourceSurfaceReadiness {
  return Object.fromEntries(
    READINESS_SURFACES.map((surface) => [
      surface,
      {
        status: 'UNKNOWN' as const,
        missing: rightsRequirementsForSurface(surface).map((entry) => ({
          ...entry,
          reasonCode: 'NO_EVIDENCE',
        })),
      },
    ]),
  ) as unknown as SourceSurfaceReadiness;
}

export interface ReadinessRightsContext {
  readonly source: RightsSourceGuard;
  readonly snapshot: RightsSnapshot;
}

export interface SourceRightsEvaluationInput {
  readonly sourceKey: string;
  readonly acquisitionRoute: RightsAcquisitionRoute | null;
  readonly accountOrProductPlan: string | null;
  readonly jurisdiction: string | null;
  readonly asOf: string;
  readonly context: ReadinessRightsContext | null;
}

/**
 * Ask the canonical rights engine the same seven independent questions for one
 * source-wide normalized-data contribution. A field-scoped grant cannot satisfy
 * this deliberately conservative whole-source readiness probe.
 */
export function evaluateSourceSurfaceReadiness(
  input: SourceRightsEvaluationInput,
): SourceSurfaceReadiness {
  if (input.context === null) return unknownSurfaceReadiness();
  // Preserve the null check across the surface-map callback. TypeScript does
  // not retain dotted-property narrowing when a closure can observe mutation.
  const context = input.context;

  return Object.fromEntries(
    READINESS_SURFACES.map((surface) => {
      const result = authorizeSurface(surface, [
        {
          contributionId: input.sourceKey,
          request: {
            source: context.source,
            sourceStatusRequirement: 'ACTIVE',
            acquisitionRoute: input.acquisitionRoute,
            accountOrProductPlan: input.accountOrProductPlan,
            jurisdiction: input.jurisdiction,
            assetClass: 'DATA',
            fieldKey: null,
            fieldGroupIds: [],
            outputClass: 'NORMALIZED_FACT',
            asOf: input.asOf,
            conditionReceipts: [],
          },
          snapshot: context.snapshot,
        },
      ]);
      return [
        surface,
        {
          status: result.permitted ? ('READY' as const) : ('NOT_READY' as const),
          missing: result.decisions
            .filter((entry) => !entry.decision.permitted)
            .map((entry) => ({
              id: entry.requirementId.slice(`${surface}:`.length),
              operation: entry.operation,
              channel: entry.channel,
              reasonCode: entry.decision.reasonCode,
            })),
        },
      ];
    }),
  ) as unknown as SourceSurfaceReadiness;
}

export const READINESS_SNAPSHOT_SCHEMA_VERSION = 1 as const;
export const READINESS_SNAPSHOT_CANONICALIZATION = 'DATA_FOUNDRY_CODE_UNIT_JSON_V1' as const;

const nonempty = z.string().trim().min(1);
const canonicalUtcInstant = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
  .refine((value) => {
    const parsed = new Date(value);
    return !Number.isNaN(parsed.valueOf()) && parsed.toISOString() === value;
  }, 'must be a canonical UTC instant with millisecond precision');

const sourcePublisherMappingSchema = z
  .object({ sourceId: nonempty, publisherId: nonempty })
  .strict();
const fieldGroupMappingSchema = z
  .object({ fieldGroupId: nonempty, fieldKeys: z.array(nonempty) })
  .strict();

const snapshotContextWireSchema = z
  .object({
    source: RightsSourceGuardSchema,
    snapshot: z
      .object({
        candidates: z.array(RightsDecisionCandidateSchema),
        denyExceptions: z.array(RightsDenyExceptionSchema),
        sourcePublisherIds: z.array(sourcePublisherMappingSchema),
        fieldGroupMembers: z.array(fieldGroupMappingSchema),
      })
      .strict(),
  })
  .strict();

const snapshotSourceWireSchema = z
  .object({
    verticalSlug: nonempty,
    sourceKey: nonempty,
    domain: nonempty,
    sourceType: nonempty,
    acquisitionRoute: z.enum(RIGHTS_ACQUISITION_ROUTES).nullable(),
    accountOrProductPlan: nonempty.nullable(),
    jurisdiction: nonempty.nullable(),
    context: snapshotContextWireSchema,
  })
  .strict();

const snapshotPayloadSchema = z
  .object({
    schemaVersion: z.literal(READINESS_SNAPSHOT_SCHEMA_VERSION),
    generatedAt: canonicalUtcInstant,
    asOf: canonicalUtcInstant,
    provenance: nonempty,
    canonicalization: z.literal(READINESS_SNAPSHOT_CANONICALIZATION),
    sources: z.array(snapshotSourceWireSchema),
  })
  .strict();

export const RightsEvidenceSnapshotSchema = snapshotPayloadSchema
  .extend({ canonicalDigest: z.string().regex(/^[0-9a-f]{64}$/) })
  .strict();

export function serializeRightsEvidenceSnapshotJsonSchema(): string {
  const document = z.toJSONSchema(RightsEvidenceSnapshotSchema, {
    target: 'draft-2020-12',
  }) as Record<string, unknown>;
  return `${JSON.stringify(
    {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      $id: 'https://schemas.data-foundry.dev/source-readiness/snapshot-v1.schema.json',
      title: 'Data Foundry rights-backed source-readiness snapshot v1',
      description:
        'Offline, as-of-qualified rights evidence. The canonical SHA-256 digest proves integrity, not authority or live-current status.',
      ...document,
    },
    null,
    2,
  )}\n`;
}

type RightsEvidenceSnapshotWire = z.infer<typeof RightsEvidenceSnapshotSchema>;
type RightsEvidenceSnapshotPayload = z.infer<typeof snapshotPayloadSchema>;

export interface RightsEvidenceSnapshotSourceInput {
  readonly verticalSlug: string;
  readonly sourceKey: string;
  readonly domain: string;
  readonly sourceType: string;
  readonly acquisitionRoute: RightsAcquisitionRoute | null;
  readonly accountOrProductPlan: string | null;
  readonly jurisdiction: string | null;
  readonly context: ReadinessRightsContext;
}

export interface CreateRightsEvidenceSnapshotInput {
  readonly generatedAt: string;
  readonly asOf: string;
  readonly provenance: string;
  readonly sources: readonly RightsEvidenceSnapshotSourceInput[];
}

export interface ParsedRightsEvidenceSnapshot
  extends Omit<RightsEvidenceSnapshotWire, 'sources'> {
  readonly sources: readonly RightsEvidenceSnapshotSourceInput[];
}

/** Locale-independent ordering used in reports, artifacts, and digest inputs. */
export function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function canonicalJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJsonValue);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => compareCodeUnits(left, right))
        .map(([key, entry]) => [key, canonicalJsonValue(entry)]),
    );
  }
  return value;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalJsonValue(value));
}

function digestSnapshotPayload(payload: RightsEvidenceSnapshotPayload): string {
  return createHash('sha256').update(canonicalJson(payload), 'utf8').digest('hex');
}

function contextToWire(context: ReadinessRightsContext): z.infer<typeof snapshotContextWireSchema> {
  const source = RightsSourceGuardSchema.parse(context.source);
  const snapshot = RightsSnapshotSchema.parse(context.snapshot);
  return {
    source,
    snapshot: {
      candidates: [...snapshot.candidates].sort((left, right) =>
        compareCodeUnits(
          `${left.cell.id}\u0000${left.decision.id}`,
          `${right.cell.id}\u0000${right.decision.id}`,
        ),
      ),
      denyExceptions: [...snapshot.denyExceptions].sort((left, right) =>
        compareCodeUnits(left.id, right.id),
      ),
      sourcePublisherIds: [...(snapshot.sourcePublisherIds ?? new Map()).entries()]
        .sort(([left], [right]) => compareCodeUnits(left, right))
        .map(([sourceId, publisherId]) => ({ sourceId, publisherId })),
      fieldGroupMembers: [...(snapshot.fieldGroupMembers ?? new Map()).entries()]
        .sort(([left], [right]) => compareCodeUnits(left, right))
        .map(([fieldGroupId, fieldKeys]) => ({
          fieldGroupId,
          fieldKeys: [...fieldKeys].sort(compareCodeUnits),
        })),
    },
  };
}

function contextFromWire(
  context: z.infer<typeof snapshotContextWireSchema>,
): ReadinessRightsContext {
  return {
    source: context.source,
    snapshot: {
      candidates: context.snapshot.candidates,
      denyExceptions: context.snapshot.denyExceptions,
      sourcePublisherIds: new Map(
        context.snapshot.sourcePublisherIds.map(({ sourceId, publisherId }) => [
          sourceId,
          publisherId,
        ]),
      ),
      fieldGroupMembers: new Map(
        context.snapshot.fieldGroupMembers.map(({ fieldGroupId, fieldKeys }) => [
          fieldGroupId,
          fieldKeys,
        ]),
      ),
    },
  };
}

export function createRightsEvidenceSnapshot(
  input: CreateRightsEvidenceSnapshotInput,
): RightsEvidenceSnapshotWire {
  const payload = snapshotPayloadSchema.parse({
    schemaVersion: READINESS_SNAPSHOT_SCHEMA_VERSION,
    generatedAt: input.generatedAt,
    asOf: input.asOf,
    provenance: input.provenance,
    canonicalization: READINESS_SNAPSHOT_CANONICALIZATION,
    sources: [...input.sources]
      .sort((left, right) =>
        compareCodeUnits(
          `${left.verticalSlug}\u0000${left.sourceKey}`,
          `${right.verticalSlug}\u0000${right.sourceKey}`,
        ),
      )
      .map((source) => ({
        verticalSlug: source.verticalSlug,
        sourceKey: source.sourceKey,
        domain: normalizeDomain(source.domain),
        sourceType: source.sourceType,
        acquisitionRoute: source.acquisitionRoute,
        accountOrProductPlan: source.accountOrProductPlan,
        jurisdiction: source.jurisdiction,
        context: contextToWire(source.context),
      })),
  });
  if (new Date(payload.generatedAt).valueOf() < new Date(payload.asOf).valueOf()) {
    throw new Error('snapshot generatedAt cannot precede its asOf instant');
  }
  const duplicateKeys = payload.sources
    .map((source) => `${source.verticalSlug}\u0000${source.sourceKey}`)
    .filter((key, index, keys) => index > 0 && key === keys[index - 1]);
  if (duplicateKeys.length > 0) throw new Error('snapshot source keys must be unique');
  const wire = RightsEvidenceSnapshotSchema.parse({
    ...payload,
    canonicalDigest: digestSnapshotPayload(payload),
  });
  // Apply the same canonical-order and duplicate checks used at the trust
  // boundary so the generator cannot emit an artifact its reader refuses.
  parseRightsEvidenceSnapshot(wire, input.asOf);
  return wire;
}

/**
 * Validate a portable snapshot before it can influence any surface result.
 * The SHA-256 digest proves byte-model integrity, not legal authority or
 * freshness; callers retain the SNAPSHOT evidence label in all output.
 */
export function parseRightsEvidenceSnapshot(
  value: unknown,
  expectedAsOf: string,
): ParsedRightsEvidenceSnapshot {
  const parsed = RightsEvidenceSnapshotSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(`invalid rights evidence snapshot schema: ${z.prettifyError(parsed.error)}`);
  }
  const { canonicalDigest, ...payload } = parsed.data;
  const expectedDigest = digestSnapshotPayload(payload);
  if (canonicalDigest !== expectedDigest) {
    throw new Error('rights evidence snapshot canonical digest does not match its payload');
  }
  if (parsed.data.asOf !== expectedAsOf) {
    throw new Error(
      `rights evidence snapshot as-of does not match the requested --as-of instant`,
    );
  }
  if (new Date(parsed.data.generatedAt).valueOf() < new Date(parsed.data.asOf).valueOf()) {
    throw new Error('rights evidence snapshot generatedAt cannot precede its asOf instant');
  }
  const requireStrictOrder = (values: readonly string[], label: string): void => {
    for (let index = 1; index < values.length; index += 1) {
      if (compareCodeUnits(values[index - 1]!, values[index]!) >= 0) {
        throw new Error(
          `rights evidence snapshot ${label} is not in canonical code-unit order or contains duplicates`,
        );
      }
    }
  };
  requireStrictOrder(
    parsed.data.sources.map((source) => `${source.verticalSlug}\u0000${source.sourceKey}`),
    'sources',
  );
  for (const source of parsed.data.sources) {
    requireStrictOrder(
      source.context.snapshot.candidates.map(
        (candidate) => `${candidate.cell.id}\u0000${candidate.decision.id}`,
      ),
      `${source.sourceKey} candidates`,
    );
    requireStrictOrder(
      source.context.snapshot.denyExceptions.map((exception) => exception.id),
      `${source.sourceKey} deny exceptions`,
    );
    requireStrictOrder(
      source.context.snapshot.sourcePublisherIds.map((mapping) => mapping.sourceId),
      `${source.sourceKey} publisher mappings`,
    );
    requireStrictOrder(
      source.context.snapshot.fieldGroupMembers.map((mapping) => mapping.fieldGroupId),
      `${source.sourceKey} field groups`,
    );
    for (const group of source.context.snapshot.fieldGroupMembers) {
      requireStrictOrder(group.fieldKeys, `${source.sourceKey}/${group.fieldGroupId} field keys`);
    }
  }
  return {
    ...parsed.data,
    sources: parsed.data.sources.map((source) => ({
      ...source,
      context: contextFromWire(source.context),
    })),
  };
}

export function createSnapshotRightsEvidenceResolver(
  snapshot: ParsedRightsEvidenceSnapshot,
): RightsEvidenceResolver {
  const sources = new Map(
    snapshot.sources.map((source) => [`${source.verticalSlug}\u0000${source.sourceKey}`, source]),
  );
  return {
    descriptor: {
      kind: 'SNAPSHOT',
      qualification: 'SNAPSHOT_BACKED',
      schemaVersion: snapshot.schemaVersion,
      generatedAt: snapshot.generatedAt,
      asOf: snapshot.asOf,
      provenance: snapshot.provenance,
      canonicalDigest: snapshot.canonicalDigest,
    },
    async contextFor(verticalSlug, source) {
      const stored = sources.get(`${verticalSlug}\u0000${source.key}`);
      if (stored === undefined) return null;
      const matches =
        normalizeDomain(stored.domain) === source.domain &&
        stored.sourceType === source.sourceType &&
        stored.acquisitionRoute === source.acquisitionRoute &&
        stored.accountOrProductPlan === source.accountOrProductPlan &&
        stored.jurisdiction === source.jurisdiction;
      if (!matches) {
        throw new Error(
          `rights evidence snapshot metadata does not match current source declaration ${verticalSlug}/${source.key}`,
        );
      }
      return stored.context;
    },
  };
}

/**
 * One spelling per host.
 *
 * `example.com.` is the same name as `example.com` — the trailing dot is the
 * root label written out — and DNS names are case-insensitive. The domain is
 * this report's identity for a source, deciding real-vs-synthetic and how many
 * distinct publishers there are, so both questions have to be asked of one
 * canonical form.
 */
export const normalizeDomain = (domain: string): string =>
  domain.trim().toLowerCase().replace(/\.$/, '');

/** Whether a domain is reserved, and therefore cannot name a real publisher. */
export function isReservedDomain(domain: string): boolean {
  const host = normalizeDomain(domain);
  if (host === '') return false;
  // A reserved name and everything under it, asked as one question. Splitting
  // it into an exact list and a suffix list left the apex forms in neither:
  // `test` is the reserved TLD itself, and does not end with `.test`. That gap
  // is not hypothetical either — `test.` normalizes straight into it.
  const under = (name: string): boolean => host === name || host.endsWith(`.${name}`);
  return RESERVED_TLDS.some(under) || RESERVED_NAMES.some(under);
}

/** What a single source declaration says about its own rights posture. */
export interface SourceReadiness {
  readonly key: string;
  readonly domain: string;
  readonly sourceType: string;
  readonly acquisitionRoute: RightsAcquisitionRoute | null;
  readonly accountOrProductPlan: string | null;
  readonly jurisdiction: string | null;
  /** False when the domain is reserved — a synthetic fixture, not a publisher. */
  readonly real: boolean;
  readonly rightsClassification: string;
  readonly status: string;
  /** Every commercial permission the declaration grants, or withholds. */
  readonly commercialUseAllowed: boolean;
  readonly redistributionAllowed: boolean;
  readonly derivativeNormalizationAllowed: boolean;
  readonly imagesReusable: boolean;
  readonly attributionRequired: boolean;
  /** The text that will be displayed. A required attribution with none is unmeetable. */
  readonly attributionText: string | null;
  readonly personalDataPresent: boolean;
  readonly reviewedAt: string | null;
  /** Who did the review. An unattributable review is not a review. */
  readonly reviewedBy: string | null;
  readonly nextReviewAt: string | null;
  readonly acquisitionApproved: boolean;
  readonly retainsArtifacts: boolean;
  readonly killSwitchEngaged: boolean;
  /** Whether `image_policy` exists to govern the images the rights block permits. */
  readonly imagePolicyDeclared: boolean;
  /** Exact rights bundles. Legacy declaration booleans above are inventory metadata only. */
  readonly surfaces: SourceSurfaceReadiness;
  readonly lifecycleDecision: 'REGISTRY' | 'DEFERRED';
  readonly governanceBlockers: readonly string[];
}

/** The conditions `DATA_RIGHTS.md` requires before a dataset is sold. */
export interface LegacyCommercialInventory {
  readonly noUnreviewedSources: boolean;
  readonly everyPublishingSourcePermitsCommercialUse: boolean;
  readonly everyPublishingSourcePermitsRedistribution: boolean;
  readonly everyPublishingSourcePermitsDerivativeNormalization: boolean;
  readonly attributionObligationsRecorded: boolean;
  readonly imageRightsSettledSeparately: boolean;
}

export interface VerticalReadiness {
  readonly slug: string;
  readonly status: string;
  readonly sources: readonly SourceReadiness[];
  readonly realSourceCount: number;
  readonly syntheticSourceCount: number;
  /** Distinct publishers among REAL sources — the independence signal. */
  readonly realPublisherCount: number;
  /** Historical declaration signals only; these never decide revenue readiness. */
  readonly legacyCommercialInventory: LegacyCommercialInventory;
  /** Historical declaration review signal only; canonical grants remain required. */
  readonly legacyHasRealRightsReviewedSource: boolean;
  readonly blockers: readonly string[];
  /** No declaration boolean is treated as rights evidence. */
  readonly rightsEvidence: RightsEvidenceDescriptor;
  readonly revenueReadiness: VerticalRevenueReadiness;
  readonly ready: boolean;
}

export interface VerticalRevenueReadiness {
  readonly scope: 'SOURCE_WIDE_DATA_NORMALIZED_FACT';
  readonly status: 'READY' | 'NOT_READY' | 'UNKNOWN';
  readonly surfaces: Readonly<
    Record<(typeof READINESS_SURFACES)[number], 'READY' | 'NOT_READY' | 'UNKNOWN'>
  >;
}

export function aggregateRevenueReadiness(
  sources: readonly SourceReadiness[],
): VerticalRevenueReadiness {
  // Synthetic fixtures, inactive declarations, kill-switched sources and
  // explicitly deferred review candidates are not revenue contributions. A
  // missing DB row for any of those must not contaminate an otherwise ready
  // real source. GREEN/AMBER is only an additional hard stop here; it never
  // substitutes for the exact canonical grants evaluated below.
  const candidates = sources.filter(
    (source) =>
      source.real &&
      source.status === 'ACTIVE' &&
      !source.killSwitchEngaged &&
      source.lifecycleDecision === 'REGISTRY' &&
      (source.rightsClassification === 'GREEN' || source.rightsClassification === 'AMBER'),
  );
  const surfaces = Object.fromEntries(
    READINESS_SURFACES.map((surface) => {
      const sourceStatuses = candidates.map((source) => source.surfaces[surface].status);
      const status =
        sourceStatuses.length === 0 || sourceStatuses.includes('UNKNOWN')
          ? 'UNKNOWN'
          : sourceStatuses.includes('NOT_READY')
            ? 'NOT_READY'
            : 'READY';
      return [surface, status];
    }),
  ) as VerticalRevenueReadiness['surfaces'];
  const statuses = READINESS_SURFACES.map((surface) => surfaces[surface]);
  return {
    scope: 'SOURCE_WIDE_DATA_NORMALIZED_FACT',
    status: statuses.includes('UNKNOWN')
      ? 'UNKNOWN'
      : statuses.includes('NOT_READY')
        ? 'NOT_READY'
        : 'READY',
    surfaces,
  };
}

export type RightsEvidenceDescriptor =
  | { readonly kind: 'NONE' }
  | {
      readonly kind: 'SNAPSHOT';
      readonly qualification: 'SNAPSHOT_BACKED';
      readonly schemaVersion: typeof READINESS_SNAPSHOT_SCHEMA_VERSION;
      readonly generatedAt: string;
      readonly asOf: string;
      readonly provenance: string;
      readonly canonicalDigest: string;
    }
  | {
      readonly kind: 'LIVE_DATABASE';
      readonly qualification: 'LIVE_AS_OF';
      readonly credentialEnv: string;
      readonly asOf: string;
    };

export interface RightsEvidenceResolver {
  readonly descriptor: RightsEvidenceDescriptor;
  contextFor(
    verticalSlug: string,
    source: SourceReadiness,
  ): Promise<ReadinessRightsContext | null>;
}

export function createLiveDatabaseRightsEvidenceResolver(
  driver: SqlDriver,
  credentialEnv: string,
  asOf: string,
): RightsEvidenceResolver {
  return {
    descriptor: {
      kind: 'LIVE_DATABASE',
      qualification: 'LIVE_AS_OF',
      credentialEnv,
      asOf,
    },
    async contextFor(verticalSlug, source) {
      let rows: Array<Record<string, unknown>>;
      try {
        rows = await driver.query(
          `SELECT source.id
             FROM sources source
             JOIN verticals vertical ON vertical.id = source.vertical_id
            WHERE vertical.slug = $1
              AND lower(source.domain) = lower($2)
              AND source.source_type = $3
            ORDER BY source.id`,
          [verticalSlug, source.domain, source.sourceType],
        );
      } catch {
        throw new Error(`live rights lookup failed through credential env ${credentialEnv}`);
      }
      if (rows.length === 0) return null;
      if (rows.length !== 1 || typeof rows[0]?.['id'] !== 'string') {
        throw new Error(
          `live rights lookup was ambiguous for ${verticalSlug}/${source.key} through credential env ${credentialEnv}`,
        );
      }
      try {
        return await loadStoredRightsContext(driver, rows[0]['id'], asOf);
      } catch {
        throw new Error(`live rights context failed through credential env ${credentialEnv}`);
      }
    },
  };
}

const bool = (value: unknown): boolean => value === true;
const text = (value: unknown): string => (typeof value === 'string' ? value : '');
const nullableText = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() !== '' ? value : null;

const DEFERRED_GOVERNANCE_BLOCKERS = [
  'PUBLISHER_MAPPING_MISSING',
  'TERMS_EVIDENCE_MISSING',
  'NAMED_REVIEWER_MISSING',
  'RIGHTS_ACTIVATION_MISSING',
  'OWNER_DECISION_DEFERRED',
] as const;

function readSource(
  raw: Record<string, unknown>,
  lifecycleDecision: SourceReadiness['lifecycleDecision'] = 'REGISTRY',
): SourceReadiness {
  const rights = (raw['rights_policy'] ?? {}) as Record<string, unknown>;
  const attribution = (rights['attribution'] ?? {}) as Record<string, unknown>;
  const acquisition = (raw['acquisition_policy'] ?? {}) as Record<string, unknown>;
  const retention = (raw['provenance_retention'] ?? {}) as Record<string, unknown>;
  const domain = normalizeDomain(text(raw['domain']));

  return {
    key: text(raw['key']),
    domain,
    sourceType: text(raw['source_type']),
    acquisitionRoute: nullableText(acquisition['method']) as RightsAcquisitionRoute | null,
    accountOrProductPlan: nullableText(acquisition['account_or_product_plan']),
    jurisdiction: nullableText(acquisition['jurisdiction']),
    // An absent domain is unknown, not reserved — `isReservedDomain('')` says so
    // correctly. But "not reserved, therefore real" then turned a missing field
    // into evidence that a real publisher exists. Real requires a domain.
    real: domain !== '' && !isReservedDomain(domain),
    rightsClassification: text(raw['rights_classification']) || 'UNREVIEWED',
    status: text(raw['status']),
    commercialUseAllowed: bool(rights['commercial_use_allowed']),
    redistributionAllowed: bool(rights['redistribution_allowed']),
    derivativeNormalizationAllowed: bool(rights['derivative_normalization_allowed']),
    imagesReusable: bool(rights['images_reusable']),
    attributionRequired: bool(attribution['required']),
    attributionText: nullableText(attribution['text']),
    personalDataPresent: bool(rights['personal_data_present']),
    reviewedAt: nullableText(rights['reviewed_at']),
    reviewedBy: nullableText(rights['reviewed_by']),
    nextReviewAt: nullableText(rights['next_review_at']),
    acquisitionApproved: bool(acquisition['approved']),
    retainsArtifacts: bool(retention['retain_artifacts']),
    killSwitchEngaged: bool(raw['kill_switch_engaged']),
    imagePolicyDeclared:
      typeof raw['image_policy'] === 'object' && raw['image_policy'] !== null,
    surfaces: unknownSurfaceReadiness(),
    lifecycleDecision,
    governanceBlockers:
      lifecycleDecision === 'DEFERRED' ? DEFERRED_GOVERNANCE_BLOCKERS : [],
  };
}

/** Sources whose data may actually reach a published surface. */
const publishing = (sources: readonly SourceReadiness[]): SourceReadiness[] =>
  sources.filter(
    (source) =>
      source.status === 'ACTIVE' &&
      !source.killSwitchEngaged &&
      (source.rightsClassification === 'GREEN' || source.rightsClassification === 'AMBER'),
  );

/**
 * `asOf` is the moment the question is being asked at, and it is required.
 *
 * A default here looks right on the day it is written and is silently wrong
 * every day after: review expiry would be measured against the author's
 * calendar rather than the run's, so a lapsed review would keep reporting as
 * current forever. The caller holds the clock; `main()` reads it once so every
 * vertical in one run is judged at the same instant.
 */
export function assess(
  slug: string,
  status: string,
  raws: readonly Record<string, unknown>[],
  asOf: string,
  deferredSourceKeys: ReadonlySet<string> = new Set(),
) {
  const sources = raws
    .map((raw) =>
      readSource(
        raw,
        deferredSourceKeys.has(text(raw['key'])) ? 'DEFERRED' : 'REGISTRY',
      ),
    )
    .sort((left, right) => compareCodeUnits(left.key, right.key));
  const real = sources.filter((source) => source.real);
  const live = publishing(sources);
  // Everything switched on, whatever its classification. `publishing()` already
  // drops UNREVIEWED, so asking THAT set whether anything is unreviewed can
  // never answer no — the question has to be put to the set that can still
  // contain one.
  const enabled = sources.filter((source) => source.status === 'ACTIVE' && !source.killSwitchEngaged);

  const legacyCommercialInventory: LegacyCommercialInventory = {
    noUnreviewedSources: enabled.every((source) => source.rightsClassification !== 'UNREVIEWED'),
    everyPublishingSourcePermitsCommercialUse: live.every((source) => source.commercialUseAllowed),
    everyPublishingSourcePermitsRedistribution: live.every((source) => source.redistributionAllowed),
    // Condition 2 of DATA_RIGHTS.md asks whether the terms permit "the use being
    // made, including the derivative and redistribution question". Normalizing
    // and deriving IS the use being made — a source that forbids it can be read
    // and cited but not processed, so it cannot be left to a rendered field
    // nobody gates on.
    everyPublishingSourcePermitsDerivativeNormalization: live.every(
      (source) => source.derivativeNormalizationAllowed,
    ),
    // An obligation can only be honoured if it was written down: a source that
    // requires attribution must carry the text a surface will actually display.
    attributionObligationsRecorded: live.every(
      (source) => !source.attributionRequired || source.attributionText !== null,
    ),
    // Rule 9: the right to state a specification is not the right to republish a
    // photograph. A source that claims reusable images must also carry an
    // image_policy that says what may be done with them, so the two cannot
    // disagree silently.
    imageRightsSettledSeparately: live.every(
      (source) => !source.imagesReusable || source.imagePolicyDeclared,
    ),
  };

  // Reuse the platform's own predicate rather than restating it. `publish-gate`
  // already treats a missing reviewer or an elapsed `next_review_at` as
  // RIGHTS_REVIEW_MISSING_OR_LAPSED; a readiness report that accepted either
  // would call a source reviewed that the gate itself refuses.
  const reviewIsCurrent = (source: SourceReadiness): boolean =>
    rightsReviewIsCurrent(
      {
        reviewed_at: source.reviewedAt,
        reviewed_by: source.reviewedBy,
        next_review_at: source.nextReviewAt,
      } as never,
      asOf,
    );

  const legacyHasRealRightsReviewedSource = real.some(
    (source) =>
      reviewIsCurrent(source) &&
      source.rightsClassification !== 'UNREVIEWED' &&
      source.acquisitionApproved,
  );

  const blockers: string[] = [];
  if (real.length === 0) {
    blockers.push(
      'every source is synthetic: the rights machinery has been exercised, but never against ' +
        'terms written by someone else',
    );
  }
  if (!legacyHasRealRightsReviewedSource) {
    blockers.push(
      'no real source has a current, named rights review with an approved acquisition method',
    );
  }
  // The headline verdict is computed from `blockers`. A failing publication
  // condition that never reached this list produced "READY" printed directly
  // above its own FAIL line — a report contradicting itself in six lines.
  for (const [name, passed] of Object.entries(legacyCommercialInventory)) {
    if (!passed) blockers.push(`legacy source inventory signal fails: ${name}`);
  }
  // Every commercial condition passes vacuously when nothing is allowed to
  // publish: a lone reviewed RED source satisfies "someone looked at it" and is
  // then excluded from the set the gates examine. Vacuous green is the most
  // dangerous kind.
  //
  // Asking that of `live` let a synthetic fixture answer on a real source's
  // behalf — one publishable `.example.com` source beside a real RED one and
  // the blocker stayed silent. Fixtures standing in for the thing being
  // measured is the exact failure this whole report exists to make visible.
  if (real.length > 0 && live.filter((source) => source.real).length === 0) {
    blockers.push(
      'no real source is cleared to publish, so every publication condition passes vacuously',
    );
  }
  for (const source of live) {
    if (!source.retainsArtifacts) {
      blockers.push(`${source.key} publishes without retaining its raw artifacts (rule 10)`);
    }
    if (source.personalDataPresent) {
      blockers.push(`${source.key} declares personal data present — needs a handling decision`);
    }
  }
  if (status !== 'DRAFT' && blockers.length > 0) {
    blockers.push(`vertical.yaml says status: ${status} while the conditions above are unmet`);
  }
  for (const source of sources.filter(({ lifecycleDecision }) => lifecycleDecision === 'DEFERRED')) {
    blockers.push(
      `${source.key} remains DEFERRED by the recorded owner decision and cannot be revenue-ready`,
    );
  }

  const revenueReadiness = aggregateRevenueReadiness(sources);
  return {
    slug,
    status,
    sources,
    realSourceCount: real.length,
    syntheticSourceCount: sources.length - real.length,
    realPublisherCount: new Set(real.map((source) => source.domain)).size,
    legacyCommercialInventory,
    legacyHasRealRightsReviewedSource,
    blockers,
    rightsEvidence: { kind: 'NONE' },
    revenueReadiness,
    ready: blockers.length === 0 && revenueReadiness.status === 'READY',
  } satisfies VerticalReadiness;
}

export async function readVertical(
  dir: string,
  slug: string,
  asOf: string,
  evidence?: RightsEvidenceResolver,
  deferredRaws: readonly Record<string, unknown>[] = [],
): Promise<VerticalReadiness> {
  const config = parseYaml(await readFile(join(dir, 'vertical.yaml'), 'utf8')) as Record<
    string,
    unknown
  >;
  const sourcesDir = join(dir, 'sources');
  const files = (await readdir(sourcesDir)).filter(
    (file) => file.endsWith('.yaml') || file.endsWith('.yml'),
  );
  const raws: Record<string, unknown>[] = [];
  for (const file of files.sort()) {
    raws.push(parseYaml(await readFile(join(sourcesDir, file), 'utf8')) as Record<string, unknown>);
  }
  raws.push(...deferredRaws);
  const report = assess(
    slug,
    text(config['status']) || 'UNKNOWN',
    raws,
    asOf,
    new Set(deferredRaws.map((raw) => text(raw['key']))),
  );
  if (evidence === undefined) return report;
  const sources: SourceReadiness[] = [];
  for (const source of report.sources) {
    const context = await evidence.contextFor(slug, source);
    const evaluated = evaluateSourceSurfaceReadiness({
      sourceKey: source.key,
      acquisitionRoute: source.acquisitionRoute,
      accountOrProductPlan: source.accountOrProductPlan,
      jurisdiction: source.jurisdiction,
      asOf,
      context,
    });
    const surfaces =
      source.lifecycleDecision === 'DEFERRED' && context !== null
        ? (Object.fromEntries(
            READINESS_SURFACES.map((surface) => [
              surface,
              {
                ...evaluated[surface],
                status: 'NOT_READY' as const,
                blockingReasons: ['OWNER_DECISION_DEFERRED'],
              },
            ]),
          ) as unknown as SourceSurfaceReadiness)
        : evaluated;
    sources.push({
      ...source,
      surfaces,
    });
  }
  const revenueReadiness = aggregateRevenueReadiness(sources);
  return {
    ...report,
    sources,
    rightsEvidence: evidence.descriptor,
    revenueReadiness,
    ready: report.blockers.length === 0 && revenueReadiness.status === 'READY',
  };
}

function render(report: VerticalReadiness): string {
  const lines: string[] = [];
  lines.push(
    `${report.slug} — ${report.revenueReadiness.status} for seven-surface revenue readiness` +
      ` (vertical status: ${report.status})`,
  );
  lines.push('  evaluation scope: source-wide DATA / NORMALIZED_FACT (field-scoped grants do not substitute)');
  if (report.rightsEvidence.kind === 'NONE') {
    lines.push('  rights evidence: NONE — all seven surface results are UNKNOWN');
  } else if (report.rightsEvidence.kind === 'SNAPSHOT') {
    lines.push(
      `  rights evidence: SNAPSHOT_BACKED as of ${report.rightsEvidence.asOf}` +
        ` — ${report.rightsEvidence.provenance}`,
    );
  } else {
    lines.push(
      `  rights evidence: LIVE_DATABASE as of ${report.rightsEvidence.asOf}` +
        ` — credential env ${report.rightsEvidence.credentialEnv}`,
    );
  }
  lines.push(
    `  sources: ${report.realSourceCount} real / ${report.syntheticSourceCount} synthetic` +
      `, ${report.realPublisherCount} real publisher(s)`,
  );

  for (const source of report.sources) {
    const kind = source.real ? 'real' : 'SYNTHETIC';
    const legacyInventory = [
      source.commercialUseAllowed ? 'commercial-flag' : 'no-commercial-flag',
      source.redistributionAllowed ? 'redistribution-flag' : 'no-redistribution-flag',
      source.derivativeNormalizationAllowed ? 'derivative-flag' : 'no-derivative-flag',
      source.imagesReusable ? 'images-flag' : 'no-images-flag',
    ].join(' · ');
    lines.push(
      `    ${source.key} [${kind}] ${source.rightsClassification}/${source.status}` +
        ` — legacy inventory only: ${legacyInventory}` +
        (source.reviewedAt === null ? ' — NEVER REVIEWED' : ` — reviewed ${source.reviewedAt}`),
    );
    if (source.governanceBlockers.length > 0) {
      lines.push(
        `      governance: ${source.lifecycleDecision} — ${source.governanceBlockers.join(', ')}`,
      );
    }
    for (const surface of READINESS_SURFACES) {
      const result = source.surfaces[surface];
      const missing = result.missing
        .map((entry) => `${entry.operation}/${entry.channel} (${entry.reasonCode})`)
        .join(', ');
      lines.push(
        `      ${surface}: ${result.status}` +
          (missing === '' ? '' : ` — missing ${missing}`) +
          (result.blockingReasons === undefined
            ? ''
            : ` — blocked ${result.blockingReasons.join(', ')}`),
      );
    }
  }

  lines.push('  legacy declaration inventory (not rights evidence):');
  for (const [name, passed] of Object.entries(report.legacyCommercialInventory)) {
    lines.push(`    ${passed ? 'pass' : 'FAIL'}  ${name}`);
  }

  if (report.blockers.length > 0) {
    lines.push('  blocking real-source validation:');
    for (const blocker of report.blockers) lines.push(`    - ${blocker}`);
  }
  return lines.join('\n');
}

interface CliArguments {
  readonly asOf: string;
  readonly asJson: boolean;
  readonly rightsSnapshotPath: string | null;
  readonly databaseEnv: string | null;
  readonly includeSources: readonly string[];
  readonly snapshotOut: string | null;
  readonly snapshotProvenance: string | null;
  readonly generatedAt: string | null;
  readonly verticals: readonly string[];
}

const SELECTABLE_DEFERRED_SOURCES = Object.freeze({
  'energy-star-heat-pumps': join(
    VERTICALS_DIR,
    '..',
    'docs',
    'sources',
    'proposed',
    'energy-star-heat-pumps.yaml',
  ),
});

function parseCliArguments(args: readonly string[]): CliArguments {
  let asOf: string | null = null;
  let rightsSnapshotPath: string | null = null;
  let databaseEnv: string | null = null;
  let asJson = false;
  let snapshotOut: string | null = null;
  let snapshotProvenance: string | null = null;
  let generatedAt: string | null = null;
  const includeSources: string[] = [];
  const verticals: string[] = [];
  const takeValue = (index: number, option: string): string => {
    const value = args[index + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new Error(`${option} requires a value`);
    }
    return value;
  };

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]!;
    if (argument === '--json') {
      asJson = true;
      continue;
    }
    if (argument === '--as-of') {
      if (asOf !== null) throw new Error('--as-of may be supplied only once');
      asOf = takeValue(index, argument);
      index += 1;
      continue;
    }
    if (argument === '--rights-snapshot') {
      if (rightsSnapshotPath !== null) {
        throw new Error('--rights-snapshot may be supplied only once');
      }
      rightsSnapshotPath = takeValue(index, argument);
      index += 1;
      continue;
    }
    if (argument === '--database-env') {
      if (databaseEnv !== null) throw new Error('--database-env may be supplied only once');
      databaseEnv = takeValue(index, argument);
      index += 1;
      continue;
    }
    if (argument === '--include-source') {
      includeSources.push(takeValue(index, argument));
      index += 1;
      continue;
    }
    if (argument === '--snapshot-out') {
      if (snapshotOut !== null) throw new Error('--snapshot-out may be supplied only once');
      snapshotOut = takeValue(index, argument);
      index += 1;
      continue;
    }
    if (argument === '--snapshot-provenance') {
      if (snapshotProvenance !== null) {
        throw new Error('--snapshot-provenance may be supplied only once');
      }
      snapshotProvenance = takeValue(index, argument);
      index += 1;
      continue;
    }
    if (argument === '--generated-at') {
      if (generatedAt !== null) throw new Error('--generated-at may be supplied only once');
      generatedAt = takeValue(index, argument);
      index += 1;
      continue;
    }
    if (argument.startsWith('--')) throw new Error(`unknown source-readiness option: ${argument}`);
    verticals.push(argument);
  }

  if (asOf === null) {
    throw new Error('source readiness requires --as-of <canonical UTC instant>');
  }
  const parsedAsOf = new Date(asOf);
  if (Number.isNaN(parsedAsOf.valueOf()) || parsedAsOf.toISOString() !== asOf) {
    throw new Error('--as-of must be a canonical UTC instant such as 2026-08-28T19:00:00.000Z');
  }
  if (rightsSnapshotPath !== null && databaseEnv !== null) {
    throw new Error('--rights-snapshot and --database-env are mutually exclusive');
  }
  const wantsSnapshotExport =
    snapshotOut !== null || snapshotProvenance !== null || generatedAt !== null;
  if (wantsSnapshotExport && databaseEnv === null) {
    throw new Error('snapshot export requires --database-env live rights evidence');
  }
  if (
    wantsSnapshotExport &&
    (snapshotOut === null || snapshotProvenance === null || generatedAt === null)
  ) {
    throw new Error(
      'snapshot export requires --snapshot-out, --snapshot-provenance, and --generated-at together',
    );
  }
  if (generatedAt !== null) {
    const parsedGeneratedAt = new Date(generatedAt);
    if (
      Number.isNaN(parsedGeneratedAt.valueOf()) ||
      parsedGeneratedAt.toISOString() !== generatedAt
    ) {
      throw new Error('--generated-at must be a canonical UTC instant with millisecond precision');
    }
  }
  return {
    asOf,
    asJson,
    rightsSnapshotPath,
    databaseEnv,
    includeSources: [...new Set(includeSources)].sort(compareCodeUnits),
    snapshotOut,
    snapshotProvenance,
    generatedAt,
    verticals,
  };
}

async function main(): Promise<void> {
  const options = parseCliArguments(process.argv.slice(2));
  const deferredByVertical = new Map<string, Record<string, unknown>[]>();
  for (const sourceKey of options.includeSources) {
    const path = SELECTABLE_DEFERRED_SOURCES[
      sourceKey as keyof typeof SELECTABLE_DEFERRED_SOURCES
    ];
    if (path === undefined) {
      throw new Error(`unknown selectable deferred source: ${sourceKey}`);
    }
    const raw = parseYaml(await readFile(path, 'utf8')) as Record<string, unknown>;
    if (
      text(raw['key']) !== sourceKey ||
      text(raw['status']) !== 'UNDER_REVIEW' ||
      text(raw['rights_classification']) !== 'UNREVIEWED'
    ) {
      throw new Error(`deferred source declaration is no longer fail-closed: ${sourceKey}`);
    }
    const verticalSlug = text(raw['vertical_slug']);
    const bucket = deferredByVertical.get(verticalSlug);
    if (bucket === undefined) deferredByVertical.set(verticalSlug, [raw]);
    else bucket.push(raw);
  }
  let evidence: RightsEvidenceResolver | undefined;
  let liveDriver: SqlDriver | null = null;
  if (options.rightsSnapshotPath !== null) {
    let raw: unknown;
    try {
      raw = JSON.parse(await readFile(options.rightsSnapshotPath, 'utf8')) as unknown;
    } catch (error) {
      throw new Error(
        `cannot read rights evidence snapshot ${options.rightsSnapshotPath}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    evidence = createSnapshotRightsEvidenceResolver(
      parseRightsEvidenceSnapshot(raw, options.asOf),
    );
  } else if (options.databaseEnv !== null) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(options.databaseEnv)) {
      throw new Error('--database-env must be an environment-variable name, never a credential value');
    }
    const connectionString = process.env[options.databaseEnv];
    if (connectionString === undefined || connectionString.trim() === '') {
      throw new Error(
        `database credential environment variable ${options.databaseEnv} is not set`,
      );
    }
    try {
      liveDriver = await createPostgresDriver(connectionString);
    } catch {
      throw new Error(`cannot open live database through credential env ${options.databaseEnv}`);
    }
    evidence = createLiveDatabaseRightsEvidenceResolver(
      liveDriver,
      options.databaseEnv,
      options.asOf,
    );
  }

  const reports: VerticalReadiness[] = [];
  try {
    const entries = await readdir(VERTICALS_DIR, { withFileTypes: true });
    const slugs = entries
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('_'))
      .map((entry) => entry.name)
      .filter((slug) => options.verticals.length === 0 || options.verticals.includes(slug))
      .sort(compareCodeUnits);

    for (const slug of slugs) {
      // Deferred candidates are read only when explicitly selected and never
      // enter the runtime registry or acquisition path.
      reports.push(
        await readVertical(
          join(VERTICALS_DIR, slug),
          slug,
          options.asOf,
          evidence,
          deferredByVertical.get(slug) ?? [],
        ),
      );
    }
    if (
      options.snapshotOut !== null &&
      options.snapshotProvenance !== null &&
      options.generatedAt !== null &&
      evidence !== undefined
    ) {
      const sources: RightsEvidenceSnapshotSourceInput[] = [];
      for (const report of reports) {
        for (const source of report.sources) {
          const context = await evidence.contextFor(report.slug, source);
          if (context === null) continue;
          sources.push({
            verticalSlug: report.slug,
            sourceKey: source.key,
            domain: source.domain,
            sourceType: source.sourceType,
            acquisitionRoute: source.acquisitionRoute,
            accountOrProductPlan: source.accountOrProductPlan,
            jurisdiction: source.jurisdiction,
            context,
          });
        }
      }
      const snapshot = createRightsEvidenceSnapshot({
        generatedAt: options.generatedAt,
        asOf: options.asOf,
        provenance: options.snapshotProvenance,
        sources,
      });
      await writeFile(options.snapshotOut, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
    }
  } finally {
    if (liveDriver !== null) {
      try {
        await liveDriver.close();
      } catch {
        throw new Error(
          `cannot close live database through credential env ${options.databaseEnv ?? 'UNKNOWN'}`,
        );
      }
    }
  }

  if (options.asJson) {
    process.stdout.write(`${JSON.stringify(reports, null, 2)}\n`);
    return;
  }

  if (reports.length === 0) {
    process.stdout.write('No verticals to report on.\n');
    return;
  }
  process.stdout.write(`${reports.map(render).join('\n\n')}\n`);
}

if (isMain(import.meta.url)) {
  await main();
}
