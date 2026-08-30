import { afterEach, describe, expect, it } from 'vitest';
import { identityConfidence, type SourceRecord } from '@data-foundry/canonical-schema';
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

async function supersedeSourceRecord(fixture: Fixtures, record: SourceRecord): Promise<void> {
  await fixture.driver.transaction(async (tx) => {
    await fixture.store.reconcileSourceRecord({
      source_id: record.source_id,
      artifact_id: record.artifact_id,
      source_record_key: record.source_record_key,
      source_stream: record.source_stream ?? 'fixture_records',
      entity_type: record.entity_type,
      raw_payload: { ...record.raw_payload, test_successor: true },
      normalized_payload: record.normalized_payload,
      extraction_confidence: record.extraction_confidence,
      extractor_version: record.extractor_version,
    }, tx, 'e'.repeat(64), ts('2026-08-30T00:00:00Z'));
  });
}

describe('alias claim currentness', () => {
  it('honors the complete half-open alias validity window', async () => {
    fixtures = await createFixtures({ trigram: false });
    const future = await fixtures.store.addAlias({
      ...sourceAlias(fixtures, 'FUTURE-CURATED-ALIAS'),
      valid_from: ts('2099-01-01T00:00:00Z'),
    });
    const scheduled = await fixtures.store.addAlias({
      ...sourceAlias(fixtures, 'SCHEDULED-CURATED-EXPIRY'),
      valid_from: ts('2000-01-01T00:00:00Z'),
      valid_to: ts('2099-01-01T00:00:00Z'),
    });

    const currentIds = (await fixtures.store.listAliases(fixtures.entity.id))
      .map((alias) => alias.id);
    expect(currentIds).not.toContain(future.id);
    expect(currentIds).toContain(scheduled.id);
  });

  it('refuses a curated reopen with a different validity start instead of erasing the closed interval', async () => {
    fixtures = await createFixtures({ trigram: false });
    const input = {
      ...sourceAlias(fixtures, 'SCHEDULED-CURATED-REOPEN'),
      valid_from: ts('2026-01-01T00:00:00Z'),
    };
    const alias = await fixtures.store.addAlias(input);
    const retiredAt = ts('2026-08-29T00:00:00Z');
    await fixtures.store.addAlias({ ...input, valid_to: retiredAt });

    await expect(fixtures.store.addAlias({
      ...input,
      valid_from: ts('2027-01-01T00:00:00Z'),
      valid_to: null,
    })).rejects.toThrow(/reopen.*validity start|validity start.*reopen/i);

    expect(await fixtures.driver.query<{
      valid_from: Date;
      valid_to: Date | null;
      authority_epoch: number;
    }>(
      `SELECT valid_from, valid_to, authority_epoch
         FROM entity_aliases WHERE id = $1`,
      [alias.id],
    )).toEqual([{
      valid_from: new Date('2026-01-01T00:00:00Z'),
      valid_to: new Date('2026-08-29T00:00:00Z'),
      authority_epoch: 1,
    }]);
    expect((await fixtures.store.listAliases(fixtures.entity.id)).map((item) => item.id))
      .not.toContain(alias.id);
  });

  it('does not activate a staged source alias until a current finalized record claims it', async () => {
    fixtures = await createFixtures({ trigram: false });
    const record = fixtures.sources.manufacturer.record;
    const alias = await fixtures.store.stageSourceAlias(sourceAlias(fixtures, 'SOURCE-ONLY-1'));

    expect((await fixtures.store.listAliases(fixtures.entity.id)).map((item) => item.id))
      .not.toContain(alias.id);

    const claim = await fixtures.store.recordSourceAliasClaim({
      entity_alias_id: alias.id,
      asserted_alias_value: 'SOURCE-ONLY-1',
      asserted_normalized_value: 'source-only-1',
      identity_confidence: identityConfidence(0.96),
      source_record_id: record.id,
      locator_type: 'JSON_POINTER',
      locator_value: '/products/0/model',
    });
    const repeated = await fixtures.store.recordSourceAliasClaim({
      entity_alias_id: alias.id,
      asserted_alias_value: 'SOURCE-ONLY-1',
      asserted_normalized_value: 'source-only-1',
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

    await supersedeSourceRecord(fixtures, record);
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
      asserted_normalized_value: 'shared-alias',
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
      asserted_normalized_value: 'shared-alias',
      identity_confidence: identityConfidence(0.96),
      source_record_id: certifier.record.id,
      locator_type: 'TABLE_CELL',
      locator_value: 'models!A2',
    });

    await supersedeSourceRecord(fixtures, manufacturer.record);
    expect((await fixtures.store.listAliases(fixtures.entity.id)).map((item) => item.id))
      .toContain(alias.id);

    await supersedeSourceRecord(fixtures, certifier.record);
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
      asserted_normalized_value: 'curated-survives',
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

    await supersedeSourceRecord(fixtures, record);
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
      asserted_normalized_value: 'global-retirement',
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

  it('does not reactivate a pre-retirement spelling when a curator reopens the alias', async () => {
    fixtures = await createFixtures({ trigram: false });
    const normalized = 'reopen-epoch';
    const original = await fixtures.store.addAlias({
      ...sourceAlias(fixtures, 'Old certifier spelling', fixtures.sources.certifier.source.id),
      normalized_value: normalized,
      identity_confidence: identityConfidence(0.99),
    });
    await fixtures.store.addAlias({
      ...sourceAlias(fixtures, 'Old certifier spelling', fixtures.sources.certifier.source.id),
      normalized_value: normalized,
      identity_confidence: identityConfidence(0.99),
      valid_to: ts('2026-08-30T12:00:00Z'),
    });
    await fixtures.store.addAlias({
      ...sourceAlias(fixtures, 'Explicit reopen spelling', fixtures.sources.manufacturer.source.id),
      normalized_value: normalized,
      identity_confidence: identityConfidence(0.8),
      valid_to: null,
    });

    expect(await fixtures.store.listAliases(fixtures.entity.id)).toContainEqual(
      expect.objectContaining({
        id: original.id,
        alias_value: 'Explicit reopen spelling',
        source_id: fixtures.sources.manufacturer.source.id,
        identity_confidence: 0.8,
      }),
    );
  });

  it('rejects claims outside the current authority epoch and unsynchronized lifecycle changes', async () => {
    fixtures = await createFixtures({ trigram: false });
    const source = fixtures.sources.manufacturer;
    const alias = await fixtures.store.stageSourceAlias(sourceAlias(fixtures, 'EPOCH-BOUND'));
    const insertSourceClaimAtEpoch = (authorityEpoch: number) => fixtures!.driver.query(
      `INSERT INTO entity_alias_claims (
         entity_alias_id, asserted_alias_value, asserted_normalized_value,
         identity_confidence, claim_kind, source_id, source_record_id, authority_epoch,
         locator_type, locator_value, valid_to
       ) VALUES ($1, 'EPOCH-BOUND', 'epoch-bound', 0.96, 'SOURCE_RECORD', $2, $3, $4,
                 'JSON_POINTER', '/products/0/model', NULL)`,
      [alias.id, source.source.id, source.record.id, authorityEpoch],
    );

    await expect(insertSourceClaimAtEpoch(1)).rejects.toThrow(/current alias authority epoch/i);
    await expect(fixtures.driver.query(
      `UPDATE entity_aliases SET valid_to = $2 WHERE id = $1`,
      [alias.id, ts('2026-08-30T12:00:00Z')],
    )).rejects.toThrow(/authority epoch/i);
    await expect(fixtures.driver.query(
      `UPDATE entity_aliases SET authority_epoch = authority_epoch + 1 WHERE id = $1`,
      [alias.id],
    )).rejects.toThrow(/authority epoch/i);
    await expect(fixtures.driver.query(
      `UPDATE entity_aliases
          SET valid_to = $2, authority_epoch = authority_epoch + 2
        WHERE id = $1`,
      [alias.id, ts('2026-08-30T12:00:00Z')],
    )).rejects.toThrow(/authority epoch/i);

    await fixtures.store.addAlias({
      ...sourceAlias(fixtures, 'EPOCH-BOUND'),
      valid_to: ts('2026-08-30T12:00:00Z'),
    });
    await expect(insertSourceClaimAtEpoch(0)).rejects.toThrow(/current alias authority epoch/i);
  });

  it('never lets a claimed alias identity move or revive through raw row mutation', async () => {
    fixtures = await createFixtures({ trigram: false });
    const alias = await fixtures.store.addAlias(sourceAlias(fixtures, 'IMMUTABLE-IDENTITY'));
    const other = await fixtures.store.upsertEntity({
      vertical_id: fixtures.vertical.id,
      entity_type: fixtures.entity.entity_type,
      canonical_name: 'Other alias identity target',
      canonical_slug: 'other-alias-identity-target',
      status: 'ACTIVE',
      quality_score: fixtures.entity.quality_score,
      first_seen_at: fixtures.entity.first_seen_at,
      last_verified_at: null,
    });

    await expect(fixtures.driver.query(
      `UPDATE entity_aliases SET entity_id = $2 WHERE id = $1`,
      [alias.id, other.id],
    )).rejects.toThrow(/alias identity.*immutable/i);
    await expect(fixtures.driver.query(
      `UPDATE entity_aliases SET alias_type = 'model_number' WHERE id = $1`,
      [alias.id],
    )).rejects.toThrow(/alias identity.*immutable/i);
    await expect(fixtures.driver.query(
      `UPDATE entity_aliases SET normalized_value = 'temporary' WHERE id = $1`,
      [alias.id],
    )).rejects.toThrow(/alias identity.*immutable/i);

    expect(await fixtures.store.listAliases(fixtures.entity.id)).toContainEqual(
      expect.objectContaining({ id: alias.id, normalized_value: 'immutable-identity' }),
    );
    expect(await fixtures.store.listAliases(other.id)).toEqual([]);
  });

  it('rejects source claims for provisional records and makes accepted claims immutable', async () => {
    fixtures = await createFixtures({ trigram: false });
    const source = fixtures.sources.manufacturer;
    const provisional = await fixtures.store.ensureSourceRecord({
      source_id: source.source.id,
      artifact_id: source.artifact.id,
      source_record_key: 'provisional-alias-claim',
      source_stream: 'fixture_records',
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
      asserted_normalized_value: 'provisional-alias',
      identity_confidence: identityConfidence(0.96),
      source_record_id: provisional.id,
      locator_type: 'JSON_POINTER',
      locator_value: '/model',
    })).rejects.toThrow(/current finalized source-record/i);

    const accepted = await fixtures.store.recordSourceAliasClaim({
      entity_alias_id: alias.id,
      asserted_alias_value: 'PROVISIONAL-ALIAS',
      asserted_normalized_value: 'provisional-alias',
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

  it('projects presentation only from the deterministic winning current claim', async () => {
    fixtures = await createFixtures({ trigram: false });
    const manufacturer = fixtures.sources.manufacturer;
    const certifier = fixtures.sources.certifier;
    const filing = fixtures.sources.filing;
    const alias = await fixtures.store.stageSourceAlias({
      ...sourceAlias(fixtures, 'Manufacturer spelling', manufacturer.source.id),
      normalized_value: 'presentation-switch',
      identity_confidence: identityConfidence(0.71),
    });
    await fixtures.store.recordSourceAliasClaim({
      entity_alias_id: alias.id,
      asserted_alias_value: 'Manufacturer spelling',
      asserted_normalized_value: 'presentation-switch',
      identity_confidence: identityConfidence(0.71),
      source_record_id: manufacturer.record.id,
      locator_type: 'JSON_POINTER',
      locator_value: '/products/0/model',
    });
    await fixtures.store.stageSourceAlias({
      ...sourceAlias(fixtures, 'Certifier spelling', certifier.source.id),
      normalized_value: 'presentation-switch',
      identity_confidence: identityConfidence(0.98),
    });
    await fixtures.store.recordSourceAliasClaim({
      entity_alias_id: alias.id,
      asserted_alias_value: 'Certifier spelling',
      asserted_normalized_value: 'presentation-switch',
      identity_confidence: identityConfidence(0.98),
      source_record_id: certifier.record.id,
      locator_type: 'TABLE_CELL',
      locator_value: 'models!A2',
    });

    // Staging a canonical-looking, high-confidence value must not change an
    // active surface until that exact assertion receives a valid claim.
    await fixtures.store.stageSourceAlias({
      ...sourceAlias(fixtures, 'presentation-switch', filing.source.id),
      normalized_value: 'presentation-switch',
      identity_confidence: identityConfidence(1),
    });

    expect(await fixtures.store.listAliases(fixtures.entity.id)).toContainEqual(
      expect.objectContaining({
        id: alias.id,
        alias_value: 'Certifier spelling',
        source_id: certifier.source.id,
        identity_confidence: 0.98,
      }),
    );

    await supersedeSourceRecord(fixtures, certifier.record);
    expect(await fixtures.store.listAliases(fixtures.entity.id)).toContainEqual(
      expect.objectContaining({
        id: alias.id,
        alias_value: 'Manufacturer spelling',
        source_id: manufacturer.source.id,
        identity_confidence: 0.71,
      }),
    );
  });

  it('uses code-unit ordering after canonical spelling and source authority tie', async () => {
    fixtures = await createFixtures({ trigram: false });
    const editorial = fixtures.sources.editorial;
    const standards = fixtures.sources.editorial_standards;
    const alias = await fixtures.store.stageSourceAlias({
      ...sourceAlias(fixtures, 'abc-200', editorial.source.id),
      normalized_value: 'abc200',
    });
    await fixtures.store.recordSourceAliasClaim({
      entity_alias_id: alias.id,
      asserted_alias_value: 'abc-200',
      asserted_normalized_value: 'abc200',
      identity_confidence: identityConfidence(0.8),
      source_record_id: editorial.record.id,
      locator_type: 'JSON_POINTER',
      locator_value: '/lower',
    });
    await fixtures.store.stageSourceAlias({
      ...sourceAlias(fixtures, 'ABC-200', standards.source.id),
      normalized_value: 'abc200',
    });
    await fixtures.store.recordSourceAliasClaim({
      entity_alias_id: alias.id,
      asserted_alias_value: 'ABC-200',
      asserted_normalized_value: 'abc200',
      identity_confidence: identityConfidence(0.8),
      source_record_id: standards.record.id,
      locator_type: 'JSON_POINTER',
      locator_value: '/upper',
    });

    expect(await fixtures.store.listAliases(fixtures.entity.id)).toContainEqual(
      expect.objectContaining({
        id: alias.id,
        alias_value: 'ABC-200',
        source_id: standards.source.id,
      }),
    );
  });

  it('uses confidence deterministically when all display-selection keys tie', async () => {
    fixtures = await createFixtures({ trigram: false });
    const source = fixtures.sources.manufacturer;
    const alias = await fixtures.store.stageSourceAlias({
      ...sourceAlias(fixtures, 'Same presentation', source.source.id),
      normalized_value: 'confidence-tie',
    });
    await fixtures.driver.query(
      `INSERT INTO entity_alias_claims (
         id, entity_alias_id, asserted_alias_value, asserted_normalized_value,
         identity_confidence, claim_kind, source_id, source_record_id, authority_epoch,
         locator_type, locator_value, valid_to
       ) VALUES
         ('00000000-0000-4000-8000-000000000001', $1, 'Same presentation',
          'confidence-tie', 0.4, 'SOURCE_RECORD', $2, $3, 0,
          'JSON_POINTER', '/low', NULL),
         ('ffffffff-ffff-4fff-bfff-fffffffffff0', $1, 'Same presentation',
          'confidence-tie', 0.9, 'SOURCE_RECORD', $2, $3, 0,
          'JSON_POINTER', '/high', NULL)`,
      [alias.id, source.source.id, source.record.id],
    );

    expect(await fixtures.store.listAliases(fixtures.entity.id)).toContainEqual(
      expect.objectContaining({
        id: alias.id,
        alias_value: 'Same presentation',
        source_id: source.source.id,
        identity_confidence: 0.9,
      }),
    );
  });

  it('rejects a source claim whose asserted normalized identity differs from the staged alias', async () => {
    fixtures = await createFixtures({ trigram: false });
    const alias = await fixtures.store.stageSourceAlias(sourceAlias(fixtures, 'BOUND-ALIAS'));

    await expect(fixtures.store.recordSourceAliasClaim({
      entity_alias_id: alias.id,
      asserted_alias_value: 'UNRELATED-ASSERTION',
      asserted_normalized_value: 'unrelated-assertion',
      identity_confidence: identityConfidence(0.96),
      source_record_id: fixtures.sources.manufacturer.record.id,
      locator_type: 'JSON_POINTER',
      locator_value: '/products/0/model',
    })).rejects.toThrow(/normalized alias identity/i);

    expect((await fixtures.store.listAliases(fixtures.entity.id)).map((item) => item.id))
      .not.toContain(alias.id);
  });

  it('rolls back the alias row when curated claim insertion fails on a generic executor', async () => {
    fixtures = await createFixtures({ trigram: false });
    await fixtures.driver.exec(`
      CREATE OR REPLACE FUNCTION reject_atomic_alias_claim()
      RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.asserted_alias_value = 'ATOMIC-FAIL' THEN
          RAISE EXCEPTION 'synthetic curated claim rejection';
        END IF;
        RETURN NEW;
      END;
      $$;
      CREATE TRIGGER reject_atomic_alias_claim_trigger
        BEFORE INSERT ON entity_alias_claims
        FOR EACH ROW EXECUTE FUNCTION reject_atomic_alias_claim();
    `);

    await expect(fixtures.store.addAlias({
      ...sourceAlias(fixtures, 'ATOMIC-FAIL'),
      normalized_value: 'atomic-fail',
    }, fixtures.driver)).rejects.toThrow(/synthetic curated claim rejection/i);

    expect(await fixtures.driver.query(
      `SELECT id FROM entity_aliases
        WHERE entity_id = $1 AND alias_type = 'external_id' AND normalized_value = 'atomic-fail'`,
      [fixtures.entity.id],
    )).toEqual([]);
  });
});
