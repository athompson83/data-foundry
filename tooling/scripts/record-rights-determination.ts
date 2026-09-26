/**
 * Record one committed ADR-0013 evidence-based rights determination into the
 * rights-grant matrix.
 *
 *   POSTGRES_URL=... pnpm rights:record -- --file docs/sources/determinations/<source-key>.yaml [--dry-run]
 *
 * The connection comes only from POSTGRES_URL so it never enters argv or shell
 * history, and nothing secret is printed. Everything happens in one
 * transaction under a per-source advisory lock:
 *
 *   rights publisher (created if absent; identity is immutable)
 *   → source→publisher mapping (only when unmapped; an evidenced mapping is never mutated)
 *   → evidence artifacts (content-addressed; reused when identical)
 *   → terms cell + version + activation (superseding the prior current version)
 *   → exact cells, decisions and activations for the declared surfaces only.
 *
 * UNKNOWN surfaces write nothing; absence is refusal. A cell this determination
 * previously decided but no longer declares is superseded by an explicit
 * UNKNOWN decision so an old grant cannot outlive the file. Re-running an
 * unchanged determination writes nothing. `--dry-run` performs the same work
 * against the real triggers and rolls it back.
 *
 * Every written review/activation uses reviewer/actor type DETERMINATION and
 * reviewed_by `Data Foundry evidence-based determination (ADR-0013)`. The
 * writer never uses AUTOMATED, never supersedes a HUMAN/COUNSEL decision, and
 * never edits a source's status, classification or kill switch — the engine's
 * hard stops continue to apply unchanged.
 */
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import {
  createPostgresDriver,
  type PostgresDriverOptions,
  type SqlDriver,
  type SqlParam,
  type SqlTransactionExecutor,
} from '@data-foundry/canonical-store';
import { isMain } from '../lib/cli-entry.js';
import {
  DETERMINATION_ACTOR,
  DETERMINATION_REVIEWER_TYPE,
  RightsDeterminationError,
  determinationDigest,
  parseRightsDetermination,
  planRightsDetermination,
  plannedCellKey,
  stableJson,
  type DeterminationEvidence,
  type RightsDetermination,
} from '../lib/rights-determination.js';
import { resolveOperationalSchema } from './migrate.js';

export { RightsDeterminationError } from '../lib/rights-determination.js';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const RETIRED_RATIONALE =
  'No longer declared by the current ADR-0013 determination for this source; absence is refusal.';

export type CellAction = 'NO_CHANGE' | 'CREATED' | 'SUPERSEDED' | 'RETIRED_TO_UNKNOWN';

export interface RightsDeterminationRecordResult {
  readonly kind: 'data-foundry.rights-determination-record.v1';
  readonly dry_run: boolean;
  readonly committed: boolean;
  readonly changed: boolean;
  readonly source_key: string;
  readonly vertical_slug: string;
  readonly basis: RightsDetermination['basis'];
  readonly determination_sha256: string;
  readonly source: {
    readonly status: string;
    readonly rights_classification: string;
    readonly kill_switch_engaged: boolean | null;
  };
  readonly publisher: 'EXISTING' | 'CREATED';
  readonly publisher_mapping: 'EXISTING' | 'CREATED';
  readonly evidence: { readonly created: number; readonly existing: number };
  readonly terms: 'CURRENT' | 'CREATED' | 'SUPERSEDED';
  readonly cells: readonly {
    readonly operation: string;
    readonly channel: string;
    readonly output_class: string | null;
    readonly state: 'ALLOW' | 'DENY' | 'UNKNOWN';
    readonly action: CellAction;
  }[];
  readonly unknown_surfaces: readonly string[];
  /** Hard stops outside this writer's authority that still refuse every surface. */
  readonly warnings: readonly string[];
}

class DryRunRollback extends Error {
  constructor(readonly result: RightsDeterminationRecordResult) {
    super('dry run rollback');
  }
}

const one = async <T extends Record<string, unknown>>(
  tx: SqlTransactionExecutor,
  sql: string,
  params: readonly SqlParam[],
): Promise<T | undefined> => (await tx.query<T>(sql, params))[0];

const required = async <T extends Record<string, unknown>>(
  tx: SqlTransactionExecutor,
  sql: string,
  params: readonly SqlParam[],
): Promise<T> => {
  const row = await one<T>(tx, sql, params);
  if (row === undefined) throw new RightsDeterminationError('expected database row was not returned');
  return row;
};

