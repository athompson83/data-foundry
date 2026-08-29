import type { SqlDriver } from '../../packages/canonical-store/src/index.js';

export interface AcquisitionRightsTestScope {
  readonly acquisitionRoute: string;
  readonly assetClass: string;
  readonly outputClass: string;
}

/** Neutral test-only ACQUIRE/STORE/CACHE grants for one exact scope. */
export async function seedAcquisitionRights(input: {
  readonly driver: SqlDriver;
  readonly sourceId: string;
  readonly acquisitionRoute: string;
  readonly assetClass: string;
  readonly outputClass: string;
}): Promise<void> {
  await seedAcquisitionRightsScopes({
    driver: input.driver,
    sourceId: input.sourceId,
    scopes: [input],
  });
}

/** Explicit synthetic ACQUIRE/STORE/CACHE grants for exact scopes under one immutable publisher mapping. */
export async function seedAcquisitionRightsScopes(input: {
  readonly driver: SqlDriver;
  readonly sourceId: string;
  readonly scopes: readonly AcquisitionRightsTestScope[];
  readonly termsRecheckAt?: string;
  readonly decisionRecheckAt?: string;
}): Promise<void> {
  const publisherId = crypto.randomUUID();
  const termsEvidenceId = crypto.randomUUID();
  const reviewEvidenceId = crypto.randomUUID();
  const effective = '2026-08-01T00:00:00.000Z';
  const termsRecheck = input.termsRecheckAt ?? '2027-08-01T00:00:00.000Z';
  const decisionRecheck = input.decisionRecheckAt ?? '2027-08-01T00:00:00.000Z';
  await input.driver.query(
    `INSERT INTO rights_publishers (id, publisher_key, legal_name, status)
     VALUES ($1, $2, 'Synthetic acquisition test publisher', 'ACTIVE')`,
    [publisherId, `acquisition-test-${publisherId}`],
  );
  await input.driver.query(
    `INSERT INTO rights_evidence_artifacts
       (id, kind, canonical_uri, storage_uri, content_sha256, mime_type, captured_at, created_by)
     VALUES ($1, 'TERMS', $6, $7, $3, 'text/plain', $5, 'test-fixture'),
            ($2, 'REVIEW_MEMO', $8, $9, $4, 'text/plain', $5, 'test-fixture')`,
    [
      termsEvidenceId,
      reviewEvidenceId,
      'a'.repeat(64),
      'b'.repeat(64),
      effective,
      `fixture://${publisherId}/terms`,
      `fixture://${publisherId}/terms.txt`,
      `fixture://${publisherId}/review`,
      `fixture://${publisherId}/review.txt`,
    ],
  );
  await input.driver.query(
    `UPDATE sources SET rights_publisher_id = $1,
       rights_publisher_mapping_evidence_artifact_id = $3,
       rights_publisher_mapping_reviewer_type = 'HUMAN',
       rights_publisher_mapping_reviewed_by = 'test-fixture',
       rights_publisher_mapping_reviewed_at = $4
     WHERE id = $2`,
    [publisherId, input.sourceId, reviewEvidenceId, effective],
  );
  await input.driver.exec('BEGIN');
  try {
    for (const scope of input.scopes) {
      const termsCellId = crypto.randomUUID();
      const termsVersionId = crypto.randomUUID();
      await input.driver.query(
        `INSERT INTO rights_terms_cells
           (id, source_id, acquisition_route, created_by)
         VALUES ($1, $2, $3, 'test-fixture')`,
        [termsCellId, input.sourceId, scope.acquisitionRoute],
      );
      await input.driver.query(
        `INSERT INTO rights_terms_versions
           (id, terms_cell_id, evidence_artifact_id, content_sha256, version_label,
            effective_from, recheck_at, created_by)
         VALUES ($1, $2, $3, $4, 'test-v1', $5, $6, 'test-fixture')`,
        [termsVersionId, termsCellId, termsEvidenceId, 'a'.repeat(64), effective, termsRecheck],
      );
      await input.driver.query(
        `SELECT activate_rights_terms($1, 'HUMAN', 'test-fixture', 'synthetic test terms', $2)`,
        [termsVersionId, effective],
      );
      for (const operation of ['ACQUIRE', 'STORE', 'CACHE']) {
        const cellId = crypto.randomUUID();
        const decisionId = crypto.randomUUID();
        await input.driver.query(
          `INSERT INTO rights_cells
             (id, source_id, acquisition_route, asset_class, output_class,
              operation, channel, created_by)
           VALUES ($1, $2, $3, $4, $5, $6, 'INTERNAL_PROCESSING', 'test-fixture')`,
          [
            cellId,
            input.sourceId,
            scope.acquisitionRoute,
            scope.assetClass,
            scope.outputClass,
            operation,
          ],
        );
        await input.driver.query(
          `INSERT INTO rights_decisions
             (id, cell_id, state, controlling_terms_version_id, evidence_artifact_id, clause_ref,
              review_status, reviewer_type, reviewed_by, reviewed_at, effective_from, recheck_at,
              rationale, created_by)
           VALUES ($1, $2, 'ALLOW', $3, $4, 'synthetic fixture only', 'APPROVED', 'HUMAN',
                   'test-fixture', $5, $5, $6, 'explicit acquisition test grant', 'test-fixture')`,
          [decisionId, cellId, termsVersionId, reviewEvidenceId, effective, decisionRecheck],
        );
        await input.driver.query(
          `SELECT activate_rights_decision($1, 'HUMAN', 'test-fixture', 'synthetic test grant', $2)`,
          [decisionId, effective],
        );
      }
    }
    await input.driver.exec('COMMIT');
  } catch (error) {
    await input.driver.exec('ROLLBACK');
    throw error;
  }
}
