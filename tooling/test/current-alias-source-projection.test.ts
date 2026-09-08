import { afterEach, describe, expect, it } from 'vitest';
import { identityConfidence } from '@data-foundry/canonical-schema';
import { createFixtures, ts, type Fixtures, type SourceKey } from '../../packages/canonical-store/test/support.js';
import { loadMigrations } from '../scripts/migrate.js';

let fixtures: Fixtures | undefined;
afterEach(async () => { await fixtures?.driver.close(); fixtures = undefined; });

function aliasInput(fixture: Fixtures, value: string) {
  return {
    entity_id: fixture.entity.id,
    alias_type: 'external_id' as const,
    alias_value: value,
    normalized_value: value.toLowerCase(),
    source_id: fixture.sources.manufacturer.source.id,
    identity_confidence: identityConfidence(0.96),
    valid_from: ts('2000-01-01T00:00:00Z'),
    valid_to: null,
  };
}

async function contribute(fixture: Fixtures, aliasId: string, source: SourceKey, value: string, evidence = true) {
  const provenance = fixture.sources[source];
  const claim = await fixture.store.recordSourceAliasClaim({
    entity_alias_id: aliasId as never,
    asserted_alias_value: value,
    asserted_normalized_value: 'shared-id',
    identity_confidence: identityConfidence(0.96),
    source_record_id: provenance.record.id,
    locator_type: 'JSON_POINTER',
    locator_value: '/model',
  });
  if (evidence) await fixture.store.recordEntityEvidence({
    entity_id: fixture.entity.id,
    artifact_id: provenance.artifact.id,
    source_record_id: provenance.record.id,
    entity_alias_claim_id: claim.id,
    contribution_role: 'ALIAS',
    locator_type: 'JSON_POINTER',
    locator_value: '/model',
    observed_at: ts('2026-01-05T00:00:00Z'),
  });
}

async function projected(fixture: Fixtures, id: string) {
  return fixture.driver.query<{ alias_value: string; source_id: string | null; current_source_ids: string[] }>(
    'SELECT alias_value, source_id, current_source_ids FROM current_entity_aliases WHERE id = $1', [id],
  );
}

describe('current alias source projection migration', () => {
  it('collects every effective source before choosing display and excludes unsupported or superseded claims', async () => {
    fixtures = await createFixtures({ trigram: false });
    const alias = await fixtures.store.stageSourceAlias(aliasInput(fixtures, 'SHARED-ID'));
    await contribute(fixtures, alias.id, 'manufacturer', 'shared-id');
    await contribute(fixtures, alias.id, 'certifier', 'SHARED-ID');
    await contribute(fixtures, alias.id, 'aggregator', 'Shared Id', false);

    const [before] = await projected(fixtures, alias.id);
    expect(before?.alias_value).toBe('shared-id');
    expect(before?.source_id).toBe(fixtures.sources.manufacturer.source.id);
    expect(before?.current_source_ids.toSorted()).toEqual([
      fixtures.sources.manufacturer.source.id, fixtures.sources.certifier.source.id,
    ].sort());

    const fixture = fixtures;
    const record = fixture.sources.manufacturer.record;
    await fixture.driver.transaction(async (tx) => {
      await fixture.store.reconcileSourceRecord({
        source_id: record.source_id,
        artifact_id: record.artifact_id,
        source_record_key: record.source_record_key,
        source_stream: record.source_stream ?? 'fixture_records',
        entity_type: record.entity_type,
        raw_payload: { ...record.raw_payload, successor: true },
        normalized_payload: record.normalized_payload,
        extraction_confidence: record.extraction_confidence,
        extractor_version: record.extractor_version,
      }, tx, 'e'.repeat(64), ts('2026-08-30T00:00:00Z'));
    });
    expect(await projected(fixtures, alias.id)).toEqual([{
      alias_value: 'SHARED-ID', source_id: fixtures.sources.certifier.source.id,
      current_source_ids: [fixtures.sources.certifier.source.id],
    }]);
  });

  it('keeps unattributed curated aliases usable and drops old authority epochs on reopening', async () => {
    fixtures = await createFixtures({ trigram: false });
    const unattributed = await fixtures.store.addAlias({ ...aliasInput(fixtures, 'CURATED'), source_id: null });
    expect(await projected(fixtures, unattributed.id)).toEqual([{
      alias_value: 'CURATED', source_id: null, current_source_ids: [],
    }]);

    const input = aliasInput(fixtures, 'SHARED-ID');
    const alias = await fixtures.store.stageSourceAlias(input);
    await contribute(fixtures, alias.id, 'manufacturer', 'shared-id');
    await fixtures.store.addAlias({ ...input, valid_to: ts('2025-01-01T00:00:00Z') });
    expect(await projected(fixtures, alias.id)).toEqual([]);
    await fixtures.store.addAlias({ ...input, source_id: fixtures.sources.certifier.source.id });
    expect((await projected(fixtures, alias.id))[0]?.current_source_ids).toEqual([fixtures.sources.certifier.source.id]);
    const future = await fixtures.store.addAlias({ ...aliasInput(fixtures, 'FUTURE'), valid_from: ts('2099-01-01T00:00:00Z') });
    expect(await projected(fixtures, future.id)).toEqual([]);
  });

  it('appends a uuid array and preserves view-only reader grants when replacing the view', async () => {
    fixtures = await createFixtures({ trigram: false });
    const alias = await fixtures.store.addAlias(aliasInput(fixtures, 'READABLE'));
    await fixtures.driver.exec('CREATE ROLE df_edge NOLOGIN NOINHERIT; GRANT USAGE ON SCHEMA public TO df_edge; GRANT SELECT ON current_entity_aliases TO df_edge;');
    const migration = (await loadMigrations()).find((entry) => entry.version === '0032');
    if (migration === undefined) throw new Error('source projection migration missing');
    await fixtures.driver.exec(migration.sql);
    const columns = await fixtures.driver.query<{ column_name: string; udt_name: string }>(
      "SELECT column_name, udt_name FROM information_schema.columns WHERE table_schema='public' AND table_name='current_entity_aliases' ORDER BY ordinal_position",
    );
    expect(columns.map((column) => column.column_name)).toEqual([
      'id', 'entity_id', 'alias_type', 'alias_value', 'normalized_value', 'source_id',
      'identity_confidence', 'valid_from', 'valid_to', 'created_at', 'current_source_ids',
    ]);
    expect(columns.at(-1)?.udt_name).toBe('_uuid');
    await fixtures.driver.exec('SET ROLE df_edge');
    try {
      expect((await projected(fixtures, alias.id))[0]?.current_source_ids).toEqual([fixtures.sources.manufacturer.source.id]);
      await expect(fixtures.driver.query('SELECT * FROM entity_aliases')).rejects.toMatchObject({ code: '42501' });
      await expect(fixtures.driver.query('SELECT * FROM entity_alias_claims')).rejects.toMatchObject({ code: '42501' });
    } finally {
      await fixtures.driver.exec('RESET ROLE');
    }
  });
});
