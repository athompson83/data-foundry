import type {
  RightsDecisionCandidate,
  RightsDecisionCondition,
  RightsDenyException,
  RightsSnapshot,
  RightsSourceGuard,
} from '@data-foundry/rights-engine';
import type { SqlDriver, SqlRow } from './sql-driver.js';
import { toIso, toIsoOrNull, toJson, toNumber, toText, toTextOrNull } from './rows.js';

export interface StoredRightsContext {
  readonly source: RightsSourceGuard;
  readonly snapshot: RightsSnapshot;
}

const candidateFromRow = (
  row: SqlRow,
  conditions: readonly RightsDecisionCondition[],
): RightsDecisionCandidate => ({
  cell: {
    id: toText(row['cell_id']),
    publisherId: toTextOrNull(row['publisher_id']),
    sourceId: toTextOrNull(row['source_id']),
    acquisitionRoute: toTextOrNull(row['acquisition_route']) as RightsDecisionCandidate['cell']['acquisitionRoute'],
    accountOrProductPlan: toTextOrNull(row['account_or_product_plan']),
    jurisdiction: toTextOrNull(row['jurisdiction']),
    assetClass: toTextOrNull(row['asset_class']) as RightsDecisionCandidate['cell']['assetClass'],
    fieldKey: toTextOrNull(row['field_key']),
    fieldGroupId: toTextOrNull(row['field_group_id']),
    outputClass: toTextOrNull(row['output_class']) as RightsDecisionCandidate['cell']['outputClass'],
    operation: toText(row['operation']) as RightsDecisionCandidate['cell']['operation'],
    channel: toText(row['channel']) as RightsDecisionCandidate['cell']['channel'],
  },
  decision: {
    id: toText(row['decision_id']),
    cellId: toText(row['decision_cell_id']),
    state: toText(row['decision_state']) as RightsDecisionCandidate['decision']['state'],
    controllingTermsVersionId: toTextOrNull(row['controlling_terms_version_id']),
    evidenceArtifactId: toTextOrNull(row['decision_evidence_artifact_id']),
    clauseRef: toTextOrNull(row['clause_ref']),
    reviewStatus: toText(row['review_status']) as RightsDecisionCandidate['decision']['reviewStatus'],
    reviewerType: toText(row['reviewer_type']) as RightsDecisionCandidate['decision']['reviewerType'],
    reviewedBy: toTextOrNull(row['reviewed_by']),
    reviewedAt: toIso(row['reviewed_at']),
    effectiveFrom: toIsoOrNull(row['decision_effective_from']),
    effectiveUntil: toIsoOrNull(row['decision_effective_until']),
    recheckAt: toIsoOrNull(row['decision_recheck_at']),
  },
  terms:
    row['terms_version_id'] === null || row['terms_version_id'] === undefined
      ? null
      : {
          version: {
            id: toText(row['terms_version_id']),
            termsCellId: toText(row['terms_cell_id']),
            evidenceArtifactId: toText(row['terms_evidence_artifact_id']),
            contentSha256: toText(row['terms_content_sha256']),
            effectiveFrom: toIso(row['terms_effective_from']),
            effectiveUntil: toIsoOrNull(row['terms_effective_until']),
            recheckAt: toIso(row['terms_recheck_at']),
          },
          scope: {
            publisherId: toTextOrNull(row['terms_publisher_id']),
            sourceId: toTextOrNull(row['terms_source_id']),
            acquisitionRoute: toTextOrNull(row['terms_acquisition_route']) as NonNullable<
              RightsDecisionCandidate['terms']
            >['scope']['acquisitionRoute'],
            accountOrProductPlan: toTextOrNull(row['terms_account_or_product_plan']),
            jurisdiction: toTextOrNull(row['terms_jurisdiction']),
          },
          currentVersionId: toTextOrNull(row['current_terms_version_id']),
          activationState: toTextOrNull(row['current_terms_state']) as RightsDecisionCandidate['terms'] extends null
            ? never
            : NonNullable<RightsDecisionCandidate['terms']>['activationState'],
          activationActorType: toTextOrNull(row['terms_activation_actor_type']) as RightsDecisionCandidate['terms'] extends null
            ? never
            : NonNullable<RightsDecisionCandidate['terms']>['activationActorType'],
          activationOccurredAt: toIsoOrNull(row['terms_activation_occurred_at']),
        },
  conditions,
  activation: {
    decisionId: toText(row['decision_id']),
    cellId: toText(row['cell_id']),
    sequenceNo: toNumber(row['decision_sequence_no']),
    actorType: toText(row['decision_activation_actor_type']) as RightsDecisionCandidate['activation']['actorType'],
    actor: toText(row['decision_activation_actor']),
    occurredAt: toIso(row['decision_activation_occurred_at']),
  },
});

