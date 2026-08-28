import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { evaluateRights } from '@data-foundry/rights-engine';
import { loadStoredRightsContext } from '../src/index.js';
import { createFixtures, type Fixtures } from './support.js';

const PUBLISHER = '81000000-0000-4000-8000-000000000001';
const TERMS_EVIDENCE = '81000000-0000-4000-8000-000000000002';
const DECISION_EVIDENCE = '81000000-0000-4000-8000-000000000003';
const TERMS_CELL = '81000000-0000-4000-8000-000000000004';
const TERMS_VERSION = '81000000-0000-4000-8000-000000000005';
const RIGHTS_CELL = '81000000-0000-4000-8000-000000000006';
const ALLOW = '81000000-0000-4000-8000-000000000007';
const FUTURE_DENY = '81000000-0000-4000-8000-000000000008';
const HASH = 'd'.repeat(64);
const EFFECTIVE = '2026-08-01T00:00:00.000Z';
const NOW = '2026-08-15T12:00:00.000Z';
const FUTURE = '2026-08-20T00:00:00.000Z';
const RECHECK = '2027-08-01T00:00:00.000Z';

let fixtures: Fixtures;

beforeAll(async () => {
  fixtures = await createFixtures({ trigram: false });
  const source = fixtures.sources.manufacturer.source;
  await fixtures.driver.query(
    `INSERT INTO rights_publishers (id, publisher_key, legal_name, status)
     VALUES ($1, 'acme-climate-rights', 'Acme Climate LLC', 'ACTIVE')`,
    [PUBLISHER],
  );
  await fixtures.driver.query(
    `INSERT INTO rights_evidence_artifacts
       (id, kind, canonical_uri, storage_uri, content_sha256, mime_type, captured_at, created_by)
     VALUES ($1, 'TERMS', 'repo://terms/acme-v1', 'repo://terms/acme-v1.txt', $3,
             'text/plain', $4, 'test-owner'),
            ($2, 'REVIEW_MEMO', 'repo://reviews/acme-v1', 'repo://reviews/acme-v1.txt', $3,
             'text/plain', $4, 'test-owner')`,
    [TERMS_EVIDENCE, DECISION_EVIDENCE, HASH, EFFECTIVE],
  );
  await fixtures.driver.query(
    `UPDATE sources
        SET rights_publisher_id = $1,
            rights_publisher_mapping_evidence_artifact_id = $3,
            rights_publisher_mapping_reviewer_type = 'HUMAN',
            rights_publisher_mapping_reviewed_by = 'test-owner',
            rights_publisher_mapping_reviewed_at = $4
      WHERE id = $2`,
    [PUBLISHER, source.id, DECISION_EVIDENCE, EFFECTIVE],
  );
  await fixtures.driver.query(
    `INSERT INTO rights_terms_cells
       (id, source_id, acquisition_route, account_or_product_plan, jurisdiction, created_by)
     VALUES ($1, $2, 'VENDOR_API', 'commercial', 'US', 'test-owner')`,
    [TERMS_CELL, source.id],
  );
  await fixtures.driver.query(
    `INSERT INTO rights_terms_versions
       (id, terms_cell_id, evidence_artifact_id, content_sha256, version_label,
        effective_from, recheck_at, created_by)
     VALUES ($1, $2, $3, $4, 'v1', $5, $6, 'test-owner')`,
    [TERMS_VERSION, TERMS_CELL, TERMS_EVIDENCE, HASH, EFFECTIVE, RECHECK],
  );
  await fixtures.driver.query(
    `SELECT activate_rights_terms($1, 'HUMAN', 'test-owner', 'fixture terms', $2)`,
    [TERMS_VERSION, EFFECTIVE],
  );

  await fixtures.driver.exec('BEGIN');
  try {
    await fixtures.driver.query(
      `INSERT INTO rights_cells
         (id, source_id, acquisition_route, account_or_product_plan, jurisdiction,
          asset_class, field_key, output_class, operation, channel, created_by)
       VALUES ($1, $2, 'VENDOR_API', 'commercial', 'US', 'DATA', 'seer2_rating',
               'NORMALIZED_FACT', 'SERVE_API_ACCESS', 'DIRECT_CUSTOMER_API', 'test-owner')`,
      [RIGHTS_CELL, source.id],
    );
    await fixtures.driver.query(
      `INSERT INTO rights_decisions
         (id, cell_id, state, controlling_terms_version_id, evidence_artifact_id, clause_ref,
          review_status, reviewer_type, reviewed_by, reviewed_at, effective_from, recheck_at,
          rationale, supersedes_decision_id, created_by)
       VALUES
         ($1, $3, 'ALLOW', $4, $5, 'section 1', 'APPROVED', 'HUMAN', 'test-owner',
          $6, $6, $7, 'fixture direct API allow', NULL, 'test-owner'),
         ($2, $3, 'DENY', $4, $5, 'section 2', 'APPROVED', 'HUMAN', 'test-owner',
          $6, $6, $7, 'future revocation', $1, 'test-owner')`,
      [ALLOW, FUTURE_DENY, RIGHTS_CELL, TERMS_VERSION, DECISION_EVIDENCE, EFFECTIVE, RECHECK],
    );
    await fixtures.driver.query(
      `SELECT activate_rights_decision($1, 'HUMAN', 'test-owner', 'initial allow', $3),
              activate_rights_decision($2, 'HUMAN', 'test-owner', 'future deny', $4)`,
      [ALLOW, FUTURE_DENY, EFFECTIVE, FUTURE],
    );
    await fixtures.driver.exec('COMMIT');
  } catch (error) {
    await fixtures.driver.exec('ROLLBACK');
    throw error;
  }
});

afterAll(async () => {
  await fixtures?.driver.close();
});

describe('rights store snapshot', () => {
  it('loads the current decision as of the requested instant, not a future activation', async () => {
    const stored = await loadStoredRightsContext(
      fixtures.driver,
      fixtures.sources.manufacturer.source.id,
      NOW,
    );
    expect(stored).not.toBeNull();
    expect(stored?.snapshot.candidates.map((entry) => entry.decision.id)).toEqual([ALLOW]);
    const decision = evaluateRights(
      {
        source: stored!.source,
        sourceStatusRequirement: 'ACTIVE',
        acquisitionRoute: 'VENDOR_API',
        accountOrProductPlan: 'commercial',
        jurisdiction: 'US',
        assetClass: 'DATA',
        fieldKey: 'seer2_rating',
        fieldGroupIds: [],
        outputClass: 'NORMALIZED_FACT',
        operation: 'SERVE_API_ACCESS',
        channel: 'DIRECT_CUSTOMER_API',
        asOf: NOW,
        conditionReceipts: [],
      },
      stored!.snapshot,
    );
    expect(decision).toMatchObject({ permitted: true, decisionId: ALLOW, reasonCode: 'ALLOW' });
  });

  it('selects the later immutable DENY once its activation instant arrives', async () => {
    const stored = await loadStoredRightsContext(
      fixtures.driver,
      fixtures.sources.manufacturer.source.id,
      FUTURE,
    );
    expect(stored?.snapshot.candidates.map((entry) => entry.decision.id)).toEqual([FUTURE_DENY]);
  });

  it('returns an empty, unmapped snapshot for a legacy source instead of inferring permission', async () => {
    const stored = await loadStoredRightsContext(
      fixtures.driver,
      fixtures.sources.aggregator.source.id,
      NOW,
    );
    expect(stored?.source.publisherId).toBeNull();
    expect(stored?.snapshot.candidates).toEqual([]);
  });
});
