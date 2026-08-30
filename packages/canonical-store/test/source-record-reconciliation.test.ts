import { afterEach, describe, expect, it } from 'vitest';
import type { SourceRecordInsert } from '@data-foundry/canonical-schema';
import { createFixtures, type Fixtures } from './support.js';

let fixtures: Fixtures | null = null;

afterEach(async () => {
  await fixtures?.driver.close();
  fixtures = null;
});

function recordInput(source: Fixtures['sources']['manufacturer']): SourceRecordInsert {
  return {
    source_id: source.source.id,
    artifact_id: source.artifact.id,
    source_record_key: source.record.source_record_key,
    source_stream: source.record.source_stream ?? 'fixture_records',
    entity_type: source.record.entity_type,
    raw_payload: source.record.raw_payload,
    normalized_payload: source.record.normalized_payload,
    extraction_confidence: source.record.extraction_confidence,
    extractor_version: source.record.extractor_version,
  };
}

describe('source-record reconciliation', () => {
  it('does not churn an exactly identical finalized revision', async () => {
    fixtures = await createFixtures({ trigram: false });
    const source = fixtures.sources.manufacturer;
    const input = recordInput(source);
    await fixtures.store.recordEntityEvidence({
      entity_id: fixtures.entity.id,
      artifact_id: source.artifact.id,
      source_record_id: source.record.id,
      contribution_role: 'EXISTENCE',
      locator_type: 'JSON_POINTER',
      locator_value: '/products/0',
      observed_at: '2026-01-05T00:00:00.000Z' as never,
    });
    await fixtures.driver.query(
      `UPDATE source_records SET updated_at = '2026-01-05T00:00:00.000Z' WHERE id = $1`,
      [source.record.id],
    );

    const [before] = await fixtures.driver.query<{
      id: string;
      updated_at: string;
      revision_state: string;
    }>(
      `SELECT id, updated_at, revision_state FROM source_records WHERE id = $1`,
      [source.record.id],
    );
    const reconciled = await fixtures.driver.transaction((tx) =>
      fixtures!.store.reconcileSourceRecord(
        input,
        tx,
        'd'.repeat(64),
        '2026-08-30T00:00:00.000Z' as never,
      ),
    );
    const [after] = await fixtures.driver.query<{
      id: string;
      updated_at: string;
      revision_state: string;
    }>(
      `SELECT id, updated_at, revision_state FROM source_records WHERE id = $1`,
      [source.record.id],
    );

    expect(before?.id).toBe(source.record.id);
    expect(before?.revision_state).toBe('FINALIZED');
    expect(reconciled.id).toBe(source.record.id);
    expect(after).toEqual(before);
    await expect(fixtures.store.recordSourceRecord(input)).rejects.toThrow(
      /source_records_current_source_key_uniq|duplicate key/i,
    );
  });

  it('only finalizes a matching provisional row in place and supersedes every finalized change', async () => {
    fixtures = await createFixtures({ trigram: false });
    const source = fixtures.sources.manufacturer;
    const provisional: SourceRecordInsert = {
      ...recordInput(source),
      source_record_key: 'reconcile-provisional-001',
      raw_payload: { model: 'PROVISIONAL001' },
      normalized_payload: null,
      extractor_version: 'reconcile-test@1',
    };
    const initial = await fixtures.store.ensureSourceRecord(provisional);
    await expect(fixtures.store.recordEntityEvidence({
      entity_id: fixtures.entity.id,
      artifact_id: source.artifact.id,
      source_record_id: initial.id,
      contribution_role: 'EXISTENCE',
      locator_type: 'JSON_POINTER',
      locator_value: '/products/0',
      observed_at: '2026-01-05T00:00:00.000Z' as never,
    })).rejects.toThrow(/finalized source-record revision/i);
    const finalized = await fixtures.driver.transaction((tx) =>
      fixtures!.store.reconcileSourceRecord({
        ...provisional,
        normalized_payload: { model: 'PROVISIONAL001' },
      }, tx, 'a'.repeat(64), '2026-08-30T00:00:00.000Z' as never),
    );
    await fixtures.store.recordEntityEvidence({
      entity_id: fixtures.entity.id,
      artifact_id: source.artifact.id,
      source_record_id: finalized.id,
      contribution_role: 'EXISTENCE',
      locator_type: 'JSON_POINTER',
      locator_value: '/products/0',
      observed_at: '2026-01-05T00:00:00.000Z' as never,
    });
    const replacement = await fixtures.driver.transaction((tx) =>
      fixtures!.store.reconcileSourceRecord({
        ...provisional,
        raw_payload: { model: 'REEXTRACTED001' },
        normalized_payload: { model: 'REEXTRACTED001' },
        extractor_version: 'reconcile-test@2',
      }, tx, 'b'.repeat(64), '2026-08-30T00:00:01.000Z' as never),
    );
    const revisions = await fixtures.driver.query<{
      id: string;
      artifact_id: string;
      raw_payload: { model: string };
      revision_state: string;
      is_current: boolean;
    }>(
      `SELECT id, artifact_id, raw_payload, revision_state, is_current
         FROM source_records
        WHERE source_id = $1 AND source_record_key = $2
        ORDER BY created_at, id`,
      [source.source.id, provisional.source_record_key],
    );
    const links = await fixtures.driver.query<{
      superseded_source_record_id: string;
      replacement_source_record_id: string;
    }>(
      `SELECT superseded_source_record_id, replacement_source_record_id
         FROM source_record_reconciliations
        WHERE superseded_source_record_id = $1`,
      [finalized.id],
    );

    expect(finalized.id).toBe(initial.id);
    expect(replacement.id).not.toBe(finalized.id);
    expect(revisions).toEqual([
      expect.objectContaining({
        id: finalized.id,
        artifact_id: source.artifact.id,
        raw_payload: { model: 'PROVISIONAL001' },
        revision_state: 'FINALIZED',
        is_current: false,
      }),
      expect.objectContaining({
        id: replacement.id,
        artifact_id: source.artifact.id,
        raw_payload: { model: 'REEXTRACTED001' },
        revision_state: 'FINALIZED',
        is_current: true,
      }),
    ]);
    expect(links).toEqual([{
      superseded_source_record_id: finalized.id,
      replacement_source_record_id: replacement.id,
    }]);
    await expect(fixtures.driver.query(
      `UPDATE source_records SET raw_payload = '{"model":"MUTATED"}'::jsonb WHERE id = $1`,
      [finalized.id],
    )).rejects.toThrow(/finalized source-record revision is immutable/i);
    await expect(fixtures.driver.query(
      `UPDATE source_records SET is_current = TRUE WHERE id = $1`,
      [finalized.id],
    )).rejects.toThrow(/cannot become current again/i);
  });

  it('supersedes finalized lineage when validation semantics change without changing extraction', async () => {
    fixtures = await createFixtures({ trigram: false });
    const source = fixtures.sources.manufacturer;
    const input = recordInput(source);
    await fixtures.store.recordEntityEvidence({
      entity_id: fixtures.entity.id,
      artifact_id: source.artifact.id,
      source_record_id: source.record.id,
      contribution_role: 'ALIAS',
      locator_type: 'JSON_POINTER',
      locator_value: '/products/0/model',
      observed_at: '2026-01-05T00:00:00.000Z' as never,
    });
    const replacement = await fixtures.driver.transaction((tx) =>
      fixtures!.store.reconcileSourceRecord(
        input,
        tx,
        'a'.repeat(64),
        '2026-08-30T00:00:00.000Z' as never,
      ),
    );
    const revisions = await fixtures.driver.query<{
      id: string;
      is_current: boolean;
      evidence_fingerprint: string;
    }>(
      `SELECT id, is_current, evidence_fingerprint FROM source_records
        WHERE source_id = $1 AND source_record_key = $2 ORDER BY created_at, id`,
      [source.source.id, source.record.source_record_key],
    );

    expect(replacement.id).not.toBe(source.record.id);
    expect(revisions).toEqual([
      expect.objectContaining({
        id: source.record.id,
        is_current: false,
        evidence_fingerprint: 'd'.repeat(64),
      }),
      expect.objectContaining({
        id: replacement.id,
        is_current: true,
        evidence_fingerprint: 'a'.repeat(64),
      }),
    ]);
  });
});