/**
 * Record a validated determination. Pass `dryRun` to validate every write
 * against the real schema and triggers, then roll back.
 */
export async function recordRightsDetermination(
  driver: SqlDriver,
  determination: RightsDetermination,
  options: { readonly dryRun?: boolean } = {},
): Promise<RightsDeterminationRecordResult> {
  const dryRun = options.dryRun ?? false;
  const plan = planRightsDetermination(determination);
  const digest = determinationDigest(determination);
  try {
    return await driver.transaction(async (tx) => {
      const result = await recordInTransaction(tx, determination, plan, digest, dryRun);
      if (dryRun) throw new DryRunRollback(result);
      return result;
    });
  } catch (error) {
    if (error instanceof DryRunRollback) return error.result;
    throw error;
  }
}

async function recordInTransaction(
  tx: SqlTransactionExecutor,
  determination: RightsDetermination,
  plan: ReturnType<typeof planRightsDetermination>,
  digest: string,
  dryRun: boolean,
): Promise<RightsDeterminationRecordResult> {
  const actor = DETERMINATION_ACTOR;
  const reviewer = DETERMINATION_REVIEWER_TYPE;
  const { scope } = determination;
  let changed = false;

  await tx.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [
    `data-foundry:rights-determination:${determination.vertical_slug}:${determination.source_key}`,
  ]);

  const clock = await required<{ current: boolean }>(
    tx,
    `SELECT ($1::timestamptz <= now() AND $2::timestamptz <= now() AND $3::timestamptz > now()) AS current`,
    [determination.reviewed_at, plan.effectiveFrom, determination.recheck_at],
  );
  if (clock.current !== true) {
    throw new RightsDeterminationError(
      'determination is not current: reviewed_at and effective_from must not be in the future and recheck_at must be in the future',
    );
  }

  const source = await one<{
    id: string;
    status: string;
    rights_classification: string;
    kill_switch_engaged: boolean | null;
    rights_publisher_id: string | null;
  }>(
    tx,
    `SELECT s.id, s.status, s.rights_classification, s.kill_switch_engaged, s.rights_publisher_id
       FROM sources s
       JOIN verticals v ON v.id = s.vertical_id
      WHERE v.slug = $1 AND s.domain = $2 AND s.source_type = $3
      FOR UPDATE OF s`,
    [determination.vertical_slug, determination.source.domain, determination.source.source_type],
  );
  if (source === undefined) {
    throw new RightsDeterminationError(
      'the determined source is not registered in the database; synchronize the source registry first',
    );
  }

  // Publisher identity is immutable once written.
  let publisherAction: 'EXISTING' | 'CREATED' = 'EXISTING';
  let publisher = await one<{ id: string; legal_name: string; status: string }>(
    tx,
    `SELECT id, legal_name, status FROM rights_publishers WHERE publisher_key = $1 FOR UPDATE`,
    [determination.publisher.publisher_key],
  );
  if (publisher === undefined) {
    publisher = await required<{ id: string; legal_name: string; status: string }>(
      tx,
      `INSERT INTO rights_publishers (publisher_key, legal_name, status)
       VALUES ($1, $2, 'ACTIVE') RETURNING id, legal_name, status`,
      [determination.publisher.publisher_key, determination.publisher.legal_name],
    );
    publisherAction = 'CREATED';
    changed = true;
  } else {
    if (publisher.legal_name !== determination.publisher.legal_name) {
      throw new RightsDeterminationError(
        'the existing rights publisher has a different legal name; publisher identity is immutable',
      );
    }
    if (publisher.status !== 'ACTIVE') {
      throw new RightsDeterminationError(`the rights publisher is ${publisher.status}; nothing may be granted`);
    }
  }

  // Evidence is content-addressed and immutable.
  const evidenceIds = new Map<string, string>();
  let evidenceCreated = 0;
  let evidenceExisting = 0;
  for (const entry of determination.evidence) {
    const id = await recordEvidence(tx, entry, actor);
    evidenceIds.set(entry.key, id.id);
    if (id.created) {
      evidenceCreated += 1;
      changed = true;
    } else {
      evidenceExisting += 1;
    }
  }
  const termsEvidence = determination.evidence.find((entry) => entry.key === determination.terms_evidence)!;
  const termsEvidenceId = evidenceIds.get(determination.terms_evidence)!;
  const decisionEvidenceId = evidenceIds.get(determination.decision_evidence)!;

  // The source→publisher mapping is written only when absent.
  let mappingAction: 'EXISTING' | 'CREATED' = 'EXISTING';
  if (source.rights_publisher_id === null) {
    const history = await required<{ present: boolean }>(
      tx,
      `SELECT (EXISTS (SELECT 1 FROM rights_cells WHERE source_id = $1)
            OR EXISTS (SELECT 1 FROM rights_terms_cells WHERE source_id = $1)) AS present`,
      [source.id],
    );
    if (history.present === true) {
      throw new RightsDeterminationError(
        'the source has rights history but no publisher mapping; it needs a separately reviewed lineage',
      );
    }
    await tx.query(
      `UPDATE sources
          SET rights_publisher_id = $2,
              rights_publisher_mapping_evidence_artifact_id = $3,
              rights_publisher_mapping_reviewer_type = $4,
              rights_publisher_mapping_reviewed_by = $5,
              rights_publisher_mapping_reviewed_at = $6::timestamptz
        WHERE id = $1`,
      [source.id, publisher.id, decisionEvidenceId, reviewer, actor, determination.reviewed_at],
    );
    mappingAction = 'CREATED';
    changed = true;
  } else if (source.rights_publisher_id !== publisher.id) {
    throw new RightsDeterminationError(
      'the source is already mapped to a different rights publisher; an evidenced mapping is never mutated',
    );
  }

  // Controlling terms: one source-scoped terms cell per acquisition scope.
  let termsCell = await one<{ id: string }>(
    tx,
    `SELECT id FROM rights_terms_cells
      WHERE publisher_id IS NULL AND source_id = $1
        AND acquisition_route IS NOT DISTINCT FROM $2
        AND account_or_product_plan IS NOT DISTINCT FROM $3
        AND jurisdiction IS NOT DISTINCT FROM $4`,
    [source.id, scope.acquisition_route, scope.account_or_product_plan, scope.jurisdiction],
  );
  if (termsCell === undefined) {
    termsCell = await required<{ id: string }>(
      tx,
      `INSERT INTO rights_terms_cells
         (source_id, acquisition_route, account_or_product_plan, jurisdiction, created_by)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [source.id, scope.acquisition_route, scope.account_or_product_plan, scope.jurisdiction, actor],
    );
    changed = true;
  }
  const currentTerms = await one<{ terms_version_id: string; state: string; matches: boolean }>(
    tx,
    `SELECT event.terms_version_id, event.state,
            (event.state = 'ACTIVE'
             AND version.evidence_artifact_id = $2
             AND version.content_sha256 = $3
             AND version.effective_from = $4::timestamptz
             AND version.effective_until IS NULL
             AND version.recheck_at = $5::timestamptz) AS matches
       FROM rights_terms_activation_events event
       JOIN rights_terms_versions version ON version.id = event.terms_version_id
      WHERE event.terms_cell_id = $1
      ORDER BY event.sequence_no DESC
      LIMIT 1`,
    [termsCell.id, termsEvidenceId, termsEvidence.content_sha256, plan.effectiveFrom, determination.recheck_at],
  );
  let termsAction: 'CURRENT' | 'CREATED' | 'SUPERSEDED' = 'CURRENT';
  let termsVersionId: string;
  if (currentTerms?.matches === true) {
    termsVersionId = currentTerms.terms_version_id;
  } else {
    const supersedes = currentTerms?.terms_version_id ?? null;
    const label = `adr0013-${createHash('sha256')
      .update(
        stableJson({
          evidence: termsEvidence.content_sha256,
          effective_from: plan.effectiveFrom,
          recheck_at: determination.recheck_at,
          supersedes,
        }),
        'utf8',
      )
      .digest('hex')
      .slice(0, 16)}`;
    const version = await required<{ id: string }>(
      tx,
      `INSERT INTO rights_terms_versions
         (terms_cell_id, evidence_artifact_id, content_sha256, version_label,
          effective_from, recheck_at, supersedes_terms_version_id, created_by)
       VALUES ($1, $2, $3, $4, $5::timestamptz, $6::timestamptz, $7, $8) RETURNING id`,
      [
        termsCell.id,
        termsEvidenceId,
        termsEvidence.content_sha256,
        label,
        plan.effectiveFrom,
        determination.recheck_at,
        supersedes,
        actor,
      ],
    );
    termsVersionId = version.id;
    await tx.query(`SELECT activate_rights_terms($1, $2, $3, $4)`, [
      termsVersionId,
      reviewer,
      actor,
      `ADR-0013 ${determination.basis} determination for ${determination.source_key}`,
    ]);
    termsAction = supersedes === null ? 'CREATED' : 'SUPERSEDED';
    changed = true;
  }

  const cells: RightsDeterminationRecordResult['cells'][number][] = [];
  const decisionReason = `ADR-0013 ${determination.basis} determination for ${determination.source_key}`;
  const plannedCellIds = new Set<string>();
  for (const planned of plan.cells) {
    let cell = await one<{ id: string }>(
      tx,
      `SELECT id FROM rights_cells
        WHERE publisher_id IS NULL AND source_id = $1
          AND acquisition_route IS NOT DISTINCT FROM $2
          AND account_or_product_plan IS NOT DISTINCT FROM $3
          AND jurisdiction IS NOT DISTINCT FROM $4
          AND asset_class IS NOT DISTINCT FROM $5
          AND field_key IS NULL AND field_group_id IS NULL
          AND output_class IS NOT DISTINCT FROM $6
          AND operation = $7 AND channel = $8`,
      [
        source.id,
        scope.acquisition_route,
        scope.account_or_product_plan,
        scope.jurisdiction,
        planned.assetClass,
        planned.outputClass,
        planned.operation,
        planned.channel,
      ],
    );
    let action: CellAction;
    let supersedes: string | null = null;
    if (cell === undefined) {
      cell = await required<{ id: string }>(
        tx,
        `INSERT INTO rights_cells
           (source_id, acquisition_route, account_or_product_plan, jurisdiction,
            asset_class, output_class, operation, channel, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
        [
          source.id,
          scope.acquisition_route,
          scope.account_or_product_plan,
          scope.jurisdiction,
          planned.assetClass,
          planned.outputClass,
          planned.operation,
          planned.channel,
          actor,
        ],
      );
      action = 'CREATED';
    } else {
      const current = await currentDecision(tx, cell.id, {
        state: planned.state,
        termsVersionId,
        evidenceId: decisionEvidenceId,
        clauseRef: determination.clause_ref,
        reviewedAt: determination.reviewed_at,
        effectiveFrom: plan.effectiveFrom,
        recheckAt: determination.recheck_at,
        rationale: planned.rationale,
      });
      if (current?.matches === true) {
        action = 'NO_CHANGE';
      } else {
        if (current !== undefined) assertDeterminationOwned(current, planned);
        supersedes = current?.id ?? null;
        action = supersedes === null ? 'CREATED' : 'SUPERSEDED';
      }
    }
    plannedCellIds.add(cell.id);
    if (action !== 'NO_CHANGE') {
      await writeDecision(tx, {
        cellId: cell.id,
        state: planned.state,
        termsVersionId,
        evidenceId: decisionEvidenceId,
        clauseRef: determination.clause_ref,
        reviewedAt: determination.reviewed_at,
        effectiveFrom: plan.effectiveFrom,
        recheckAt: determination.recheck_at,
        rationale: planned.rationale,
        supersedes,
        reason: decisionReason,
      });
      changed = true;
    }
    cells.push({
      operation: planned.operation,
      channel: planned.channel,
      output_class: planned.outputClass,
      state: planned.state,
      action,
    });
  }

  // A cell an earlier version of this determination decided, but which the
  // current file no longer declares, must not keep its old grant.
  const stale = await tx.query<{
    cell_id: string;
    decision_id: string;
    operation: string;
    channel: string;
    output_class: string | null;
  }>(
    `WITH latest AS (
       SELECT DISTINCT ON (event.cell_id) event.cell_id, event.decision_id
         FROM rights_decision_activation_events event
         JOIN rights_cells cell ON cell.id = event.cell_id
        WHERE cell.source_id = $1 AND cell.publisher_id IS NULL
        ORDER BY event.cell_id, event.sequence_no DESC
     )
     SELECT latest.cell_id, latest.decision_id, cell.operation, cell.channel, cell.output_class
       FROM latest
       JOIN rights_decisions decision ON decision.id = latest.decision_id
       JOIN rights_cells cell ON cell.id = latest.cell_id
      WHERE decision.reviewer_type = $2 AND decision.reviewed_by = $3
        AND decision.state <> 'UNKNOWN'
      ORDER BY cell.operation, cell.channel, cell.id`,
    [source.id, reviewer, actor],
  );
  for (const row of stale) {
    if (plannedCellIds.has(row.cell_id)) continue;
    await writeDecision(tx, {
      cellId: row.cell_id,
      state: 'UNKNOWN',
      termsVersionId,
      evidenceId: decisionEvidenceId,
      clauseRef: determination.clause_ref,
      reviewedAt: determination.reviewed_at,
      effectiveFrom: plan.effectiveFrom,
      recheckAt: determination.recheck_at,
      rationale: `[${determination.basis}] ${RETIRED_RATIONALE}`,
      supersedes: row.decision_id,
      reason: decisionReason,
    });
    changed = true;
    cells.push({
      operation: row.operation,
      channel: row.channel,
      output_class: row.output_class,
      state: 'UNKNOWN',
      action: 'RETIRED_TO_UNKNOWN',
    });
  }

  const warnings: string[] = [];
  if (source.status !== 'ACTIVE') warnings.push(`source status is ${source.status}; surfaces require ACTIVE`);
  if (source.rights_classification === 'RED' || source.rights_classification === 'UNREVIEWED') {
    warnings.push(`source rights_classification is ${source.rights_classification}; every surface is refused`);
  }
  if (source.kill_switch_engaged !== false) {
    warnings.push('source kill switch is engaged or unsynchronized; every surface is refused');
  }

  return {
    kind: 'data-foundry.rights-determination-record.v1',
    dry_run: dryRun,
    committed: !dryRun,
    changed,
    source_key: determination.source_key,
    vertical_slug: determination.vertical_slug,
    basis: determination.basis,
    determination_sha256: digest,
    source: {
      status: source.status,
      rights_classification: source.rights_classification,
      kill_switch_engaged: source.kill_switch_engaged,
    },
    publisher: publisherAction,
    publisher_mapping: mappingAction,
    evidence: { created: evidenceCreated, existing: evidenceExisting },
    terms: termsAction,
    cells,
    unknown_surfaces: plan.unknownSurfaces,
    warnings,
  };
}

