/**
 * ADR-0013 evidence-based rights determination file format.
 *
 * A determination is a committed, reproducible record under
 * `docs/sources/determinations/<source-key>.yaml`. This module validates it
 * and expands it into the exact rights-matrix cells it decides. It is operator
 * tooling only: it never enters a Worker import graph, performs no I/O, and
 * grants nothing by itself. `tooling/scripts/record-rights-determination.ts`
 * writes the planned cells.
 *
 * Absence remains refusal. A surface declared `UNKNOWN` produces no cell; a
 * `DENY` produces an explicit DENY decision; an `ALLOW` produces ALLOW
 * decisions for exactly that surface's AND-bundle in
 * `rightsRequirementsForSurface` — one surface never implies a neighbor.
 */
import { createHash } from 'node:crypto';
import { z } from 'zod';
import {
  AcquisitionMethodSchema,
  IsoDateTimeSchema,
  RightsAssetClassSchema,
  RightsOutputClassSchema,
  SourceTypeSchema,
  type RightsAssetClass,
  type RightsChannel,
  type RightsOperation,
  type RightsOutputClass,
} from '@data-foundry/canonical-schema';
import { rightsRequirementsForSurface, type RightsSurface } from '@data-foundry/rights-engine';

/** `reviewed_by` / activation actor for every determination-written row. */
export const DETERMINATION_ACTOR = 'Data Foundry evidence-based determination (ADR-0013)';
/** reviewer_type / actor_type. `AUTOMATED` is never used by a determination. */
export const DETERMINATION_REVIEWER_TYPE = 'DETERMINATION' as const;
export const MAX_DETERMINATION_RECHECK_MONTHS = 12;

export const DETERMINATION_BASES = [
  'PUBLIC_DOMAIN_US_GOVERNMENT_WORK',
  'OPEN_LICENSE',
  'PUBLISHED_TERMS_PERMIT',
  'DOCUMENTED_APPROVAL',
  // ADR-0018: data the publisher offers free of charge, with no login, paywall or CAPTCHA, whose terms do not
  // expressly forbid commercial reuse or redistribution. Silent or missing terms are no longer a refusal.
  'FREE_PUBLIC_ACCESS',
] as const;
export type DeterminationBasis = (typeof DETERMINATION_BASES)[number];

/** The seven customer surfaces ADR-0013 requires to be decided separately. */
export const DETERMINATION_SURFACES = [
  'PUBLIC_WEB',
  'SEARCH_INDEX',
  'API_FREE',
  'API_PAID',
  'RAPIDAPI',
  'MCP',
  'BULK_EXPORT',
] as const satisfies readonly RightsSurface[];
export type DeterminationSurface = (typeof DETERMINATION_SURFACES)[number];

/** Internal-processing operations a determination may decide. */
export const DETERMINATION_INTERNAL_OPERATIONS = [
  'ACQUIRE',
  'STORE',
  'CACHE',
  'NORMALIZE',
  'DERIVE',
] as const satisfies readonly RightsOperation[];
export type DeterminationInternalOperation = (typeof DETERMINATION_INTERNAL_OPERATIONS)[number];
/**
 * Acquisition operations are checked by the scheduled acquisition Worker at
 * the exact route/plan/jurisdiction/asset/output scope, so their cells carry
 * the declared output class. NORMALIZE/DERIVE apply to every output class.
 */
const EXACT_OUTPUT_OPERATIONS = new Set<DeterminationInternalOperation>([
  'ACQUIRE',
  'STORE',
  'CACHE',
]);

export const DETERMINATION_EVIDENCE_KINDS = [
  'TERMS',
  'POLICY',
  'AGREEMENT',
  'REVIEW_MEMO',
] as const;

const KEY = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const EVIDENCE_KEY = /^[a-z][a-z0-9_-]*$/;
const SHA256 = /^[0-9a-f]{64}$/;

const nonEmpty = (max: number) => z.string().trim().min(1).max(max);
const nullableNonEmpty = (max: number) => nonEmpty(max).nullable();

export const DeterminationDecisionSchema = z
  .object({
    decision: z.enum(['ALLOW', 'DENY', 'UNKNOWN']),
    rationale: nonEmpty(2000),
  })
  .strict();
