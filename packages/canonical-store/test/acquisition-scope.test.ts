import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  extractionConfidence,
  factConfidence,
  policySnapshotId,
  type AcquisitionMethod,
  type Identifier,
  type PolicySnapshotId,
} from '@data-foundry/canonical-schema';
import { createFixtures, ts, type Fixtures } from './support.js';

let fixtures: Fixtures;

beforeAll(async () => {
  fixtures = await createFixtures();
});

afterAll(async () => {
  await fixtures?.driver.close();
});

interface ScopeFixture {
  readonly suffix: 'b' | 'c';
  readonly acquisitionRoute: AcquisitionMethod;
  readonly accountOrProductPlan: string | null;
  readonly acquisitionJurisdiction: string | null;
  readonly policySnapshotId: PolicySnapshotId | null;
}

async function loadCandidateArtifact(scope: ScopeFixture): Promise<Record<string, unknown>> {
  const source = fixtures.sources.manufacturer;
  const property = `scope_probe_${scope.suffix}` as Identifier;
  const observedAt = ts('2026-03-01T00:00:00Z');
  if (scope.policySnapshotId !== null) {
    const snapshotHash = 'd'.repeat(64);
    await fixtures.driver.query(
      `INSERT INTO acquisition_policy_snapshots
         (id, snapshot_hash, captured_at, snapshot)
       VALUES ($1, $2, $3, $4::jsonb)`,
      [
        scope.policySnapshotId,
        snapshotHash,
        ts('2026-01-15T00:00:00Z'),
        JSON.stringify({ id: scope.policySnapshotId, snapshot_hash: snapshotHash }),
      ],
    );
  }
  const artifact = await fixtures.store.recordSourceArtifact({
    source_id: source.source.id,
    url: `https://${source.source.domain}/scope-${scope.suffix}`,
    retrieved_at: ts('2026-02-01T00:00:00Z'),
    content_hash: scope.suffix.repeat(64),
    mime_type: 'application/json',
    r2_uri: `r2://raw/hvac/manufacturer/scope-${scope.suffix}.json`,
    http_status: 200,
    extractor_version: 'json-1.0.0',
    policy_snapshot_id: scope.policySnapshotId,
    byte_size: 128,
    acquisition_provider: 'http',
    acquisition_route: scope.acquisitionRoute,
    account_or_product_plan: scope.accountOrProductPlan,
    acquisition_jurisdiction: scope.acquisitionJurisdiction,
  });
  const record = await fixtures.store.recordSourceRecord({
    source_id: source.source.id,
    artifact_id: artifact.id,
    source_record_key: `scope-${scope.suffix}`,
    entity_type: 'equipment',
    raw_payload: { scope: scope.suffix },
    normalized_payload: null,
    extraction_confidence: extractionConfidence(0.99),
    extractor_version: 'json-1.0.0',
  });
  await fixtures.store.appendFactWithEvidence(
    {
      entity_id: fixtures.entity.id,
      property,
      normalized_value: scope.suffix,
      value_type: 'string',
      unit: null,
      valid_from: observedAt,
      confidence: factConfidence(0.99),
      recorded_at: observedAt,
      status: 'ACTIVE',
    },
    [
      {
        artifact_id: artifact.id,
        source_record_id: record.id,
        source_value: scope.suffix,
        locator_type: 'JSON_POINTER',
        locator_value: '/scope',
        observed_at: observedAt,
      },
    ],
  );

  const candidates = await fixtures.store.loadFactCandidates(
    fixtures.entity.id,
    property,
    ts('2026-04-01T00:00:00Z'),
  );
  const loaded = candidates[0]?.evidence[0]?.artifact;
  expect(loaded).toBeDefined();
  return loaded as unknown as Record<string, unknown>;
}

describe('fact-candidate acquisition scope', () => {
  it('preserves the exact artifact scope and policy snapshot for downstream authorization', async () => {
    const snapshot = policySnapshotId('81000000-0000-4000-8000-000000000001');
    const artifact = await loadCandidateArtifact({
      suffix: 'b',
      acquisitionRoute: 'VENDOR_API',
      accountOrProductPlan: 'commercial-v2',
      acquisitionJurisdiction: 'US',
      policySnapshotId: snapshot,
    });

    expect(artifact).toMatchObject({
      policy_snapshot_id: snapshot,
      acquisition_route: 'VENDOR_API',
      account_or_product_plan: 'commercial-v2',
      acquisition_jurisdiction: 'US',
    });
  });

  it('keeps unknown optional scope explicitly null instead of inventing defaults', async () => {
    const artifact = await loadCandidateArtifact({
      suffix: 'c',
      acquisitionRoute: 'DIRECT_HTTP',
      accountOrProductPlan: null,
      acquisitionJurisdiction: null,
      policySnapshotId: null,
    });

    for (const field of [
      'policy_snapshot_id',
      'account_or_product_plan',
      'acquisition_jurisdiction',
    ]) {
      expect(Object.hasOwn(artifact, field), field).toBe(true);
      expect(artifact[field], field).toBeNull();
    }
    expect(artifact['acquisition_route']).toBe('DIRECT_HTTP');
  });
});