async function recordEvidence(
  tx: SqlTransactionExecutor,
  entry: DeterminationEvidence,
  actor: string,
): Promise<{ id: string; created: boolean }> {
  const existing = await one<{ id: string; kind: string; canonical_uri: string; mime_type: string }>(
    tx,
    `SELECT id, kind, canonical_uri, mime_type FROM rights_evidence_artifacts
      WHERE storage_uri = $1 AND content_sha256 = $2`,
    [entry.storage_uri, entry.content_sha256],
  );
  if (existing !== undefined) {
    if (
      existing.kind !== entry.kind ||
      existing.canonical_uri !== entry.canonical_uri ||
      existing.mime_type !== entry.mime_type
    ) {
      throw new RightsDeterminationError(
        `evidence ${entry.key} conflicts with an immutable stored artifact at the same storage_uri and digest`,
      );
    }
    return { id: existing.id, created: false };
  }
  const row = await required<{ id: string }>(
    tx,
    `INSERT INTO rights_evidence_artifacts
       (kind, canonical_uri, storage_uri, content_sha256, mime_type, captured_at, created_by)
     VALUES ($1, $2, $3, $4, $5, $6::timestamptz, $7) RETURNING id`,
    [
      entry.kind,
      entry.canonical_uri,
      entry.storage_uri,
      entry.content_sha256,
      entry.mime_type,
      entry.retrieved_at,
      actor,
    ],
  );
  return { id: row.id, created: true };
}