export type DeterminationDecision = z.infer<typeof DeterminationDecisionSchema>;

export const DeterminationEvidenceSchema = z
  .object({
    key: z.string().regex(EVIDENCE_KEY),
    kind: z.enum(DETERMINATION_EVIDENCE_KINDS),
    canonical_uri: nonEmpty(2000),
    storage_uri: nonEmpty(2000),
    content_sha256: z.string().regex(SHA256),
    mime_type: nonEmpty(200),
    retrieved_at: IsoDateTimeSchema,
    notes: nonEmpty(2000).optional(),
  })
  .strict();
export type DeterminationEvidence = z.infer<typeof DeterminationEvidenceSchema>;

const surfaceShape = Object.fromEntries(
  DETERMINATION_SURFACES.map((surface) => [surface, DeterminationDecisionSchema]),
) as { [K in DeterminationSurface]: typeof DeterminationDecisionSchema };

export const RightsDeterminationSchema = z
  .object({
    schema_version: z.literal(1),
    source_key: z.string().regex(KEY),
    vertical_slug: z.string().regex(KEY),
    source: z
      .object({
        domain: nonEmpty(253),
        source_type: SourceTypeSchema,
      })
      .strict(),
    publisher: z
      .object({
        publisher_key: z.string().regex(KEY),
        legal_name: nonEmpty(300),
      })
      .strict(),
    basis: z.enum(DETERMINATION_BASES),
    /** Repository path of the human-readable determination memo, if any. */
    determination_document: nonEmpty(500).optional(),
    evidence: z.array(DeterminationEvidenceSchema).min(1).max(50),
    /** Evidence key whose bytes are the controlling terms version. */
    terms_evidence: z.string().regex(EVIDENCE_KEY),
    /** Evidence key (a REVIEW_MEMO) cited by every decision and the publisher mapping. */
    decision_evidence: z.string().regex(EVIDENCE_KEY),
    clause_ref: nonEmpty(1000),
    reviewed_at: IsoDateTimeSchema,
    /** Defaults to `reviewed_at`. */
    effective_from: IsoDateTimeSchema.optional(),
    recheck_at: IsoDateTimeSchema,
    scope: z
      .object({
        acquisition_route: AcquisitionMethodSchema,
        account_or_product_plan: nullableNonEmpty(200),
        jurisdiction: nullableNonEmpty(100),
        asset_class: RightsAssetClassSchema,
        output_class: RightsOutputClassSchema,
      })
      .strict(),
    surfaces: z.object(surfaceShape).strict(),
    internal_processing: z
      .object({
        ACQUIRE: DeterminationDecisionSchema,
        STORE: DeterminationDecisionSchema,
        CACHE: DeterminationDecisionSchema,
        NORMALIZE: DeterminationDecisionSchema.optional(),
        DERIVE: DeterminationDecisionSchema.optional(),
      })
      .strict(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const issue = (message: string, path: (string | number)[]): void => {
      ctx.addIssue({ code: 'custom', message, path });
    };
    const reviewed = Date.parse(value.reviewed_at);
    const recheck = Date.parse(value.recheck_at);
    const effective = Date.parse(value.effective_from ?? value.reviewed_at);
    if (!(recheck > reviewed)) issue('recheck_at must be after reviewed_at', ['recheck_at']);
    if (!(recheck > effective)) issue('recheck_at must be after effective_from', ['recheck_at']);
    if (recheck > addUtcMonths(reviewed, MAX_DETERMINATION_RECHECK_MONTHS)) {
      issue(
        `recheck_at must be no later than ${MAX_DETERMINATION_RECHECK_MONTHS} months after reviewed_at (ADR-0013)`,
        ['recheck_at'],
      );
    }

    const keys = new Map<string, DeterminationEvidence>();
    const stored = new Set<string>();
    value.evidence.forEach((entry, index) => {
      if (keys.has(entry.key)) issue(`duplicate evidence key ${entry.key}`, ['evidence', index, 'key']);
      keys.set(entry.key, entry);
      const identity = `${entry.storage_uri}\u0000${entry.content_sha256}`;
      if (stored.has(identity)) {
        issue('duplicate evidence storage_uri/content_sha256', ['evidence', index]);
      }
      stored.add(identity);
    });
    const terms = keys.get(value.terms_evidence);
    const decision = keys.get(value.decision_evidence);
    if (terms === undefined) issue('terms_evidence must name an evidence key', ['terms_evidence']);
    if (decision === undefined) {
      issue('decision_evidence must name an evidence key', ['decision_evidence']);
    } else if (decision.kind !== 'REVIEW_MEMO') {
      issue('decision_evidence must be the REVIEW_MEMO recording this determination', [
        'decision_evidence',
      ]);
    }
    // A § 105 federal work, and free public data under ADR-0018 (whose terms
    // may be silent or absent), may rest on the determination memo alone.
    // Every other basis cites the retrieved text itself.
    if (
      terms !== undefined &&
      value.basis !== 'PUBLIC_DOMAIN_US_GOVERNMENT_WORK' &&
      value.basis !== 'FREE_PUBLIC_ACCESS' &&
      terms.kind === 'REVIEW_MEMO'
    ) {
      issue(`${value.basis} requires terms_evidence to be retrieved TERMS, POLICY or AGREEMENT text`, [
        'terms_evidence',
      ]);
    }
    if (
      value.basis === 'DOCUMENTED_APPROVAL' &&
      !value.evidence.some((entry) => entry.kind === 'AGREEMENT')
    ) {
      issue('DOCUMENTED_APPROVAL requires AGREEMENT evidence (a reference, not the secret)', [
        'evidence',
      ]);
    }
    // Personal data needs its own handling decision before acquisition.
    if (value.scope.asset_class === 'PERSONAL_DATA' || value.scope.output_class === 'PERSONAL_DATA') {
      issue('personal data requires a separate handling decision; a determination cannot grant it', [
        'scope',
      ]);
    }
    if (value.determination_document !== undefined) {
      const path = value.determination_document;
      if (!path.startsWith('docs/sources/') || path.includes('..') || path.includes('\\')) {
        issue('determination_document must be a repository path under docs/sources/', [
          'determination_document',
        ]);
      }
    }
  });
export type RightsDetermination = z.infer<typeof RightsDeterminationSchema>;

export class RightsDeterminationError extends Error {
  readonly issues: readonly string[];
  constructor(message: string, issues: readonly string[] = []) {
    super(issues.length === 0 ? message : `${message}: ${issues.join('; ')}`);
    this.name = 'RightsDeterminationError';
    this.issues = issues;
  }
}

/** Parse untrusted input (for example a YAML document) into a determination. */
export function parseRightsDetermination(input: unknown): RightsDetermination {
  const parsed = RightsDeterminationSchema.safeParse(input);
  if (!parsed.success) {
    throw new RightsDeterminationError(
      'invalid rights determination',
      parsed.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`),
    );
  }
  return parsed.data;
}

/** One exact matrix cell and the state this determination records for it. */
export interface PlannedDeterminationCell {
  readonly operation: RightsOperation;
  readonly channel: RightsChannel;
  readonly assetClass: RightsAssetClass;
  readonly outputClass: RightsOutputClass | null;
  readonly state: 'ALLOW' | 'DENY';
  /** Deterministic, so an unchanged file re-plans to identical rows. */
  readonly rationale: string;
  /** Surfaces or internal operations that require this cell. */
  readonly origins: readonly string[];
}

export interface DeterminationPlan {
  readonly effectiveFrom: string;
  readonly cells: readonly PlannedDeterminationCell[];
  readonly unknownSurfaces: readonly DeterminationSurface[];
  readonly unknownInternalOperations: readonly DeterminationInternalOperation[];
}

export const plannedCellKey = (cell: {
  readonly operation: string;
  readonly channel: string;
}): string => `${cell.operation}:${cell.channel}`;

/**
 * Expand a determination into exact cells. Refuses a file whose decisions
 * cannot be represented faithfully: a DENY and an ALLOW on one shared cell, or
 * a surface declared UNKNOWN/DENY whose every requirement is nevertheless
 * granted through other surfaces (for example API_PAID ALLOW with API_FREE
 * UNKNOWN, since API_FREE's only cell is API_PAID's serve cell).
 */
export function planRightsDetermination(determination: RightsDetermination): DeterminationPlan {
  const { scope } = determination;
  const entries = new Map<
    string,
    {
      operation: RightsOperation;
      channel: RightsChannel;
      outputClass: RightsOutputClass | null;
      state: 'ALLOW' | 'DENY';
      reasons: string[];
    }
  >();
  const issues: string[] = [];
  const add = (
    operation: RightsOperation,
    channel: RightsChannel,
    outputClass: RightsOutputClass | null,
    origin: string,
    decision: DeterminationDecision,
  ): void => {
    if (decision.decision === 'UNKNOWN') return;
    const key = `${operation}:${channel}`;
    const existing = entries.get(key);
    const reason = `${origin}: ${decision.rationale.trim()}`;
    if (existing === undefined) {
      entries.set(key, { operation, channel, outputClass, state: decision.decision, reasons: [reason] });
    } else if (existing.state !== decision.decision) {
      issues.push(
        `${origin} declares ${decision.decision} but ${key} is ${existing.state} for ${existing.reasons
          .map((entry) => entry.split(':')[0])
          .join(', ')}; the shared cell cannot hold both`,
      );
    } else {
      existing.reasons.push(reason);
    }
  };

  const unknownSurfaces: DeterminationSurface[] = [];
  for (const surface of DETERMINATION_SURFACES) {
    const decision = determination.surfaces[surface];
    if (decision.decision === 'UNKNOWN') unknownSurfaces.push(surface);
    for (const requirement of rightsRequirementsForSurface(surface)) {
      add(requirement.operation, requirement.channel, null, surface, decision);
    }
  }
  const unknownInternalOperations: DeterminationInternalOperation[] = [];
  for (const operation of DETERMINATION_INTERNAL_OPERATIONS) {
    const decision = determination.internal_processing[operation] ?? {
      decision: 'UNKNOWN' as const,
      rationale: 'not declared',
    };
    if (decision.decision === 'UNKNOWN') unknownInternalOperations.push(operation);
    add(
      operation,
      'INTERNAL_PROCESSING',
      EXACT_OUTPUT_OPERATIONS.has(operation) ? scope.output_class : null,
      operation,
      decision,
    );
  }

  for (const surface of DETERMINATION_SURFACES) {
    if (determination.surfaces[surface].decision === 'ALLOW') continue;
    const implied = rightsRequirementsForSurface(surface).every(
      (requirement) => entries.get(plannedCellKey(requirement))?.state === 'ALLOW',
    );
    if (implied) {
      issues.push(
        `${surface} is declared ${determination.surfaces[surface].decision} but every cell it requires is granted by another surface; declare it ALLOW or narrow the other grants`,
      );
    }
  }
  if (issues.length > 0) {
    throw new RightsDeterminationError('rights determination is not representable', issues);
  }

  const basis = determination.basis;
  const cells = [...entries.values()]
    .map(
      (entry): PlannedDeterminationCell => ({
        operation: entry.operation,
        channel: entry.channel,
        assetClass: scope.asset_class,
        outputClass: entry.outputClass,
        state: entry.state,
        rationale: `[${basis}] ${entry.reasons.join(' | ')}`,
        origins: entry.reasons.map((reason) => reason.slice(0, reason.indexOf(':'))),
      }),
    )
    .sort((left, right) => plannedCellKey(left).localeCompare(plannedCellKey(right)));
  return {
    effectiveFrom: determination.effective_from ?? determination.reviewed_at,
    cells,
    unknownSurfaces,
    unknownInternalOperations,
  };
}

/** Stable content digest of a determination, for receipts and version labels. */
export function determinationDigest(determination: RightsDetermination): string {
  return createHash('sha256').update(stableJson(determination), 'utf8').digest('hex');
}

export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/** Calendar-month addition in UTC, clamped to the target month's last day. */
export function addUtcMonths(epochMs: number, months: number): number {
  const date = new Date(epochMs);
  const targetMonth = date.getUTCMonth() + months;
  const lastDay = new Date(Date.UTC(date.getUTCFullYear(), targetMonth + 1, 0)).getUTCDate();
  return Date.UTC(
    date.getUTCFullYear(),
    targetMonth,
    Math.min(date.getUTCDate(), lastDay),
    date.getUTCHours(),
    date.getUTCMinutes(),
    date.getUTCSeconds(),
    date.getUTCMilliseconds(),
  );
}
