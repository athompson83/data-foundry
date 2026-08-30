import { afterEach, describe, expect, it } from 'vitest';
import { identityConfidence } from '@data-foundry/canonical-schema';
import { createFixtures, ts, type Fixtures } from './support.js';

let fixtures: Fixtures | null = null;

afterEach(async () => {
  await fixtures?.driver.close();
  fixtures = null;
});

const sourceAlias = (fixture: Fixtures, value: string, sourceId = fixture.sources.manufacturer.source.id) => ({
  entity_id: fixture.entity.id,
  alias_type: 'external_id' as const,
  alias_value: value,
  normalized_value: value.toLowerCase(),
  source_id: sourceId,
  identity_confidence: identityConfidence(0.96),
  valid_from: ts('2026-08-30T00:00:00Z'),
  valid_to: null,
});

describe('alias claim currentness', () => {
  it('does not activate a staged source alias until a current finalized record claims it', async () => {
    fixtures = await createFixtures({ trigram: false });
    const record = fixtures.sources.manufacturer.record;
    const alias = await fixtures.store.stageSourceAlias(sourceAlias(fixtures, 'SOURCE-ONLY-1'));

    expect((await fixtures.store.listAliases(fixtures.entity.id)).map((item) => item.id))
      .not.toContain(alias.id);

    const claim = await fixtures.store.recordSourceAliasClaim({
      entity_alias_id: alias.id,
      asserted_alias_value: 'SOURCE-ONLY-1',
      identity_confidence: identityConfidence(0.96),
      source_record_id: record.id,
      locator_type: 'JSON_POINTER',
      locator_value: '/products/0/model',
    });
    const repeated = await fixtures.store.recordSourceAliasClaim({
      entity_alias_id: alias.id,
      asserted_alias_value: 'SOURCE-ONLY-1',
      identity_confidence: identityConfidence(0.96),
      source_record_id: record.id,
      locator_type: 'JSON_POINTER',
      locator_value: '/products/0/model',
    });
    expect(repeated.id).toBe(claim.id);

    await fixtures.store.stageSourceAlias({
      ...sourceAlias(fixtures, 'SOURCE-ONLY-1'),
      alias_value: 'Source Only One (new display)',
      identity_confidence: identityConfidence(0.99),
    });
    expect(await fixtures.driver.query<{
      asserted_alias_value: string;
      identity_confidence: number;
    }>(
      `SELECT asserted_alias_value, identity_confidence
         FROM entity_alias_claims WHERE id = $1`,
      [claim.id],
    )).toEqual([{
      asserted_alias_value: 'SOURCE-ONLY-1',
      identity_confidence: 0.96,
    }]);
    expect((await fixtures.store.listAliases(fixtures.entity.id)).map((item) => item.id))
      .toContain(alias.id);

    await fixtures.driver.query(`UPDATE source_records SET is_current = FALSE WHERE id = $1`, [record.id]);
    expect((await fixtures.store.listAliases(fixtures.entity.id)).map((item) => item.id))
      .not.toContain(alias.id);
    expect(await fixtures.driver.query(
      `SELECT id FROM entity_alias_claims WHERE entity_alias_id = $1`,
      [alias.id],
    )).toHaveLength(1);
  });

  it('keeps a shared alias current while any independent source-record claim remains current', async () => {
    fixtures = await createFixtures({ trigram: false });
    const manufacturer = fixtures.sources.manufacturer;
    const certifier = fixtures.sources.certifier;
    const alias = await fixtures.store.stageSourceAlias(
      sourceAlias(fixtures, 'SHARED-ALIAS', manufacturer.source.id),
    );
    await fixtures.store.recordSourceAliasClaim({
      entity_alias_id: alias.id,
      asserted_alias_value: 'SHARED-ALIAS',
      identity_confidence: identityConfidence(0.96),
      source_record_id: manufacturer.record.id,
      locator_type: 'JSON_POINTER',
      locator_value: '/products/0/model',
    });
    await fixtures.store.stageSourceAlias(
      sourceAlias(fixtures, 'SHARED-ALIAS', certifier.source.id),
    );
    await fixtures.store.recordSourceAliasClaim({
      entity_alias_id: alias.id,
      asserted_alias_value: 'SHARED-ALIAS',
      identity_confidence: identityConfidence(0.96),
      source_record_id: certifier.record.id,
      locator_type: 'TABLE_CELL',
      locator_value: 'models!A2',
    });

    await fixtures.driver.query(`UPDATE source_records SET is_current = FALSE WHERE id = $1`, [manufacturer.record.id]);
    expect((await fixtures.store.listAliases(fixtures.entity.id)).map((item) => item.id))
      .toContain(alias.id);

    await fixtures.driver.query(`UPDATE source_records SET is_current = FALSE WHERE id = $1`, [certifier.record.id]);
    expect((await fixtures.store.listAliases(fixtures.entity.id)).map((item) => item.id))
      .not.toContain(alias.id);
    expect(await fixtures.driver.query(
      `SELECT id FROM entity_alias_claims WHERE entity_alias_id = $1`,
      [alias.id],
    )).toHaveLength(2);
  });

  it('keeps an explicit curated assertion current after source claims expire', async () => {
    fixtures = await createFixtures({ trigram: false });
    const record = fixtures.sources.manufacturer.record;
    const input = sourceAlias(fixtures, 'CURATED-SURVIVES');
    const alias = await fixtures.store.stageSourceAlias(input);
    await fixtures.store.recordSourceAliasClaim({
      entity_alias_id: alias.id,
      asserted_alias_value: 'CURATED-SURVIVES',
      identity_confidence: identityConfidence(0.96),
      source_record_id: record.id,
      locator_type: 'JSON_POINTER',
      locator_value: '/products/0/model',
    });
    const curated = await fixtures.store.addAlias({ ...input, source_id: input.source_id });
    await fixtures.store.addAlias({
      ...input,
      alias_value: 'Curated Survives (preferred display)',
      identity_confidence: identityConfidence(0.99),
    });

    await fixtures.driver.query(`UPDATE source_records SET is_current = FALSE WHERE id = $1`, [record.id]);
    expect((await fixtures.store.listAliases(fixtures.entity.id)).map((item) => item.id))
      .toContain(curated.id);
    expect(await fixtures.driver.query<{
      claim_kind: string;
      asserted_alias_value: string;
      identity_confidence: number;
    }>(
      `SELECT claim_kind, asserted_alias_value, identity_confidence
         FROM entity_alias_claims
        WHERE entity_alias_id = $1
        ORDER BY claim_kind, asserted_alias_value`,
      [alias.id],
    )).toEqual([
      {
        claim_kind: 'CURATED',
        asserted_alias_value: 'CURATED-SURVIVES',
        identity_confidence: 0.96,
      },
      {
        claim_kind: 'CURATED',
        asserted_alias_value: 'Curated Survives (preferred display)',
        identity_confidence: 0.99,
      },
      {
        claim_kind: 'SOURCE_RECORD',
        asserted_alias_value: 'CURATED-SURVIVES',
        identity_confidence: 0.96,
      },
    ]);
  });

  it('does not let source staging reopen a globally retired curated alias', async () => {
    fixtures = await createFixtures({ trigram: false });
    const input = sourceAlias(fixtures, 'GLOBAL-RETIREMENT');
    const alias = await fixtures.store.addAlias(input);
    const retiredAt = ts('2026-08-30T12:00:00Z');
    await fixtures.store.addAlias({ ...input, valid_to: retiredAt });

    expect((await fixtures.store.listAliases(fixtures.entity.id)).map((item) => item.id))
      .not.toContain(alias.id);

    const staged = await fixtures.store.stageSourceAlias({
      ...input,
      alias_value: 'Global Retirement (source rediscovery)',
      identity_confidence: identityConfidence(0.99),
      valid_to: null,
    });
    expect(staged.valid_to).toBe(retiredAt);
    await fixtures.store.recordSourceAliasClaim({
      entity_alias_id: alias.id,
      asserted_alias_value: 'Global Retirement (source rediscovery)',
      identity_confidence: identityConfidence(0.99),
      source_record_id: fixtures.sources.manufacturer.record.id,
      locator_type: 'JSON_POINTER',
      locator_value: '/products/0/model',
    });
    expect((await fixtures.store.listAliases(fixtures.entity.id)).map((item) => item.id))
      .not.toContain(alias.id);

    const reopened = await fixtures.store.addAlias({
      ...input,
      alias_value: 'Global Retirement (curated reopen)',
      identity_confidence: identityConfidence(0.99),
      valid_to: null,
    });
    expect(reopened.valid_to).toBeNull();
    expect((await fixtures.store.listAliases(fixtures.entity.id)).map((item) => item.id))
      .toContain(alias.id);
  });

  it('rejects source claims for provisional records and makes accepted claims immutable', async () => {
    fixtures = await createFixtures({ trigram: false });
    const source = fixtures.sources.manufacturer;
    const provisional = await fixtures.store.ensureSourceRecord({
      source_id: source.source.id,
      artifact_id: source.artifact.id,
      source_record_key: 'provisional-alias-claim',
      entity_type: 'equipment',
      raw_payload: { model: 'PROVISIONAL-ALIAS' },
      normalized_payload: null,
      extraction_confidence: source.record.extraction_confidence,
      extractor_version: source.record.extractor_version,
    });
    const alias = await fixtures.store.stageSourceAlias(sourceAlias(fixtures, 'PROVISIONAL-ALIAS'));

    await expect(fixtures.store.recordSourceAliasClaim({
      entity_alias_id: alias.id,
      asserted_alias_value: 'PROVISIONAL-ALIAS',
      identity_confidence: identityConfidence(0.96),
      source_record_id: provisional.id,
      locator_type: 'JSON_POINTER',
      locator_value: '/model',
    })).rejects.toThrow(/current finalized source-record/i);

    const accepted = await fixtures.store.recordSourceAliasClaim({
      entity_alias_id: alias.id,
      asserted_alias_value: 'PROVISIONAL-ALIAS',
      identity_confidence: identityConfidence(0.96),
      source_record_id: source.record.id,
      locator_type: 'JSON_POINTER',
      locator_value: '/model',
    });
    await expect(fixtures.driver.query(
      `UPDATE entity_alias_claims SET locator_value = '/changed' WHERE id = $1`,
      [accepted.id],
    )).rejects.toThrow(/alias claim history is append-only/i);
  });
});