interface DesiredDecision {
  readonly state: 'ALLOW' | 'DENY' | 'UNKNOWN';
  readonly termsVersionId: string;
  readonly evidenceId: string;
  readonly clauseRef: string;
  readonly reviewedAt: string;
  readonly effectiveFrom: string;
  readonly recheckAt: string;
  readonly rationale: string;
}

interface CurrentDecisionRow extends Record<string, unknown> {
  id: string;
  state: string;
  reviewer_type: string;
  reviewed_by: string | null;
  matches: boolean;
}

async function currentDecision(
  tx: SqlTransactionExecutor,
  cellId: string,
  desired: DesiredDecision,
): Promise<CurrentDecisionRow | undefined> {
  return one<CurrentDecisionRow>(
    tx,
    `SELECT decision.id, decision.state, decision.reviewer_type, decision.reviewed_by,
            (decision.state = $2
             AND decision.controlling_terms_version_id = $3
             AND decision.evidence_artifact_id = $4
             AND decision.clause_ref = $5
             AND decision.review_status = 'APPROVED'
             AND decision.reviewer_type = $6
             AND decision.reviewed_by = $7
             AND decision.reviewed_at = $8::timestamptz
             AND decision.effective_from = $9::timestamptz
             AND decision.effective_until IS NULL
             AND decision.recheck_at = $10::timestamptz
             AND decision.rationale = $11
             AND NOT EXISTS (
                 SELECT 1 FROM rights_decision_conditions condition
                  WHERE condition.decision_id = decision.id)) AS matches
       FROM rights_decision_activation_events event
       JOIN rights_decisions decision ON decision.id = event.decision_id
      WHERE event.cell_id = $1
      ORDER BY event.sequence_no DESC
      LIMIT 1`,
    [
      cellId,
      desired.state,
      desired.termsVersionId,
      desired.evidenceId,
      desired.clauseRef,
      DETERMINATION_REVIEWER_TYPE,
      DETERMINATION_ACTOR,
      desired.reviewedAt,
      desired.effectiveFrom,
      desired.recheckAt,
      desired.rationale,
    ],
  );
}