/**
 * Load the effective immutable rights history for one source as of one instant.
 * This performs no legal inference: missing mappings, cells, decisions, terms,
 * or activation events remain missing and the pure resolver refuses them.
 */
export async function loadStoredRightsContext(
  driver: SqlDriver,
  sourceId: string,
  asOf: string,
): Promise<StoredRightsContext | null> {
  const sourceRows = await driver.query(
    `SELECT s.id, s.rights_publisher_id, s.status, s.rights_classification,
            rp.status AS publisher_status
       FROM sources s
       LEFT JOIN rights_publishers rp ON rp.id = s.rights_publisher_id
      WHERE s.id = $1`,
    [sourceId],
  );
  const sourceRow = sourceRows[0];
  if (sourceRow === undefined) return null;
  const publisherId = toTextOrNull(sourceRow['rights_publisher_id']);

  const rows = await driver.query(
    `WITH current_decisions AS (
       SELECT DISTINCT ON (event.cell_id)
              event.cell_id, event.decision_id, event.sequence_no,
              event.actor_type, event.actor, event.occurred_at
         FROM rights_decision_activation_events event
        WHERE event.occurred_at <= $2
        ORDER BY event.cell_id, event.sequence_no DESC
     ), current_terms AS (
       SELECT DISTINCT ON (event.terms_cell_id)
              event.terms_cell_id, event.terms_version_id, event.state,
              event.actor_type, event.occurred_at
         FROM rights_terms_activation_events event
        WHERE event.occurred_at <= $2
        ORDER BY event.terms_cell_id, event.sequence_no DESC
     )
     SELECT cell.id AS cell_id, cell.publisher_id, cell.source_id,
            cell.acquisition_route, cell.account_or_product_plan, cell.jurisdiction,
            cell.asset_class, cell.field_key, cell.field_group_id, cell.output_class,
            cell.operation, cell.channel,
            decision.id AS decision_id, decision.cell_id AS decision_cell_id,
            decision.state AS decision_state,
            decision.controlling_terms_version_id,
            decision.evidence_artifact_id AS decision_evidence_artifact_id,
            decision.clause_ref, decision.review_status, decision.reviewer_type,
            decision.reviewed_by, decision.reviewed_at,
            decision.effective_from AS decision_effective_from,
            decision.effective_until AS decision_effective_until,
            decision.recheck_at AS decision_recheck_at,
            active.sequence_no AS decision_sequence_no,
            active.actor_type AS decision_activation_actor_type,
            active.actor AS decision_activation_actor,
            active.occurred_at AS decision_activation_occurred_at,
            terms.id AS terms_version_id, terms.terms_cell_id,
            terms.evidence_artifact_id AS terms_evidence_artifact_id,
            terms.content_sha256 AS terms_content_sha256,
            terms.effective_from AS terms_effective_from,
            terms.effective_until AS terms_effective_until,
            terms.recheck_at AS terms_recheck_at,
            terms_cell.publisher_id AS terms_publisher_id,
            terms_cell.source_id AS terms_source_id,
            terms_cell.acquisition_route AS terms_acquisition_route,
            terms_cell.account_or_product_plan AS terms_account_or_product_plan,
            terms_cell.jurisdiction AS terms_jurisdiction,
            current_terms.terms_version_id AS current_terms_version_id,
            current_terms.state AS current_terms_state,
            current_terms.actor_type AS terms_activation_actor_type,
            current_terms.occurred_at AS terms_activation_occurred_at
       FROM current_decisions active
       JOIN rights_cells cell ON cell.id = active.cell_id
       JOIN rights_decisions decision ON decision.id = active.decision_id
       LEFT JOIN rights_terms_versions terms
              ON terms.id = decision.controlling_terms_version_id
       LEFT JOIN rights_terms_cells terms_cell ON terms_cell.id = terms.terms_cell_id
       LEFT JOIN current_terms ON current_terms.terms_cell_id = terms.terms_cell_id
      WHERE cell.source_id = $1 OR ($3::uuid IS NOT NULL AND cell.publisher_id = $3::uuid)
      ORDER BY cell.id`,
    [sourceId, asOf, publisherId],
  );

  const decisionIds = rows.map((row) => toText(row['decision_id']));
  const conditionsByDecision = new Map<string, RightsDecisionCondition[]>();
  if (decisionIds.length > 0) {
    const placeholders = decisionIds.map((_, index) => `$${index + 1}`).join(', ');
    const conditionRows = await driver.query(
      `SELECT id, decision_id, condition_key, condition_type, evaluator_key,
              evaluator_version, parameters_sha256, parameters_canonical,
              parameters, audit_required
         FROM rights_decision_conditions
        WHERE decision_id IN (${placeholders})
        ORDER BY decision_id, condition_key`,
      decisionIds,
    );
    for (const row of conditionRows) {
      const decisionId = toText(row['decision_id']);
      const condition: RightsDecisionCondition = {
        id: toText(row['id']),
        decisionId,
        conditionKey: toText(row['condition_key']),
        conditionType: toText(row['condition_type']) as RightsDecisionCondition['conditionType'],
        evaluatorKey: toText(row['evaluator_key']),
        evaluatorVersion: toText(row['evaluator_version']),
        parametersSha256: toText(row['parameters_sha256']),
        parametersCanonical: toText(row['parameters_canonical']),
        parameters: toJson(row['parameters']) as Readonly<Record<string, unknown>>,
        auditRequired: row['audit_required'] === true,
      };
      const bucket = conditionsByDecision.get(decisionId);
      if (bucket === undefined) conditionsByDecision.set(decisionId, [condition]);
      else bucket.push(condition);
    }
  }

  const candidates = rows.map((row) => {
    const decisionId = toText(row['decision_id']);
    return candidateFromRow(row, conditionsByDecision.get(decisionId) ?? []);
  });

  const denyExceptions: RightsDenyException[] = [];
  if (decisionIds.length > 0) {
    const placeholders = decisionIds.map((_, index) => `$${index + 1}`).join(', ');
    const exceptionRows = await driver.query(
      `SELECT id, deny_decision_id, exception_decision_id, evidence_artifact_id,
              clause_ref, reviewer_type, reviewed_by, reviewed_at,
              effective_from, effective_until, recheck_at
         FROM rights_deny_exceptions
        WHERE deny_decision_id IN (${placeholders})
          AND exception_decision_id IN (${placeholders})
        ORDER BY id`,
      decisionIds,
    );
    for (const row of exceptionRows) {
      denyExceptions.push({
        id: toText(row['id']),
        denyDecisionId: toText(row['deny_decision_id']),
        exceptionDecisionId: toText(row['exception_decision_id']),
        evidenceArtifactId: toText(row['evidence_artifact_id']),
        clauseRef: toText(row['clause_ref']),
        reviewerType: toText(row['reviewer_type']) as RightsDenyException['reviewerType'],
        reviewedBy: toText(row['reviewed_by']),
        reviewedAt: toIso(row['reviewed_at']),
        effectiveFrom: toIso(row['effective_from']),
        effectiveUntil: toIsoOrNull(row['effective_until']),
        recheckAt: toIso(row['recheck_at']),
      });
    }
  }

  const fieldGroupMembers = new Map<string, string[]>();
  const groupRows = await driver.query(
    `SELECT member.field_group_id, member.field_key
       FROM rights_field_group_members member
      WHERE member.source_id = $1
      ORDER BY member.field_group_id, member.field_key`,
    [sourceId],
  );
  for (const row of groupRows) {
    const id = toText(row['field_group_id']);
    const bucket = fieldGroupMembers.get(id);
    if (bucket === undefined) fieldGroupMembers.set(id, [toText(row['field_key'])]);
    else bucket.push(toText(row['field_key']));
  }

  return {
    source: {
      id: toText(sourceRow['id']),
      publisherId,
      status: toText(sourceRow['status']),
      rightsClassification: toText(sourceRow['rights_classification']) as RightsSourceGuard['rightsClassification'],
      killSwitchEngaged: false,
      prohibited:
        sourceRow['publisher_status'] === 'PROHIBITED' ||
        sourceRow['publisher_status'] === 'RETIRED',
    },
    snapshot: {
      candidates,
      denyExceptions,
      sourcePublisherIds:
        publisherId === null ? new Map() : new Map([[toText(sourceRow['id']), publisherId]]),
      fieldGroupMembers,
    },
  };
}