/** A determination supersedes only its own decisions, never a HUMAN/COUNSEL one. */
function assertDeterminationOwned(
  current: CurrentDecisionRow,
  planned: { readonly operation: string; readonly channel: string },
): void {
  if (current.reviewer_type !== DETERMINATION_REVIEWER_TYPE || current.reviewed_by !== DETERMINATION_ACTOR) {
    throw new RightsDeterminationError(
      `${plannedCellKey(planned)} already has a current ${current.reviewer_type} decision; a determination does not supersede another reviewer's decision`,
    );
  }
}

async function writeDecision(
  tx: SqlTransactionExecutor,
  input: DesiredDecision & {
    readonly cellId: string;
    readonly supersedes: string | null;
    readonly reason: string;
  },
): Promise<void> {
  const decision = await required<{ id: string }>(
    tx,
    `INSERT INTO rights_decisions
       (cell_id, state, controlling_terms_version_id, evidence_artifact_id, clause_ref,
        review_status, reviewer_type, reviewed_by, reviewed_at, effective_from,
        recheck_at, rationale, supersedes_decision_id, created_by)
     VALUES ($1, $2, $3, $4, $5, 'APPROVED', $6, $7, $8::timestamptz, $9::timestamptz,
             $10::timestamptz, $11, $12, $7)
     RETURNING id`,
    [
      input.cellId,
      input.state,
      input.termsVersionId,
      input.evidenceId,
      input.clauseRef,
      DETERMINATION_REVIEWER_TYPE,
      DETERMINATION_ACTOR,
      input.reviewedAt,
      input.effectiveFrom,
      input.recheckAt,
      input.rationale,
      input.supersedes,
    ],
  );
  await tx.query(`SELECT activate_rights_decision($1, $2, $3, $4)`, [
    decision.id,
    DETERMINATION_REVIEWER_TYPE,
    DETERMINATION_ACTOR,
    input.reason,
  ]);
}

/* ------------------------------------------------------------------ *
 * File loading and CLI
 * ------------------------------------------------------------------ */

export interface RecordDeterminationArgs {
  readonly file: string;
  readonly dryRun: boolean;
}

export function parseRecordDeterminationArgs(rawArgs: readonly string[]): RecordDeterminationArgs {
  const args = rawArgs[0] === '--' ? rawArgs.slice(1) : rawArgs;
  let file: string | null = null;
  let dryRun = false;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]!;
    if (argument === '--dry-run') {
      if (dryRun) throw new RightsDeterminationError('--dry-run may be supplied only once');
      dryRun = true;
    } else if (argument === '--file') {
      const value = args[index + 1];
      if (value === undefined || value.startsWith('--')) {
        throw new RightsDeterminationError('--file requires a path');
      }
      if (file !== null) throw new RightsDeterminationError('--file may be supplied only once');
      file = value;
      index += 1;
    } else {
      throw new RightsDeterminationError(`unsupported argument ${argument}`);
    }
  }
  if (file === null) throw new RightsDeterminationError('--file is required');
  return { file, dryRun };
}

/**
 * Read and validate a committed determination file. The file must live under
 * docs/sources/determinations/ and be named for its source key; when the
 * vertical registry declares the source, its domain and type must agree.
 */
export async function loadRightsDeterminationFile(
  file: string,
  repoRoot: string = REPO_ROOT,
): Promise<RightsDetermination> {
  const absolute = isAbsolute(file) ? file : resolve(repoRoot, file);
  const repoPath = relative(repoRoot, absolute).split(sep).join('/');
  if (!repoPath.startsWith('docs/sources/determinations/') || !/\.ya?ml$/.test(repoPath)) {
    throw new RightsDeterminationError(
      'the determination file must be a committed docs/sources/determinations/<source-key>.yaml',
    );
  }
  let parsed: unknown;
  try {
    parsed = parseYaml(await readFile(absolute, 'utf8'));
  } catch {
    throw new RightsDeterminationError('cannot read the determination file as YAML');
  }
  const determination = parseRightsDetermination(parsed);
  if (basename(repoPath).replace(/\.ya?ml$/, '') !== determination.source_key) {
    throw new RightsDeterminationError('the determination file name must equal its source_key');
  }
  if (determination.determination_document !== undefined) {
    const exists = await stat(join(repoRoot, determination.determination_document)).then(
      (info) => info.isFile(),
      () => false,
    );
    if (!exists) throw new RightsDeterminationError('determination_document does not exist');
  }
  const registryFile = join(
    repoRoot,
    'verticals',
    determination.vertical_slug,
    'sources',
    `${determination.source_key}.yaml`,
  );
  const registryText = await readFile(registryFile, 'utf8').catch(() => null);
  if (registryText !== null) {
    const registry = parseYaml(registryText) as Record<string, unknown> | null;
    if (
      registry?.['key'] !== determination.source_key ||
      registry['vertical_slug'] !== determination.vertical_slug ||
      registry['domain'] !== determination.source.domain ||
      registry['source_type'] !== determination.source.source_type
    ) {
      throw new RightsDeterminationError(
        'the determination source does not match its vertical registry declaration',
      );
    }
  }
  return determination;
}

export interface RecordDeterminationCliRuntime {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly createDriver: (connectionString: string, options?: PostgresDriverOptions) => Promise<SqlDriver>;
  readonly writeStdout: (text: string) => void;
  readonly repoRoot?: string;
}

export async function runRecordRightsDeterminationCli(
  args: readonly string[],
  runtime: RecordDeterminationCliRuntime,
): Promise<RightsDeterminationRecordResult> {
  const options = parseRecordDeterminationArgs(args);
  const determination = await loadRightsDeterminationFile(options.file, runtime.repoRoot ?? REPO_ROOT);
  const connectionString = runtime.env['POSTGRES_URL'];
  if (connectionString === undefined || connectionString.trim() === '') {
    throw new RightsDeterminationError('POSTGRES_URL is required');
  }
  let schema: string;
  try {
    schema = resolveOperationalSchema(runtime.env);
  } catch {
    throw new RightsDeterminationError('DATA_FOUNDRY_SCHEMA is invalid');
  }
  let driver: SqlDriver;
  try {
    driver = await runtime.createDriver(connectionString, { schema });
  } catch {
    throw new RightsDeterminationError('cannot connect using POSTGRES_URL');
  }
  let result: RightsDeterminationRecordResult | null = null;
  let failure: unknown = null;
  try {
    result = await recordRightsDetermination(driver, determination, { dryRun: options.dryRun });
  } catch (error) {
    failure = error;
  } finally {
    try {
      await driver.close();
    } catch {
      if (failure === null) failure = new RightsDeterminationError('cannot close the POSTGRES_URL connection');
    }
  }
  if (failure !== null) throw failure;
  runtime.writeStdout(`${JSON.stringify(result)}\n`);
  return result!;
}

/** Database errors can echo parameters; report only the SQLSTATE class. */
export function describeRecordFailure(error: unknown): string {
  if (error instanceof RightsDeterminationError) return error.message;
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)
    ? `database refused the determination (SQLSTATE ${code})`
    : 'unexpected rights determination failure';
}

if (isMain(import.meta.url)) {
  try {
    await runRecordRightsDeterminationCli(process.argv.slice(2), {
      env: process.env,
      createDriver: createPostgresDriver,
      writeStdout: (text) => process.stdout.write(text),
    });
  } catch (error) {
    process.stderr.write(`Rights determination refused: ${describeRecordFailure(error)}\n`);
    process.exitCode = 1;
  }
}
